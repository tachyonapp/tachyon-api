import { Pool } from "pg";
import Redis from "ioredis";

let pgPool: Pool | null = null;
let redisClient: Redis | null = null;

function getPgPool(): Pool {
  if (!pgPool) {
    pgPool = new Pool({
      host: process.env.POSTGRES_HOST || "localhost",
      port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
      database: process.env.POSTGRES_DB || "tachyon_dev",
      user: process.env.POSTGRES_USER || "tachyon",
      password: process.env.POSTGRES_PASSWORD || "tachyon_local_dev",
      ssl:
        process.env.POSTGRES_SSL === "true"
          ? { rejectUnauthorized: false }
          : false,
      max: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || "20", 10),
    });
  }
  return pgPool;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD || undefined,
      tls: process.env.REDIS_TLS === "true" ? {} : undefined,
      lazyConnect: true,
    });
  }
  return redisClient;
}

export async function checkPostgres(): Promise<boolean> {
  try {
    const pool = getPgPool();
    const result = await pool.query("SELECT 1");
    return result.rowCount === 1;
  } catch {
    return false;
  }
}

export async function checkRedis(): Promise<boolean> {
  try {
    const client = getRedisClient();
    if (client.status !== "ready") {
      await client.connect();
    }
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
