import { GraphQLError } from "graphql";
import type { TachyonContext } from "../../context";
import { withOpRateLimit } from "../operationRateLimit";
import { logger } from "../../lib/logger";

// jest.mock is hoisted before imports — mock the module with an inline jest.fn(),
// then grab the reference from the already-mocked module below.
jest.mock("../../lib/logger", () => ({
  logger: { warn: jest.fn() },
}));

const mockWarn = logger.warn as jest.Mock;

// Helper: build a minimal TachyonContext with a controllable eval mock
function makeCtx(evalResult: number): TachyonContext {
  return {
    auth: { userId: "user-123", sub: "sub", email: "test@test.com", roles: [] },
    correlationId: "corr-abc-123",
    valkey: {
      eval: jest.fn().mockResolvedValue(evalResult),
    } as unknown as TachyonContext["valkey"],
    db: {} as TachyonContext["db"],
    loaders: {} as TachyonContext["loaders"],
    operationName: null,
  };
}

describe("withOpRateLimit", () => {
  beforeEach(() => {
    mockWarn.mockClear();
  });

  it("resolves without throwing when count is below the limit", async () => {
    const ctx = makeCtx(5); // count = 5, limit = 10
    await expect(
      withOpRateLimit(ctx, "approveProposal", 10, 60),
    ).resolves.toBeUndefined();
  });

  it("throws GraphQLError with RATE_LIMITED code when count equals the limit", async () => {
    const ctx = makeCtx(10); // count = 10 >= limit = 10
    await expect(
      withOpRateLimit(ctx, "approveProposal", 10, 60),
    ).rejects.toThrow(GraphQLError);

    try {
      await withOpRateLimit(makeCtx(10), "approveProposal", 10, 60);
    } catch (err) {
      expect(err).toBeInstanceOf(GraphQLError);
      const gqlErr = err as GraphQLError;
      expect(gqlErr.extensions.code).toBe("RATE_LIMITED");
      expect(typeof gqlErr.extensions.retryAfter).toBe("number");
      expect(gqlErr.extensions.operation).toBe("approveProposal");
    }
  });

  it("emits a pino warn log on rate limit breach containing required fields", async () => {
    const ctx = makeCtx(10);
    try {
      await withOpRateLimit(ctx, "createBot", 5, 3600);
    } catch {
      // expected
    }
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        operationName: "createBot",
        limit: 5,
        windowSeconds: 3600,
        retryAfter: expect.any(Number),
      }),
    );
  });

  it("uses the correct Valkey key format: rate:op:<userId>:<operationName>", async () => {
    const ctx = makeCtx(0);
    await withOpRateLimit(ctx, "skipProposal", 20, 60);

    expect(ctx.valkey.eval).toHaveBeenCalledWith(
      expect.any(String), // Lua script
      1, // numkeys
      "rate:op:user-123:skipProposal", // KEYS[1]
      expect.any(String), // ARGV[1] cutoff
      expect.any(String), // ARGV[2] now
      "corr-abc-123", // ARGV[3] member (correlationId)
      expect.any(String), // ARGV[4] limit
      expect.any(String), // ARGV[5] ttl
    );
  });

  it("does NOT advance the counter when the request is rate limited (eval is not called a second time)", async () => {
    // The Lua script itself handles this — it skips ZADD on breach.
    // At the wrapper level: verify eval is called exactly once (not twice),
    // confirming the wrapper does not attempt a separate increment after rejection.
    const ctx = makeCtx(10); // count >= limit → rejected
    try {
      await withOpRateLimit(ctx, "activateBot", 10, 60);
    } catch {
      // expected
    }
    expect(ctx.valkey.eval).toHaveBeenCalledTimes(1);
  });
});

