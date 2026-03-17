import { builder } from "../../builder";

builder.queryField("me", (t) =>
  t.field({
    type: "User",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      const user = await ctx.db
        .selectFrom("users")
        .selectAll()
        .where("id", "=", ctx.auth!.userId)
        .executeTakeFirstOrThrow();
      return user;
    },
  }),
);
