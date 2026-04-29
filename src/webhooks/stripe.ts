import type { Request, Response } from "express";
import type { Transaction } from "kysely";
import type { DB } from "@tachyonapp/tachyon-db";
import { stripe } from "../lib/stripe";
import { getDb } from "../lib/db";
import { logger } from "../lib/logger";
import * as Sentry from "@sentry/node";

// ─── Minimal event data shapes ────────────────────────────────────────────────
// We only extract the fields we actually read — avoids coupling to Stripe SDK
// namespace types which differ between major versions.

interface InvoiceEventData {
  subscription: string | null;
  lines?: { data: Array<{ period?: { end?: number } }> };
}

interface SubscriptionEventData {
  id: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * POST /webhooks/stripe
 *
 * Handles Stripe webhook events. Requires raw (unparsed) body so Stripe can
 * verify the HMAC signature. Mount this route with express.raw() — do NOT
 * use express.json() or body-parser before this handler.
 *
 * Always returns HTTP 200 to Stripe after signature verification. Handler
 * errors are captured to Sentry — Stripe retries are deduplicated via the
 * processed_stripe_events idempotency table.
 *
 * Handled events:
 *   - invoice.payment_succeeded       → status = 'active', current_period_end updated
 *   - invoice.payment_failed          → status = 'past_due'; suspended + bots paused after grace period
 *   - customer.subscription.deleted   → status = 'cancelled', ACTIVE bots paused
 */
export async function stripeWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const sig = req.headers["stripe-signature"] as string | undefined;

  if (!sig) {
    res.status(400).send("Missing stripe-signature header");
    return;
  }

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    logger.warn({ err }, "Invalid Stripe webhook signature");
    res.status(400).send("Invalid signature");
    return;
  }

  // Always return 200 to Stripe from this point — handler errors go to Sentry
  try {
    const db = getDb();

    const alreadyProcessed = await db
      .selectFrom("processed_stripe_events")
      .where("stripe_event_id", "=", event.id)
      .select("stripe_event_id")
      .executeTakeFirst();

    if (alreadyProcessed) {
      res.status(200).json({ received: true, skipped: true });
      return;
    }

    await db.transaction().execute(async (trx) => {
      await handleStripeEvent(event, trx);

      await trx
        .insertInto("processed_stripe_events")
        .values({
          stripe_event_id: event.id,
          event_type: event.type,
        })
        .execute();
    });
  } catch (err) {
    Sentry.captureException(err, {
      extra: { stripeEventId: event.id, eventType: event.type },
    });
    logger.error(
      { err, stripeEventId: event.id, eventType: event.type },
      "Stripe webhook handler error",
    );
  }

  res.status(200).json({ received: true });
}

// ─── Event dispatch ───────────────────────────────────────────────────────────

async function handleStripeEvent(
  event: ReturnType<typeof stripe.webhooks.constructEvent>,
  trx: Transaction<DB>,
): Promise<void> {
  switch (event.type) {
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as unknown as InvoiceEventData;
      await trx
        .updateTable("user_subscriptions")
        .set({
          subscription_status: "active",
          current_period_end: invoice.lines?.data[0]?.period?.end
            ? new Date(invoice.lines.data[0].period.end * 1000)
            : undefined,
          updated_at: new Date(),
        })
        .where("stripe_subscription_id", "=", invoice.subscription ?? "")
        .execute();
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as unknown as InvoiceEventData;
      const sub = await trx
        .selectFrom("user_subscriptions")
        .where("stripe_subscription_id", "=", invoice.subscription ?? "")
        .select(["id", "user_id", "subscription_status", "current_period_end"])
        .executeTakeFirst();

      if (!sub) break;

      const gracePeriodExpired =
        sub.current_period_end != null &&
        new Date() >
          new Date(
            new Date(sub.current_period_end).getTime() +
              7 * 24 * 60 * 60 * 1000,
          );

      if (sub.subscription_status === "past_due" && gracePeriodExpired) {
        await trx
          .updateTable("user_subscriptions")
          .set({ subscription_status: "suspended", updated_at: new Date() })
          .where("id", "=", sub.id)
          .execute();
        await trx
          .updateTable("bots")
          .set({ status: "PAUSED", updated_at: new Date() })
          .where("user_id", "=", sub.user_id)
          .where("status", "=", "ACTIVE")
          .execute();
      } else {
        await trx
          .updateTable("user_subscriptions")
          .set({ subscription_status: "past_due", updated_at: new Date() })
          .where("id", "=", sub.id)
          .execute();
      }
      break;
    }

    case "customer.subscription.deleted": {
      const stripeSub = event.data.object as unknown as SubscriptionEventData;
      const sub = await trx
        .selectFrom("user_subscriptions")
        .where("stripe_subscription_id", "=", stripeSub.id)
        .select(["id", "user_id"])
        .executeTakeFirst();

      if (!sub) break;

      await trx
        .updateTable("user_subscriptions")
        .set({ subscription_status: "cancelled", updated_at: new Date() })
        .where("id", "=", sub.id)
        .execute();
      await trx
        .updateTable("bots")
        .set({ status: "PAUSED", updated_at: new Date() })
        .where("user_id", "=", sub.user_id)
        .where("status", "=", "ACTIVE")
        .execute();
      break;
    }

    default:
      logger.info({ eventType: event.type }, "Unhandled Stripe webhook event");
  }
}
