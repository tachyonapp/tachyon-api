import { GraphQLError } from "graphql";
import { assertOwnership } from "../authorization";
import type { TachyonContext } from "../../context";

function mockCtx(userId: string | null): TachyonContext {
  return {
    auth: userId ? { userId, sub: "auth0|123", email: "u@example.com", roles: [] } : null,
  } as unknown as TachyonContext;
}

describe("assertOwnership", () => {
  it("does not throw when userId matches resourceOwnerId", () => {
    expect(() => assertOwnership(mockCtx("user-1"), "user-1")).not.toThrow();
  });

  it("throws FORBIDDEN when userId does not match resourceOwnerId", () => {
    expect(() => assertOwnership(mockCtx("user-1"), "user-2")).toThrow(
      expect.objectContaining({
        extensions: expect.objectContaining({ code: "FORBIDDEN" }),
      }) as GraphQLError,
    );
  });

  it("throws UNAUTHENTICATED when ctx.auth is null", () => {
    expect(() => assertOwnership(mockCtx(null), "user-1")).toThrow(
      expect.objectContaining({
        extensions: expect.objectContaining({ code: "UNAUTHENTICATED" }),
      }) as GraphQLError,
    );
  });
});
