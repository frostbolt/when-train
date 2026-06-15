import * as GtfsRt from "gtfs-realtime-bindings";
import { fetchBytesCached } from "./cache";
import type { GtfsCache } from "./gtfs";
import type { ArrivalTime } from "./types";

const MTA_BASE =
  "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F";

const CACHE_TTL_SECS = 30;

// ── Feed routing ──────────────────────────────────────────────────────────────

export function feedForStopId(stopId: string): string {
  const c = stopId[0] ?? "";
  if ("123456789".includes(c)) return "gtfs-1234567";
  if ("ACE H".includes(c)) return "gtfs-ace";          // H = Rockaway shuttle
  if ("BDFM".includes(c)) return "gtfs-bdfm";
  if (c === "G") return "gtfs-g";
  if ("JZ".includes(c)) return "gtfs-jz";
  if (c === "L") return "gtfs-l";
  if ("NQRW".includes(c)) return "gtfs-nqrw";
  if (c === "S") return "gtfs-si";
  return "gtfs-nqrw";
}

// ── Cached feed fetch ─────────────────────────────────────────────────────────

async function fetchFeedWithCache(
  feedName: string
): Promise<GtfsRt.transit_realtime.FeedMessage> {
  const buf = await fetchBytesCached(
    `feed:${feedName}`,
    `${MTA_BASE}${feedName}`,
    CACHE_TTL_SECS
  );
  return GtfsRt.transit_realtime.FeedMessage.decode(new Uint8Array(buf));
}

// ── Arrival extraction ────────────────────────────────────────────────────────

function toSecs(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

interface RawArrival {
  direction: "N" | "S";
  epochSecs: number;
  routeId: string;
  tripId: string;
}

function extractArrivals(
  childIds: string[],
  feed: GtfsRt.transit_realtime.FeedMessage,
  nowSecs: number
): RawArrival[] {
  const childSet = new Set(childIds);
  const out: RawArrival[] = [];

  for (const entity of feed.entity) {
    const tu = entity.tripUpdate;
    if (!tu) continue;
    const routeId = String(tu.trip?.routeId ?? "");
    const tripId = String(tu.trip?.tripId ?? "");

    for (const stu of tu.stopTimeUpdate ?? []) {
      const sid = stu.stopId ?? "";
      if (!childSet.has(sid)) continue;
      const epoch = toSecs(stu.arrival?.time ?? stu.departure?.time);
      if (!epoch || epoch < nowSecs - 30) continue;
      out.push({
        direction: sid.endsWith("N") ? "N" : "S",
        epochSecs: epoch,
        routeId,
        tripId,
      });
    }
  }

  return out.sort((a, b) => a.epochSecs - b.epochSecs);
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface StationArrivals {
  northbound: ArrivalTime[];
  southbound: ArrivalTime[];
}

export async function getStationArrivals(
  stationId: string,
  gtfs: GtfsCache
): Promise<StationArrivals> {
  const children = gtfs.parentToChildren.get(stationId) ?? [];
  if (children.length === 0) return { northbound: [], southbound: [] };

  const feedName = feedForStopId(stationId);
  const nowSecs = Math.floor(Date.now() / 1000);

  let feed: GtfsRt.transit_realtime.FeedMessage;
  try {
    feed = await fetchFeedWithCache(feedName);
  } catch (err) {
    console.error(`[feeds] ${feedName}:`, err instanceof Error ? err.message : err);
    return { northbound: [], southbound: [] };
  }

  const raw = extractArrivals(children, feed, nowSecs);

  const toArrivalTime = (a: RawArrival): ArrivalTime => {
    const minutes = Math.round((a.epochSecs - nowSecs) / 60);
    return {
      routeId: a.routeId,
      headsign: gtfs.tripHeadsign.get(a.tripId) ?? "",
      minutes: Math.max(0, minutes),
      urgent: minutes <= 2,
    };
  };

  return {
    northbound: raw.filter((a) => a.direction === "N").slice(0, 5).map(toArrivalTime),
    southbound: raw.filter((a) => a.direction === "S").slice(0, 5).map(toArrivalTime),
  };
}

/** Fetch arrivals for multiple stations concurrently, deduplicating feed calls. */
export async function getArrivalsForStations(
  stationIds: string[],
  gtfs: GtfsCache
): Promise<Map<string, StationArrivals>> {
  // Deduplicate feeds needed
  const feedToStations = new Map<string, string[]>();
  for (const sid of stationIds) {
    const feed = feedForStopId(sid);
    if (!feedToStations.has(feed)) feedToStations.set(feed, []);
    feedToStations.get(feed)!.push(sid);
  }

  // Fetch feeds concurrently
  const feedMessages = new Map<string, GtfsRt.transit_realtime.FeedMessage>();
  await Promise.all(
    Array.from(feedToStations.keys()).map(async (feedName) => {
      try {
        feedMessages.set(feedName, await fetchFeedWithCache(feedName));
      } catch (err) {
        console.error(
          `[feeds] ${feedName}:`,
          err instanceof Error ? err.message : err
        );
      }
    })
  );

  // Extract arrivals per station using already-fetched feeds
  const nowSecs = Math.floor(Date.now() / 1000);
  const result = new Map<string, StationArrivals>();

  for (const sid of stationIds) {
    const feedName = feedForStopId(sid);
    const feed = feedMessages.get(feedName);
    if (!feed) {
      result.set(sid, { northbound: [], southbound: [] });
      continue;
    }
    const children = gtfs.parentToChildren.get(sid) ?? [];
    const raw = extractArrivals(children, feed, nowSecs);

    const toArrivalTime = (a: RawArrival): ArrivalTime => {
      const minutes = Math.round((a.epochSecs - nowSecs) / 60);
      return {
        routeId: a.routeId,
        headsign: gtfs.tripHeadsign.get(a.tripId) ?? "",
        minutes: Math.max(0, minutes),
        urgent: minutes <= 2,
      };
    };

    result.set(sid, {
      northbound: raw.filter((a) => a.direction === "N").slice(0, 5).map(toArrivalTime),
      southbound: raw.filter((a) => a.direction === "S").slice(0, 5).map(toArrivalTime),
    });
  }

  return result;
}
