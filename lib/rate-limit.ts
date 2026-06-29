/**
 * Minimal fixed-window rate limiter (in-memory).
 *
 * Keyed per client IP + bucket name. Deliberately demo-grade: the counters live
 * in the process, so they're per-serverless-instance and reset on cold start. A
 * production deployment behind multiple instances would back this with a shared
 * store (e.g. Upstash Redis / Cloudflare KV) — the call sites wouldn't change.
 */

interface Window {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as { __vellumRL?: Map<string, Window> };
const windows: Map<string, Window> = (g.__vellumRL ??= new Map());

export interface RateLimitResult {
  ok: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Seconds until the window resets (for the Retry-After header). */
  retryAfter: number;
}

/**
 * Record a hit against `key` and report whether it's within `limit` per
 * `windowMs`. `now` is injectable for tests.
 */
export function rateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  if (w.count >= limit) {
    return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }
  w.count += 1;
  return { ok: true, remaining: limit - w.count, retryAfter: 0 };
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Clear all counters — test helper. */
export function __resetRateLimit(): void {
  windows.clear();
}
