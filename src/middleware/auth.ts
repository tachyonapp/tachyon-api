import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/jwks";
import type { Kysely } from "kysely";
import type { DB } from "@tachyonapp/tachyon-db";
import { getDb } from "../lib/db";
import { logger } from "../lib/logger";

/**
 * Clerk JWT middleware.
 *
 * Verifies the Bearer token from the Authorization header using Clerk's JWKS
 * endpoint, then looks up or provisions the local users record for the
 * authenticated subject.
 *
 * ## Dual-path provisioning
 *
 * User rows are created through two independent paths that must never conflict:
 *
 * 1. Clerk webhook (POST /webhooks/clerk, user.created event) — the primary path
 *    under normal operation. Svix delivers the event seconds after signup and
 *    inserts the users row with real profile data from Clerk, plus a
 *    user_cash_accounts row seeded at $0.
 *
 * 2. This middleware (first JWT arrival) — the fallback path. If a valid JWT
 *    reaches the API before the webhook fires (race condition, webhook delivery
 *    delay, or a missed delivery), lookupOrProvisionUser inserts the users row
 *    using claims from the JWT (email-derived display_name) and creates the
 *    user_cash_accounts row. Both inserts use ON CONFLICT DO NOTHING so when
 *    the webhook subsequently fires it silently no-ops on both tables.
 *
 * End state is identical regardless of which path runs first:
 *   - Webhook first → middleware finds existing row, returns it.
 *   - Middleware first → webhook hits ON CONFLICT, skips both inserts.
 *   - Concurrent first-login requests → ON CONFLICT + re-select ensures exactly
 *     one row is created and all requests get the same user ID.
 *
 * Intentionally never returns 401 — invalid or missing tokens result in
 * req.auth being undefined. Resolver-level authorization is enforced by
 * Pothos scope-auth, which returns UNAUTHENTICATED via GraphQL errors.
 */
export async function clerkJwtMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.slice(7);

  try {
    const claims = await verifyToken(token);
    const db: Kysely<DB> = getDb();
    const user = await lookupOrProvisionUser(db, claims.sub, claims.email);

    req.auth = {
      sub: claims.sub,
      email: claims.email,
      userId: user.id,
      roles: claims.publicMetadata?.roles ?? [],
    };

    next();
  } catch (err) {
    logger.warn(
      { correlationId: req.correlationId, err },
      "JWT authentication failed",
    );
    next();
  }
}

// TODO: The `auth0_subject` DB column name is a legacy field name. Change it in a migration.
async function lookupOrProvisionUser(
  db: Kysely<DB>,
  clerkSubject: string,
  email: string,
): Promise<{ id: string }> {
  // Fast path — user was already provisioned (webhook or prior login).
  const existing = await db
    .selectFrom("users")
    .select("id")
    .where("auth0_subject", "=", clerkSubject)
    .executeTakeFirst();

  if (existing) return existing;

  // Slow path — first JWT arrival with no users row yet.
  //
  // ON CONFLICT DO NOTHING makes this safe under concurrent first-login requests:
  // exactly one INSERT wins; the losers skip silently and fall through to the
  // re-select below, which returns the winner's row.
  //
  // display_name is seeded from the email prefix as a placeholder. The Clerk
  // webhook (user.created) carries the real display name from Clerk's user
  // record and will update it — but because the webhook also uses ON CONFLICT
  // DO NOTHING it cannot overwrite. If real display names matter before the
  // webhook enriches the row, switch the webhook to an upsert (DO UPDATE SET
  // display_name = EXCLUDED.display_name) at that time.
  await db
    .insertInto("users")
    .values({
      auth0_subject: clerkSubject,
      email,
      display_name: email.split("@")[0],
    })
    .onConflict((oc) => oc.column("auth0_subject").doNothing())
    .execute();

  const user = await db
    .selectFrom("users")
    .select("id")
    .where("auth0_subject", "=", clerkSubject)
    .executeTakeFirstOrThrow();

  // Mirror the webhook's user_cash_accounts insert so balance queries never
  // throw a "no result" error regardless of which provisioning path ran first.
  // ON CONFLICT DO NOTHING is safe here for the same reason as above.
  await db
    .insertInto("user_cash_accounts")
    .values({ user_id: user.id, balance: "0" })
    .onConflict((oc) => oc.column("user_id").doNothing())
    .execute();

  return user;
}
