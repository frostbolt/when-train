// In-process TTL cache for raw GTFS-RT feed bytes.
//
// This replaces the former Redis cache. The only thing we ever cached was the
// raw protobuf bytes of each feed for a few seconds, and the deployment runs a
// single always-on instance — so a shared external cache buys nothing. A plain
// Map with per-key expiry does the job with zero extra processes or memory
// overhead, which is what lets the whole stack fit on a 1 GB e2-micro.

interface Entry {
  buf: Buffer;
  expiresAt: number; // epoch ms
}

const store = new Map<string, Entry>();

// Coalesce concurrent fetches for the same key so a cache miss under load
// triggers exactly one upstream request, not one per in-flight caller.
const inflight = new Map<string, Promise<Buffer>>();

/**
 * Return cached bytes for `key`, fetching from `url` on a miss. Concurrent
 * callers for the same key share a single fetch. Caches the raw response body
 * for `ttlSecs` seconds. Throws on a non-OK HTTP response.
 */
export async function fetchBytesCached(
  key: string,
  url: string,
  ttlSecs: number
): Promise<Buffer> {
  const hit = store.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.buf;
  if (hit) store.delete(key); // expired

  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    store.set(key, { buf, expiresAt: Date.now() + ttlSecs * 1000 });
    return buf;
  })();

  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}
