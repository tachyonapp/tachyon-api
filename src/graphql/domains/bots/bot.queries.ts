import type { Kysely } from "kysely";
import type { DB } from "@tachyonapp/tachyon-db";
import { builder, type BotWithSettings } from "../../builder";
import { assertOwnership } from "../../../auth/authorization";

/**
 * Reusable Kysely query base for fetching bots with their joined settings and frame.
 *
 * Joins:
 *   - LEFT JOIN bot_settings  — via bots.current_settings_id (null for DRAFT bots with no settings)
 *   - INNER JOIN bot_frames   — via bots.frame_id (always present)
 *
 * Returns bots columns + daily_max_loss/gain + risk/tempo/patience + frame_name.
 * Cast result to BotWithSettings[] at call site.
 */
export function botWithSettingsQuery(db: Kysely<DB>) {
  return db
    .selectFrom("bots")
    .leftJoin("bot_settings", "bot_settings.id", "bots.current_settings_id")
    .innerJoin("bot_frames", "bot_frames.id", "bots.frame_id")
    .selectAll("bots")
    .select([
      "bot_settings.daily_max_loss",
      "bot_settings.daily_max_gain",
      "bot_settings.risk_attitude",
      "bot_settings.trade_tempo",
      "bot_settings.combat_patience",
      "bot_frames.name as frame_name",
    ]);
}

// List all non-archived bots for the authenticated user
builder.queryField("bots", (t) =>
  t.field({
    type: ["Bot"],
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      const rows = await botWithSettingsQuery(ctx.db)
        .where("bots.user_id", "=", ctx.auth!.userId)
        .where("bots.status", "!=", "ARCHIVED")
        .execute();

      return rows as unknown as BotWithSettings[];
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
      const bot = await botWithSettingsQuery(ctx.db)
        .where("bots.id", "=", args.id)
        .where("bots.status", "!=", "ARCHIVED")
        .executeTakeFirst();

      if (!bot) return null;

      assertOwnership(ctx, String(bot.user_id));

      return bot as unknown as BotWithSettings;
    },
  }),
);
