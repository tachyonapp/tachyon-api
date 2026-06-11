import { builder } from "../../builder";
import {
  BotStatusEnum,
  BotFrameEnum,
  RiskAttitudeEnum,
  TradeTempoEnum,
  CombatPatienceEnum,
  ProposalStatusEnum,
  SectorFilterEnum,
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
  type BotFrameName,
} from "../../types/enums";

// ---------------------------------------------------------------------------
// BotBrainConfig — resolved from bot_brain_configs table
// encrypted_key is NEVER exposed here; only keyPreview is surfaced
// ---------------------------------------------------------------------------

const BotBrainConfig = builder.objectRef<{
  brainType: string;
  modelId: string;
  provider: string | null;
  keyPreview: string | null;
  openaiModelVariant: string | null;
  anthropicModelVariant: string | null;
  groqModelVariant: string | null;
  geminiModelVariant: string | null;
}>("BotBrainConfig");

builder.objectType(BotBrainConfig, {
  fields: (t) => ({
    brainType: t.exposeString("brainType"),
    modelId: t.exposeString("modelId"),
    provider: t.exposeString("provider", { nullable: true }),
    keyPreview: t.exposeString("keyPreview", { nullable: true }),
    openaiModelVariant:    t.exposeString("openaiModelVariant",    { nullable: true }),
    anthropicModelVariant: t.exposeString("anthropicModelVariant", { nullable: true }),
    groqModelVariant:      t.exposeString("groqModelVariant",      { nullable: true }),
    geminiModelVariant:    t.exposeString("geminiModelVariant",    { nullable: true }),
  }),
});

const MarketAwareness = builder.objectRef<{
  momentum: number;
  meanReversion: number;
  volatility: number;
  trendFollowing: number;
}>("MarketAwareness");

builder.objectType(MarketAwareness, {
  fields: (t) => ({
    momentum: t.exposeFloat("momentum"),
    meanReversion: t.exposeFloat("meanReversion"),
    volatility: t.exposeFloat("volatility"),
    trendFollowing: t.exposeFloat("trendFollowing"),
  }),
});

export const BotRef = builder.objectType("Bot", {
  description: "A user-configured AI trading bot",
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),

    // frame_name lives in the bot_frames lookup table — resolved via DataLoader.
    // FK constraint guarantees the frame always exists; throw on missing data.
    frame: t.field({
      type: BotFrameEnum,
      resolve: async (bot, _args, ctx) => {
        const frame = await ctx.loaders.botFrameById.load(String(bot.frame_id));
        if (!frame) throw new Error(`Bot frame ${bot.frame_id} not found`);
        return frame.name as BotFrameName;
      },
    }),

    status: t.field({
      type: BotStatusEnum,
      resolve: (bot) => bot.status,
    }),

    capitalAllocatedUsd: t.float({
      nullable: false,
      description: "Fixed dollar amount the agent may deploy in a single position.",
      resolve: (bot) => Number(bot.capital_allocated_usd),
    }),

    recoveryModeActiveUntil: t.field({
      type: "DateTime",
      nullable: true,
      description: "Date through which recovery mode constraints are active. Null if not in recovery.",
      resolve: (bot) => bot.recovery_mode_active_until,
    }),

    recoveryModeApplied: t.string({
      nullable: true,
      description: "Recovery mode variant being enforced. Null if not in recovery.",
      resolve: (bot) => bot.recovery_mode_applied ?? null,
    }),

    // Settings fields live in bot_settings, resolved via DataLoader.
    // current_settings_id is null for DRAFT bots with no settings yet — all nullable.
    dailyMaxLoss: t.field({
      type: "Decimal",
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.daily_max_loss_pct ?? null;
      },
    }),

    dailyMaxGain: t.field({
      type: "Decimal",
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.daily_max_gain ?? null;
      },
    }),

    riskAttitude: t.field({
      type: RiskAttitudeEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.risk_attitude ?? null;
      },
    }),

    tradeTempo: t.field({
      type: TradeTempoEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.trade_tempo ?? null;
      },
    }),

    combatPatience: t.field({
      type: CombatPatienceEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.combat_patience ?? null;
      },
    }),

    marketAwareness: t.field({
      type: MarketAwareness,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        if (!s?.market_awareness) return null;
        return s.market_awareness as {
          momentum: number;
          meanReversion: number;
          volatility: number;
          trendFollowing: number;
        };
      },
    }),

    sectors: t.field({
      type: [SectorFilterEnum],
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        if (!s?.sectors) return null;
        // pg returns user-defined enum arrays as "{VAL1,VAL2}" strings rather than JS arrays.
        // Parse defensively to handle both the raw string format and any future auto-parsed arrays.
        const raw = s.sectors;
        const arr: string[] = Array.isArray(raw)
          ? (raw as string[])
          : String(raw).replace(/^{|}$/g, "").split(",").filter(Boolean);
        return arr as (typeof SectorFilterEnum.$inferType)[];
      },
    }),

    exitStyle: t.string({
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        if (!s?.exit_personality_id) return null;
        const row = await ctx.db
          .selectFrom("exit_personalities")
          .select("name")
          .where("id", "=", s.exit_personality_id)
          .executeTakeFirst();
        return row?.name ?? null;
      },
    }),

    stopStyle: t.string({
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        if (!s?.stop_style_id) return null;
        const row = await ctx.db
          .selectFrom("stop_styles")
          .select("name")
          .where("id", "=", s.stop_style_id)
          .executeTakeFirst();
        return row?.name ?? null;
      },
    }),

    // Feature 8b — Advanced Agent Customization fields (all nullable; null for pre-8b bots)

    signalWeights: t.field({
      type: SignalWeightsOutput,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        if (!s?.signal_weights) return null;
        return s.signal_weights as {
          technicals: number;
          news: number;
          fundamentals: number;
        };
      },
    }),

    confidenceThreshold: t.field({
      type: ConfidenceThresholdEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.confidence_threshold ?? null;
      },
    }),

    regimeAwareness: t.field({
      type: RegimeAwarenessEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.regime_awareness ?? null;
      },
    }),

    earningsBehavior: t.field({
      type: EarningsBehaviorEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.earnings_behavior ?? null;
      },
    }),

    subSectors: t.stringList({
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return [];
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        if (!s?.sub_sectors) return [];
        return s.sub_sectors as string[];
      },
    }),

    customWatchlist: t.stringList({
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return [];
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        if (!s?.custom_watchlist) return [];
        return s.custom_watchlist as string[];
      },
    }),

    exclusionList: t.stringList({
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return [];
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        if (!s?.exclusion_list) return [];
        return s.exclusion_list as string[];
      },
    }),

    dividendPreference: t.field({
      type: DividendPreferenceEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.dividend_preference ?? null;
      },
    }),

    shortInterestSignal: t.field({
      type: ShortInterestSignalEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.short_interest_signal ?? null;
      },
    }),

    positionSizingMethod: t.field({
      type: PositionSizingMethodEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.position_sizing_method ?? null;
      },
    }),

    minRrRatio: t.float({
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.min_rr_ratio != null ? Number(s.min_rr_ratio) : null;
      },
    }),

    maxDrawdownProtectionPct: t.float({
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.max_drawdown_protection_pct != null
          ? Number(s.max_drawdown_protection_pct)
          : null;
      },
    }),

    recoveryMode: t.field({
      type: RecoveryModeEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.recovery_mode ?? null;
      },
    }),

    sessionPreference: t.field({
      type: SessionPreferenceEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.session_preference ?? null;
      },
    }),

    dayAvoidance: t.field({
      type: [DayOfWeekEnum],
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return [];
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        if (!s?.day_avoidance) return [];
        return s.day_avoidance as (typeof DayOfWeekEnum.$inferType)[];
      },
    }),

    volatilityEnvPreference: t.field({
      type: VolatilityEnvPreferenceEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.volatility_env_preference ?? null;
      },
    }),

    agentBackground: t.string({
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.agent_background ?? null;
      },
    }),

    proposalCommunicationStyle: t.field({
      type: ProposalCommunicationStyleEnum,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.proposal_communication_style ?? null;
      },
    }),

    winReaction: t.string({
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.win_reaction ?? null;
      },
    }),

    lossReaction: t.string({
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        if (!bot.current_settings_id) return null;
        const s = await ctx.loaders.botSettingsById.load(
          String(bot.current_settings_id),
        );
        return s?.loss_reaction ?? null;
      },
    }),

    // Relational fields resolved via DataLoaders (batched — no N+1)
    owner: t.field({
      type: "User",
      resolve: async (bot, _args, ctx) =>
        ctx.loaders.userById.load(String(bot.user_id)),
    }),

    activePosition: t.field({
      type: "Position",
      nullable: true,
      resolve: async (bot, _args, ctx) =>
        ctx.loaders.positionByBotId.load(String(bot.id)),
    }),

    proposals: t.field({
      type: ["Proposal"],
      args: {
        status: t.arg({ type: ProposalStatusEnum, required: false }),
      },
      resolve: async (bot, args, ctx) => {
        const proposals = await ctx.loaders.proposalsByBotId.load(
          String(bot.id),
        );
        if (args.status) {
          return proposals.filter((p) => p.status === args.status);
        }
        return proposals;
      },
    }),

    brain: t.field({
      type: BotBrainConfig,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        const config = await ctx.db
          .selectFrom("bot_brain_configs")
          .select([
            "brain_type",
            "model_id",
            "provider",
            "key_preview",
            "openai_model_variant",
            "anthropic_model_variant",
            "groq_model_variant",
            "gemini_model_variant",
          ])
          .where("bot_id", "=", bot.id)
          .where("is_active", "=", true)
          .executeTakeFirst();
        if (!config) return null;
        return {
          brainType: config.brain_type,
          modelId: config.model_id,
          provider: config.provider ?? null,
          keyPreview: config.key_preview ?? null,
          openaiModelVariant:    config.openai_model_variant    ?? null,
          anthropicModelVariant: config.anthropic_model_variant ?? null,
          groqModelVariant:      config.groq_model_variant      ?? null,
          geminiModelVariant:    config.gemini_model_variant    ?? null,
        };
      },
    }),

    botBrainConfig: t.field({
      type: BotBrainConfig,
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        const config = await ctx.loaders.botBrainConfigByBotId.load(
          String(bot.id),
        );
        if (!config) return null;
        return {
          brainType: config.brain_type,
          modelId: config.model_id,
          provider: config.provider ?? null,
          keyPreview: config.key_preview ?? null,
          openaiModelVariant:    config.openai_model_variant    ?? null,
          anthropicModelVariant: config.anthropic_model_variant ?? null,
          groqModelVariant:      config.groq_model_variant      ?? null,
          geminiModelVariant:    config.gemini_model_variant    ?? null,
        };
      },
    }),

    scanCapUsed: t.int({
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        const runtime = await ctx.loaders.botRuntimeDataByBotId.load(
          String(bot.id),
        );
        return runtime?.ai_calls_today ?? 0;
      },
    }),

    scanCapRemaining: t.int({
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        const [runtime, sub] = await Promise.all([
          ctx.loaders.botRuntimeDataByBotId.load(String(bot.id)),
          ctx.db
            .selectFrom("user_subscriptions")
            .where("user_id", "=", bot.user_id)
            .select("tier")
            .executeTakeFirst(),
        ]);
        if (!sub) return null;
        const used = runtime?.ai_calls_today ?? 0;
        if (sub.tier === "FREE_TRIAL") return Math.max(0, 40 - used);
        if (sub.tier === "TACHYON_HOSTED") return Math.max(0, 78 - used);
        return null; // BYOK — no cap
      },
    }),

    avatarSeed: t.exposeString("avatar_seed"),

    createdAt: t.field({
      type: "DateTime",
      resolve: (bot) => new Date(bot.created_at),
    }),

    updatedAt: t.field({
      type: "DateTime",
      resolve: (bot) => new Date(bot.updated_at),
    }),
  }),
});

// ---------------------------------------------------------------------------
// botPerformance result types
// ---------------------------------------------------------------------------

export type PnlDataPointShape = { date: Date; cumulativePnl: number };
export type BotPerformanceShape = {
  totalRealizedPnl: number;
  returnOnAllocatedCapitalPct: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  avgGainPerWin: number;
  avgLossPerLoss: number;
  profitFactor: number;
  largestSingleWin: number;
  largestSingleLoss: number;
  avgHoldDurationHours: number;
  daysActive: number;
  totalProposalsGenerated: number;
  totalProposalsApproved: number;
  approvalRatePct: number;
  skipRatePct: number;
  pnlTimeSeries: PnlDataPointShape[];
};

export const PnlDataPoint =
  builder.objectRef<PnlDataPointShape>("PnlDataPoint");
builder.objectType(PnlDataPoint, {
  fields: (t) => ({
    date: t.field({ type: "DateTime", resolve: (p) => p.date }),
    cumulativePnl: t.field({
      type: "Decimal",
      resolve: (p) => p.cumulativePnl.toString(),
    }),
  }),
});

export const BotPerformanceResult = builder.objectRef<BotPerformanceShape>(
  "BotPerformanceResult",
);
builder.objectType(BotPerformanceResult, {
  fields: (t) => ({
    totalRealizedPnl: t.field({
      type: "Decimal",
      resolve: (p) => p.totalRealizedPnl.toString(),
    }),
    returnOnAllocatedCapitalPct: t.field({
      type: "Decimal",
      resolve: (p) => p.returnOnAllocatedCapitalPct.toString(),
    }),
    winCount: t.int({ resolve: (p) => p.winCount }),
    lossCount: t.int({ resolve: (p) => p.lossCount }),
    winRatePct: t.field({
      type: "Decimal",
      resolve: (p) => p.winRatePct.toString(),
    }),
    avgGainPerWin: t.field({
      type: "Decimal",
      resolve: (p) => p.avgGainPerWin.toString(),
    }),
    avgLossPerLoss: t.field({
      type: "Decimal",
      resolve: (p) => p.avgLossPerLoss.toString(),
    }),
    profitFactor: t.field({
      type: "Decimal",
      resolve: (p) => p.profitFactor.toString(),
    }),
    largestSingleWin: t.field({
      type: "Decimal",
      resolve: (p) => p.largestSingleWin.toString(),
    }),
    largestSingleLoss: t.field({
      type: "Decimal",
      resolve: (p) => p.largestSingleLoss.toString(),
    }),
    avgHoldDurationHours: t.field({
      type: "Decimal",
      resolve: (p) => p.avgHoldDurationHours.toString(),
    }),
    daysActive: t.int({ resolve: (p) => p.daysActive }),
    totalProposalsGenerated: t.int({
      resolve: (p) => p.totalProposalsGenerated,
    }),
    totalProposalsApproved: t.int({ resolve: (p) => p.totalProposalsApproved }),
    approvalRatePct: t.field({
      type: "Decimal",
      resolve: (p) => p.approvalRatePct.toString(),
    }),
    skipRatePct: t.field({
      type: "Decimal",
      resolve: (p) => p.skipRatePct.toString(),
    }),
    pnlTimeSeries: t.field({
      type: [PnlDataPoint],
      resolve: (p) => p.pnlTimeSeries,
    }),
  }),
});

// ---------------------------------------------------------------------------
// Brain catalog types — returned by the brainProviders query.
// These are plain data shapes with no DB backing; SimpleObjectsPlugin handles them.
// ---------------------------------------------------------------------------

export const BrainModelOption = builder.simpleObject("BrainModelOption", {
  fields: (t) => ({
    modelId: t.string(),
    displayName: t.string(),
  }),
});

export const BrainProviderOption = builder.simpleObject("BrainProviderOption", {
  fields: (t) => ({
    provider: t.string(),
    displayName: t.string(),
    models: t.field({ type: [BrainModelOption] }),
  }),
});

export const DefaultBrainInfo = builder.simpleObject("DefaultBrainInfo", {
  fields: (t) => ({
    brainType: t.string(),
    modelId: t.string(),
    provider: t.string(),
    displayName: t.string(),
    description: t.string(),
  }),
});

export const BrainCatalog = builder.simpleObject("BrainCatalog", {
  fields: (t) => ({
    defaultBrain: t.field({ type: DefaultBrainInfo }),
    byokProviders: t.field({ type: [BrainProviderOption] }),
  }),
});

export const ValidateBrainKeyResult = builder.simpleObject(
  "ValidateBrainKeyResult",
  {
    fields: (t) => ({
      valid: t.boolean(),
      error: t.string({ nullable: true }),
    }),
  },
);

export const SignalWeightsOutput = builder.simpleObject("SignalWeightsOutput", {
  fields: (t) => ({
    technicals: t.int(),
    news: t.int(),
    fundamentals: t.int(),
  }),
});

export const MutationAdvisory = builder.simpleObject("MutationAdvisory", {
  fields: (t) => ({
    code: t.string(),
    field: t.string(),
    message: t.string(),
  }),
});

export const BotMutationResult = builder.simpleObject("BotMutationResult", {
  fields: (t) => ({
    bot: t.field({ type: BotRef }), // existing Bot reference
    advisories: t.field({ type: [MutationAdvisory] }),
  }),
});
