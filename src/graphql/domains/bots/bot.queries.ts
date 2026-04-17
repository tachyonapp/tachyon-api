import { builder } from "../../builder";
import { assertOwnership } from "../../../auth/authorization";
import {
  TACHYON_DEFAULT_BRAIN,
  BYOK_PROVIDER_CATALOG,
} from "../../../config/brainProviders";
import { BrainCatalog } from "./bot.type";

// Public catalog — no auth required; mobile fetches this at wizard entry
builder.queryField("brainProviders", (t) =>
  t.field({
    type: BrainCatalog,
    resolve: () => ({
      defaultBrain: {
        brainType: TACHYON_DEFAULT_BRAIN.brainType,
        modelId: TACHYON_DEFAULT_BRAIN.modelId,
        provider: TACHYON_DEFAULT_BRAIN.provider,
        displayName: TACHYON_DEFAULT_BRAIN.displayName,
        description: TACHYON_DEFAULT_BRAIN.description,
      },
      byokProviders: BYOK_PROVIDER_CATALOG.map((p) => ({
        provider: p.provider,
        displayName: p.displayName,
        models: p.models.map((m) => ({
          modelId: m.modelId,
          displayName: m.displayName,
        })),
      })),
    }),
  }),
);

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
