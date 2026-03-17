import { builder } from "./builder";

// Import order: shared types before domain types, types before queries/mutations
import "./types/scalars";
import "./types/errors";
import "./types/enums";

// Domain types
import "./domains/user/user.type";
import "./domains/bots/bot.type";
import "./domains/proposals/proposal.type";
import "./domains/positions/position.type";
import "./domains/account/account.type";

// Queries
import "./domains/user/user.queries";
import "./domains/bots/bot.queries";
import "./domains/proposals/proposal.queries";
import "./domains/positions/position.queries";
import "./domains/account/account.queries";

// Mutations
import "./domains/bots/bot.mutations";
import "./domains/proposals/proposal.mutations";
import "./domains/account/account.mutations";

// Subscription stubs
import "./domains/subscriptions/subscription.stubs";

export function buildSchema() {
  return builder.toSchema();
}
