import { GraphQLError } from "graphql";
import type { TachyonContext } from "../context";

/**
 * Asserts that the authenticated user owns the resource identified by resourceOwnerId.
 *
 * Throws FORBIDDEN if resource belongs to a different user.
 * Throws UNAUTHENTICATED if no auth context exists.
 *
 * @param ctx - The request context
 * @param resourceOwnerId - The users.id value from the DB row being accessed
 *
 * CRITICAL
 * Resolvers NEVER use `args.userId` for authorization
 * This is enforced by code review
 */
export function assertOwnership(
  ctx: TachyonContext,
  resourceOwnerId: string,
): void {
  if (!ctx.auth) {
    throw new GraphQLError("Not authenticated", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  if (ctx.auth.userId !== resourceOwnerId) {
    throw new GraphQLError("Access denied", {
      extensions: { code: "FORBIDDEN" },
    });
  }
}
