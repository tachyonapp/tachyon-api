import express from "express";
import { ApolloServer } from "@apollo/server";
import {
  expressMiddleware,
  type ExpressContextFunctionArgument,
} from "@apollo/server/express4";
import {
  ApolloServerPluginLandingPageDisabled,
  ApolloServerPluginInlineTraceDisabled,
} from "@apollo/server/plugin/disabled";
import cors from "cors";
import { json } from "body-parser";
import { buildSchema } from "./graphql/schema";
import { buildContext } from "./context";
import { formatError } from "./errors/formatter";
import { correlationIdMiddleware } from "./middleware/correlationId";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { auth0JwtMiddleware } from "./middleware/auth";
import { logger } from "./lib/logger";
import { mountDashboard } from "./bullboard/bullboard";
import { checkPostgres, checkValkey } from "./health";
import pinoHttp from "pino-http";

// TODO:: (Feature-19): Lock down ALLOWED_ORIGINS before Phase 6 (Admin Console).
// React Native / Expo does not send an Origin header, so CORS is a no-op for mobile.
// When the web admin dashboard is built, restrict origin to 'https://admin.tachyon.app'
// via ALLOWED_ORIGINS env var. Add ALLOWED_ORIGINS to tachyon-infra .env.example at that time.

export async function createApp() {
  const app = express();

  // Trust proxy — required for correct IP extraction behind DigitalOcean load balancer.
  // Without this, req.ip returns the load balancer IP, breaking IP-based rate limiting.
  app.set("trust proxy", 1);

  app.use(pinoHttp({ logger }));

  // Liveness check — preserves existing detailed response shape
  app.get("/health", async (_req, res) => {
    try {
      const [pgOk, valkeyOk] = await Promise.all([
        checkPostgres(),
        checkValkey(),
      ]);

      if (pgOk && valkeyOk) {
        res.status(200).json({
          status: "healthy",
          service: "tachyon-api",
          version: process.env.GIT_COMMIT_SHA ?? "unknown",
          timestamp: new Date().toISOString(),
          checks: { postgres: "connected", valkey: "connected" },
        });
      } else {
        res.status(503).json({
          status: "unhealthy",
          version: process.env.GIT_COMMIT_SHA ?? "unknown",
          timestamp: new Date().toISOString(),
          checks: {
            postgres: pgOk ? "connected" : "disconnected",
            valkey: valkeyOk ? "connected" : "disconnected",
          },
        });
      }
    } catch (err) {
      res.status(503).json({
        status: "unhealthy",
        version: process.env.GIT_COMMIT_SHA ?? "unknown",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  // Readiness check
  app.get("/ready", async (_req, res) => {
    try {
      const [pgOk, valkeyOk] = await Promise.all([
        checkPostgres(),
        checkValkey(),
      ]);

      if (pgOk && valkeyOk) {
        res.status(200).json({ status: "ready" });
      } else {
        res.status(503).json({ status: "not ready" });
      }
    } catch {
      res.status(503).json({ status: "not ready" });
    }
  });

  // Bull Board dashboard (non-prod only)
  mountDashboard(app);

  const schema = buildSchema();

  const server = new ApolloServer({
    schema,
    introspection: process.env.NODE_ENV !== "production",
    formatError,
    plugins: [
      ApolloServerPluginLandingPageDisabled(),
      ApolloServerPluginInlineTraceDisabled(), // No Apollo Studio telemetry
    ],
  });

  await server.start();

  // Middleware order is CRITICAL: correlationId → rateLimit → auth → Apollo
  // See README.md for details
  app.use(
    "/graphql",
    cors({ origin: true, credentials: true }),
    json(),
    correlationIdMiddleware,
    rateLimitMiddleware,
    auth0JwtMiddleware,
    expressMiddleware(server, {
      context: async ({ req }: ExpressContextFunctionArgument) =>
        buildContext(req),
    }),
  );

  return { app, apolloServer: server };
}
