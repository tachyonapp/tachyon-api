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
 * BotWithSettings — the backing type for the `Bot` GraphQL object.
 *
 * The `bots` table stores identity and status. Financial risk settings
 * (`daily_max_loss`, `daily_max_gain`, etc.) live in a separate `bot_settings`
 * table referenced via `bots.current_settings_id`. Bot frame name comes from
 * the `bot_frames` lookup table via `bots.frame_id`.
 *
 * Resolvers that return `Bot` must JOIN all three tables and cast to this type.
 * `bot_settings` fields are nullable because a DRAFT bot may have no settings yet.
 * `frame_name` is always present (INNER JOIN on `bot_frames`).
 *
 * This preserves the ability to query `bots` and `bot_settings` independently —
 * this interface is only used at the GraphQL boundary.
 */
export interface BotWithSettings extends BotsRow {
  // From bot_frames (INNER JOIN via frame_id — always present)
  frame_name: string;
  // From bot_settings (LEFT JOIN via current_settings_id — null if no settings yet)
  daily_max_loss: string | null;
  daily_max_gain: string | null;
  risk_attitude: "AGGRESSIVE" | "BALANCED" | "CAUTIOUS" | null;
  trade_tempo: "ACTIVE" | "OPPORTUNISTIC" | "RELENTLESS" | null;
  combat_patience: "CALCULATED" | "IMPULSIVE" | "PATIENT" | "STRATEGIC" | null;
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
    Bot: BotWithSettings;
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
