import type { getDb as GetDb } from '../db';

const mockPoolConstructor = jest.fn().mockImplementation(() => ({}));

jest.mock('pg', () => ({ Pool: mockPoolConstructor }));

let getDb: typeof GetDb;

beforeEach(async () => {
  jest.resetModules();
  mockPoolConstructor.mockClear();
  ({ getDb } = await import('../db'));
});

describe('getDb', () => {
  it('returns an object with Kysely query methods', () => {
    const db = getDb();
    expect(typeof db.selectFrom).toBe('function');
    expect(typeof db.insertInto).toBe('function');
  });

  it('returns the same instance on repeated calls (singleton)', () => {
    const first = getDb();
    const second = getDb();
    expect(first).toBe(second);
    expect(mockPoolConstructor).toHaveBeenCalledTimes(1);
  });

  it('creates a pg Pool with DATABASE_URL from env', () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/testdb';
    getDb();
    expect(mockPoolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: 'postgres://test:test@localhost:5432/testdb' }),
    );
  });

  it('disables SSL when POSTGRES_SSL is not "true"', () => {
    process.env.POSTGRES_SSL = 'false';
    getDb();
    expect(mockPoolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: false }),
    );
  });

  it('enables SSL when POSTGRES_SSL is "true"', () => {
    process.env.POSTGRES_SSL = 'true';
    getDb();
    expect(mockPoolConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: false } }),
    );
  });
});
