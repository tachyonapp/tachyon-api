import type { Request, Response, NextFunction } from 'express';
import type { rateLimitMiddleware as RateLimitFn } from '../rateLimit';

// Pipeline mock — controls the zcard result returned by exec()
const mockExec = jest.fn();
const mockPipeline = {
  zremrangebyscore: jest.fn().mockReturnThis(),
  zcard: jest.fn().mockReturnThis(),
  zadd: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: mockExec,
};

jest.mock('../../lib/valkey', () => ({
  getValkey: jest.fn().mockReturnValue({ pipeline: jest.fn().mockReturnValue(mockPipeline) }),
}));

let rateLimitMiddleware: typeof RateLimitFn;

beforeEach(async () => {
  jest.resetModules();
  mockExec.mockClear();
  mockPipeline.zremrangebyscore.mockClear();
  ({ rateLimitMiddleware } = await import('../rateLimit'));
});

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ip: '127.0.0.1',
    correlationId: 'test-correlation-id',
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

// Simulate exec() returning a count at index [1][1]
function execWithCount(count: number) {
  mockExec.mockResolvedValue([null, [null, count], null, null]);
}

describe('rateLimitMiddleware', () => {
  it('calls next() when authenticated request is under the limit', async () => {
    execWithCount(1);
    const next: NextFunction = jest.fn();
    const req = mockReq({ headers: { authorization: 'Bearer some.jwt.token' } });

    await rateLimitMiddleware(req, mockRes() as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() on the 60th authenticated request (at limit boundary)', async () => {
    execWithCount(59);
    const next: NextFunction = jest.fn();
    const req = mockReq({ headers: { authorization: 'Bearer some.jwt.token' } });

    await rateLimitMiddleware(req, mockRes() as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 429 with RATE_LIMITED code on the 61st authenticated request', async () => {
    execWithCount(60);
    const next: NextFunction = jest.fn();
    const req = mockReq({ headers: { authorization: 'Bearer some.jwt.token' } });
    const res = mockRes();

    await rateLimitMiddleware(req, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({ extensions: expect.objectContaining({ code: 'RATE_LIMITED' }) }),
        ]),
      }),
    );
  });

  it('calls next() on the 20th unauthenticated request (at limit boundary)', async () => {
    execWithCount(19);
    const next: NextFunction = jest.fn();
    const req = mockReq(); // no auth header

    await rateLimitMiddleware(req, mockRes() as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 429 on the 21st unauthenticated request', async () => {
    execWithCount(20);
    const next: NextFunction = jest.fn();
    const req = mockReq(); // no auth header
    const res = mockRes();

    await rateLimitMiddleware(req, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('uses ip-based key for unauthenticated requests', async () => {
    execWithCount(0);
    const req = mockReq({ ip: '10.0.0.1' });
    await rateLimitMiddleware(req, mockRes() as Response, jest.fn());
    expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith(
      expect.stringContaining('ip:10.0.0.1'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('uses token-based key for authenticated requests', async () => {
    execWithCount(0);
    const token = 'header.payload.signature1234567890abcdef';
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    await rateLimitMiddleware(req, mockRes() as Response, jest.fn());
    expect(mockPipeline.zremrangebyscore).toHaveBeenCalledWith(
      expect.stringContaining('user:'),
      expect.anything(),
      expect.anything(),
    );
  });
});
