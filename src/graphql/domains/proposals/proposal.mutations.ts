import {
  withOpRateLimit,
  OP_RATE_LIMITS,
} from "../../../middleware/operationRateLimit";
import { builder } from "../../builder";
import { NotFoundError, AuthError } from "../../types/errors";
import { assertOwnership } from "../../../auth/authorization";
import { getReconciliationQueue } from "../../../queues";
import { QUEUE_NAMES } from "@tachyonapp/tachyon-queue-types";
import type { OrderSubmitPayload } from "@tachyonapp/tachyon-queue-types";

// ---------------------------------------------------------------------------
// Result union types
// ---------------------------------------------------------------------------

const ApproveProposalResult = builder.unionType("ApproveProposalResult", {
  types: ["Proposal", NotFoundError, AuthError],
  resolveType: (value) => {
    if ("message" in value && "bot_id" in value) return "Proposal";
    if ("message" in value) return NotFoundError;
    return AuthError;
  },
});

const SkipProposalResult = builder.unionType("SkipProposalResult", {
  types: ["Proposal", NotFoundError, AuthError],
  resolveType: (value) => {
    if ("message" in value && "bot_id" in value) return "Proposal";
    if ("message" in value) return NotFoundError;
    return AuthError;
  },
});

// ---------------------------------------------------------------------------
// approveProposal
// ---------------------------------------------------------------------------

builder.mutationField("approveProposal", (t) =>
  t.field({
    type: ApproveProposalResult,
    args: { id: t.arg.id({ required: true }) },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      // rate limit check
      await withOpRateLimit(
        ctx,
        "approveProposal",
        OP_RATE_LIMITS.approveProposal.limit,
        OP_RATE_LIMITS.approveProposal.windowSeconds,
      );

      const proposal = await ctx.db
        .selectFrom("trade_proposals")
        .selectAll()
        .where("id", "=", args.id)
        .where("status", "=", "PENDING")
        .executeTakeFirst();

      if (!proposal) {
        return { message: "Proposal not found or already actioned" };
      }

      // user_id is denormalized onto trade_proposals — no join needed
      assertOwnership(ctx, String(proposal.user_id));

      // Wrap status update + proposal_actions insert in a transaction
      const updated = await ctx.db.transaction().execute(async (trx) => {
        const row = await trx
          .updateTable("trade_proposals")
          .set({ status: "APPROVED", approved_at: new Date() })
          .where("id", "=", args.id)
          .returningAll()
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("proposal_actions")
          .values({
            proposal_id: args.id,
            user_id: ctx.auth!.userId,
            action: "APPROVE",
          })
          .execute();

        return row;
      });

      // Fire-and-forget — do NOT await job completion before responding
      // Payload contains IDs only; worker fetches order details from DB at execution time
      const payload: OrderSubmitPayload = {
        proposalId: String(updated.id),
        botId: String(updated.bot_id),
        userId: ctx.auth!.userId,
        correlationId: ctx.correlationId,
        enqueuedAt: new Date().toISOString(),
      };

      await getReconciliationQueue().add(QUEUE_NAMES.RECONCILIATION, payload, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      });

      return updated;
    },
  }),
);

// ---------------------------------------------------------------------------
// skipProposal
// ---------------------------------------------------------------------------

builder.mutationField("skipProposal", (t) =>
  t.field({
    type: SkipProposalResult,
    args: { id: t.arg.id({ required: true }) },
    authScopes: { authenticated: true },
    resolve: async (_root, args, ctx) => {
      // rate limit check
      await withOpRateLimit(
        ctx,
        "skipProposal",
        OP_RATE_LIMITS.skipProposal.limit,
        OP_RATE_LIMITS.skipProposal.windowSeconds,
      );

      const proposal = await ctx.db
        .selectFrom("trade_proposals")
        .selectAll()
        .where("id", "=", args.id)
        .where("status", "=", "PENDING")
        .executeTakeFirst();

      if (!proposal) {
        return { message: "Proposal not found or already actioned" };
      }

      assertOwnership(ctx, String(proposal.user_id));

      // Wrap status update + proposal_actions insert in a transaction
      const updated = await ctx.db.transaction().execute(async (trx) => {
        const row = await trx
          .updateTable("trade_proposals")
          .set({ status: "SKIPPED", skipped_at: new Date() })
          .where("id", "=", args.id)
          .returningAll()
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("proposal_actions")
          .values({
            proposal_id: args.id,
            user_id: ctx.auth!.userId,
            action: "SKIP",
          })
          .execute();

        return row;
      });

      // No BullMQ dispatch for skip — status update is sufficient
      return updated;
    },
  }),
);
