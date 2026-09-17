import type { NextFunction, Request, Response } from "express";
import { errorResponse } from "./firebase-auth";

// SEC-01: fixed one-minute windows per uid and per client IP, kept in memory — the demo fleet runs one API
// process. Limits per group are listed in docs/ops-notes.md; change them there and here together.
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function resetRateLimits(): void {
  buckets.clear();
}

/** Counts one request against `key`; returns the window end when the limit is already reached, else 0. */
function take(key: string, limit: number, now: number): number {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return 0;
  }
  if (bucket.count >= limit) return bucket.resetAt;
  bucket.count += 1;
  return 0;
}

/**
 * Per-minute limits for one group of endpoints. Mount right after `firebaseIdentity`: the uid is known by then
 * and nothing has read the database yet, so a flood is refused before it costs a membership lookup.
 */
export function rateLimit(group: string, perUid: number, perIp: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (buckets.size > 10_000) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
    }
    // The uid bucket goes first so an exhausted account cannot drain the client bucket it shares with everyone else.
    // `req.ip` is the socket peer until `trust proxy` is set (docs/ops-notes.md): behind Replit's proxy every caller
    // shares one client key, so the per-client limit is a fleet-wide ceiling there — never a key an attacker can pick.
    const uid = req.firebaseIdentity?.uid;
    const resetAt = (uid ? take(`${group}:uid:${uid}`, perUid, now) : 0) || take(`${group}:ip:${req.ip}`, perIp, now);
    if (!resetAt) {
      next();
      return;
    }
    req.log.warn({ code: "rate_limited", group, uid }, "Rate limit exceeded");
    res.setHeader("Retry-After", Math.max(1, Math.ceil((resetAt - now) / 1000)));
    errorResponse(res, 429, "Too many requests, slow down", "RATE_LIMITED");
  };
}
