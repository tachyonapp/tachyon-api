import { sql } from "kysely";
import { getDb } from "./lib/db";
import { getValkey } from "./lib/valkey";

export async function checkPostgres(): Promise<boolean> {
  try {
    await sql`SELECT 1`.execute(getDb());
    return true;
  } catch {
    return false;
  }
}

export async function checkValkey(): Promise<boolean> {
  try {
    const client = getValkey();
    if (client.status !== "ready") {
      await client.connect();
    }
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
