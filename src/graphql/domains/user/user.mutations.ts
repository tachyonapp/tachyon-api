import { builder } from "../../builder";
/**
 *
 * CRITICAL
 *
 * Must use an upsert (`INSERT ... ON CONFLICT DO UPDATE`), not a plain `UPDATE`.
 * The Clerk `provisionUser()` webhook handler does NOT create a `user_settings` row -
 * a new user will have no `user_settings` row when they first hit FTUE.
 *
 * A plain `UPDATE WHERE user_id = $1` against a missing row is a silent no-op that
 * returns `true` while writing nothing, leaving the user permanently stuck in the FTUE loop.
 *
 */
builder.mutationField("completeOnboarding", (t) =>
  t.boolean({
    description: "Mark the authenticated user's FTUE as complete. Idempotent.",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      await ctx.db
        .insertInto("user_settings")
        .values({
          user_id: BigInt(ctx.auth!.userId), // ctx.auth!.userId is a string but is BigInt in DB
          onboarding_completed: true,
        })
        .onConflict((oc) =>
          oc.column("user_id").doUpdateSet({ onboarding_completed: true }),
        )
        .execute();
      return true;
    },
  }),
);
