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
      resolve: (bot) => bot.allocation_pct.toString(),
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
        return s?.daily_max_loss ?? null;
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
