import { builder } from "../builder";

// NOTE: $inferType extracts the TypeScript union type from the Pothos EnumRef —
// i.e. 'CAUTIOUS' | 'BALANCED' | 'AGGRESSIVE'. This keeps the enum values
// as the single source of truth: adding/removing a value here automatically
// updates this type without any manual duplication.

// Mirrors DB enum: bot_status
// NOTE: ARCHIVED is the soft-delete state — there is no DELETED in the schema
export const BotStatusEnum = builder.enumType("BotStatus", {
  values: ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED", "STOOD_DOWN"] as const,
});

// Mirrors DB enum: proposal_status
export const ProposalStatusEnum = builder.enumType("ProposalStatus", {
  values: ["PENDING", "APPROVED", "SKIPPED", "EXPIRED", "CANCELLED"] as const,
});

// Mirrors DB enum: position_status
export const PositionStatusEnum = builder.enumType("PositionStatus", {
  values: ["OPEN", "CLOSED"] as const,
});

// Values match bot_frames.name in the lookup table (seeded: CATALYST → PENDULUM)
export const BotFrameEnum = builder.enumType("BotFrame", {
  values: [
    "CATALYST",
    "COMPOUNDER",
    "THRESHOLD",
    "SURGE",
    "ANCHOR",
    "PENDULUM",
  ] as const,
});

// Narrow type alias for bot_frames.name — used to safely cast the joined
// frame_name string field (typed as string) in bot.type.ts resolvers.
// See RiskAttitude below for $inferType explanation.
export type BotFrameName = (typeof BotFrameEnum)["$inferType"];

// Mirrors DB enum: risk_attitude
export const RiskAttitudeEnum = builder.enumType("RiskAttitude", {
  values: ["CAUTIOUS", "BALANCED", "AGGRESSIVE"] as const,
});
export type RiskAttitude = (typeof RiskAttitudeEnum)["$inferType"];

// Mirrors DB enum: trade_tempo
export const TradeTempoEnum = builder.enumType("TradeTempo", {
  values: ["OPPORTUNISTIC", "ACTIVE", "RELENTLESS"] as const,
});
// See Note at top of file for $inferType explanation.
export type TradeTempo = (typeof TradeTempoEnum)["$inferType"];

// Mirrors DB enum: combat_patience
export const CombatPatienceEnum = builder.enumType("CombatPatience", {
  values: ["PATIENT", "CALCULATED", "STRATEGIC", "IMPULSIVE"] as const,
});
// See Note at top of file for $inferType explanation.
export type CombatPatience = (typeof CombatPatienceEnum)["$inferType"];

// Exit personality names — match exit_personalities lookup table
export const ExitPersonalityNameEnum = builder.enumType("ExitPersonalityName", {
  values: ["QUICK_FINISHER", "BALANCED", "PATIENT"] as const,
});
export type ExitPersonalityName =
  (typeof ExitPersonalityNameEnum)["$inferType"];

// Stop style names — match stop_styles lookup table
export const StopStyleNameEnum = builder.enumType("StopStyleName", {
  values: ["HARD", "FLEXIBLE", "ADAPTIVE"] as const,
});
export type StopStyleName = (typeof StopStyleNameEnum)["$inferType"];

// Brain type — TACHYON_HOSTED (managed) or BYOK (bring your own key)
export const BrainTypeEnum = builder.enumType("BrainType", {
  values: ["TACHYON_HOSTED", "BYOK"] as const,
});
export type BrainType = (typeof BrainTypeEnum)["$inferType"];

// Mirrors DB enum: sector_filter
export const SectorFilterEnum = builder.enumType("SectorFilter", {
  values: [
    "TECH",
    "ENERGY",
    "FINANCIALS",
    "HEALTHCARE",
    "ETFS_ONLY",
    "MEGA_CAPS_ONLY",
    "LIQUID_LARGE_CAPS",
    "ANY",
  ] as const,
});
// See Note at top of file for $inferType explanation.
export type SectorFilter = (typeof SectorFilterEnum)["$inferType"];

// Mirrors DB enum: proposal_side
export const ProposalSideEnum = builder.enumType("ProposalSide", {
  values: ["BUY", "SELL"] as const,
});

// Mirrors DB enum: order_entry_type
export const OrderEntryTypeEnum = builder.enumType("OrderEntryType", {
  values: ["MARKET", "LIMIT"] as const,
});

// Mirrors DB enum: broker_conn_status
export const BrokerConnStatusEnum = builder.enumType("BrokerConnStatus", {
  values: ["ACTIVE", "ERROR", "REVOKED"] as const,
});

export const SubscriptionTierEnum = builder.enumType("SubscriptionTier", {
  values: ["FREE_TRIAL", "BYOK", "TACHYON_HOSTED"] as const,
});

export const SubscriptionStatusEnum = builder.enumType("SubscriptionStatus", {
  values: ["trialing", "active", "past_due", "cancelled", "suspended"] as const,
});

export const ConfidenceThresholdEnum = builder.enumType("ConfidenceThreshold", {
  values: ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"] as const,
});

export const RegimeBehaviorEnum = builder.enumType("RegimeBehavior", {
  values: ["NO_CHANGE", "SIZE_UP", "SIZE_DOWN", "PAUSE"] as const,
});

export const EarningsBehaviorEnum = builder.enumType("EarningsBehavior", {
  values: ["MORE_AGGRESSIVE", "NEUTRAL", "STAND_DOWN"] as const,
});

export const DividendPreferenceEnum = builder.enumType("DividendPreference", {
  values: ["PREFER_DIVIDEND", "NO_PREFERENCE", "EXCLUDE_DIVIDEND"] as const,
});

export const ShortInterestSignalEnum = builder.enumType("ShortInterestSignal", {
  values: [
    "TARGET_SHORT_SQUEEZE",
    "AVOID_HIGH_SHORT_INTEREST",
    "IGNORE",
  ] as const,
});

export const PositionSizingMethodEnum = builder.enumType(
  "PositionSizingMethod",
  {
    values: ["FIXED_PCT", "VOLATILITY_ADJUSTED", "CONVICTION_SCALED"] as const,
  },
);

export const RecoveryModeEnum = builder.enumType("RecoveryMode", {
  values: ["NORMAL", "MORE_CONSERVATIVE_2D", "STAND_DOWN_1W"] as const,
});

export const SessionPreferenceEnum = builder.enumType("SessionPreference", {
  values: [
    "FULL_SESSION",
    "MORNING_HUNTER",
    "AFTERNOON_HUNTER",
    "AVOID_FIRST_30",
  ] as const,
});

export const VolatilityEnvPreferenceEnum = builder.enumType(
  "VolatilityEnvPreference",
  {
    values: ["PREFERS_LOW_VIX", "PREFERS_HIGH_VIX", "NO_PREFERENCE"] as const,
  },
);

export const ProposalCommunicationStyleEnum = builder.enumType(
  "ProposalCommunicationStyle",
  {
    values: [
      "TERSE",
      "DETAILED",
      "AGGRESSIVE_CONFIDENT",
      "CAUTIOUS_MEASURED",
    ] as const,
  },
);

export const DayOfWeekEnum = builder.enumType("DayOfWeek", {
  values: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const,
});
