import type { ArrivalsResponse } from "./types.js";

export async function fetchArrivals(
  lat: number,
  lng: number
): Promise<ArrivalsResponse> {
  const res = await fetch(`/api/arrivals?lat=${lat}&lng=${lng}`);
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json() as Promise<ArrivalsResponse>;
}
