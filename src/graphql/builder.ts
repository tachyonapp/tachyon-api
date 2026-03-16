import SchemaBuilder from "@pothos/core";
import ErrorsPlugin from "@pothos/plugin-errors";
import ScopeAuthPlugin from "@pothos/plugin-scope-auth";
import SimpleObjectsPlugin from "@pothos/plugin-simple-objects";
import type { TachyonContext } from "../context";
import type {
  UsersRow,
  BotsRow,
  ProposalsRow,
  PositionsRow,
  AccountsRow,
} from "@tachyonapp/tachyon-db";

// BalanceSummary is a computed aggregate — not a direct DB row
export interface BalanceSummary {
  totalValue: string;
  cashBalance: string;
  investedValue: string;
  dayPnl: string;
  dayPnlPercent: string;
}

/**
 * KEY PATTERN
 *
 * Pothos uses the `Objects` map to infer resolver `parent` types at the
 * TypeScript level. The Kysely row types are imported from tachyon-db.
 * This means field resolvers receieve fully-typed DB rows as their first
 * argument.
 *
 * Pothos does NOT interact with kysely at runtime.
 *
 */
export const builder = new SchemaBuilder<{
  Context: TachyonContext;
  AuthScopes: {
    authenticated: boolean;
  };
  Objects: {
    User: UsersRow;
    Bot: BotsRow;
    Proposal: ProposalsRow;
    Position: PositionsRow;
    BrokerAccount: AccountsRow;
    Balance: BalanceSummary;
  };
  Scalars: {
    DateTime: { Input: Date; Output: Date };
    Decimal: { Input: string; Output: string };
  };
}>({
  plugins: [ScopeAuthPlugin, ErrorsPlugin, SimpleObjectsPlugin],
  scopeAuth: {
    authScopes: async (context) => ({
      authenticated: context.auth !== null,
    }),
  },
  errors: {
    defaultTypes: [],
  },
});
