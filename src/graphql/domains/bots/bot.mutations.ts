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
  SectorFilterEnum,
  ExitPersonalityNameEnum,
  StopStyleNameEnum,
  BrainTypeEnum,
} from "../../types/enums";
import { ValidationError, NotFoundError } from "../../types/errors";
import { GraphQLError } from "graphql";
import type { BotsRow } from "@tachyonapp/tachyon-db";
import { assertOwnership } from "../../../auth/authorization";
import { getScanBotQueue, getReconciliationQueue } from "../../../queues";
import { QUEUE_NAMES } from "@tachyonapp/tachyon-queue-types";
import type {
  ScanBotJobPayload,
  PositionClosePayload,
} from "@tachyonapp/tachyon-queue-types";
import { encrypt } from "../../../lib/crypto";
import {
  ALLOWED_BYOK_PROVIDERS,
  ALLOWED_BYOK_MODELS,
  BYOK_PROVIDER_VALIDATION_ENDPOINTS,
  type ByokProvider,
} from "../../../config/allowedSectors";
import { FRAME_CONFIG } from "../../../config/frameConfig";
import { ValidateBrainKeyResult } from "./bot.type";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

const MarketAwarenessInput = builder.inputType("MarketAwarenessInput", {
  fields: (t) => ({
    momentum: t.float({ required: true }),
    meanReversion: t.float({ required: true }),
    volatility: t.float({ required: true }),
    trendFollowing: t.float({ required: true }),
  }),
});

const EmotionalControlsInput = builder.inputType("EmotionalControlsInput", {
  fields: (t) => ({
    freezeAfterLosses: t.int({ required: false }), // null = disabled; 1–5
    cooldownAfterVolatility: t.boolean({ required: true }),
    standDownAfterNoonIfLosing: t.boolean({ required: true }),
  }),
});

const RulesOfEngagementInput = builder.inputType("RulesOfEngagementInput", {
  fields: (t) => ({
    overnightHoldAllowed: t.boolean({ required: true }),
    noSameDayExitUnlessStopLoss: t.boolean({ required: true }),
    // oneTradeAtATime is always true in MVP — NOT accepted as input
  }),
});

const BrainConfigInput = builder.inputType("BrainConfigInput", {
  fields: (t) => ({
    brainType: t.field({ type: BrainTypeEnum, required: true }),
    modelId: t.string({ required: true }),
    provider: t.string({ required: false }), // required if brainType == BYOK
    apiKey: t.string({ required: false }), // required if brainType == BYOK; encrypted before storage
  }),
});

const ExitPersonalityInput = builder.inputType("ExitPersonalityInput", {
  fields: (t) => ({
    name: t.field({ type: ExitPersonalityNameEnum, required: true }),
  }),
});

const StopLossStyleInput = builder.inputType("StopLossStyleInput", {
  fields: (t) => ({
    name: t.field({ type: StopStyleNameEnum, required: true }),
  }),
});

const CreateBotInput = builder.inputType("CreateBotInput", {
  fields: (t) => ({
    // Frame & Identity
    name: t.string({ required: true }), // max 24 chars
    frameName: t.field({ type: BotFrameEnum, required: true }),
    avatarId: t.id({ required: true }),
    colorway: t.string({ required: true }), // hex string e.g. "#2C6BED"

    // Core trading parameters
    allocationPct: t.field({ type: "Decimal", required: true }), // 0.01 – 1.00
    riskAttitude: t.field({ type: RiskAttitudeEnum, required: true }),
    tradeTempo: t.field({ type: TradeTempoEnum, required: true }),
    combatPatience: t.field({ type: CombatPatienceEnum, required: true }),

    // Market awareness (4 scores 0.0–1.0)
    marketAwareness: t.field({ type: MarketAwarenessInput, required: true }),

    // Sector & target preferences
    sectors: t.field({ type: [SectorFilterEnum], required: true }), // min 1 item

    // Exit behavior
    exitPersonality: t.field({ type: ExitPersonalityInput, required: true }),
    stopLossStyle: t.field({ type: StopLossStyleInput, required: true }),

    // Safety systems
    dailyMaxLossPct: t.field({ type: "Decimal", required: true }), // per-frame bounds enforced in resolver
    dailyMaxGain: t.field({ type: "Decimal", required: false }), // optional (USD)

    // Emotional controls
    emotionalControls: t.field({
      type: EmotionalControlsInput,
      required: true,
    }),

    // Rules of engagement
    rulesOfEngagement: t.field({
      type: RulesOfEngagementInput,
      required: true,
    }),

    // Brain selection
    brain: t.field({ type: BrainConfigInput, required: true }),
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
//
// NOTE:: JSONB columns — pg has no special handling. When you pass a plain
// JS object or array, the driver calls .toString() on it, which produces
// [object Object] or TECH (comma-joined). Postgres then tries to parse that
// string as JSON and fails with invalid input syntax for type json. Hence
// the use of JSON.stringify() for certain bot settings.
// ---------------------------------------------------------------------------

builder.mutationField("createBot", (t) =>
  t.field({
    type: CreateBotResult,
    args: { input: t.arg({ type: CreateBotInput, required: true }) },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      // Step 1: Rate limit check
      await withOpRateLimit(
        ctx,
        "createBot",
        OP_RATE_LIMITS.createBot.limit,
        OP_RATE_LIMITS.createBot.windowSeconds,
      );

      const { input } = args;

      // Step 2: Validate name length (max 24 chars)
      if (input.name.length > 24) {
        return {
          message: "Bot name must be 24 characters or fewer",
          field: "name",
          code: "TOO_LONG",
        };
      }

      // Step 3: Validate allocationPct range [0.01, 1.00] + per-user ceiling.
      // The ceiling check sums allocation_pct across the user's existing ACTIVE/PAUSED bots
      // (the new bot doesn't exist in the DB yet — the transaction is step 15). Users with no
      // existing bots get existingTotal = 0 safely: executeTakeFirst() returns undefined when
      // there are no rows, and SUM() on an empty set returns null, both coalesced to "0".
      const allocationPct = parseFloat(input.allocationPct);
      if (allocationPct < 0.01 || allocationPct > 1.0) {
        return {
          message: "Allocation must be between 1% and 100%",
          field: "allocationPct",
          code: "OUT_OF_BOUNDS",
        };
      }

      const existingAllocationRow = await ctx.db
        .selectFrom("bots")
        .select((eb) => eb.fn.sum<string>("allocation_pct").as("total"))
        .where("user_id", "=", ctx.auth!.userId)
        .where("status", "in", ["ACTIVE", "PAUSED"])
        .executeTakeFirst();

      const existingTotal = parseFloat(existingAllocationRow?.total ?? "0");
      if (existingTotal + allocationPct > 1.0) {
        return {
          message: "Total bot allocation would exceed 100%",
          field: "allocationPct",
          code: "ALLOCATION_CEILING_EXCEEDED",
        };
      }

      // Step 4: Validate dailyMaxLossPct against per-frame bounds from FRAME_CONFIG
      const frameConfig = FRAME_CONFIG[input.frameName];
      const dailyMaxLossPct = parseFloat(input.dailyMaxLossPct);
      const lossBounds = frameConfig.bounds.dailyMaxLoss;
      if (
        dailyMaxLossPct < lossBounds.minPct ||
        dailyMaxLossPct > lossBounds.maxPct
      ) {
        return {
          message: `${input.frameName} allows ${(lossBounds.minPct * 100).toFixed(0)}%–${(lossBounds.maxPct * 100).toFixed(0)}%`,
          field: "dailyMaxLossPct",
          code: "OUT_OF_BOUNDS",
        };
      }

      // Step 5: Validate sectors (min 1 item; GraphQL enum type ensures all values are valid)
      if (input.sectors.length < 1) {
        return {
          message: "At least one sector must be selected",
          field: "sectors",
          code: "MIN_LENGTH",
        };
      }

      // Step 6: Validate all marketAwareness fields in [0.0, 1.0]
      const maInputFields = [
        {
          key: "marketAwareness.momentum",
          value: input.marketAwareness.momentum,
        },
        {
          key: "marketAwareness.meanReversion",
          value: input.marketAwareness.meanReversion,
        },
        {
          key: "marketAwareness.volatility",
          value: input.marketAwareness.volatility,
        },
        {
          key: "marketAwareness.trendFollowing",
          value: input.marketAwareness.trendFollowing,
        },
      ] as const;

      for (const { key, value } of maInputFields) {
        if (value < 0.0 || value > 1.0) {
          return {
            message: `${key} must be between 0.0 and 1.0`,
            field: key,
            code: "OUT_OF_BOUNDS",
          };
        }
      }

      // Step 7: Validate emotionalControls.freezeAfterLosses in [1, 5] if not null
      const fal = input.emotionalControls.freezeAfterLosses;
      if (fal !== null && fal !== undefined && (fal < 1 || fal > 5)) {
        return {
          message: "freezeAfterLosses must be between 1 and 5",
          field: "emotionalControls.freezeAfterLosses",
          code: "OUT_OF_BOUNDS",
        };
      }

      // Step 8: Look up frame from bot_frames table; return error if not found or inactive
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
          code: "FRAME_NOT_FOUND",
        };
      }

      // Step 9: Validate all parameters against FRAME_CONFIG per-frame bounds.
      // Collect ALL violations (no short-circuit) — mobile needs to surface all errors at once.
      const bounds = frameConfig.bounds;
      const violations: Array<{
        message: string;
        field: string;
        code: string;
      }> = [];

      if (
        allocationPct < bounds.allocationPct.min ||
        allocationPct > bounds.allocationPct.max
      ) {
        violations.push({
          message: `${input.frameName} allows allocation between ${(bounds.allocationPct.min * 100).toFixed(0)}%–${(bounds.allocationPct.max * 100).toFixed(0)}%`,
          field: "allocationPct",
          code: "OUT_OF_BOUNDS",
        });
      }

      if (
        !(bounds.riskAttitude as readonly string[]).includes(input.riskAttitude)
      ) {
        violations.push({
          message: `${input.frameName} does not allow risk attitude "${input.riskAttitude}"`,
          field: "riskAttitude",
          code: "OUT_OF_BOUNDS",
        });
      }

      if (
        !(bounds.tradeTempo as readonly string[]).includes(input.tradeTempo)
      ) {
        violations.push({
          message: `${input.frameName} does not allow trade tempo "${input.tradeTempo}"`,
          field: "tradeTempo",
          code: "OUT_OF_BOUNDS",
        });
      }

      if (
        !(bounds.combatPatience as readonly string[]).includes(
          input.combatPatience,
        )
      ) {
        violations.push({
          message: `${input.frameName} does not allow combat patience "${input.combatPatience}"`,
          field: "combatPatience",
          code: "OUT_OF_BOUNDS",
        });
      }

      for (const key of [
        "momentum",
        "meanReversion",
        "volatility",
        "trendFollowing",
      ] as const) {
        const val = input.marketAwareness[key];
        const bound = bounds.marketAwareness[key];
        if (val < bound.min || val > bound.max) {
          violations.push({
            message: `marketAwareness.${key} must be between ${bound.min} and ${bound.max} for ${input.frameName}`,
            field: `marketAwareness.${key}`,
            code: "OUT_OF_BOUNDS",
          });
        }
      }

      if (violations.length > 0) {
        // Schema supports a single ValidationError — return the first violation found
        return violations[0]!;
      }

      // Step 10: BYOK validation — external HTTP call; done after all local checks to avoid
      // unnecessary network traffic when input is otherwise invalid
      if (input.brain.brainType === "BYOK") {
        const { provider, modelId, apiKey } = input.brain;

        if (
          !provider ||
          !(ALLOWED_BYOK_PROVIDERS as readonly string[]).includes(provider)
        ) {
          return {
            message: `Provider "${provider ?? "missing"}" is not supported`,
            field: "brain.provider",
            code: "INVALID_PROVIDER",
          };
        }

        const typedProvider = provider as ByokProvider;
        if (!ALLOWED_BYOK_MODELS[typedProvider].includes(modelId)) {
          return {
            message: `Model "${modelId}" is not supported for provider "${provider}"`,
            field: "brain.modelId",
            code: "INVALID_MODEL",
          };
        }

        if (!apiKey) {
          return {
            message: "API key is required for BYOK",
            field: "brain.apiKey",
            code: "REQUIRED",
          };
        }

        // SSRF guard: validation URL is from server-side allowlist — never constructed from user input
        const validationUrl = BYOK_PROVIDER_VALIDATION_ENDPOINTS[typedProvider];
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(validationUrl, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            return {
              message: "API key validation failed",
              field: "brain.apiKey",
              code: "BYOK_KEY_INVALID",
            };
          }
        } catch {
          return {
            message: "API key validation failed",
            field: "brain.apiKey",
            code: "BYOK_KEY_INVALID",
          };
        }
      }

      // Step 11: Look up avatar
      const avatar = await ctx.db
        .selectFrom("bot_avatars")
        .select("id")
        .where("id", "=", input.avatarId)
        .executeTakeFirst();

      if (!avatar) {
        return {
          message: "Avatar not found",
          field: "avatarId",
          code: "AVATAR_NOT_FOUND",
        };
      }

      // Step 12: Look up exit_personality by name
      const exitPersonality = await ctx.db
        .selectFrom("exit_personalities")
        .select("id")
        .where("name", "=", input.exitPersonality.name)
        .where("is_active", "=", true)
        .executeTakeFirst();

      if (!exitPersonality) {
        return {
          message: `Exit personality "${input.exitPersonality.name}" not found`,
          field: "exitPersonality",
          code: "EXIT_PERSONALITY_NOT_FOUND",
        };
      }

      // Step 13: Look up stop_style by name
      const stopStyle = await ctx.db
        .selectFrom("stop_styles")
        .select("id")
        .where("name", "=", input.stopLossStyle.name)
        .where("is_active", "=", true)
        .executeTakeFirst();

      if (!stopStyle) {
        return {
          message: `Stop style "${input.stopLossStyle.name}" not found`,
          field: "stopLossStyle",
          code: "STOP_STYLE_NOT_FOUND",
        };
      }

      // Step 14: Idempotency check — return existing DRAFT bot if same name was created within 60s
      const sixtySecondsAgo = new Date(Date.now() - 60_000);
      const existingDraft = await ctx.db
        .selectFrom("bots")
        .selectAll()
        .where("user_id", "=", ctx.auth!.userId)
        .where("name", "=", input.name)
        .where("status", "=", "DRAFT")
        .where("created_at", ">=", sixtySecondsAgo)
        .executeTakeFirst();

      if (existingDraft) {
        return existingDraft;
      }

      // Step 15: Atomic DB transaction — no orphaned records on partial failure
      const botId = await ctx.db.transaction().execute(async (trx) => {
        // a. Insert bot with DRAFT status (circular FK on current_settings_id resolved in step d)
        const newBot = await trx
          .insertInto("bots")
          .values({
            user_id: ctx.auth!.userId,
            frame_id: frame.id,
            avatar_id: avatar.id,
            name: input.name,
            colorway: input.colorway,
            allocation_pct: input.allocationPct,
            status: "DRAFT",
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        // b. Insert bot_settings — oneTradeAtATime is always written as true regardless of input
        const newSettings = await trx
          .insertInto("bot_settings")
          .values({
            bot_id: newBot.id,
            risk_attitude: input.riskAttitude,
            trade_tempo: input.tradeTempo,
            combat_patience: input.combatPatience,
            exit_personality_id: exitPersonality.id,
            stop_style_id: stopStyle.id,
            daily_max_loss_pct: input.dailyMaxLossPct,
            daily_max_gain: input.dailyMaxGain ?? "0",
            emotional_controls: JSON.stringify({
              freezeAfterLosses:
                input.emotionalControls.freezeAfterLosses ?? null,
              cooldownAfterVolatility:
                input.emotionalControls.cooldownAfterVolatility,
              standDownAfterNoonIfLosing:
                input.emotionalControls.standDownAfterNoonIfLosing,
            }),
            rules_of_engagement: JSON.stringify({
              oneTradeAtATime: true,
              overnightHoldAllowed:
                input.rulesOfEngagement.overnightHoldAllowed,
              noSameDayExitUnlessStopLoss:
                input.rulesOfEngagement.noSameDayExitUnlessStopLoss,
            }),
            market_awareness: JSON.stringify({
              momentum: input.marketAwareness.momentum,
              meanReversion: input.marketAwareness.meanReversion,
              volatility: input.marketAwareness.volatility,
              trendFollowing: input.marketAwareness.trendFollowing,
            }),
            sectors: input.sectors,
            asset_types: JSON.stringify(["STOCK", "ETF"]),
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        // c. Insert brain config — BYOK key is encrypted before storage; never returned in response
        let encryptedKey: string | null = null;
        let keyPreview: string | null = null;
        let brainProvider: string | null = null;

        if (input.brain.brainType === "BYOK") {
          const rawKey = input.brain.apiKey!;
          encryptedKey = encrypt(rawKey);
          keyPreview = rawKey.slice(-4);
          brainProvider = input.brain.provider!;
        } else {
          brainProvider = "anthropic";
        }

        await trx
          .insertInto("bot_brain_configs")
          .values({
            bot_id: newBot.id,
            brain_type: input.brain.brainType,
            model_id: input.brain.modelId,
            provider: brainProvider,
            encrypted_key: encryptedKey,
            key_preview: keyPreview,
            is_active: true,
          })
          .execute();

        // d. Promote bot to ACTIVE and link settings (resolves circular FK)
        await trx
          .updateTable("bots")
          .set({ current_settings_id: newSettings.id, status: "ACTIVE" })
          .where("id", "=", newBot.id)
          .execute();

        return newBot.id;
      });

      // Step 16: Dispatch SCAN_BOT after transaction commits (fire-and-forget)
      const scanPayload: ScanBotJobPayload = {
        botId: String(botId),
        userId: ctx.auth!.userId,
      };

      await getScanBotQueue().add(QUEUE_NAMES.SCAN_BOT, scanPayload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      });

      // Step 17: Return fully hydrated Bot with status: ACTIVE
      return ctx.db
        .selectFrom("bots")
        .selectAll()
        .where("id", "=", botId)
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

// ---------------------------------------------------------------------------
// validateBrainKey
//
// Proxies the API key validation to the provider server-side so the mobile
// client never embeds provider-specific validation logic. The key is NOT
// stored — only the validation result is returned.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// updateBotIdentity
// ---------------------------------------------------------------------------

const UpdateBotIdentityInput = builder.inputType("UpdateBotIdentityInput", {
  fields: (t) => ({
    name: t.string({ required: true }),
    avatarId: t.id({ required: true }),
  }),
});

const UpdateBotIdentityResult = builder.objectRef<{ bot: BotsRow }>(
  "UpdateBotIdentityResult",
);
builder.objectType(UpdateBotIdentityResult, {
  fields: (t) => ({
    bot: t.field({
      type: "Bot",
      resolve: (r) => r.bot,
    }),
  }),
});

builder.mutationField("updateBotIdentity", (t) =>
  t.field({
    type: UpdateBotIdentityResult,
    args: {
      id: t.arg.id({ required: true }),
      input: t.arg({ type: UpdateBotIdentityInput, required: true }),
    },
    authScopes: { authenticated: true },
    resolve: async (_root, { id, input }, ctx) => {
      await withOpRateLimit(
        ctx,
        "updateBotIdentity",
        OP_RATE_LIMITS.updateBotIdentity.limit,
        OP_RATE_LIMITS.updateBotIdentity.windowSeconds,
      );

      if (input.name.length > 24) {
        throw new GraphQLError("Bot name must be 24 characters or fewer", {
          extensions: { code: "VALIDATION_ERROR", field: "name" },
        });
      }

      const bot = await ctx.db
        .selectFrom("bots")
        .where("id", "=", id)
        .select(["id", "user_id"])
        .executeTakeFirst();

      if (!bot) {
        throw new GraphQLError("Bot not found", {
          extensions: { code: "NOT_FOUND" },
        });
      }

      assertOwnership(ctx, String(bot.user_id));

      const avatar = await ctx.db
        .selectFrom("bot_avatars")
        .where("id", "=", input.avatarId)
        .select("id")
        .executeTakeFirst();

      if (!avatar) {
        throw new GraphQLError("Avatar not found", {
          extensions: { code: "NOT_FOUND", field: "avatarId" },
        });
      }

      const updated = await ctx.db
        .updateTable("bots")
        .set({
          name: input.name,
          avatar_id: avatar.id,
          updated_at: new Date(),
        })
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return { bot: updated };
    },
  }),
);

function providerValidationErrorMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  if (!("error" in body)) return undefined;
  const error = body.error;
  if (typeof error !== "object" || error === null) return undefined;
  if (!("message" in error)) return undefined;
  const message = error.message;
  return typeof message === "string" ? message : undefined;
}

builder.mutationField("validateBrainKey", (t) =>
  t.field({
    type: ValidateBrainKeyResult,
    args: {
      provider: t.arg.string({ required: true }),
      apiKey: t.arg.string({ required: true }),
    },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      await withOpRateLimit(
        ctx,
        "validateBrainKey",
        OP_RATE_LIMITS.validateBrainKey.limit,
        OP_RATE_LIMITS.validateBrainKey.windowSeconds,
      );

      const provider = args.provider as ByokProvider;

      if (!ALLOWED_BYOK_PROVIDERS.includes(provider)) {
        return {
          valid: false,
          error: `Unsupported provider: ${args.provider}`,
        };
      }

      const endpoint = BYOK_PROVIDER_VALIDATION_ENDPOINTS[provider];

      try {
        const headers: Record<string, string> =
          provider === "anthropic"
            ? { "x-api-key": args.apiKey, "anthropic-version": "2023-06-01" }
            : { Authorization: `Bearer ${args.apiKey}` };

        const res = await fetch(endpoint, { method: "GET", headers });

        if (res.ok) {
          return { valid: true, error: null };
        }

        const body: unknown = await res.json().catch(() => ({}));
        const message =
          providerValidationErrorMessage(body) ??
          `Provider returned ${res.status}`;

        return { valid: false, error: message };
      } catch {
        return {
          valid: false,
          error: "Could not reach provider. Check your network and try again.",
        };
      }
    },
  }),
);
