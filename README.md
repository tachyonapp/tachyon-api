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
| `scan:dispatch` | Triggers a market scan fan-out across all active bots |
| `scan:bot` | Per-bot scan job (enqueued by `tachyon-workers` scan dispatch) |
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

The dashboard is excluded from production via a `NODE_ENV === 'production'` guard in `src/bullboard.ts`. The `@bull-board/*` packages are `devDependencies` and are additionally excluded from the production Docker image by the multi-stage build (`npm ci --omit=dev`).

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
