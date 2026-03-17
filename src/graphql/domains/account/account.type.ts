import { builder } from "../../builder";
import { BrokerConnStatusEnum } from "../../types/enums";
import type { BalanceSummary } from "../../builder";

builder.objectType("Account", {
  description: "A user broker connection",
  fields: (t) => ({
    id: t.exposeID("id"),
    providerName: t.field({
      type: "String",
      resolve: (account) => account.provider_name,
    }),
    status: t.field({
      type: BrokerConnStatusEnum,
      resolve: (account) => account.status,
    }),
    createdAt: t.field({
      type: "DateTime",
      resolve: (account) => new Date(account.created_at),
    }),
    updatedAt: t.field({
      type: "DateTime",
      resolve: (account) => new Date(account.updated_at),
    }),
  }),
});

builder.objectType("Balance", {
  description: "Computed balance summary for the authenticated user",
  fields: (t) => ({
    totalValue: t.field({
      type: "Decimal",
      resolve: (b: BalanceSummary) => b.totalValue,
    }),
    cashBalance: t.field({
      type: "Decimal",
      resolve: (b: BalanceSummary) => b.cashBalance,
    }),
    investedValue: t.field({
      type: "Decimal",
      resolve: (b: BalanceSummary) => b.investedValue,
    }),
    dayPnl: t.field({
      type: "Decimal",
      resolve: (b: BalanceSummary) => b.dayPnl,
    }),
    dayPnlPercent: t.field({
      type: "Decimal",
      resolve: (b: BalanceSummary) => b.dayPnlPercent,
    }),
  }),
});
