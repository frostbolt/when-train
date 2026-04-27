import express from "express";
import cors from "cors";
import { Redis } from "ioredis";
import { getGtfs } from "./gtfs";
import { getBusGtfs, type BusStop } from "./bus-gtfs";
import { stationsWithinWalk, haversineMeters } from "./geo";
import { getArrivalsForStations } from "./feeds";
import { getBusArrivalsForStops } from "./bus-feeds";
import type { ArrivalsResponse, StationResult } from "./types";

// ── RTF card builder ──────────────────────────────────────────────────────────

function buildRtf(station: StationResult): string {
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");

  // Group arrivals by route + headsign so each row is a single destination.
  type Group = { routeId: string; headsign: string; minutes: number[] };
  const groups = new Map<string, Group>();
  const collect = (
    arrivals: { routeId: string; headsign: string; minutes: number }[],
    fallback: string,
  ) => {
    for (const a of arrivals) {
      const headsign = a.headsign || fallback;
      const key = `${a.routeId}|${headsign}`;
      const g = groups.get(key);
      if (g) g.minutes.push(a.minutes);
      else groups.set(key, { routeId: a.routeId, headsign, minutes: [a.minutes] });
    }
  };
  collect(station.northbound.arrivals, "Northbound");
  collect(station.southbound.arrivals, "Southbound");

  const rows = Array.from(groups.values())
    .map((g) => ({ ...g, minutes: g.minutes.slice().sort((a, b) => a - b) }))
    .sort((a, b) => a.minutes[0] - b.minutes[0]);

  const uniqueRoutes = Array.from(new Set(rows.map((r) => r.routeId)));
  const routePrefix = uniqueRoutes.length ? uniqueRoutes.join(", ") + " \\emdash  " : "";
  const headerLine =
    `${routePrefix}${esc(station.name)} \\emdash  ${station.walkMinutes} min walk`;

  const fmtMin = (n: number) => (n === 0 ? "now" : `${n} min`);
  const fmtRest = (xs: number[]) =>
    xs.length === 0 ? "\\emdash " : xs.slice(0, 4).join(", ") + " min";

  // Native RTF table — Quick Look (NSAttributedString) renders these.
  // cellx is the cumulative right-edge in twips (1440 twips = 1 inch).
  const C1 = 4400; // Headsign  (~3.0")
  const C2 = 5800; // Next      (~1.0")
  const C3 = 9200; // Then in   (~2.4")

  const ruled = "\\clbrdrt\\brdrs\\brdrw15\\clbrdrb\\brdrs\\brdrw15";
  const headerCells =
    `${ruled}\\cellx${C1}${ruled}\\cellx${C2}${ruled}\\cellx${C3}`;
  const dataCells = `\\cellx${C1}\\cellx${C2}\\cellx${C3}`;
  const closeCells =
    `\\clbrdrt\\brdrs\\brdrw15\\cellx${C1}` +
    `\\clbrdrt\\brdrs\\brdrw15\\cellx${C2}` +
    `\\clbrdrt\\brdrs\\brdrw15\\cellx${C3}`;

  const tableHeader = [
    `\\trowd\\trgaph108${headerCells}`,
    `\\pard\\intbl\\b Headsign\\cell Next\\cell Then in\\cell\\b0\\row`,
  ].join("\n");

  const dataRows = rows.map((r) =>
    [
      `\\trowd\\trgaph108${dataCells}`,
      `\\pard\\intbl ${esc(r.headsign)}\\cell ${fmtMin(r.minutes[0])}\\cell ${fmtRest(r.minutes.slice(1))}\\cell\\row`,
    ].join("\n"),
  );

  // Empty border-only row to draw the bottom rule.
  const tableFooter = [
    `\\trowd\\trgaph108${closeCells}`,
    `\\pard\\intbl\\cell\\cell\\cell\\row`,
  ].join("\n");

  const body = rows.length === 0
    ? ["\\pard No arrivals available.\\par"]
    : [tableHeader, ...dataRows, tableFooter];

  return [
    "{\\rtf1\\ansi\\deff0",
    "{\\fonttbl{\\f0\\fswiss\\fcharset0 Helvetica;}}",
    "\\f0\\fs28",
    `\\pard\\b ${headerLine}\\b0\\par`,
    "\\pard\\fs24\\par",
    ...body,
    "\\pard\\par",
    "}",
  ].join("\n");
}

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// ── Redis ─────────────────────────────────────────────────────────────────────

const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
});

let redisOk = false;
redis.on("connect", () => { redisOk = true; console.log("[redis] connected"); });
redis.on("error", (e) => { if (redisOk || !e.message.includes("ECONNREFUSED")) console.warn("[redis]", e.message); });
redis.connect().catch(() => {/* handled by error event */});

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/arrivals", async (req, res) => {
  try {
    const rawLat = req.query.lat as string | undefined;
    const rawLng = req.query.lng as string | undefined;

    if (!rawLat || !rawLng) {
      res.status(400).json({ error: "lat and lng are required" });
      return;
    }

    const lat = parseFloat(rawLat);
    const lng = parseFloat(rawLng);

    if (!isFinite(lat) || !isFinite(lng)) {
      res.status(400).json({ error: "Invalid lat/lng" });
      return;
    }

    const gtfs = await getGtfs();
    const nearest = stationsWithinWalk(lat, lng, gtfs.stations, 15);
    const arrivals = await getArrivalsForStations(
      nearest.map((s) => s.id),
      gtfs,
      redis
    );

    const stations: StationResult[] = nearest.map((s) => {
      const a = arrivals.get(s.id) ?? { northbound: [], southbound: [] };
      return {
        id: s.id,
        name: s.name,
        walkMinutes: Math.round(s.distMeters / 1.4 / 60),
        northbound: { arrivals: a.northbound },
        southbound: { arrivals: a.southbound },
      };
    });

    const body: ArrivalsResponse = { stations, fetchedAt: Date.now() };
    // Let the client know it can reuse this response for up to 25 s
    res.setHeader("Cache-Control", "public, max-age=25");
    res.json(body);
  } catch (err) {
    console.error("[server] /api/arrivals error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

app.get("/api/arrivals/card", async (req, res) => {
  try {
    const rawLat = req.query.lat as string | undefined;
    const rawLng = req.query.lng as string | undefined;

    if (!rawLat || !rawLng) {
      res.status(400).send("lat and lng are required");
      return;
    }

    const lat = parseFloat(rawLat);
    const lng = parseFloat(rawLng);

    if (!isFinite(lat) || !isFinite(lng)) {
      res.status(400).send("Invalid lat/lng");
      return;
    }

    const gtfs = await getGtfs();
    const nearest = stationsWithinWalk(lat, lng, gtfs.stations, 15);

    if (nearest.length === 0) {
      res.status(404).send("No stations found nearby");
      return;
    }

    const arrivals = await getArrivalsForStations(
      nearest.map((s) => s.id),
      gtfs,
      redis
    );

    const stations: StationResult[] = nearest.map((s) => {
      const a = arrivals.get(s.id) ?? { northbound: [], southbound: [] };
      return {
        id: s.id,
        name: s.name,
        walkMinutes: Math.round(s.distMeters / 1.4 / 60),
        northbound: { arrivals: a.northbound },
        southbound: { arrivals: a.southbound },
      };
    });

    const rtf = buildRtf(stations[0]);

    res.setHeader("Content-Type", "application/rtf");
    res.setHeader("Content-Disposition", 'inline; filename="arrivals.rtf"');
    res.setHeader("Cache-Control", "public, max-age=25");
    res.send(rtf);
  } catch (err) {
    console.error("[server] /api/arrivals/card error:", err);
    res.status(500).send(
      err instanceof Error ? err.message : "Internal server error"
    );
  }
});

// ── Bus stop clustering ───────────────────────────────────────────────────────

const BUS_WALK_METERS = 840; // ~10 min walk at 1.4 m/s
const CLUSTER_RADIUS_M = 40; // stops within 40m are at the same corner

interface StopWithDist extends BusStop { distMeters: number }

interface BusStopCluster {
  id: string;
  name: string;
  distMeters: number;
  allIds: string[];
}

function clusterBusStops(
  userLat: number,
  userLng: number,
  stops: BusStop[],
  maxResults = 3
): BusStopCluster[] {
  const nearby: StopWithDist[] = stops
    .map((s) => ({ ...s, distMeters: haversineMeters(userLat, userLng, s.lat, s.lng) }))
    .filter((s) => s.distMeters <= BUS_WALK_METERS)
    .sort((a, b) => a.distMeters - b.distMeters);

  const clusters: BusStopCluster[] = [];
  const used = new Set<string>();

  for (const stop of nearby) {
    if (used.has(stop.id)) continue;
    const cluster: BusStopCluster = {
      id: stop.id,
      name: stop.name,
      distMeters: stop.distMeters,
      allIds: [stop.id],
    };
    used.add(stop.id);
    // Collect other nearby stops that share the same corner
    for (const other of nearby) {
      if (used.has(other.id)) continue;
      if (haversineMeters(stop.lat, stop.lng, other.lat, other.lng) <= CLUSTER_RADIUS_M) {
        cluster.allIds.push(other.id);
        used.add(other.id);
      }
    }
    clusters.push(cluster);
    if (clusters.length >= maxResults) break;
  }

  return clusters;
}

// ── Bus arrivals endpoint ─────────────────────────────────────────────────────

app.get("/api/bus-arrivals", async (req, res) => {
  try {
    const rawLat = req.query.lat as string | undefined;
    const rawLng = req.query.lng as string | undefined;
    if (!rawLat || !rawLng) { res.status(400).json({ error: "lat and lng are required" }); return; }
    const lat = parseFloat(rawLat);
    const lng = parseFloat(rawLng);
    if (!isFinite(lat) || !isFinite(lng)) { res.status(400).json({ error: "Invalid lat/lng" }); return; }

    const gtfs = await getBusGtfs();
    const clusters = clusterBusStops(lat, lng, gtfs.stops);

    // Collect all stop IDs across all clusters
    const allStopIds = clusters.flatMap((c) => c.allIds);
    const arrivalsMap = await getBusArrivalsForStops(allStopIds, gtfs, redis);

    const stations: StationResult[] = clusters.map((cluster) => {
      // Merge arrivals from all stop IDs in this cluster
      const dir0: import("./types").ArrivalTime[] = [];
      const dir1: import("./types").ArrivalTime[] = [];
      for (const stopId of cluster.allIds) {
        const a = arrivalsMap.get(stopId);
        if (a) { dir0.push(...a.dir0); dir1.push(...a.dir1); }
      }
      // Re-sort merged arrivals by minutes and deduplicate route+time combos
      const dedupe = (arr: import("./types").ArrivalTime[]) => {
        const seen = new Set<string>();
        return arr
          .sort((a, b) => a.minutes - b.minutes)
          .filter((a) => { const k = `${a.routeId}:${a.minutes}`; if (seen.has(k)) return false; seen.add(k); return true; })
          .slice(0, 5);
      };
      return {
        id: cluster.id,
        name: cluster.name,
        walkMinutes: Math.round(cluster.distMeters / 1.4 / 60),
        northbound: { arrivals: dedupe(dir0) },
        southbound: { arrivals: dedupe(dir1) },
      };
    });

    const body: ArrivalsResponse = { stations, fetchedAt: Date.now() };
    res.setHeader("Cache-Control", "public, max-age=25");
    res.json(body);
  } catch (err) {
    console.error("[server] /api/bus-arrivals error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] listening on port ${PORT}`);
});

// Kick off GTFS load immediately so first request is fast
getGtfs().catch((e) => console.error("[gtfs] preload failed:", e.message));
getBusGtfs().catch((e) => console.error("[bus-gtfs] preload failed:", e.message));
