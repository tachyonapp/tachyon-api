import { GraphQLError } from "graphql";
import type { TachyonContext } from "../context";
import { logger } from "../lib/logger";

// Per-operation rate limit configuration
// TODO: externalize to environment variables post-MVP
export const OP_RATE_LIMITS: Record<
  string,
  { limit: number; windowSeconds: number }
> = {
  approveProposal: { limit: 10, windowSeconds: 60 },
  skipProposal: { limit: 20, windowSeconds: 60 },
  createBot: { limit: 5, windowSeconds: 3600 },
  activateBot: { limit: 10, windowSeconds: 60 },
  pauseBot: { limit: 10, windowSeconds: 60 },
  connectBroker: { limit: 3, windowSeconds: 3600 },
};

/**
 * Atomic sliding window Lua script.
 *
 * Executes entirely on the Valkey server — no interleaving between the count
 * read and the member write is possible. Valkey guarantees a Lua script executes
 * atomically - no other client can run while its in progress. This is because
 * Valkey is single-threaded and Lua scripts run inline on that thread.
 *
 * Note that this is a blocking operation.
 *
 * KEYS[1]  — sorted set key
 * ARGV[1]  — cutoff timestamp ms (now - windowMs): prune members older than this
 * ARGV[2]  — now (current timestamp ms): score for the new member
 * ARGV[3]  — member (correlationId): unique identifier for this request
 * ARGV[4]  — limit: max allowed count
 * ARGV[5]  — ttl seconds: key expiry (windowSeconds + 1)
 *
 * Returns the count of existing members BEFORE adding the new one.
 * If count >= limit, the new member is NOT added (request is rejected, counter not advanced).
 */
export const SLIDING_WINDOW_LUA = `
local key    = KEYS[1]
local cutoff = ARGV[1]
local now    = ARGV[2]
local member = ARGV[3]
local limit  = tonumber(ARGV[4])
local ttl    = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)
if count >= limit then
  return count
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl)
return count
`;

/**
 * withOpRateLimit — per-operation sliding window rate limiter for GraphQL resolvers.
 *
 * Call this as the FIRST line of any rate-limited resolver body (before any DB reads
 * or queue dispatches). On rate limit breach it throws a GraphQLError — Apollo formats
 * this as a standard { errors: [...] } response with HTTP 200 (not HTTP 429).
 *
 * Precondition: ctx.auth must be non-null. This is guaranteed by authScopes: { authenticated: true }
 * on every field that calls this function. The ctx.auth! non-null assertion is intentional.
 *
 * Key format: rate:op:<userId>:<operationName>
 */
export async function withOpRateLimit(
  ctx: TachyonContext,
  operationName: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const userId = ctx.auth!.userId;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const cutoff = now - windowMs;
  const key = `rate:op:${userId}:${operationName}`;
  const member = ctx.correlationId;

  const count = (await ctx.valkey.eval(
    SLIDING_WINDOW_LUA,
    1,
    key,
    String(cutoff),
    String(now),
    member,
    String(limit),
    String(windowSeconds + 1),
  )) as number;

  if (count >= limit) {
    const retryAfter = Math.ceil(windowSeconds - (now - cutoff) / 1000);

    logger.warn({
      msg: "Operation rate limit exceeded",
      userId,
      operationName,
      limit,
      windowSeconds,
      retryAfter,
    });

    throw new GraphQLError(`Rate limit exceeded for ${operationName}`, {
      extensions: {
        code: "RATE_LIMITED",
        retryAfter,
        operation: operationName,
      },
    });
  }
}
