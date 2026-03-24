import type { Request, Response } from "express";
import { Webhook } from "svix";
import type { Kysely } from "kysely";
import type { DB } from "@tachyonapp/tachyon-db";
import { getDb } from "../lib/db";
import { logger } from "../lib/logger";

// ─── Clerk event types ────────────────────────────────────────────────────────

interface ClerkEmailAddress {
  id: string;
  email_address: string;
}

interface ClerkUserCreatedEvent {
  type: "user.created";
  data: {
    id: string; // Clerk subject: "user_xxx"
    email_addresses: ClerkEmailAddress[];
    primary_email_address_id: string;
  };
}

type ClerkWebhookEvent = ClerkUserCreatedEvent;

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * POST /webhooks/clerk
 *
 * Handles Clerk webhook events. Requires raw (unparsed) body so Svix can
 * verify the HMAC signature. Mount this route with express.raw() — do NOT
 * use express.json() or body-parser before this handler.
 *
 * Currently handled events:
 *   - user.created  → provisions users row + user_cash_accounts row
 */
export async function clerkWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    logger.error("CLERK_WEBHOOK_SECRET is not configured");
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }

  const svixId = req.headers["svix-id"] as string | undefined;
  const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
  const svixSignature = req.headers["svix-signature"] as string | undefined;

  if (!svixId || !svixTimestamp || !svixSignature) {
    res.status(400).json({ error: "Missing svix headers" });
    return;
  }

  let event: ClerkWebhookEvent;
  try {
    const wh = new Webhook(secret);
    // req.body is a Buffer when the route uses express.raw()
    event = wh.verify(req.body as Buffer, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    logger.warn({ err }, "Clerk webhook signature verification failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  try {
    if (event.type === "user.created") {
      await provisionUser(getDb(), event.data);
    }
    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err, eventType: event.type }, "Clerk webhook handler error");
    res.status(500).json({ error: "Internal error" });
  }
}

// ─── Provisioning ─────────────────────────────────────────────────────────────

async function provisionUser(
  db: Kysely<DB>,
  data: ClerkUserCreatedEvent["data"],
): Promise<void> {
  const primaryEmail = data.email_addresses.find(
    (e) => e.id === data.primary_email_address_id,
  );

  if (!primaryEmail) {
    logger.error(
      { clerkUserId: data.id },
      "user.created event has no primary email — skipping provisioning",
    );
    return;
  }

  const email = primaryEmail.email_address;
  const displayName = email.split("@")[0];

  // ON CONFLICT DO NOTHING guards against duplicate delivery (Svix at-least-once)
  await db
    .insertInto("users")
    .values({ auth0_subject: data.id, email, display_name: displayName })
    .onConflict((oc) => oc.column("auth0_subject").doNothing())
    .execute();

  const user = await db
    .selectFrom("users")
    .select("id")
    .where("auth0_subject", "=", data.id)
    .executeTakeFirstOrThrow();

  await db
    .insertInto("user_cash_accounts")
    .values({ user_id: user.id, balance: "0" })
    .onConflict((oc) => oc.column("user_id").doNothing())
    .execute();

  logger.info(
    { clerkUserId: data.id, userId: user.id },
    "User provisioned via Clerk webhook",
  );
}
