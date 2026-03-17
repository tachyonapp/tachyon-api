import { builder } from "../../builder";
import type { ProposalsRow, PositionsRow } from "@tachyonapp/tachyon-db";

// Subscription transport (WebSocket/SSE) is deferred post-MVP.
// These stubs keep the types in the schema so clients can reference them
// without a breaking schema change when transport is added.
// See PDRD Pre-Phase 6 Gate for transport decision.

builder.subscriptionField("proposalCreated", (t) =>
  t.field({
    type: "Proposal",
    args: { botId: t.arg.id({ required: true }) },
    authScopes: { authenticated: true },
    subscribe: () => {
      throw new Error("Subscriptions not yet supported");
    },
    resolve: (payload: ProposalsRow) => payload,
  }),
);

builder.subscriptionField("orderUpdated", (t) =>
  t.field({
    type: "Position",
    args: { botId: t.arg.id({ required: true }) },
    authScopes: { authenticated: true },
    subscribe: () => {
      throw new Error("Subscriptions not yet supported");
    },
    resolve: (payload: PositionsRow) => payload,
  }),
);
