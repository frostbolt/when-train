import AdmZip from "adm-zip";

// All six MTA bus GTFS feeds (NYCT boroughs + MTA Bus Company)
const BUS_GTFS_URLS = [
  "http://web.mta.info/developers/data/nyct/bus/google_transit_manhattan.zip",
  "http://web.mta.info/developers/data/nyct/bus/google_transit_brooklyn.zip",
  "http://web.mta.info/developers/data/nyct/bus/google_transit_bronx.zip",
  "http://web.mta.info/developers/data/nyct/bus/google_transit_queens.zip",
  "http://web.mta.info/developers/data/nyct/bus/google_transit_staten_island.zip",
  "http://web.mta.info/developers/data/busco/google_transit.zip",
];

export interface BusStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface BusGtfsCache {
  stops: BusStop[];
  /** "routeId:directionId" → headsign (first found wins) */
  routeDirHeadsign: Map<string, string>;
}

// ── CSV parser (same logic as gtfs.ts) ───────────────────────────────────────

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; }
    else if (c === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseCSV(data: string): Record<string, string>[] {
  const lines = data.split("\n");
  if (lines.length < 2) return [];
  const headers = parseLine(lines[0].replace(/\r$/, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "").trim();
    if (!line) continue;
    const vals = parseLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => (obj[h.trim()] = (vals[idx] ?? "").trim()));
    rows.push(obj);
  }
  return rows;
}

// ── Per-zip loader ────────────────────────────────────────────────────────────

async function loadOneZip(
  url: string
): Promise<{ stops: BusStop[]; headsigns: Map<string, string> }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);

  const stops: BusStop[] = [];
  const stopsEntry = zip.getEntry("stops.txt");
  if (stopsEntry) {
    for (const row of parseCSV(stopsEntry.getData().toString("utf8"))) {
      const lat = parseFloat(row["stop_lat"] ?? "");
      const lng = parseFloat(row["stop_lon"] ?? "");
      if (isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0)) {
        stops.push({ id: row["stop_id"] ?? "", name: row["stop_name"] ?? "", lat, lng });
      }
    }
  }

  const headsigns = new Map<string, string>();
  const tripsEntry = zip.getEntry("trips.txt");
  if (tripsEntry) {
    for (const row of parseCSV(tripsEntry.getData().toString("utf8"))) {
      const hs = row["trip_headsign"];
      if (!hs) continue;
      const key = `${row["route_id"] ?? ""}:${row["direction_id"] ?? "0"}`;
      if (!headsigns.has(key)) headsigns.set(key, hs);
    }
  }

  return { stops, headsigns };
}

// ── Cached loader ─────────────────────────────────────────────────────────────

let _promise: Promise<BusGtfsCache> | null = null;

export function getBusGtfs(): Promise<BusGtfsCache> {
  if (!_promise) _promise = load();
  return _promise;
}

async function load(): Promise<BusGtfsCache> {
  console.log("[bus-gtfs] Downloading static data from", BUS_GTFS_URLS.length, "feeds…");
  const results = await Promise.allSettled(BUS_GTFS_URLS.map(loadOneZip));

  const stopMap = new Map<string, BusStop>();
  const routeDirHeadsign = new Map<string, string>();

  for (const r of results) {
    if (r.status === "rejected") {
      console.warn("[bus-gtfs] Failed to load a zip:", String(r.reason));
      continue;
    }
    for (const s of r.value.stops) {
      if (!stopMap.has(s.id)) stopMap.set(s.id, s);
    }
    for (const [k, v] of r.value.headsigns) {
      if (!routeDirHeadsign.has(k)) routeDirHeadsign.set(k, v);
    }
  }

  const stops = Array.from(stopMap.values());
  console.log(`[bus-gtfs] ${stops.length} stops, ${routeDirHeadsign.size} route/dir headsigns`);
  return { stops, routeDirHeadsign };
}
