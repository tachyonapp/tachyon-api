import type { Request, Response, NextFunction } from "express";
import type { rateLimitMiddleware as RateLimitFn } from "../rateLimit";

// eval mock — returns the count directly (the value SLIDING_WINDOW_LUA returns)
const mockEval = jest.fn();

jest.mock("../../lib/valkey", () => ({
  getValkey: jest.fn().mockReturnValue({ eval: mockEval }),
}));

let rateLimitMiddleware: typeof RateLimitFn;

beforeEach(async () => {
  jest.resetModules();
  mockEval.mockClear();
  ({ rateLimitMiddleware } = await import("../rateLimit"));
});

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ip: "127.0.0.1",
    correlationId: "test-correlation-id",
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Partial<Response> {
  return {
    set: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

// Simulate eval() returning the count (what SLIDING_WINDOW_LUA returns before ZADD)
function evalWithCount(count: number) {
  mockEval.mockResolvedValue(count);
}

describe("rateLimitMiddleware", () => {
  it("calls next() when authenticated request is under the limit", async () => {
    evalWithCount(1);
    const next: NextFunction = jest.fn();
    const req = mockReq({
      headers: { authorization: "Bearer some.jwt.token" },
    });

    await rateLimitMiddleware(req, mockRes() as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("calls next() on the 60th authenticated request (at limit boundary)", async () => {
    evalWithCount(59);
    const next: NextFunction = jest.fn();
    const req = mockReq({
      headers: { authorization: "Bearer some.jwt.token" },
    });

    await rateLimitMiddleware(req, mockRes() as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 429 with RATE_LIMITED code on the 61st authenticated request", async () => {
    evalWithCount(60);
    const next: NextFunction = jest.fn();
    const req = mockReq({
      headers: { authorization: "Bearer some.jwt.token" },
    });
    const res = mockRes();

    await rateLimitMiddleware(req, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith("Retry-After", expect.any(String));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({
            extensions: expect.objectContaining({ code: "RATE_LIMITED" }),
          }),
        ]),
      }),
    );
  });

  it("calls next() on the 20th unauthenticated request (at limit boundary)", async () => {
    evalWithCount(19);
    const next: NextFunction = jest.fn();
    const req = mockReq(); // no auth header

    await rateLimitMiddleware(req, mockRes() as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 429 on the 21st unauthenticated request", async () => {
    evalWithCount(20);
    const next: NextFunction = jest.fn();
    const req = mockReq(); // no auth header
    const res = mockRes();

    await rateLimitMiddleware(req, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("uses ip-based key for unauthenticated requests", async () => {
    evalWithCount(0);
    const req = mockReq({ ip: "10.0.0.1" });
    await rateLimitMiddleware(req, mockRes() as Response, jest.fn());
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String), // Lua script
      1, // numkeys
      expect.stringContaining("ip:10.0.0.1"), // KEYS[1]
      expect.any(String), // ARGV[1] cutoff
      expect.any(String), // ARGV[2] now
      expect.any(String), // ARGV[3] member
      expect.any(String), // ARGV[4] limit
      expect.any(String), // ARGV[5] ttl
    );
  });

  it("uses token-based key for authenticated requests", async () => {
    evalWithCount(0);
    const token = "header.payload.signature1234567890abcdef";
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    await rateLimitMiddleware(req, mockRes() as Response, jest.fn());
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringContaining("user:"),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });
});
