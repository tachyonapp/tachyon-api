import { builder } from "../../builder";
import {
  BotStatusEnum,
  BotFrameEnum,
  RiskAttitudeEnum,
  TradeTempoEnum,
  CombatPatienceEnum,
  ProposalStatusEnum,
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
}>("BotBrainConfig");

builder.objectType(BotBrainConfig, {
  fields: (t) => ({
    brainType:  t.exposeString("brainType"),
    modelId:    t.exposeString("modelId"),
    provider:   t.exposeString("provider",   { nullable: true }),
    keyPreview: t.exposeString("keyPreview", { nullable: true }),
  }),
});

builder.objectType("Bot", {
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

    // allocation_pct is on the bots table directly
    allocationPct: t.field({
      type: "Decimal",
      resolve: (bot) => parseFloat(bot.allocation_pct.toString()).toString(),
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
          .select(["brain_type", "model_id", "provider", "key_preview"])
          .where("bot_id", "=", bot.id)
          .where("is_active", "=", true)
          .executeTakeFirst();
        if (!config) return null;
        return {
          brainType:  config.brain_type,
          modelId:    config.model_id,
          provider:   config.provider ?? null,
          keyPreview: config.key_preview ?? null,
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
          brainType:  config.brain_type,
          modelId:    config.model_id,
          provider:   config.provider ?? null,
          keyPreview: config.key_preview ?? null,
        };
      },
    }),

    scanCapUsed: t.int({
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        const runtime = await ctx.db
          .selectFrom("bot_runtime_data")
          .where("bot_id", "=", bot.id)
          .select("ai_calls_today")
          .executeTakeFirst();
        return runtime?.ai_calls_today ?? 0;
      },
    }),

    scanCapRemaining: t.int({
      nullable: true,
      resolve: async (bot, _args, ctx) => {
        const [runtime, sub] = await Promise.all([
          ctx.db
            .selectFrom("bot_runtime_data")
            .where("bot_id", "=", bot.id)
            .select("ai_calls_today")
            .executeTakeFirst(),
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
