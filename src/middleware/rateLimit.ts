/**
 * Sliding window rate limiter using a Valkey sorted set.
 *
 * Key format:  rl:{identifier}
 * Score:       current Unix timestamp in milliseconds
 * Member:      correlationId (unique per request)
 *
 * Algorithm:
 * 1. Remove members older than (now - windowMs)
 * 2. Count remaining members
 * 3. If count >= limit → 429
 * 4. Add current request as member with score = now
 * 5. Set key TTL to windowSeconds + 1
 */
import { SLIDING_WINDOW_LUA } from "./operationRateLimit";
import type { Request, Response, NextFunction } from "express";
import type Redis from "ioredis";
import { getValkey } from "../lib/valkey";

// Hardcoded MVP constants — TODO: externalize to env vars post-MVP
const AUTHENTICATED_WINDOW_SECONDS = 60;
const AUTHENTICATED_MAX_REQUESTS = 60;
const UNAUTHENTICATED_WINDOW_SECONDS = 60;
const UNAUTHENTICATED_MAX_REQUESTS = 20;

/**
 * IMPORTANT
 *
 * This middleware runs before JWT verification.
 * It uses the last 16 chars of the raw JWT as an opaque identifier
 * - this is intentional coarse DOS protection only.
 *
 * It does NOT use `userId` from `req.auth` because auth hasn't run
 * yet at this point in the stack.
 */
export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const valkey: Redis = getValkey();
  const now = Date.now();

  const authHeader = req.headers["authorization"];
  const isAuthenticated = !!authHeader;
  const identifier = isAuthenticated
    ? `user:${authHeader?.split(" ")[1]?.slice(-16) ?? "unknown"}`
    : `ip:${req.ip}`;

  const windowSeconds = isAuthenticated
    ? AUTHENTICATED_WINDOW_SECONDS
    : UNAUTHENTICATED_WINDOW_SECONDS;
  const maxRequests = isAuthenticated
    ? AUTHENTICATED_MAX_REQUESTS
    : UNAUTHENTICATED_MAX_REQUESTS;

  const windowMs = windowSeconds * 1000;
  const key = `rl:${identifier}`;
  const cutoff = now - windowMs;
  const member = req.correlationId;

  /**
   * Important behavioral note:
   *
   * The Lua script returns the count of existing members BEFORE adding
   * the new memeber and skips 'ZADD'. This means that the guard condition
   * `if count >= maxRequests` is already correct - no change needed to
   * the rejection logic below it.
   *
   */
  const count = (await valkey.eval(
    SLIDING_WINDOW_LUA,
    1,
    key,
    String(cutoff),
    String(now),
    member,
    String(maxRequests),
    String(windowSeconds + 1),
  )) as number;

  if (count >= maxRequests) {
    const retryAfter = Math.ceil(windowSeconds - (now - cutoff) / 1000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({
      errors: [
        {
          message: "Rate limit exceeded",
          extensions: {
            code: "RATE_LIMITED",
            retryAfter,
          },
        },
      ],
    });
    return;
  }

  next();
}
