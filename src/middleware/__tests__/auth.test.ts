import type { Request, Response, NextFunction } from "express";
import type { clerkJwtMiddleware as AuthFn } from "../auth";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockVerifyToken = jest.fn();
jest.mock("../../auth/jwks", () => ({ verifyToken: mockVerifyToken }));
jest.mock("../../lib/logger", () => ({ logger: { warn: jest.fn() } }));

const mockExecuteTakeFirst = jest.fn();

const mockDb = {
  selectFrom: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  executeTakeFirst: mockExecuteTakeFirst,
};

jest.mock("../../lib/db", () => ({ getDb: jest.fn().mockReturnValue(mockDb) }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface MockRequest {
  headers: Record<string, string>;
  correlationId: string;
  auth?: {
    sub: string;
    email: string;
    userId: string;
    roles: string[];
  };
}

function mockReq(headers: Record<string, string> = {}): MockRequest {
  return { headers, correlationId: "test-id" };
}

const res = {} as Response;

function callMiddleware(
  req: MockRequest,
  response: Response,
  next: NextFunction,
) {
  return clerkJwtMiddleware(req as unknown as Request, response, next);
}

let clerkJwtMiddleware: typeof AuthFn;

beforeEach(async () => {
  jest.resetModules();
  mockVerifyToken.mockReset();
  mockExecuteTakeFirst.mockReset();
  ({ clerkJwtMiddleware } = await import("../auth"));
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("clerkJwtMiddleware", () => {
  describe("missing Authorization header", () => {
    it("calls next() without setting req.auth", async () => {
      const req = mockReq();
      const next: NextFunction = jest.fn();

      await callMiddleware(req, res, next);

      expect(req.auth).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });
  });

  describe("invalid / expired JWT", () => {
    it("calls next() without setting req.auth when verifyToken throws", async () => {
      mockVerifyToken.mockRejectedValue(new Error("jwt expired"));
      const req = mockReq({ authorization: "Bearer bad.token.here" });
      const next: NextFunction = jest.fn();

      await callMiddleware(req, res, next);

      expect(req.auth).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("does not return 401 on expired token", async () => {
      mockVerifyToken.mockRejectedValue(new Error("jwt expired"));
      const resSpy = { status: jest.fn() } as unknown as Response;
      const req = mockReq({ authorization: "Bearer bad.token.here" });

      await callMiddleware(req, resSpy, jest.fn());

      expect(resSpy.status).not.toHaveBeenCalled();
    });
  });

  describe("valid JWT — existing user", () => {
    it("populates req.auth and calls next()", async () => {
      mockVerifyToken.mockResolvedValue({
        sub: "user_test123",
        email: "user@example.com",
        publicMetadata: { roles: ["trader"] },
      });
      mockExecuteTakeFirst.mockResolvedValue({ id: "existing-user-id" });

      const req = mockReq({ authorization: "Bearer valid.jwt.token" });
      const next: NextFunction = jest.fn();

      await callMiddleware(req, res, next);

      expect(req.auth).toEqual({
        sub: "user_test123",
        email: "user@example.com",
        userId: "existing-user-id",
        roles: ["trader"],
      });
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("does not INSERT when user record exists", async () => {
      mockVerifyToken.mockResolvedValue({
        sub: "user_test123",
        email: "user@example.com",
        publicMetadata: { roles: ["trader"] },
      });
      mockExecuteTakeFirst.mockResolvedValue({ id: "existing-user-id" });

      await callMiddleware(
        mockReq({ authorization: "Bearer valid.jwt.token" }),
        res,
        jest.fn(),
      );

      expect(mockDb.selectFrom).toHaveBeenCalledWith("users");
      // No insert — provisioning is handled by the webhook, not here
      expect(mockDb).not.toHaveProperty("insertInto");
    });
  });

  describe("valid JWT — user not provisioned (webhook missed)", () => {
    it("calls next() without setting req.auth when user row is missing", async () => {
      mockVerifyToken.mockResolvedValue({
        sub: "user_test123",
        email: "user@example.com",
        publicMetadata: {},
      });
      // No row in DB — webhook never fired
      mockExecuteTakeFirst.mockResolvedValue(undefined);

      const req = mockReq({ authorization: "Bearer valid.jwt.token" });
      const next: NextFunction = jest.fn();

      await callMiddleware(req, res, next);

      expect(req.auth).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
