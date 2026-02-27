import { Pool } from "pg";
import Redis from "ioredis";

let pgPool: Pool | null = null;
let valkeyClient: Redis | null = null; // ValKey is a direct fork of redis - ioredis is compatible

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

export async function getValkeyClient(): Promise<Redis> {
  if (!valkeyClient) {
    valkeyClient = new Redis({
      host: process.env.VALKEY_HOST || "localhost",
      port: parseInt(process.env.VALKEY_PORT || "6379", 10),
      password: process.env.VALKEY_PASSWORD || undefined,
      tls: process.env.VALKEY_TLS === "true" ? {} : undefined,
      lazyConnect: true,
    });
  }
  return valkeyClient;
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

export async function checkValkey(): Promise<boolean> {
  try {
    const client = await getValkeyClient();
    if (client.status !== "ready") {
      await client.connect();
    }
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
