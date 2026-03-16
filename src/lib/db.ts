/** Database singleton
 *
 * Provides a single shared Kysely instance backed by a pg connection pool.
 * Kysely is the type-safe query builder used throughout tachyon-api. The DB
 * type comes from @tachyonapp/tachyon-db, which is generated from the live
 * schema via kysely-codegen in tachyon-db.
 *
 * getDb() is synchronous and safe to call on every request — the Pool and
 * Kysely instance are created once and reused for the lifetime of the process.
 */
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB } from "@tachyonapp/tachyon-db";

let db: Kysely<DB> | null = null;

export function getDb(): Kysely<DB> {
  if (!db) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.POSTGRES_SSL === "true"
          ? { rejectUnauthorized: false }
          : false,
      max: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || "20", 10),
    });

    db = new Kysely<DB>({
      dialect: new PostgresDialect({ pool }),
    });
  }

  return db;
}
