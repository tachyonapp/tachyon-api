import { builder } from "../../builder";

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
  }),
});
