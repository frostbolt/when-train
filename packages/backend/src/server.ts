import express from "express";
import cors from "cors";
import { getGtfs } from "./gtfs";
import { getBusGtfs, type BusStop } from "./bus-gtfs";
import { stationsWithinWalk, haversineMeters } from "./geo";
import { getArrivalsForStations } from "./feeds";
import { getBusArrivalsForStops } from "./bus-feeds";
import type { ArrivalsResponse, StationResult } from "./types";

// ── HTML card builder ─────────────────────────────────────────────────────────

function buildHtml(station: StationResult): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

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
  const routePrefix = uniqueRoutes.length ? uniqueRoutes.join(", ") + " — " : "";
  const headerLine =
    `${routePrefix}${esc(station.name)} — ${station.walkMinutes} min walk`;

  const fmtMin = (n: number) => (n === 0 ? "now" : `${n} min`);
  const fmtRest = (xs: number[]) =>
    xs.length === 0 ? "—" : xs.slice(0, 4).join(", ") + " min";

  const trs = rows.map((r) =>
    `      <tr><td>${esc(r.headsign)}</td><td>${fmtMin(r.minutes[0])}</td><td>${fmtRest(r.minutes.slice(1))}</td></tr>`,
  ).join("\n");

  const body = rows.length === 0
    ? "    <p>No arrivals available.</p>"
    : `    <table border="1" cellpadding="6" cellspacing="0">
      <thead>
        <tr><th>Headsign</th><th>Next</th><th>Then in</th></tr>
      </thead>
      <tbody>
${trs}
      </tbody>
    </table>`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(station.name)}</title>
    <style>
      body {
        max-width: 640px;
        margin: 2rem auto;
        padding: 0 1rem;
        font: 15px/1.4 -apple-system, system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    <h2>${headerLine}</h2>
${body}
  </body>
</html>
`;
}

const PORT = parseInt(process.env.PORT ?? "3001", 10);

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
      gtfs
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
      gtfs
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

    const html = buildHtml(stations[0]);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=25");
    res.send(html);
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
    const arrivalsMap = await getBusArrivalsForStops(allStopIds, gtfs);

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
