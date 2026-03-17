import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/jwks";
import type { Kysely } from "kysely";
import type { DB } from "@tachyonapp/tachyon-db";
import { getDb } from "../lib/db";
import { logger } from "../lib/logger";

/**
 * Auth0 JWT middleware.
 *
 * Verifies the Bearer token from the Authorization header using Auth0's JWKS
 * endpoint, then resolves (or provisions) the local users record for the
 * authenticated subject. The resolved auth context is attached to req.auth
 * for downstream use by the Apollo context builder.
 *
 * Intentionally never returns 401 — invalid or missing tokens result in
 * req.auth being undefined. Resolver-level authorization is enforced by
 * Pothos scope-auth, which returns UNAUTHENTICATED via GraphQL errors.
 */
export async function auth0JwtMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    return next(); // unauthenticated — resolver scope-auth will enforce
  }

  const token = authHeader.slice(7);

  try {
    const claims = await verifyToken(token);
    const db: Kysely<DB> = getDb();
    const user = await provisionUser(db, claims.sub, claims.email);

    req.auth = {
      sub: claims.sub,
      email: claims.email,
      userId: user.id,
      roles: claims["https://tachyon.app/roles"] ?? [],
    };

    next();
  } catch (err) {
    // JWT invalid/expired — do NOT return 401; let Apollo scope-auth return UNAUTHENTICATED
    logger.warn(
      { correlationId: req.correlationId, err },
      "JWT verification failed",
    );
    next();
  }
}

async function provisionUser(
  db: Kysely<DB>,
  auth0Id: string,
  email: string,
): Promise<{ id: string }> {
  // Hot path: existing user
  const existing = await db
    .selectFrom("users")
    .select("id")
    .where("auth0_subject", "=", auth0Id)
    .executeTakeFirst();

  if (existing) return existing;

  // First login — ON CONFLICT DO NOTHING handles concurrent first-requests.
  // NOTE: display_name is seeded from the email username and can be updated by the
  // user later via the profile mutation.
  const displayName = email.split("@")[0];
  await db
    .insertInto("users")
    .values({ auth0_subject: auth0Id, email, display_name: displayName })
    .onConflict((oc) => oc.column("auth0_subject").doNothing())
    .execute();

  const newUser = await db
    .selectFrom("users")
    .select("id")
    .where("auth0_subject", "=", auth0Id)
    .executeTakeFirstOrThrow();

  // Ensure the user has a cash account row — ON CONFLICT DO NOTHING is safe
  // against concurrent first-requests racing to create the same user.
  await db
    .insertInto("user_cash_accounts")
    .values({ user_id: newUser.id, balance: "0" })
    .onConflict((oc) => oc.column("user_id").doNothing())
    .execute();

  return newUser;
}
