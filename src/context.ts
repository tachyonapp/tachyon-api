import type { Request } from "express";
import type { Kysely } from "kysely";
import type { DB } from "@tachyonapp/tachyon-db";
import type Redis from "ioredis";
import type { DataLoaders } from "./dataloaders";
import { createDataLoaders } from "./dataloaders";
import { getDb } from "./lib/db";
import { getValkey } from "./lib/valkey";

/**
 * AuthContext — the verified identity attached to an authenticated request.
 *
 * Populated by clerkJwtMiddleware after successful JWT verification. Contains
 * both the raw Auth0 claims (sub, email) and the resolved local users.id (userId)
 * so resolvers never need to re-query the DB just to find out who is asking.
 *
 * When auth is null (unauthenticated request), Pothos scope-auth enforces access
 * control at the resolver level — middleware always calls next() and defers to GraphQL.
 */
export interface AuthContext {
  sub: string; // Auth0 subject claim
  email: string;
  userId: string; // Resolved local users.id (bigint as string)
  roles: string[];
}

/**
 * TachyonContext — the per-request context object passed to every GraphQL resolver.
 *
 * Apollo Server calls buildContext() once per request and injects the result as the
 * third argument (ctx) in every resolver function. Resolvers never instantiate their
 * own DB connections or loaders — they consume everything through this context.
 *
 * Fields:
 *   auth          — verified identity, or null for unauthenticated requests
 *   correlationId — UUID for distributed tracing, echoed in X-Correlation-ID header
 *   db            — Kysely query builder backed by the shared pg Pool singleton
 *   valkey        — ioredis client for rate limiting and queue operations
 *   loaders       — fresh DataLoader instances for this request (see dataloaders/index.ts)
 *   operationName — GraphQL operation name from the request body, used for logging
 */
export interface TachyonContext {
  auth: AuthContext | null;
  correlationId: string;
  db: Kysely<DB>;
  valkey: Redis;
  loaders: DataLoaders;
  operationName: string | null;
}

/**
 * buildContext() — assembles a fresh TachyonContext for each incoming GraphQL request.
 *
 * Called by Apollo Server's context factory (configured in server.ts). Runs after the
 * Express middleware stack, so req.auth and req.correlationId are already populated.
 *
 * db and valkey are lazy singletons (initialized once, reused across requests).
 * loaders MUST be created fresh here — DataLoader caches per-instance, so reusing
 * across requests would cause cache poisoning. See dataloaders/index.ts for detail.
 */
export async function buildContext(req: Request): Promise<TachyonContext> {
  return {
    auth: req.auth ?? null,
    correlationId: req.correlationId,
    db: getDb(),
    valkey: getValkey(),
    loaders: createDataLoaders(getDb()),
    operationName: req.body?.operationName ?? null,
  };
}
