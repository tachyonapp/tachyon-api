import type { Request, Response, NextFunction } from "express";
import { correlationIdMiddleware } from "../correlationId";

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Defines the properties correlationIdMiddleware reads/writes on req, without
// relying on the global Express augmentation being in scope for test assertions.
interface MockRequest {
  headers: Record<string, string>;
  correlationId?: string;
}

function mockReq(headers: Record<string, string> = {}): MockRequest {
  return { headers };
}

function mockRes(): { setHeader: jest.Mock } {
  return { setHeader: jest.fn() };
}

function callMiddleware(req: MockRequest, res: Response, next: NextFunction) {
  return correlationIdMiddleware(req as unknown as Request, res, next);
}

describe("correlationIdMiddleware", () => {
  it("generates a UUID v4 when no x-correlation-id header is present", () => {
    const req = mockReq();
    const res = mockRes() as unknown as Response;
    const next: NextFunction = jest.fn();

    callMiddleware(req, res, next);

    expect(req.correlationId).toMatch(UUID_V4_REGEX);
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      req.correlationId,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("reuses the client-provided x-correlation-id header", () => {
    const clientId = "client-provided-trace-id";
    const req = mockReq({ "x-correlation-id": clientId });
    const res = mockRes() as unknown as Response;
    const next: NextFunction = jest.fn();

    callMiddleware(req, res, next);

    expect(req.correlationId).toBe(clientId);
    expect(res.setHeader).toHaveBeenCalledWith("X-Correlation-ID", clientId);
  });

  it("assigns distinct IDs to concurrent requests", () => {
    const req1 = mockReq();
    const req2 = mockReq();
    const res = mockRes() as unknown as Response;
    const next: NextFunction = jest.fn();

    callMiddleware(req1, res, next);
    callMiddleware(req2, res, next);

    expect(req1.correlationId).not.toBe(req2.correlationId);
  });
});
