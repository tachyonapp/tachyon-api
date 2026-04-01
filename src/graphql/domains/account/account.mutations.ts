import {
  withOpRateLimit,
  OP_RATE_LIMITS,
} from "../../../middleware/operationRateLimit";
import { builder } from "../../builder";
import { ValidationError } from "../../types/errors";

const ConnectBrokerResult = builder.unionType("ConnectBrokerResult", {
  types: ["Account", ValidationError],
  resolveType: (value) => {
    if ("field" in value) return ValidationError;
    return "Account";
  },
});

builder.mutationField("connectBroker", (t) =>
  t.field({
    type: ConnectBrokerResult,
    args: {
      brokerName: t.arg.string({ required: true }),
      credentials: t.arg.string({ required: true }),
    },
    authScopes: { authenticated: true },
    resolve: async (_root, _args, ctx) => {
      await withOpRateLimit(
        ctx,
        "connectBroker",
        OP_RATE_LIMITS.connectBroker.limit,
        OP_RATE_LIMITS.connectBroker.windowSeconds,
      );
      // TODO:: (Feature-13 — Broker Integration): Stub for MVP.
      //
      // Full implementation requires the Broker Integration TDD (Phase 4, Feature 13):
      //   1. Credential storage: AES-256-GCM in broker_connections vs. external secrets manager
      //   2. OAuth flow for Alpaca: separate REST callback endpoint at POST /broker/callback
      //   3. BullMQ dispatch: { brokerConnectionId, userId, correlationId } only — no credentials
      //   4. Auth0 allowed callback URL: add broker callback URI before Feature 13 ships
      //
      // Mutation stays in schema to prevent a breaking change when Feature 13 ships.
      return {
        __typename: "ValidationError",
        message: "Broker connection is not yet available. Coming soon.",
        field: "brokerName",
        code: "NOT_IMPLEMENTED",
      };
    },
  }),
);
