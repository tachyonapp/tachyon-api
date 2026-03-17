import { builder } from "../../builder";

// Returns the authenticated user's active broker connection, or null if none exists.
// One connection per user for MVP — executeTakeFirst() is intentional.
builder.queryField("account", (t) =>
  t.field({
    type: "Account",
    nullable: true,
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      return ctx.db
        .selectFrom("broker_connections")
        .selectAll()
        .where("user_id", "=", ctx.auth!.userId)
        .executeTakeFirst() ?? null;
    },
  }),
);

builder.queryField("balance", (t) =>
  t.field({
    type: "Balance",
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      // Cash balance from the running total in user_cash_accounts
      const cashAccount = await ctx.db
        .selectFrom("user_cash_accounts")
        .select("balance")
        .where("user_id", "=", ctx.auth!.userId)
        .executeTakeFirst();

      const cashBalance = cashAccount
        ? parseFloat(cashAccount.balance.toString())
        : 0;

      // Invested value + day PnL from open positions owned by this user
      const openPositions = await ctx.db
        .selectFrom("positions")
        .innerJoin("bots", "bots.id", "positions.bot_id")
        .selectAll("positions")
        .where("bots.user_id", "=", ctx.auth!.userId)
        .where("positions.status", "=", "OPEN")
        .execute();

      // qty and avg_entry_price are the actual column names in the positions table
      const investedValue = openPositions.reduce(
        (sum, p) => sum + parseFloat(p.avg_entry_price.toString()) * parseFloat(p.qty.toString()),
        0,
      );

      // unrealized_pnl is not stored in the positions table — computed by workers at EOD.
      // Return 0.00 for intraday; will be populated post-MVP when workers push mark prices.
      const dayPnl = 0;

      const totalValue = cashBalance + investedValue;

      const dayPnlPercent =
        totalValue !== 0
          ? ((dayPnl / totalValue) * 100).toFixed(4)
          : "0.0000";

      return {
        totalValue: totalValue.toFixed(2),
        cashBalance: cashBalance.toFixed(2),
        investedValue: investedValue.toFixed(2),
        dayPnl: dayPnl.toFixed(2),
        dayPnlPercent,
      };
    },
  }),
);
