import { builder } from "../../builder";
import { assertOwnership } from "../../../auth/authorization";
import { withOpRateLimit } from "../../../middleware/operationRateLimit";
import { GraphQLError } from "graphql";
import {
  TACHYON_DEFAULT_BRAIN,
  BYOK_PROVIDER_CATALOG,
} from "../../../config/brainProviders";
import { BrainCatalog, BotPerformanceResult } from "./bot.type";

// Public catalog — no auth required; mobile fetches this at wizard entry
builder.queryField("brainProviders", (t) =>
  t.field({
    type: BrainCatalog,
    resolve: () => ({
      defaultBrain: {
        brainType: TACHYON_DEFAULT_BRAIN.brainType,
        modelId: TACHYON_DEFAULT_BRAIN.modelId,
        provider: TACHYON_DEFAULT_BRAIN.provider,
        displayName: TACHYON_DEFAULT_BRAIN.displayName,
        description: TACHYON_DEFAULT_BRAIN.description,
      },
      byokProviders: BYOK_PROVIDER_CATALOG.map((p) => ({
        provider: p.provider,
        displayName: p.displayName,
        models: p.models.map((m) => ({
          modelId: m.modelId,
          displayName: m.displayName,
        })),
      })),
    }),
  }),
);

// List all non-archived bots for the authenticated user
builder.queryField("bots", (t) =>
  t.field({
    type: ["Bot"],
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      return ctx.db
        .selectFrom("bots")
        .selectAll()
        .where("user_id", "=", ctx.auth!.userId)
        .where("status", "!=", "ARCHIVED")
        .execute();
    },
  }),
);

// Fetch a single bot by ID — enforces ownership
builder.queryField("bot", (t) =>
  t.field({
    type: "Bot",
    nullable: true,
    args: { id: t.arg.id({ required: true }) },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      const bot = await ctx.db
        .selectFrom("bots")
        .selectAll()
        .where("id", "=", args.id)
        .where("status", "!=", "ARCHIVED")
        .executeTakeFirst();

      if (!bot) return null;

      assertOwnership(ctx, String(bot.user_id));

      return bot;
    },
  }),
);

builder.queryField("botPerformance", (t) =>
  t.field({
    type: BotPerformanceResult,
    args: { id: t.arg.id({ required: true }) },
    authScopes: { authenticated: true },
    resolve: async (_root, { id }, ctx) => {
      await withOpRateLimit(ctx, "botPerformance", 20, 60);

      const bot = await ctx.db
        .selectFrom("bots")
        .where("id", "=", id)
        .select(["id", "user_id", "created_at"])
        .executeTakeFirst();

      if (!bot)
        throw new GraphQLError("Bot not found", {
          extensions: { code: "NOT_FOUND" },
        });
      assertOwnership(ctx, String(bot.user_id));

      const [positions, proposals] = await Promise.all([
        ctx.db
          .selectFrom("positions")
          .where("bot_id", "=", id)
          .where("status", "=", "CLOSED")
          .select([
            "id",
            "avg_entry_price",
            "exit_price",
            "qty",
            "realized_pnl",
            "capital_allocated_usd",
            "closed_at",
            "opened_at",
          ])
          .execute(),
        ctx.db
          .selectFrom("trade_proposals")
          .where("bot_id", "=", id)
          .select(["id", "status"])
          .execute(),
      ]);

      // realized_pnl is authoritative (net of fees, written by worker at close).
      // Defaults to 0 for positions predating migration 009 that have no worker-written value.
      const pnl = (p: (typeof positions)[number]) => Number(p.realized_pnl ?? 0);

      const wins = positions.filter((p) => pnl(p) > 0);
      const losses = positions.filter((p) => pnl(p) <= 0);

      const totalRealizedPnl = positions.reduce((sum, p) => sum + pnl(p), 0);

      // ROAC = totalRealizedPnl / total capital deployed across all closed trades.
      const totalCapitalDeployed = positions.reduce(
        (sum, p) => sum + Number(p.capital_allocated_usd ?? 0),
        0,
      );
      const returnOnAllocatedCapitalPct =
        totalCapitalDeployed > 0 ? (totalRealizedPnl / totalCapitalDeployed) * 100 : 0;

      const grossProfit = wins.reduce((sum, p) => sum + pnl(p), 0);
      const grossLoss = Math.abs(losses.reduce((sum, p) => sum + pnl(p), 0));

      const avgHoldDurationHours =
        positions.length > 0
          ? positions.reduce((sum, p) => {
              const diffMs =
                new Date(p.closed_at!).getTime() -
                new Date(p.opened_at).getTime();
              return sum + diffMs / (1000 * 60 * 60);
            }, 0) / positions.length
          : 0;

      const daysActive = Math.floor(
        (Date.now() - new Date(bot.created_at).getTime()) /
          (1000 * 60 * 60 * 24),
      );

      const approved = proposals.filter((p) => p.status === "APPROVED").length;
      const skipped = proposals.filter((p) => p.status === "SKIPPED").length;

      const sorted = [...positions]
        .filter((p) => p.closed_at)
        .sort(
          (a, b) =>
            new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime(),
        );

      let cumulative = 0;
      const pnlTimeSeries = sorted.map((p) => {
        cumulative += pnl(p);
        return { date: new Date(p.closed_at!), cumulativePnl: cumulative };
      });

      return {
        totalRealizedPnl,
        returnOnAllocatedCapitalPct,
        winCount: wins.length,
        lossCount: losses.length,
        winRatePct:
          positions.length > 0 ? (wins.length / positions.length) * 100 : 0,
        avgGainPerWin: wins.length > 0 ? grossProfit / wins.length : 0,
        avgLossPerLoss: losses.length > 0 ? grossLoss / losses.length : 0,
        profitFactor:
          grossLoss > 0
            ? grossProfit / grossLoss
            : grossProfit > 0
              ? grossProfit
              : 0,
        largestSingleWin:
          wins.length > 0 ? Math.max(...wins.map((p) => pnl(p))) : 0,
        largestSingleLoss:
          losses.length > 0
            ? Math.max(...losses.map((p) => Math.abs(pnl(p))))
            : 0,
        avgHoldDurationHours,
        daysActive,
        totalProposalsGenerated: proposals.length,
        totalProposalsApproved: approved,
        approvalRatePct:
          proposals.length > 0 ? (approved / proposals.length) * 100 : 0,
        skipRatePct:
          proposals.length > 0 ? (skipped / proposals.length) * 100 : 0,
        pnlTimeSeries,
      };
    },
  }),
);
