import type { ArrivalsResponse } from "./types.js";

async function apiFetch(path: string, lat: number, lng: number): Promise<ArrivalsResponse> {
  const res = await fetch(`${path}?lat=${lat}&lng=${lng}`);
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json() as Promise<ArrivalsResponse>;
}

export function fetchArrivals(lat: number, lng: number): Promise<ArrivalsResponse> {
  return apiFetch("/api/arrivals", lat, lng);
}

export function fetchBusArrivals(lat: number, lng: number): Promise<ArrivalsResponse> {
  return apiFetch("/api/bus-arrivals", lat, lng);
}
