import { builder } from "../builder";

// Mirrors DB enum: bot_status
// NOTE: ARCHIVED is the soft-delete state — there is no DELETED in the schema
export const BotStatusEnum = builder.enumType("BotStatus", {
  values: ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const,
});

// Mirrors DB enum: proposal_status
export const ProposalStatusEnum = builder.enumType("ProposalStatus", {
  values: ["PENDING", "APPROVED", "SKIPPED", "EXPIRED", "CANCELLED"] as const,
});

// Mirrors DB enum: position_status
export const PositionStatusEnum = builder.enumType("PositionStatus", {
  values: ["OPEN", "CLOSED"] as const,
});

// Values match bot_frames.name in the lookup table (seeded: SCOUT → BRAWLER)
export const BotFrameEnum = builder.enumType("BotFrame", {
  values: [
    "SCOUT",
    "BRUISER",
    "SNIPER",
    "BERSERKER",
    "GUARDIAN",
    "BRAWLER",
  ] as const,
});

// Narrow type alias for bot_frames.name — used to safely cast the joined
// frame_name string field (typed as string) in bot.type.ts resolvers
export type BotFrameName =
  | "SCOUT"
  | "BRUISER"
  | "SNIPER"
  | "BERSERKER"
  | "GUARDIAN"
  | "BRAWLER";

// Mirrors DB enum: risk_attitude
export const RiskAttitudeEnum = builder.enumType("RiskAttitude", {
  values: ["CAUTIOUS", "BALANCED", "AGGRESSIVE"] as const,
});

// Mirrors DB enum: trade_tempo
export const TradeTempoEnum = builder.enumType("TradeTempo", {
  values: ["OPPORTUNISTIC", "ACTIVE", "RELENTLESS"] as const,
});

// Mirrors DB enum: combat_patience
export const CombatPatienceEnum = builder.enumType("CombatPatience", {
  values: ["PATIENT", "CALCULATED", "STRATEGIC", "IMPULSIVE"] as const,
});

// Mirrors DB enum: proposal_side
export const ProposalSideEnum = builder.enumType("ProposalSide", {
  values: ["BUY", "SELL"] as const,
});

// Mirrors DB enum: order_entry_type
export const OrderEntryTypeEnum = builder.enumType("OrderEntryType", {
  values: ["MARKET", "LIMIT"] as const,
});
