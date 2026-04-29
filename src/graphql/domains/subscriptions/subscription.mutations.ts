import { GraphQLError } from "graphql";
import { builder } from "../../builder";
import {
  SubscriptionTierEnum,
  SubscriptionStatusEnum,
} from "../../types/enums";
import {
  withOpRateLimit,
  OP_RATE_LIMITS,
} from "../../../middleware/operationRateLimit";
import { getDb } from "../../../lib/db";
import { stripe } from "../../../lib/stripe";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

type SelectTierResultShape = {
  subscriptionTier: "FREE_TRIAL" | "BYOK" | "TACHYON_HOSTED";
  subscriptionStatus:
    | "trialing"
    | "active"
    | "past_due"
    | "cancelled"
    | "suspended";
  trialExpiresAt: Date | null;
};

const SelectTierResult =
  builder.objectRef<SelectTierResultShape>("SelectTierResult");
builder.objectType(SelectTierResult, {
  fields: (t) => ({
    subscriptionTier: t.field({
      type: SubscriptionTierEnum,
      resolve: (r) => r.subscriptionTier,
    }),
    subscriptionStatus: t.field({
      type: SubscriptionStatusEnum,
      resolve: (r) => r.subscriptionStatus,
    }),
    trialExpiresAt: t.field({
      type: "DateTime",
      nullable: true,
      resolve: (r) => r.trialExpiresAt,
    }),
  }),
});

// ---------------------------------------------------------------------------
// selectTier
// ---------------------------------------------------------------------------

builder.mutationField("selectTier", (t) =>
  t.field({
    type: SelectTierResult,
    args: {
      tier: t.arg({ type: SubscriptionTierEnum, required: true }),
      stripePaymentMethodId: t.arg.string({ required: false }),
    },
    authScopes: { authenticated: true },
    resolve: async (_root, { tier, stripePaymentMethodId }, ctx) => {
      await withOpRateLimit(
        ctx,
        "selectTier",
        OP_RATE_LIMITS.selectTier.limit,
        OP_RATE_LIMITS.selectTier.windowSeconds,
      );

      const userId = ctx.auth!.userId;
      const db = getDb();

      const existingSub = await db
        .selectFrom("user_subscriptions")
        .where("user_id", "=", userId)
        .select(["id", "stripe_customer_id", "stripe_subscription_id"])
        .executeTakeFirst();

      if (tier === "FREE_TRIAL") {
        const trialExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await db
          .insertInto("user_subscriptions")
          .values({
            user_id: userId,
            tier: "FREE_TRIAL",
            subscription_status: "trialing",
            trial_started_at: new Date(),
            trial_expires_at: trialExpiresAt,
          })
          .onConflict((oc) =>
            oc.column("user_id").doUpdateSet({
              tier: "FREE_TRIAL",
              subscription_status: "trialing",
              trial_started_at: new Date(),
              trial_expires_at: trialExpiresAt,
              updated_at: new Date(),
            }),
          )
          .execute();

        return {
          subscriptionTier: "FREE_TRIAL" as const,
          subscriptionStatus: "trialing" as const,
          trialExpiresAt,
        };
      }

      // BYOK or TACHYON_HOSTED — requires a Stripe payment method
      if (!stripePaymentMethodId) {
        throw new GraphQLError(
          "stripePaymentMethodId is required for paid tiers",
          {
            extensions: {
              code: "VALIDATION_ERROR",
              field: "stripePaymentMethodId",
            },
          },
        );
      }

      return await db.transaction().execute(async (trx) => {
        const user = await trx
          .selectFrom("users")
          .where("id", "=", userId)
          .select("email")
          .executeTakeFirstOrThrow();

        let stripeCustomerId = existingSub?.stripe_customer_id ?? null;

        if (!stripeCustomerId) {
          const customer = await stripe.customers.create({
            email: user.email,
          });
          stripeCustomerId = customer.id;
        }

        await stripe.paymentMethods.attach(stripePaymentMethodId, {
          customer: stripeCustomerId,
        });
        await stripe.customers.update(stripeCustomerId, {
          invoice_settings: {
            default_payment_method: stripePaymentMethodId,
          },
        });

        const priceId =
          tier === "BYOK"
            ? process.env.STRIPE_PRICE_ID_BYOK!
            : process.env.STRIPE_PRICE_ID_TACHYON_HOSTED!;

        const stripeSub = await stripe.subscriptions.create({
          customer: stripeCustomerId,
          items: [{ price: priceId }],
        });

        const currentPeriodEnd = new Date(
          (stripeSub as unknown as { current_period_end: number })
            .current_period_end * 1000,
        );

        await trx
          .insertInto("user_subscriptions")
          .values({
            user_id: userId,
            tier,
            subscription_status: "active",
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: stripeSub.id,
            current_period_end: currentPeriodEnd,
          })
          .onConflict((oc) =>
            oc.column("user_id").doUpdateSet({
              tier,
              subscription_status: "active",
              stripe_customer_id: stripeCustomerId!,
              stripe_subscription_id: stripeSub.id,
              current_period_end: currentPeriodEnd,
              updated_at: new Date(),
            }),
          )
          .execute();

        return {
          subscriptionTier: tier,
          subscriptionStatus: "active" as const,
          trialExpiresAt: null,
        };
      });
    },
  }),
);

// ---------------------------------------------------------------------------
// cancelSubscription
// ---------------------------------------------------------------------------

const CancelSubscriptionResult = builder.simpleObject(
  "CancelSubscriptionResult",
  {
    fields: (t) => ({
      success: t.boolean(),
    }),
  },
);

builder.mutationField("cancelSubscription", (t) =>
  t.field({
    type: CancelSubscriptionResult,
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      await withOpRateLimit(
        ctx,
        "cancelSubscription",
        OP_RATE_LIMITS.cancelSubscription.limit,
        OP_RATE_LIMITS.cancelSubscription.windowSeconds,
      );

      const userId = ctx.auth!.userId;
      const db = getDb();

      const sub = await db
        .selectFrom("user_subscriptions")
        .where("user_id", "=", userId)
        .select(["id", "stripe_subscription_id"])
        .executeTakeFirst();

      if (!sub) {
        throw new GraphQLError("No active subscription found", {
          extensions: { code: "NOT_FOUND" },
        });
      }

      // Cancel at Stripe for paid tiers; no-op for FREE_TRIAL (no stripe_subscription_id)
      if (sub.stripe_subscription_id) {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      }

      // Atomic: mark cancelled + pause all ACTIVE bots
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable("user_subscriptions")
          .set({ subscription_status: "cancelled", updated_at: new Date() })
          .where("id", "=", sub.id)
          .execute();

        await trx
          .updateTable("bots")
          .set({ status: "PAUSED", updated_at: new Date() })
          .where("user_id", "=", userId)
          .where("status", "=", "ACTIVE")
          .execute();
      });

      return { success: true };
    },
  }),
);
