import { builder } from "../../builder";
import {
  SubscriptionTierEnum,
  SubscriptionStatusEnum,
} from "../../types/enums";

builder.objectType("User", {
  description: "An authenticated Tachyon user",
  fields: (t) => ({
    id: t.exposeID("id"),
    email: t.exposeString("email"),
    auth0Id: t.field({
      type: "String",
      resolve: (user) => user.auth0_subject, // snake_case DB col → camelCase field
    }),
    createdAt: t.field({
      type: "DateTime",
      resolve: (user) => new Date(user.created_at),
    }),
    onboardingCompleted: t.field({
      type: "Boolean",
      nullable: false,
      description: "Whether the user has completed the FTUE onboarding flow.",
      resolve: async (user, _args, ctx) => {
        const settings = await ctx.db
          .selectFrom("user_settings")
          .select("onboarding_completed")
          .where("user_id", "=", user.id)
          .executeTakeFirst();
        // Default false if no row exists (new users before first settings write)
        return settings?.onboarding_completed ?? false;
      },
    }),
    subscriptionTier: t.field({
      type: SubscriptionTierEnum,
      nullable: true,
      resolve: async (user, _args, ctx) => {
        const sub = await ctx.db
          .selectFrom("user_subscriptions")
          .where("user_id", "=", user.id)
          .select("tier")
          .executeTakeFirst();
        return sub?.tier ?? null;
      },
    }),
    subscriptionStatus: t.field({
      type: SubscriptionStatusEnum,
      nullable: true,
      resolve: async (user, _args, ctx) => {
        const sub = await ctx.db
          .selectFrom("user_subscriptions")
          .where("user_id", "=", user.id)
          .select("subscription_status")
          .executeTakeFirst();
        return sub?.subscription_status ?? null;
      },
    }),
    trialExpiresAt: t.field({
      type: "DateTime",
      nullable: true,
      resolve: async (user, _args, ctx) => {
        const sub = await ctx.db
          .selectFrom("user_subscriptions")
          .where("user_id", "=", user.id)
          .where("tier", "=", "FREE_TRIAL")
          .select("trial_expires_at")
          .executeTakeFirst();
        return sub?.trial_expires_at ?? null;
      },
    }),
    currentPeriodEnd: t.field({
      type: "DateTime",
      nullable: true,
      resolve: async (user, _args, ctx) => {
        const sub = await ctx.db
          .selectFrom("user_subscriptions")
          .where("user_id", "=", user.id)
          .select("current_period_end")
          .executeTakeFirst();
        return sub?.current_period_end ?? null;
      },
    }),
  }),
});
