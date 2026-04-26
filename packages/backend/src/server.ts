import express from "express";
import cors from "cors";
import { Redis } from "ioredis";
import { getGtfs } from "./gtfs";
import { stationsWithinWalk } from "./geo";
import { getArrivalsForStations } from "./feeds";
import type { ArrivalsResponse, StationResult } from "./types";

// ── RTF card builder ──────────────────────────────────────────────────────────

function buildRtf(station: StationResult): string {
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");

  const allArrivals = [
    ...station.northbound.arrivals,
    ...station.southbound.arrivals,
  ].sort((a, b) => a.minutes - b.minutes);

  const header = `${esc(station.name)} \\emdash  ${station.walkMinutes} min walk`;

  // tab stops: 1440 twips = 1" (route), 5040 twips = 3.5" (headsign), arrives after
  const TAB_DEFS = "\\tx1440\\tx5040";

  const rows = allArrivals.map((a) => {
    const arrives = a.minutes === 0 ? "now" : `${a.minutes} min`;
    return `\\pard ${TAB_DEFS} ${esc(a.routeId)}\\t${esc(a.headsign)}\\t${esc(arrives)}\\par`;
  });

  return [
    "{\\rtf1\\ansi\\deff0",
    "{\\fonttbl{\\f0\\fswiss\\fcharset0 Helvetica;}}",
    "\\f0\\fs24",
    `\\pard\\b ${header}\\b0\\par`,
    "\\pard\\par",
    `\\pard ${TAB_DEFS}\\b Route\\tHeadsign\\tArrives\\b0\\par`,
    ...rows,
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] listening on port ${PORT}`);
});

// Kick off GTFS load immediately so first request is fast
getGtfs().catch((e) => console.error("[gtfs] preload failed:", e.message));
