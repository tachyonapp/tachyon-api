import { builder } from "../../builder";
import { PositionStatusEnum } from "../../types/enums";

builder.objectType("Position", {
  description: "An open or closed trading position held by a bot",
  fields: (t) => ({
    id: t.exposeID("id"),

    // bot resolved via DataLoader — avoids N+1 when listing positions
    bot: t.field({
      type: "Bot",
      resolve: async (pos, _args, ctx) =>
        ctx.loaders.botById.load(String(pos.bot_id)),
    }),

    symbol: t.exposeString("symbol"),

    qty: t.field({
      type: "Decimal",
      resolve: (pos) => pos.qty.toString(),
    }),

    avgEntryPrice: t.field({
      type: "Decimal",
      resolve: (pos) => pos.avg_entry_price.toString(),
    }),

    status: t.field({
      type: PositionStatusEnum,
      resolve: (pos) => pos.status,
    }),

    // min_hold_until enforces PDT avoidance at the data layer
    minHoldUntil: t.field({
      type: "DateTime",
      resolve: (pos) => new Date(pos.min_hold_until),
    }),

    openedAt: t.field({
      type: "DateTime",
      resolve: (pos) => new Date(pos.opened_at),
    }),

    closedAt: t.field({
      type: "DateTime",
      nullable: true,
      resolve: (pos) => (pos.closed_at ? new Date(pos.closed_at) : null),
    }),
  }),
});
