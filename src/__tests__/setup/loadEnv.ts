/**
 * Jest setupFile — loads .env into process.env before tests run.
 *
 * Registered unconditionally in jest.config.ts so jiti (Jest's TS config
 * loader) never has to evaluate a conditional that depends on process.env.
 * For non-integration runs the file is a no-op: .env is either absent (CI)
 * or already loaded, and vars already in the environment are never overwritten.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env");

try {
  const raw = readFileSync(envPath, "utf-8");
  const keysFound: string[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Strip optional `export ` prefix
    const stripped = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;

    const eqIdx = stripped.indexOf("=");
    if (eqIdx === -1) continue;

    const key = stripped.slice(0, eqIdx).trim();
    let value = stripped.slice(eqIdx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    keysFound.push(key);

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch (err) {
  console.error(`[loadEnv] Failed to load .env from ${envPath}:`, err);
}
