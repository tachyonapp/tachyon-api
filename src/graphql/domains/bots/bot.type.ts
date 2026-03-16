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

    // frame_name is joined from bot_frames — always present.
    // Cast from string to BotFrameName: the JOIN guarantees the value is one
    // of the seeded bot_frames.name values; the type cannot be narrower at the
    // DB layer because bot_frames is a lookup table, not a PostgreSQL enum.
    frame: t.field({
      type: BotFrameEnum,
      resolve: (bot) => bot.frame_name as BotFrameName,
    }),

    // bot.status is already BotStatus ("ACTIVE" | "ARCHIVED" | "DRAFT" | "PAUSED")
    // which matches the enum values exactly — no cast needed
    status: t.field({
      type: BotStatusEnum,
      resolve: (bot) => bot.status,
    }),

    // allocation_pct is the actual column name on the bots table
    allocationPct: t.field({
      type: "Decimal",
      resolve: (bot) => bot.allocation_pct.toString(),
    }),

    // Settings fields — nullable until bot_settings row exists (DRAFT bots)
    dailyMaxLoss: t.field({
      type: "Decimal",
      nullable: true,
      resolve: (bot) => bot.daily_max_loss ?? null,
    }),

    dailyMaxGain: t.field({
      type: "Decimal",
      nullable: true,
      resolve: (bot) => bot.daily_max_gain ?? null,
    }),

    // risk_attitude, trade_tempo, combat_patience are already typed as the
    // correct string literal unions (or null) in BotWithSettings — no cast needed
    riskAttitude: t.field({
      type: RiskAttitudeEnum,
      nullable: true,
      resolve: (bot) => bot.risk_attitude ?? null,
    }),

    tradeTempo: t.field({
      type: TradeTempoEnum,
      nullable: true,
      resolve: (bot) => bot.trade_tempo ?? null,
    }),

    combatPatience: t.field({
      type: CombatPatienceEnum,
      nullable: true,
      resolve: (bot) => bot.combat_patience ?? null,
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
