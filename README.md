# tachyon-api

GraphQL API gateway for the Tachyon platform (Express + TypeScript).

## Local Development

### Option A — Infrastructure only (recommended)

Start PostgreSQL and Valkey via Docker, then run the API directly:

```bash
# From tachyon-infra
docker compose up postgres valkey

# From this repo
cp ../tachyon-infra/env/.env.local.example .env.local
export NODE_AUTH_TOKEN=<your-github-pat>  # GitHub PAT with read:packages scope
npm install
npm run dev
```

### Option B — Full stack via Docker Compose

```bash
# From tachyon-infra — NODE_AUTH_TOKEN is required for the Docker build
# to pull @tachyonapp/tachyon-db from GitHub Packages
export NODE_AUTH_TOKEN=<your-github-pat>
docker compose up
```

### Option C — Build Docker image locally

```bash
export NODE_AUTH_TOKEN=<your-github-pat>
docker build --secret id=node_auth_token,env=NODE_AUTH_TOKEN .
```

> `NODE_AUTH_TOKEN` is passed as a BuildKit secret and is never written to any
> image layer. It cannot be extracted via `docker history`.

## Scripts

```bash
npm run dev       # Start with hot reload (tsx watch)
npm run build     # Compile TypeScript
npm test          # Run Jest tests
npm run lint      # Run ESLint
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check — returns PostgreSQL and Valkey connection status. Returns 503 if either dependency is unreachable |
| `GET` | `/ready` | Readiness check — returns 200 when the API is ready to accept traffic |
| `GET` | `/internal/bull-board/*` | BullMQ dashboard (not mounted in production — see Bull Board section below) |

## BullMQ Queue Producer

The API uses BullMQ as a **producer only** — it enqueues jobs but never instantiates Worker processors. All job processing happens in `tachyon-workers`.

Six named Queue instances are available for use by GraphQL resolvers (Feature 4+):

| Queue | Description |
|---|---|
| `scan-dispatch` | Triggers a market scan fan-out across all active bots |
| `scan-bot` | Per-bot scan job (enqueued by `tachyon-workers` scan dispatch) |
| `expiry` | Proposal expiry sweep |
| `reconciliation` | Broker reconciliation pass |
| `notification` | On-demand push notification delivery |
| `summary` | EOD summary report generation |

Queue instances are exported from `src/queues/index.ts` and consumed by the Bull Board dashboard. Resolver integration is implemented in Feature 4+.

## Bull Board Dashboard

BullMQ job queue monitoring dashboard mounted at `/internal/bull-board`.

| Environment | URL | Auth |
|---|---|---|
| Local dev | `http://localhost:4000/internal/bull-board` | None |
| Staging | `https://staging-api.tachyon.app/internal/bull-board` | Basic auth (`BULL_BOARD_USERNAME` / `BULL_BOARD_PASSWORD`) |
| Production | Not mounted | N/A |

The dashboard is excluded from production via a `NODE_ENV === 'production'` guard in `src/bullboard.ts`. The `@bull-board/*` and `basic-auth-connect` packages are production `dependencies` — TypeScript static imports compile to `require()` calls that execute at module load time, before any runtime guard can fire. The packages are present in the production image but the `NODE_ENV` guard ensures the dashboard is never mounted.

## Request Lifecycle

This section traces a single authenticated GraphQL mutation — `approveProposal` — from the moment the mobile client sends it to the moment the response is returned. It covers every layer of the stack and explains why each piece is ordered the way it is.

### The example request

```
POST /graphql
Authorization: Bearer eyJhbGc...
X-Correlation-ID: (optional — client may send its own)

{
  "operationName": "ApproveProposal",
  "query": "mutation ApproveProposal($id: ID!) { approveProposal(id: $id) { ... } }",
  "variables": { "id": "42" }
}
```

---

### Step 1 — Correlation ID middleware (`src/middleware/correlationId.ts`)

The first middleware to run. It inspects the incoming request for an `X-Correlation-ID` header:

- **If present** (e.g. a mobile retry sending the same ID): the existing value is reused, keeping the trace continuous across attempts.
- **If absent**: a new UUID v4 is generated.

The ID is attached to `req.correlationId` and echoed in the `X-Correlation-ID` response header. Every subsequent layer — rate limiter, auth, logger, resolver, BullMQ job payload — carries this same ID, so a single user action can be correlated across API logs and worker logs.

---

### Step 2 — Rate limit middleware (`src/middleware/rateLimit.ts`)

Runs **before** JWT verification — this is intentional. The rate limiter is coarse DoS protection, not per-user quota enforcement, so it doesn't need a verified identity.

It checks the `Authorization` header for the presence of a Bearer token (not its validity):

- **Token present**: uses the last 16 characters of the raw JWT as an opaque bucket key (`rl:user:<last16>`). Limit: 60 requests / 60 seconds.
- **No token**: falls back to the client IP (`rl:ip:<ip>`). Limit: 20 requests / 60 seconds.

The algorithm uses a Valkey sorted set as a sliding window. Four commands are pipelined into a single Valkey round-trip:

```
ZREMRANGEBYSCORE  rl:<key>  -inf  <cutoff>   # evict expired entries
ZCARD             rl:<key>                    # count requests in window
ZADD              rl:<key>  <now>  <corrId>   # record this request
EXPIRE            rl:<key>  61                # reset TTL
```

If the count after eviction is already at the limit, the middleware returns `429` with a `Retry-After` header and a GraphQL-shaped `RATE_LIMITED` error body — no further middleware runs.

---

### Step 3 — Auth0 JWT middleware (`src/middleware/auth.ts`)

Extracts the Bearer token and verifies it against Auth0's JWKS endpoint via `jose` (`src/auth/jwks.ts`):

- `createRemoteJWKSet` fetches Auth0's public keys once, caches them in memory for `AUTH0_JWKS_CACHE_TTL` seconds (default 600s), and automatically refreshes on an unknown `kid` — no restart needed on Auth0 key rotation.
- `jwtVerify` validates the RS256 signature, the `aud` (audience), and the `iss` (issuer). Symmetric algorithms are rejected by default, preventing algorithm confusion attacks.

On success, the middleware calls `provisionUser()`:

- **Existing user**: single `SELECT` on `auth0_subject` — fast path.
- **First login**: `INSERT ... ON CONFLICT DO NOTHING` followed by a `SELECT`. The conflict guard makes concurrent first-requests safe — two simultaneous logins for the same user will not create duplicate rows.

The resolved identity is attached to `req.auth`:

```typescript
req.auth = { sub, email, userId, roles }
```

**Key design decision:** if the token is missing or invalid, the middleware calls `next()` with `req.auth` left undefined — it never returns a `401`. Authorization is enforced at the resolver level by Pothos scope-auth. This keeps the HTTP layer clean and lets GraphQL return structured `UNAUTHENTICATED` errors inside the standard `errors` array rather than bare HTTP status codes.

---

### Step 4 — Apollo Server / `buildContext()` (`src/context.ts`)

Apollo's `expressMiddleware` intercepts the request and calls `buildContext(req)` before routing to any resolver. This assembles the `TachyonContext` object that every resolver receives as its third argument (`ctx`):

```typescript
{
  auth:          req.auth ?? null,       // verified identity, or null
  correlationId: req.correlationId,      // UUID from Step 1
  db:            getDb(),                // Kysely pg Pool singleton
  valkey:        getValkey(),            // ioredis singleton
  loaders:       createDataLoaders(db), // fresh DataLoader instances
  operationName: req.body.operationName, // "ApproveProposal"
}
```

`db` and `valkey` are **lazy singletons** — created once on first call, reused for the lifetime of the process. `loaders` are **created fresh for every request** — see Step 5.

---

### Step 5 — DataLoaders (`src/dataloaders/index.ts`)

`createDataLoaders(db)` returns four `DataLoader` instances scoped to this request:

| Loader | Batches by | Returns |
|---|---|---|
| `userById` | `users.id` | `UsersRow \| null` |
| `botById` | `bots.id` | `BotsRow \| null` (excludes ARCHIVED) |
| `proposalsByBotId` | `trade_proposals.bot_id` | `ProposalsRow[]` |
| `positionByBotId` | `positions.bot_id` | `PositionsRow \| null` (OPEN only) |

For this particular mutation (`approveProposal`), the resolver does direct Kysely queries rather than using loaders — loaders are primarily used by **field resolvers** on types. For example, if the response includes a `bot { owner { email } }` field, `userById.load(bot.user_id)` is called once per bot in the result set. DataLoader coalesces all of those calls into a single `WHERE id IN (...)` query and fans the results back out to each caller — solving the N+1 problem without any manual batching logic in the resolver.

**Why per-request?** DataLoader caches results by key for the lifetime of the instance. If a loader were shared across requests, a cached row from user A's request could be returned to user B. Fresh instances on every request eliminate this risk entirely.

---

### Step 6 — Resolver execution (`src/graphql/domains/proposals/proposal.mutations.ts`)

With context assembled, Apollo routes to the `approveProposal` resolver:

**1. Scope-auth check (Pothos)**
```typescript
authScopes: { authenticated: true }
```
Pothos evaluates `context.auth !== null`. If auth is null (token was missing or invalid in Step 3), it throws a GraphQL `UNAUTHENTICATED` error here — the resolver body never runs.

**2. DB read + ownership check**
```typescript
const proposal = await ctx.db
  .selectFrom('trade_proposals')
  .innerJoin('bots', 'bots.id', 'trade_proposals.bot_id')
  .where('trade_proposals.id', '=', args.id)
  .where('trade_proposals.status', '=', 'PENDING')
  .executeTakeFirst();

assertOwnership(ctx, proposal.user_id); // throws FORBIDDEN if userId mismatch
```
`assertOwnership` compares `proposal.user_id` against `ctx.auth.userId`. Resolvers **never** trust args for authorization — only `ctx.auth.userId`, which came from the verified JWT.

**3. DB write**
```typescript
await ctx.db.updateTable('trade_proposals')
  .set({ status: 'APPROVED' })
  .where('id', '=', args.id)
  .execute();
```

**4. BullMQ dispatch (fire-and-forget)**
```typescript
await queues.reconciliation.add(QUEUE_NAMES.RECONCILIATION, {
  proposalId, botId, userId, correlationId, enqueuedAt
});
```
The payload contains IDs and timestamps only — no prices, quantities, or credentials. The worker fetches everything it needs from the DB when the job runs. The `correlationId` from Step 1 is included so the worker's log entry can be linked back to the originating HTTP request.

---

### Step 7 — Response

Apollo serializes the resolver's return value, runs it through `formatError` for any errors (sanitizing stack traces in production and routing unknown errors to Sentry), and sends the HTTP response. The `X-Correlation-ID` header set in Step 1 is present on every response regardless of success or failure.

```json
{
  "data": {
    "approveProposal": {
      "id": "42",
      "status": "APPROVED"
    }
  }
}
```

---

### Full stack summary

```
POST /graphql
     │
     ▼
[1] correlationId    — assign/forward UUID, set X-Correlation-ID header
     │
     ▼
[2] rateLimit        — sliding window via Valkey sorted set (4-command pipeline)
     │                 429 → exit early
     ▼
[3] auth0Jwt         — verify RS256 JWT via JWKS cache, provision user on first login
     │                 invalid/missing token → req.auth = undefined, continue
     ▼
[4] buildContext()   — assemble TachyonContext: auth, db, valkey, loaders, correlationId
     │
     ▼
[5] DataLoaders      — fresh per-request instances, batch N field-resolver DB calls into 1
     │
     ▼
[6] Resolver         — scope-auth → ownership check → DB read/write → BullMQ dispatch
     │
     ▼
[7] formatError      — sanitize internals in production, route unknowns to Sentry
     │
     ▼
Response + X-Correlation-ID header
```

---

## Known Dependency Constraints

### `@types/express` pinned to v4

`@types/express` is pinned to `^4` despite the project running **Express v5** at runtime. The reason is structural: `@apollo/server` bundles its own copy of `@types/express@4` inside its `node_modules`. TypeScript resolves `expressMiddleware`'s type signature against Apollo's bundled copy, and resolves `app.use()` against the project's copy — two structurally distinct module paths that are incompatible at compile time even though they represent the same types at runtime.

Using `@types/express@5` causes a `TS2769` overload mismatch on the `/graphql` middleware chain. Using `@types/express@4` aligns both resolutions and clears the error.

**When to remove the pin:** once `@apollo/server` updates its bundled `@types/express` to v5, upgrade `@types/express` in `package.json` freely and verify `tsc --noEmit` passes.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `POSTGRES_SSL` | No | `false` | Set to `true` to enable SSL (required for DigitalOcean managed PostgreSQL) |
| `VALKEY_HOST` | No | `localhost` | Valkey hostname |
| `VALKEY_PORT` | No | `6379` | Valkey port |
| `VALKEY_PASSWORD` | No | — | Valkey auth password (empty = no auth, typical for local dev) |
| `VALKEY_TLS` | No | `false` | Set to `true` to enable TLS (required for DigitalOcean managed Valkey) |
| `PORT` | No | `4000` | HTTP server port |
| `BULL_BOARD_USERNAME` | No | — | Basic auth username for Bull Board. Staging only. Empty = no auth (local dev) |
| `BULL_BOARD_PASSWORD` | No | — | Basic auth password for Bull Board. Staging only. Empty = no auth (local dev) |
| `NODE_ENV` | No | `development` | Controls Bull Board mounting (`production` = not mounted) and Sentry environment tagging |
| `GIT_COMMIT_SHA` | No | `unknown` | Injected at build time — surfaced in `/health` and `/ready` responses |
