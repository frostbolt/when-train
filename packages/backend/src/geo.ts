import type { Station } from "./gtfs";

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearestStations(
  userLat: number,
  userLng: number,
  stations: Station[],
  n = 3
): (Station & { distMeters: number })[] {
  return stations
    .map((s) => ({ ...s, distMeters: haversineMeters(userLat, userLng, s.lat, s.lng) }))
    .sort((a, b) => a.distMeters - b.distMeters)
    .slice(0, n);
}

/** Return every station reachable within `maxWalkMinutes` at 1.4 m/s, sorted by distance. */
export function stationsWithinWalk(
  userLat: number,
  userLng: number,
  stations: Station[],
  maxWalkMinutes = 15
): (Station & { distMeters: number })[] {
  const maxMeters = maxWalkMinutes * 60 * 1.4;
  return stations
    .map((s) => ({ ...s, distMeters: haversineMeters(userLat, userLng, s.lat, s.lng) }))
    .filter((s) => s.distMeters <= maxMeters)
    .sort((a, b) => a.distMeters - b.distMeters);
}
