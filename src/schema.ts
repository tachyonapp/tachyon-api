import { builder } from "./graphql/builder";

// Import order: shared types before domain types, types before queries/mutations
import "./graphql/types/scalars";
import "./graphql/types/errors";
import "./graphql/types/enums";

// Domain types
import "./graphql/domains/user/user.type";
import "./graphql/domains/bots/bot.type";
import "./graphql/domains/proposals/proposal.type";
import "./graphql/domains/positions/position.type";
import "./graphql/domains/account/account.type";

// Queries
import "./graphql/domains/user/user.queries";
import "./graphql/domains/bots/bot.queries";
import "./graphql/domains/proposals/proposal.queries";
import "./graphql/domains/positions/position.queries";
import "./graphql/domains/account/account.queries";

// Mutations
import "./graphql/domains/bots/bot.mutations";
import "./graphql/domains/proposals/proposal.mutations";
import "./graphql/domains/account/account.mutations";

// Subscription stubs
import "./graphql/domains/subscriptions/subscription.stubs";

export function buildSchema() {
  return builder.toSchema();
}
