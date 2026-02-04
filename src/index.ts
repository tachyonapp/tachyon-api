import express from "express";
import { checkPostgres, checkRedis } from "./health";

const app = express();
const PORT = parseInt(process.env.PORT || "4000", 10);

// Liveness check: API is running - depedencies are reachable
// - Used by load balancers/monitoring tools to verify server health
// - Returns JSON status of PostgreSQL and Redis
// - Returns 503 status if services are unhealthy
app.get("/health", async (_req, res) => {
  try {
    const [pgOk, redisOk] = await Promise.all([checkPostgres(), checkRedis()]);

    if (pgOk && redisOk) {
      res.status(200).json({
        status: "healthy",
        version: process.env.GIT_COMMIT_SHA || "unknown",
        timestamp: new Date().toISOString(),
        checks: { postgres: "connected", redis: "connected" },
      });
    } else {
      res.status(503).json({
        status: "unhealthy",
        version: process.env.GIT_COMMIT_SHA || "unknown",
        timestamp: new Date().toISOString(),
        checks: {
          postgres: pgOk ? "connected" : "disconnected",
          redis: redisOk ? "connected" : "disconnected",
        },
      });
    }
  } catch (err) {
    res.status(503).json({
      status: "unhealthy",
      version: process.env.GIT_COMMIT_SHA || "unknown",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// Readiness check: API ready to accept traffic
app.get("/ready", async (_req, res) => {
  try {
    const [pgOk, redisOk] = await Promise.all([checkPostgres(), checkRedis()]);

    if (pgOk && redisOk) {
      res.status(200).json({ status: "ready" });
    } else {
      res.status(503).json({ status: "not ready" });
    }
  } catch {
    res.status(503).json({ status: "not ready" });
  }
});

app.listen(PORT, () => {
  console.log(`tachyon-api listening on port ${PORT}`);
});

export default app;
