import { builder } from "../../builder";
import { assertOwnership } from "../../../auth/authorization";

// List all non-archived bots for the authenticated user
builder.queryField("bots", (t) =>
  t.field({
    type: ["Bot"],
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      return ctx.db
        .selectFrom("bots")
        .selectAll()
        .where("user_id", "=", ctx.auth!.userId)
        .where("status", "!=", "ARCHIVED")
        .execute();
    },
  }),
);

// Fetch a single bot by ID — enforces ownership
builder.queryField("bot", (t) =>
  t.field({
    type: "Bot",
    nullable: true,
    args: { id: t.arg.id({ required: true }) },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      const bot = await ctx.db
        .selectFrom("bots")
        .selectAll()
        .where("id", "=", args.id)
        .where("status", "!=", "ARCHIVED")
        .executeTakeFirst();

      if (!bot) return null;

      assertOwnership(ctx, String(bot.user_id));

      return bot;
    },
  }),
);
