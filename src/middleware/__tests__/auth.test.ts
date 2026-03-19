import type { Request, Response, NextFunction } from "express";
import type { clerkJwtMiddleware as AuthFn } from "../auth";

// ─── Valkey/JWT mocks ─────────────────────────────────────────────────────────

const mockVerifyToken = jest.fn();
jest.mock("../../auth/jwks", () => ({ verifyToken: mockVerifyToken }));
jest.mock("../../lib/logger", () => ({ logger: { warn: jest.fn() } }));

// ─── Kysely chain mock ────────────────────────────────────────────────────────
// All intermediate methods return the mock object for chaining.
// Terminal methods are jest.fn() so individual tests can override return values.

const mockExecuteTakeFirst = jest.fn();
const mockExecuteTakeFirstOrThrow = jest.fn();
const mockExecute = jest.fn().mockResolvedValue(undefined);

const mockDb = {
  selectFrom: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  executeTakeFirst: mockExecuteTakeFirst,
  executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
  insertInto: jest.fn().mockReturnThis(),
  values: jest.fn().mockReturnThis(),
  onConflict: jest.fn().mockImplementation((cb: (oc: unknown) => unknown) => {
    cb({
      column: jest
        .fn()
        .mockReturnValue({ doNothing: jest.fn().mockReturnThis() }),
    });
    return mockDb;
  }),
  execute: mockExecute,
};

jest.mock("../../lib/db", () => ({ getDb: jest.fn().mockReturnValue(mockDb) }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Defines the properties our middleware reads/writes on req, without relying on
// the global Express augmentation being in scope for test-side assertions.
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

// ─── Test setup ───────────────────────────────────────────────────────────────

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
  mockExecuteTakeFirstOrThrow.mockReset();
  mockExecute.mockResolvedValue(undefined);
  mockDb.insertInto.mockReturnThis();
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

    it("does not INSERT when user record already exists", async () => {
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

      expect(mockDb.insertInto).not.toHaveBeenCalled();
    });
  });

  describe("valid JWT — new user (first login)", () => {
    it("inserts a new user record and sets req.auth.userId to the new id", async () => {
      mockVerifyToken.mockResolvedValue({
        sub: "user_test123",
        email: "user@example.com",
        publicMetadata: { roles: ["trader"] },
      });
      // First SELECT returns null (user not found); second returns the new record
      mockExecuteTakeFirst.mockResolvedValue(null);
      mockExecuteTakeFirstOrThrow.mockResolvedValue({ id: "new-user-id" });

      const req = mockReq({ authorization: "Bearer valid.jwt.token" });
      const next: NextFunction = jest.fn();

      await callMiddleware(req, res, next);

      expect(mockDb.insertInto).toHaveBeenCalledWith("users");
      expect(req.auth?.userId).toBe("new-user-id");
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
