import { builder } from "../builder";

export const BotStatusEnum = builder.enumType("BotStatus", {
  values: ["DRAFT", "ACTIVE", "PAUSED", "DELETED"] as const,
});

export const ProposalStatusEnum = builder.enumType("ProposalStatus", {
  values: [
    "PENDING",
    "APPROVED",
    "SKIPPED",
    "EXPIRED",
    "EXECUTED",
    "FAILED",
  ] as const,
});

export const PositionStatusEnum = builder.enumType("PositionStatus", {
  values: ["OPEN", "CLOSED"] as const,
});

export const BotFrameEnum = builder.enumType("BotFrame", {
  values: [
    "MOMENTUM",
    "MEAN_REVERSION",
    "BREAKOUT",
    "TREND_FOLLOWING",
  ] as const,
});
