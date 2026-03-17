import { builder } from "../../builder";
import { ProposalStatusEnum } from "../../types/enums";

builder.queryField("proposals", (t) =>
  t.field({
    type: ["Proposal"],
    args: {
      status: t.arg({ type: ProposalStatusEnum, required: false }),
    },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      // JOIN bots to enforce user ownership — proposals belong to users via their bots
      let query = ctx.db
        .selectFrom("trade_proposals")
        .innerJoin("bots", "bots.id", "trade_proposals.bot_id")
        .selectAll("trade_proposals")
        .where("bots.user_id", "=", ctx.auth!.userId);

      if (args.status) {
        query = query.where("trade_proposals.status", "=", args.status);
      }

      return query.execute();
    },
  }),
);
