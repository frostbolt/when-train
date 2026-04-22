import AdmZip from "adm-zip";

const GTFS_ZIP_URL =
  "http://web.mta.info/developers/data/nyct/subway/google_transit.zip";

export interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface GtfsCache {
  stations: Station[];
  parentToChildren: Map<string, string[]>;
  /** GTFS-RT short trip_id (e.g. "055800_N..S74R") → headsign */
  tripHeadsign: Map<string, string>;
}

// ── CSV parser ────────────────────────────────────────────────────────────────

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

// ── Loader ────────────────────────────────────────────────────────────────────

let _promise: Promise<GtfsCache> | null = null;

export function getGtfs(): Promise<GtfsCache> {
  if (!_promise) _promise = load();
  return _promise;
}

async function load(): Promise<GtfsCache> {
  console.log("[gtfs] Downloading static data…");
  const res = await fetch(GTFS_ZIP_URL);
  if (!res.ok) throw new Error(`GTFS download: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`[gtfs] Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  const zip = new AdmZip(buf);

  // ── stops.txt ──────────────────────────────────────────────────────────────
  const stopsEntry = zip.getEntry("stops.txt");
  if (!stopsEntry) throw new Error("stops.txt missing from GTFS zip");
  const stopsRows = parseCSV(stopsEntry.getData().toString("utf8"));

  const stations: Station[] = [];
  const parentToChildren = new Map<string, string[]>();

  for (const row of stopsRows) {
    if ((row["location_type"] ?? "") === "1") {
      const lat = parseFloat(row["stop_lat"] ?? "");
      const lng = parseFloat(row["stop_lon"] ?? "");
      if (isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0)) {
        stations.push({ id: row["stop_id"], name: row["stop_name"], lat, lng });
      }
    }
  }

  for (const row of stopsRows) {
    const lt = row["location_type"] ?? "";
    const parent = row["parent_station"] ?? "";
    if ((lt === "0" || lt === "") && parent) {
      if (!parentToChildren.has(parent)) parentToChildren.set(parent, []);
      parentToChildren.get(parent)!.push(row["stop_id"]);
    }
  }

  // ── trips.txt ──────────────────────────────────────────────────────────────
  // Static trip_ids: "AFA25GEN-1038-Weekday-00_055800_N..S74R"
  // RT trip_ids use just the suffix after the first "_": "055800_N..S74R"
  const tripHeadsign = new Map<string, string>();
  const tripsEntry = zip.getEntry("trips.txt");
  if (tripsEntry) {
    const tripsRows = parseCSV(tripsEntry.getData().toString("utf8"));
    for (const row of tripsRows) {
      const hs = row["trip_headsign"];
      if (!hs) continue;
      const tid = row["trip_id"];
      tripHeadsign.set(tid, hs);
      const cut = tid.indexOf("_");
      if (cut !== -1) tripHeadsign.set(tid.slice(cut + 1), hs);
    }
  }

  console.log(
    `[gtfs] ${stations.length} stations, ${tripHeadsign.size} headsigns`
  );
  return { stations, parentToChildren, tripHeadsign };
}
