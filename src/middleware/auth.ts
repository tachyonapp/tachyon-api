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
 * endpoint, then looks up the local users record for the authenticated subject.
 *
 * User provisioning is handled upstream by the POST /webhooks/clerk handler
 * on the user.created Clerk event. If a valid JWT arrives for a subject
 * with no users row, authentication fails with a warning.
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
    const user = await lookupUser(db, claims.sub);

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
async function lookupUser(
  db: Kysely<DB>,
  clerkSubject: string,
): Promise<{ id: string }> {
  const user = await db
    .selectFrom("users")
    .select("id")
    .where("auth0_subject", "=", clerkSubject)
    .executeTakeFirst();

  if (!user) {
    throw new Error(
      `No users row for Clerk subject ${clerkSubject} — webhook may not have fired`,
    );
  }

  return user;
}
