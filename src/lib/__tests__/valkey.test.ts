import type { getValkey as GetValkey } from '../valkey';

const mockRedisInstance = {};
const mockRedisConstructor = jest.fn().mockImplementation(() => mockRedisInstance);

jest.mock('ioredis', () => mockRedisConstructor);

let getValkey: typeof GetValkey;

beforeEach(async () => {
  jest.resetModules();
  mockRedisConstructor.mockClear();
  ({ getValkey } = await import('../valkey'));
});

describe('getValkey', () => {
  it('returns a Redis instance', () => {
    const client = getValkey();
    expect(client).toBe(mockRedisInstance);
  });

  it('returns the same instance on repeated calls (singleton)', () => {
    const first = getValkey();
    const second = getValkey();
    expect(first).toBe(second);
    expect(mockRedisConstructor).toHaveBeenCalledTimes(1);
  });

  it('constructs Redis with VALKEY_HOST and VALKEY_PORT from env', () => {
    process.env.VALKEY_HOST = 'valkey-host';
    process.env.VALKEY_PORT = '6380';
    getValkey();
    expect(mockRedisConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'valkey-host', port: 6380 }),
    );
  });

  it('enables TLS when VALKEY_TLS is "true"', () => {
    process.env.VALKEY_TLS = 'true';
    getValkey();
    expect(mockRedisConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ tls: {} }),
    );
  });

  it('disables TLS when VALKEY_TLS is not "true"', () => {
    process.env.VALKEY_TLS = 'false';
    getValkey();
    expect(mockRedisConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ tls: undefined }),
    );
  });
});
