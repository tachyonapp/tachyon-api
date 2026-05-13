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
  ConfidenceThresholdEnum,
  RegimeAwarenessEnum,
  EarningsBehaviorEnum,
  DividendPreferenceEnum,
  ShortInterestSignalEnum,
  PositionSizingMethodEnum,
  RecoveryModeEnum,
  SessionPreferenceEnum,
  VolatilityEnvPreferenceEnum,
  ProposalCommunicationStyleEnum,
  DayOfWeekEnum,
} from "../../types/enums";
import { ValidationError, NotFoundError } from "../../types/errors";
import { GraphQLError } from "graphql";
import type { BotsRow } from "@tachyonapp/tachyon-db";
import { assertOwnership } from "../../../auth/authorization";
import { getScanBotQueue } from "../../../queues";
import { QUEUE_NAMES } from "@tachyonapp/tachyon-queue-types";
import type { ScanBotJobPayload } from "@tachyonapp/tachyon-queue-types";
import { encrypt } from "../../../lib/crypto";
import {
  ALLOWED_BYOK_PROVIDERS,
  ALLOWED_BYOK_MODELS,
  BYOK_PROVIDER_VALIDATION_ENDPOINTS,
  type ByokProvider,
} from "../../../config/allowedSectors";
import { FRAME_CONFIG, PLATFORM_LIMITS } from "@tachyonapp/tachyon-queue-types";
import type { FrameAdvisory, FrameDefaults } from "@tachyonapp/tachyon-queue-types";
import { ValidateBrainKeyResult, BotMutationResult } from "./bot.type";
import * as Sentry from "@sentry/node";

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

const SignalWeightsInput = builder.inputType("SignalWeightsInput", {
  fields: (t) => ({
    technicals: t.int({ required: true }),
    news: t.int({ required: true }),
    fundamentals: t.int({ required: true }),
  }),
});

const CreateBotInput = builder.inputType("CreateBotInput", {
  fields: (t) => ({
    // Frame & Identity
    name: t.string({ required: true }), // max 24 chars
    frameName: t.field({ type: BotFrameEnum, required: true }),
    avatarSeed: t.string({ required: true }),
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
    dailyMaxLossPct: t.field({ type: "Decimal", required: true }),
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

    // Feature 8b — Intelligence & Signal Preferences
    signalWeights: t.field({ type: SignalWeightsInput, required: false }),
    confidenceThreshold: t.field({ type: ConfidenceThresholdEnum, required: false }),
    regimeAwareness: t.field({ type: RegimeAwarenessEnum, required: false }),
    earningsBehavior: t.field({ type: EarningsBehaviorEnum, required: false }),

    // Feature 8b — Sector & Universe Refinement
    subSectors: t.stringList({ required: false }),
    customWatchlist: t.stringList({ required: false }),
    exclusionList: t.stringList({ required: false }),
    dividendPreference: t.field({ type: DividendPreferenceEnum, required: false }),
    shortInterestSignal: t.field({ type: ShortInterestSignalEnum, required: false }),

    // Feature 8b — Sizing & Risk Refinement
    positionSizingMethod: t.field({ type: PositionSizingMethodEnum, required: false }),
    minRrRatio: t.float({ required: false }),
    maxDrawdownProtectionPct: t.float({ required: false }),
    recoveryMode: t.field({ type: RecoveryModeEnum, required: false }),

    // Feature 8b — Timing & Schedule Preferences
    sessionPreference: t.field({ type: SessionPreferenceEnum, required: false }),
    dayAvoidance: t.field({ type: [DayOfWeekEnum], required: false }),
    volatilityEnvPreference: t.field({ type: VolatilityEnvPreferenceEnum, required: false }),

    // Feature 8b — Agent Personality & Voice
    agentBackground: t.string({ required: false }),
    proposalCommunicationStyle: t.field({ type: ProposalCommunicationStyleEnum, required: false }),
    winReaction: t.string({ required: false }),
    lossReaction: t.string({ required: false }),
  }),
});

// ---------------------------------------------------------------------------
// Result union types
// Bot is backed by BotsRow — discriminate on `frame_id` (always present on a bot row)
// ---------------------------------------------------------------------------

const BotResult = builder.unionType("BotResult", {
  types: ["Bot", ValidationError, NotFoundError],
  resolveType: (value) => {
    if ("frame_id" in value) return "Bot";
    if ("field" in value) return ValidationError;
    return NotFoundError;
  },
});

const DeleteBotResult = builder.simpleObject("DeleteBotResult", {
  fields: (t) => ({
    success: t.boolean(),
  }),
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
    type: BotMutationResult,
    args: { input: t.arg({ type: CreateBotInput, required: true }) },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      await withOpRateLimit(
        ctx,
        "createBot",
        OP_RATE_LIMITS.createBot.limit,
        OP_RATE_LIMITS.createBot.windowSeconds,
      );

      const { input } = args;

      if (input.name.length > 24) {
        throw new GraphQLError("Bot name must be 24 characters or fewer", {
          extensions: { code: "VALIDATION_ERROR", field: "name" },
        });
      }

      // Validate allocationPct range [0.01, 1.00] + per-user ceiling.
      // SUM() on an empty set returns null — coalesced to "0" safely.
      const allocationPct = parseFloat(input.allocationPct);
      if (allocationPct < 0.01 || allocationPct > 1.0) {
        throw new GraphQLError("Allocation must be between 1% and 100%", {
          extensions: { code: "VALIDATION_ERROR", field: "allocationPct" },
        });
      }

      const existingAllocationRow = await ctx.db
        .selectFrom("bots")
        .select((eb) => eb.fn.sum<string>("allocation_pct").as("total"))
        .where("user_id", "=", ctx.auth!.userId)
        .where("status", "in", ["ACTIVE", "PAUSED"])
        .executeTakeFirst();

      const existingTotal = parseFloat(existingAllocationRow?.total ?? "0");
      if (existingTotal + allocationPct > 1.0) {
        throw new GraphQLError("Total bot allocation would exceed 100%", {
          extensions: { code: "VALIDATION_ERROR", field: "allocationPct" },
        });
      }

      const frameConfig = FRAME_CONFIG[input.frameName];
      const dailyMaxLossPct = parseFloat(input.dailyMaxLossPct);

      if (input.sectors.length < 1) {
        throw new GraphQLError("At least one sector must be selected", {
          extensions: { code: "VALIDATION_ERROR", field: "sectors" },
        });
      }

      const maInputFields = [
        { key: "marketAwareness.momentum", value: input.marketAwareness.momentum },
        { key: "marketAwareness.meanReversion", value: input.marketAwareness.meanReversion },
        { key: "marketAwareness.volatility", value: input.marketAwareness.volatility },
        { key: "marketAwareness.trendFollowing", value: input.marketAwareness.trendFollowing },
      ] as const;

      for (const { key, value } of maInputFields) {
        if (value < 0.0 || value > 1.0) {
          throw new GraphQLError(`${key} must be between 0.0 and 1.0`, {
            extensions: { code: "VALIDATION_ERROR", field: key },
          });
        }
      }

      const fal = input.emotionalControls.freezeAfterLosses;
      if (fal !== null && fal !== undefined && (fal < 1 || fal > 5)) {
        throw new GraphQLError("freezeAfterLosses must be between 1 and 5", {
          extensions: { code: "VALIDATION_ERROR", field: "emotionalControls.freezeAfterLosses" },
        });
      }

      const frame = await ctx.db
        .selectFrom("bot_frames")
        .select("id")
        .where("name", "=", input.frameName)
        .where("is_active", "=", true)
        .executeTakeFirst();

      if (!frame) {
        throw new GraphQLError(`Bot frame "${input.frameName}" is not available`, {
          extensions: { code: "VALIDATION_ERROR", field: "frameName" },
        });
      }

      // BYOK validation — external HTTP call; done after all local checks
      if (input.brain.brainType === "BYOK") {
        const { provider, modelId, apiKey } = input.brain;

        if (!provider || !(ALLOWED_BYOK_PROVIDERS as readonly string[]).includes(provider)) {
          throw new GraphQLError(`Provider "${provider ?? "missing"}" is not supported`, {
            extensions: { code: "VALIDATION_ERROR", field: "brain.provider" },
          });
        }

        const typedProvider = provider as ByokProvider;
        if (!ALLOWED_BYOK_MODELS[typedProvider].includes(modelId)) {
          throw new GraphQLError(`Model "${modelId}" is not supported for provider "${provider}"`, {
            extensions: { code: "VALIDATION_ERROR", field: "brain.modelId" },
          });
        }

        if (!apiKey) {
          throw new GraphQLError("API key is required for BYOK", {
            extensions: { code: "VALIDATION_ERROR", field: "brain.apiKey" },
          });
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
            throw new GraphQLError("API key validation failed", {
              extensions: { code: "VALIDATION_ERROR", field: "brain.apiKey" },
            });
          }
        } catch (err) {
          if (err instanceof GraphQLError) throw err;
          throw new GraphQLError("API key validation failed", {
            extensions: { code: "VALIDATION_ERROR", field: "brain.apiKey" },
          });
        }
      }

      const exitPersonality = await ctx.db
        .selectFrom("exit_personalities")
        .select("id")
        .where("name", "=", input.exitPersonality.name)
        .where("is_active", "=", true)
        .executeTakeFirst();

      if (!exitPersonality) {
        throw new GraphQLError(`Exit personality "${input.exitPersonality.name}" not found`, {
          extensions: { code: "VALIDATION_ERROR", field: "exitPersonality" },
        });
      }

      const stopStyle = await ctx.db
        .selectFrom("stop_styles")
        .select("id")
        .where("name", "=", input.stopLossStyle.name)
        .where("is_active", "=", true)
        .executeTakeFirst();

      if (!stopStyle) {
        throw new GraphQLError(`Stop style "${input.stopLossStyle.name}" not found`, {
          extensions: { code: "VALIDATION_ERROR", field: "stopLossStyle" },
        });
      }

      // Idempotency check — return existing DRAFT bot if same name was created within 60s
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
        return { bot: existingDraft, advisories: [] };
      }

      // Frame-default resolution — apply frame defaults for any absent advanced field
      const resolvedSignalWeights = input.signalWeights ?? frameConfig.defaults.signalWeights;
      const resolvedConfidenceThreshold = input.confidenceThreshold ?? frameConfig.defaults.confidenceThreshold;
      const resolvedRegimeAwareness = input.regimeAwareness ?? frameConfig.defaults.regimeAwareness;
      const resolvedEarningsBehavior = input.earningsBehavior ?? frameConfig.defaults.earningsBehavior;
      const resolvedDividendPreference = input.dividendPreference ?? frameConfig.defaults.dividendPreference;
      const resolvedShortInterestSignal = input.shortInterestSignal ?? frameConfig.defaults.shortInterestSignal;
      const resolvedPositionSizingMethod = input.positionSizingMethod ?? frameConfig.defaults.positionSizingMethod;
      const resolvedMinRrRatio = input.minRrRatio ?? frameConfig.defaults.minRrRatio;
      const resolvedMaxDrawdownProtectionPct = input.maxDrawdownProtectionPct ?? frameConfig.defaults.maxDrawdownProtectionPct;
      const resolvedRecoveryMode = input.recoveryMode ?? frameConfig.defaults.recoveryMode;
      const resolvedSessionPreference = input.sessionPreference ?? frameConfig.defaults.sessionPreference;
      const resolvedDayAvoidance = input.dayAvoidance ?? frameConfig.defaults.dayAvoidance;
      const resolvedVolatilityEnvPreference = input.volatilityEnvPreference ?? frameConfig.defaults.volatilityEnvPreference;
      const resolvedProposalCommunicationStyle = input.proposalCommunicationStyle ?? frameConfig.defaults.proposalCommunicationStyle;
      const resolvedAgentBackground = input.agentBackground ?? null;
      const resolvedWinReaction = input.winReaction ?? null;
      const resolvedLossReaction = input.lossReaction ?? null;
      const resolvedSubSectors = input.subSectors ?? [];
      const resolvedCustomWatchlist = input.customWatchlist ?? [];
      const resolvedExclusionList = input.exclusionList ?? [];

      // PLATFORM_LIMITS hard validation — rejects mutation on any violation
      if (allocationPct > PLATFORM_LIMITS.allocationPct.max) {
        throw new GraphQLError("Allocation exceeds platform ceiling", {
          extensions: { code: "ALLOCATION_EXCEEDS_PLATFORM_CEILING" },
        });
      }
      if (dailyMaxLossPct < PLATFORM_LIMITS.dailyMaxLossPct.min) {
        throw new GraphQLError("Daily loss below platform floor", {
          extensions: { code: "DAILY_LOSS_BELOW_PLATFORM_FLOOR" },
        });
      }
      if (input.signalWeights) {
        const total = input.signalWeights.technicals + input.signalWeights.news + input.signalWeights.fundamentals;
        if (total !== PLATFORM_LIMITS.signalWeightsTotal) {
          throw new GraphQLError("Signal weights must total 100", {
            extensions: { code: "SIGNAL_WEIGHTS_INVALID_TOTAL" },
          });
        }
      }
      if (resolvedCustomWatchlist.length > PLATFORM_LIMITS.customWatchlistMaxTickers) {
        throw new GraphQLError("Watchlist exceeds 10 ticker maximum", {
          extensions: { code: "WATCHLIST_EXCEEDS_MAX" },
        });
      }
      if (resolvedExclusionList.length > PLATFORM_LIMITS.exclusionListMaxTickers) {
        throw new GraphQLError("Exclusion list exceeds 10 ticker maximum", {
          extensions: { code: "EXCLUSION_LIST_EXCEEDS_MAX" },
        });
      }
      const overlapTicker = resolvedCustomWatchlist.find((ticker) => resolvedExclusionList.includes(ticker));
      if (overlapTicker) {
        throw new GraphQLError("A ticker cannot appear in both watchlist and exclusion list", {
          extensions: { code: "WATCHLIST_EXCLUSION_OVERLAP" },
        });
      }
      if (resolvedDayAvoidance.length === 5) {
        throw new GraphQLError("At least one trading day must remain active", {
          extensions: { code: "ALL_DAYS_AVOIDED" },
        });
      }
      if (resolvedAgentBackground && resolvedAgentBackground.length > PLATFORM_LIMITS.agentBackgroundMaxChars) {
        throw new GraphQLError("Agent background exceeds 300 character maximum", {
          extensions: { code: "AGENT_BACKGROUND_EXCEEDS_MAX" },
        });
      }

      // Atomic DB transaction — no orphaned records on partial failure
      const botId = await ctx.db.transaction().execute(async (trx) => {
        // a. Insert bot with DRAFT status (circular FK on current_settings_id resolved in step d)
        const newBot = await trx
          .insertInto("bots")
          .values({
            user_id: ctx.auth!.userId,
            frame_id: frame.id,
            avatar_seed: input.avatarSeed,
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
              freezeAfterLosses: input.emotionalControls.freezeAfterLosses ?? null,
              cooldownAfterVolatility: input.emotionalControls.cooldownAfterVolatility,
              standDownAfterNoonIfLosing: input.emotionalControls.standDownAfterNoonIfLosing,
            }),
            rules_of_engagement: JSON.stringify({
              oneTradeAtATime: true,
              overnightHoldAllowed: input.rulesOfEngagement.overnightHoldAllowed,
              noSameDayExitUnlessStopLoss: input.rulesOfEngagement.noSameDayExitUnlessStopLoss,
            }),
            market_awareness: JSON.stringify({
              momentum: input.marketAwareness.momentum,
              meanReversion: input.marketAwareness.meanReversion,
              volatility: input.marketAwareness.volatility,
              trendFollowing: input.marketAwareness.trendFollowing,
            }),
            sectors: input.sectors,
            asset_types: JSON.stringify(["STOCK", "ETF"]),
            // Feature 8b columns
            signal_weights: JSON.stringify(resolvedSignalWeights),
            confidence_threshold: resolvedConfidenceThreshold,
            regime_awareness: resolvedRegimeAwareness,
            earnings_behavior: resolvedEarningsBehavior,
            sub_sectors: resolvedSubSectors.length > 0 ? JSON.stringify(resolvedSubSectors) : null,
            custom_watchlist: resolvedCustomWatchlist.length > 0 ? JSON.stringify(resolvedCustomWatchlist) : null,
            exclusion_list: resolvedExclusionList.length > 0 ? JSON.stringify(resolvedExclusionList) : null,
            dividend_preference: resolvedDividendPreference,
            short_interest_signal: resolvedShortInterestSignal,
            position_sizing_method: resolvedPositionSizingMethod,
            min_rr_ratio: resolvedMinRrRatio,
            max_drawdown_protection_pct: resolvedMaxDrawdownProtectionPct,
            recovery_mode: resolvedRecoveryMode,
            session_preference: resolvedSessionPreference,
            day_avoidance: resolvedDayAvoidance.length > 0 ? JSON.stringify(resolvedDayAvoidance) : null,
            volatility_env_preference: resolvedVolatilityEnvPreference,
            agent_background: resolvedAgentBackground,
            proposal_communication_style: resolvedProposalCommunicationStyle,
            win_reaction: resolvedWinReaction,
            loss_reaction: resolvedLossReaction,
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

      // Advisory annotation pass — runs after transaction; never fails the mutation
      let advisories: Array<{ code: string; field: string; message: string }> = [];
      try {
        const resolvedSettings = {
          riskAttitude: input.riskAttitude,
          tradeTempo: input.tradeTempo,
          combatPatience: input.combatPatience,
          signalWeights: resolvedSignalWeights,
          confidenceThreshold: resolvedConfidenceThreshold,
          regimeAwareness: resolvedRegimeAwareness,
          earningsBehavior: resolvedEarningsBehavior,
          dividendPreference: resolvedDividendPreference,
          shortInterestSignal: resolvedShortInterestSignal,
          positionSizingMethod: resolvedPositionSizingMethod,
          minRrRatio: resolvedMinRrRatio,
          maxDrawdownProtectionPct: resolvedMaxDrawdownProtectionPct,
          recoveryMode: resolvedRecoveryMode,
          sessionPreference: resolvedSessionPreference,
          dayAvoidance: resolvedDayAvoidance,
          volatilityEnvPreference: resolvedVolatilityEnvPreference,
          proposalCommunicationStyle: resolvedProposalCommunicationStyle,
        };
        advisories = frameConfig.advisories
          .filter((advisory: FrameAdvisory) => {
            try { return advisory.condition(resolvedSettings as Partial<FrameDefaults>); } catch { return false; }
          })
          .map((advisory: FrameAdvisory) => ({
            code: advisory.code,
            field: advisory.field,
            message: advisory.message,
          }));
      } catch (err) {
        Sentry.captureException(err);
        advisories = [];
      }

      // Dispatch SCAN_BOT after transaction commits (fire-and-forget)
      const scanPayload: ScanBotJobPayload = {
        botId: String(botId),
        userId: ctx.auth!.userId,
      };

      await getScanBotQueue().add(QUEUE_NAMES.SCAN_BOT, scanPayload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      });

      const bot = await ctx.db
        .selectFrom("bots")
        .selectAll()
        .where("id", "=", botId)
        .executeTakeFirstOrThrow();

      return { bot, advisories };
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

      // Subscription guard — user must have an active or trialing subscription
      const sub = await ctx.db
        .selectFrom("user_subscriptions")
        .where("user_id", "=", ctx.auth!.userId)
        .select(["subscription_status"])
        .executeTakeFirst();

      if (
        !sub ||
        sub.subscription_status === "suspended" ||
        sub.subscription_status === "cancelled"
      ) {
        throw new GraphQLError("Subscription required to activate bot", {
          extensions: { code: "FORBIDDEN" },
        });
      }

      // STOOD_DOWN guard — Feature 9 owns the reset path
      if (bot.status === "STOOD_DOWN") {
        throw new GraphQLError(
          "Bot is stood down and will reactivate next trading day",
          { extensions: { code: "BOT_STOOD_DOWN" } },
        );
      }

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
    type: DeleteBotResult,
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
        throw new GraphQLError("Bot not found", {
          extensions: { code: "NOT_FOUND" },
        });
      }

      assertOwnership(ctx, String(existing.user_id));

      const openPosition = await ctx.db
        .selectFrom("positions")
        .where("bot_id", "=", args.id)
        .where("status", "=", "OPEN")
        .select("id")
        .executeTakeFirst();

      if (openPosition) {
        throw new GraphQLError(
          "Cannot delete a bot with an open position. Close the position first.",
          { extensions: { code: "VALIDATION_ERROR" } },
        );
      }

      await ctx.db
        .updateTable("bots")
        .set({ status: "ARCHIVED", deleted_at: new Date(), updated_at: new Date() })
        .where("id", "=", args.id)
        .where("user_id", "=", ctx.auth!.userId)
        .execute();

      return { success: true };
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
    avatarSeed: t.string({ required: true }),
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

      const updated = await ctx.db
        .updateTable("bots")
        .set({
          name: input.name,
          avatar_seed: input.avatarSeed,
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
