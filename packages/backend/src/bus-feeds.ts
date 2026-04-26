import * as GtfsRt from "gtfs-realtime-bindings";
import type { Redis } from "ioredis";
import type { BusGtfsCache } from "./bus-gtfs";
import type { ArrivalTime } from "./types";

const BUS_RT_URL = "https://gtfsrt.prod.obanyc.com/tripUpdates";
const CACHE_KEY = "feed:bus-tripUpdates";
const CACHE_TTL_SECS = 30;

// ── Feed fetch ────────────────────────────────────────────────────────────────

async function fetchBusFeed(
  redis: Redis
): Promise<GtfsRt.transit_realtime.FeedMessage> {
  try {
    const cached = await redis.getBuffer(CACHE_KEY);
    if (cached) {
      return GtfsRt.transit_realtime.FeedMessage.decode(new Uint8Array(cached));
    }
  } catch {
    // Redis unavailable – fall through
  }

  const res = await fetch(BUS_RT_URL);
  if (!res.ok) throw new Error(`Bus feed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  try {
    await redis.set(CACHE_KEY, buf, "EX", CACHE_TTL_SECS);
  } catch {
    // Redis unavailable
  }

  return GtfsRt.transit_realtime.FeedMessage.decode(new Uint8Array(buf));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSecs(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface BusStopArrivals {
  /** direction_id 0 */
  dir0: ArrivalTime[];
  /** direction_id 1 */
  dir1: ArrivalTime[];
}

export async function getBusArrivalsForStops(
  stopIds: string[],
  gtfs: BusGtfsCache,
  redis: Redis
): Promise<Map<string, BusStopArrivals>> {
  let feed: GtfsRt.transit_realtime.FeedMessage;
  try {
    feed = await fetchBusFeed(redis);
  } catch (err) {
    console.error("[bus-feeds]", err instanceof Error ? err.message : err);
    return new Map(stopIds.map((id) => [id, { dir0: [], dir1: [] }]));
  }

  const stopSet = new Set(stopIds);
  const nowSecs = Math.floor(Date.now() / 1000);

  interface RawArrival {
    directionId: number;
    epochSecs: number;
    routeId: string;
  }

  const rawByStop = new Map<string, RawArrival[]>();

  for (const entity of feed.entity) {
    const tu = entity.tripUpdate;
    if (!tu) continue;
    const routeId = String(tu.trip?.routeId ?? "");
    const directionId = Number(tu.trip?.directionId ?? 0);

    for (const stu of tu.stopTimeUpdate ?? []) {
      const sid = stu.stopId ?? "";
      if (!stopSet.has(sid)) continue;
      const epoch = toSecs(stu.arrival?.time ?? stu.departure?.time);
      if (!epoch || epoch < nowSecs - 30) continue;

      if (!rawByStop.has(sid)) rawByStop.set(sid, []);
      rawByStop.get(sid)!.push({ directionId, epochSecs: epoch, routeId });
    }
  }

  const result = new Map<string, BusStopArrivals>();

  for (const stopId of stopIds) {
    const raw = (rawByStop.get(stopId) ?? []).sort(
      (a, b) => a.epochSecs - b.epochSecs
    );

    const toArrivalTime = (a: RawArrival): ArrivalTime => {
      const minutes = Math.round((a.epochSecs - nowSecs) / 60);
      const headsign =
        gtfs.routeDirHeadsign.get(`${a.routeId}:${a.directionId}`) ?? "";
      return {
        routeId: a.routeId,
        headsign,
        minutes: Math.max(0, minutes),
        urgent: minutes <= 2,
      };
    };

    result.set(stopId, {
      dir0: raw.filter((a) => a.directionId === 0).slice(0, 5).map(toArrivalTime),
      dir1: raw.filter((a) => a.directionId === 1).slice(0, 5).map(toArrivalTime),
    });
  }

  return result;
}
