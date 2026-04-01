import {
  withOpRateLimit,
  OP_RATE_LIMITS,
} from "../../../middleware/operationRateLimit";
import { builder } from "../../builder";
import {
  BotFrameEnum,
  RiskAttitudeEnum,
  TradeTempoEnum,
  CombatPatienceEnum,
} from "../../types/enums";
import { ValidationError, NotFoundError } from "../../types/errors";
import { assertOwnership } from "../../../auth/authorization";
import { getScanBotQueue, getReconciliationQueue } from "../../../queues";
import { QUEUE_NAMES } from "@tachyonapp/tachyon-queue-types";
import type {
  ScanBotJobPayload,
  PositionClosePayload,
} from "@tachyonapp/tachyon-queue-types";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

const CreateBotInput = builder.inputType("CreateBotInput", {
  fields: (t) => ({
    name: t.string({ required: true }),
    frameName: t.field({ type: BotFrameEnum, required: true }),
    allocationPct: t.field({ type: "Decimal", required: true }),
    dailyMaxLoss: t.field({ type: "Decimal", required: true }),
    dailyMaxGain: t.field({ type: "Decimal", required: true }),
    riskAttitude: t.field({ type: RiskAttitudeEnum, required: true }),
    tradeTempo: t.field({ type: TradeTempoEnum, required: true }),
    combatPatience: t.field({ type: CombatPatienceEnum, required: true }),
  }),
});

const UpdateBotInput = builder.inputType("UpdateBotInput", {
  fields: (t) => ({
    name: t.string({ required: false }),
    allocationPct: t.field({ type: "Decimal", required: false }),
    dailyMaxLoss: t.field({ type: "Decimal", required: false }),
    dailyMaxGain: t.field({ type: "Decimal", required: false }),
    riskAttitude: t.field({ type: RiskAttitudeEnum, required: false }),
    tradeTempo: t.field({ type: TradeTempoEnum, required: false }),
    combatPatience: t.field({ type: CombatPatienceEnum, required: false }),
  }),
});

// ---------------------------------------------------------------------------
// Result union types
// Bot is backed by BotsRow — discriminate on `frame_id` (always present on a bot row)
// ---------------------------------------------------------------------------

const CreateBotResult = builder.unionType("CreateBotResult", {
  types: ["Bot", ValidationError],
  resolveType: (value) => ("frame_id" in value ? "Bot" : ValidationError),
});

const UpdateBotResult = builder.unionType("UpdateBotResult", {
  types: ["Bot", ValidationError, NotFoundError],
  resolveType: (value) => {
    if ("frame_id" in value) return "Bot";
    if ("field" in value) return ValidationError;
    return NotFoundError;
  },
});

const BotResult = builder.unionType("BotResult", {
  types: ["Bot", ValidationError, NotFoundError],
  resolveType: (value) => {
    if ("frame_id" in value) return "Bot";
    if ("field" in value) return ValidationError;
    return NotFoundError;
  },
});

// ---------------------------------------------------------------------------
// createBot
// ---------------------------------------------------------------------------

builder.mutationField("createBot", (t) =>
  t.field({
    type: CreateBotResult,
    args: { input: t.arg({ type: CreateBotInput, required: true }) },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      // rate limit check
      await withOpRateLimit(
        ctx,
        "createBot",
        OP_RATE_LIMITS.createBot.limit,
        OP_RATE_LIMITS.createBot.windowSeconds,
      );

      const { input } = args;

      if (parseFloat(input.allocationPct) <= 0) {
        return {
          message: "Allocation must be greater than 0",
          field: "allocationPct",
          code: "INVALID_VALUE",
        };
      }

      if (parseFloat(input.dailyMaxLoss) <= 0) {
        return {
          message: "Daily max loss must be greater than 0",
          field: "dailyMaxLoss",
          code: "INVALID_VALUE",
        };
      }

      // Look up frame_id from bot_frames by name
      const frame = await ctx.db
        .selectFrom("bot_frames")
        .select("id")
        .where("name", "=", input.frameName)
        .where("is_active", "=", true)
        .executeTakeFirst();

      if (!frame) {
        return {
          message: `Bot frame "${input.frameName}" is not available`,
          field: "frameName",
          code: "INVALID_VALUE",
        };
      }

      // Fetch default exit_personality and stop_style
      // TODO:: (Phase-2 — Bot Builder): Allow user to select personality and stop style
      const [exitPersonality, stopStyle] = await Promise.all([
        ctx.db
          .selectFrom("exit_personalities")
          .select("id")
          .where("is_active", "=", true)
          .orderBy("id", "asc")
          .executeTakeFirstOrThrow(),
        ctx.db
          .selectFrom("stop_styles")
          .select("id")
          .where("is_active", "=", true)
          .orderBy("id", "asc")
          .executeTakeFirstOrThrow(),
      ]);

      // Transaction: bots → bot_settings → update current_settings_id
      // Circular FK requires inserting bots first (current_settings_id = null),
      // then bot_settings, then updating bots.current_settings_id.
      const botId = await ctx.db.transaction().execute(async (trx) => {
        const newBot = await trx
          .insertInto("bots")
          .values({
            user_id: ctx.auth!.userId,
            name: input.name,
            frame_id: frame.id,
            allocation_pct: input.allocationPct,
            status: "DRAFT",
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        const newSettings = await trx
          .insertInto("bot_settings")
          .values({
            bot_id: newBot.id,
            daily_max_loss: input.dailyMaxLoss,
            daily_max_gain: input.dailyMaxGain,
            risk_attitude: input.riskAttitude,
            trade_tempo: input.tradeTempo,
            combat_patience: input.combatPatience,
            exit_personality_id: exitPersonality.id,
            stop_style_id: stopStyle.id,
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        await trx
          .updateTable("bots")
          .set({ current_settings_id: newSettings.id })
          .where("id", "=", newBot.id)
          .execute();

        return newBot.id;
      });

      // Re-fetch after transaction to get final state (current_settings_id set)
      return ctx.db
        .selectFrom("bots")
        .selectAll()
        .where("id", "=", botId)
        .executeTakeFirstOrThrow();
    },
  }),
);

// ---------------------------------------------------------------------------
// updateBot
// ---------------------------------------------------------------------------

builder.mutationField("updateBot", (t) =>
  t.field({
    type: UpdateBotResult,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateBotInput, required: true }),
    },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      const existing = await ctx.db
        .selectFrom("bots")
        .selectAll()
        .where("id", "=", args.id)
        .where("status", "!=", "ARCHIVED")
        .executeTakeFirst();

      if (!existing) {
        return { message: "Bot not found" };
      }

      assertOwnership(ctx, String(existing.user_id));

      const { input } = args;
      const hasSettingsUpdate =
        input.dailyMaxLoss != null ||
        input.dailyMaxGain != null ||
        input.riskAttitude != null ||
        input.tradeTempo != null ||
        input.combatPatience != null ||
        input.allocationPct != null;

      await ctx.db.transaction().execute(async (trx) => {
        if (input.name != null) {
          await trx
            .updateTable("bots")
            .set({ name: input.name })
            .where("id", "=", args.id)
            .execute();
        }

        if (hasSettingsUpdate) {
          // Fetch current settings to carry forward unchanged fields
          const currentSettings = existing.current_settings_id
            ? await trx
                .selectFrom("bot_settings")
                .selectAll()
                .where("id", "=", existing.current_settings_id)
                .executeTakeFirstOrThrow()
            : null;

          // Create a new bot_settings row — preserves version history
          // (bot_settings.effective_from tracks when each version took effect)
          const newSettings = await trx
            .insertInto("bot_settings")
            .values({
              bot_id: args.id,
              daily_max_loss:
                input.dailyMaxLoss ?? currentSettings?.daily_max_loss ?? "0",
              daily_max_gain:
                input.dailyMaxGain ?? currentSettings?.daily_max_gain ?? "0",
              risk_attitude:
                input.riskAttitude ??
                currentSettings?.risk_attitude ??
                "BALANCED",
              trade_tempo:
                input.tradeTempo ??
                currentSettings?.trade_tempo ??
                "OPPORTUNISTIC",
              combat_patience:
                input.combatPatience ??
                currentSettings?.combat_patience ??
                "PATIENT",
              exit_personality_id: currentSettings?.exit_personality_id ?? "1",
              stop_style_id: currentSettings?.stop_style_id ?? "1",
            })
            .returning("id")
            .executeTakeFirstOrThrow();

          if (input.allocationPct != null) {
            await trx
              .updateTable("bots")
              .set({
                current_settings_id: newSettings.id,
                allocation_pct: input.allocationPct,
              })
              .where("id", "=", args.id)
              .execute();
          } else {
            await trx
              .updateTable("bots")
              .set({ current_settings_id: newSettings.id })
              .where("id", "=", args.id)
              .execute();
          }
        }
      });

      // Re-fetch after transaction to get final state
      return ctx.db
        .selectFrom("bots")
        .selectAll()
        .where("id", "=", args.id)
        .executeTakeFirstOrThrow();
    },
  }),
);

// ---------------------------------------------------------------------------
// activateBot
// ---------------------------------------------------------------------------

builder.mutationField("activateBot", (t) =>
  t.field({
    type: BotResult,
    args: { id: t.arg.id({ required: true }) },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      // rate limit check
      await withOpRateLimit(
        ctx,
        "activateBot",
        OP_RATE_LIMITS.activateBot.limit,
        OP_RATE_LIMITS.activateBot.windowSeconds,
      );
      const bot = await ctx.db
        .selectFrom("bots")
        .selectAll()
        .where("id", "=", args.id)
        .where("status", "!=", "ARCHIVED")
        .executeTakeFirst();

      if (!bot) {
        return { message: "Bot not found" };
      }

      assertOwnership(ctx, String(bot.user_id));

      // Bots must have settings configured before they can be activated
      if (!bot.current_settings_id) {
        return {
          message: "Bot must have settings configured before activation",
          field: "status",
          code: "SETTINGS_REQUIRED",
        };
      }

      const updated = await ctx.db
        .updateTable("bots")
        .set({ status: "ACTIVE" })
        .where("id", "=", args.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Dispatch an immediate scan so the bot doesn't wait for the next cron tick
      const payload: ScanBotJobPayload = {
        botId: String(bot.id),
        userId: ctx.auth!.userId,
      };

      await getScanBotQueue().add(QUEUE_NAMES.SCAN_BOT, payload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      });

      return updated;
    },
  }),
);

// ---------------------------------------------------------------------------
// pauseBot
// ---------------------------------------------------------------------------

builder.mutationField("pauseBot", (t) =>
  t.field({
    type: BotResult,
    args: { id: t.arg.id({ required: true }) },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      // rate limit check
      await withOpRateLimit(
        ctx,
        "pauseBot",
        OP_RATE_LIMITS.pauseBot.limit,
        OP_RATE_LIMITS.pauseBot.windowSeconds,
      );

      const existing = await ctx.db
        .selectFrom("bots")
        .select(["id", "user_id", "status"])
        .where("id", "=", args.id)
        .where("status", "!=", "ARCHIVED")
        .executeTakeFirst();

      if (!existing) {
        return { message: "Bot not found" };
      }

      assertOwnership(ctx, String(existing.user_id));

      return ctx.db
        .updateTable("bots")
        .set({ status: "PAUSED" })
        .where("id", "=", args.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    },
  }),
);

// ---------------------------------------------------------------------------
// deleteBot (soft delete — sets status to ARCHIVED)
// ---------------------------------------------------------------------------

builder.mutationField("deleteBot", (t) =>
  t.field({
    type: BotResult,
    args: { id: t.arg.id({ required: true }) },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      const existing = await ctx.db
        .selectFrom("bots")
        .select(["id", "user_id", "status"])
        .where("id", "=", args.id)
        .where("status", "!=", "ARCHIVED")
        .executeTakeFirst();

      if (!existing) {
        return { message: "Bot not found" };
      }

      assertOwnership(ctx, String(existing.user_id));

      const updated = await ctx.db
        .updateTable("bots")
        .set({ status: "ARCHIVED" })
        .where("id", "=", args.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      // If bot has an open position, dispatch a targeted close job
      const openPosition = await ctx.db
        .selectFrom("positions")
        .select("id")
        .where("bot_id", "=", args.id)
        .where("status", "=", "OPEN")
        .executeTakeFirst();

      if (openPosition) {
        const payload: PositionClosePayload = {
          positionId: String(openPosition.id),
          botId: String(existing.id),
          userId: ctx.auth!.userId,
          correlationId: ctx.correlationId,
          enqueuedAt: new Date().toISOString(),
        };

        await getReconciliationQueue().add(
          QUEUE_NAMES.RECONCILIATION,
          payload,
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
          },
        );
      }

      return updated;
    },
  }),
);
