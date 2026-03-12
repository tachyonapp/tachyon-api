import { getBullMQConnectionOptions } from "../client";

describe("getBullMQConnectionOptions (api)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns defaults when env vars absent", () => {
    delete process.env.VALKEY_HOST;
    delete process.env.VALKEY_PORT;
    delete process.env.VALKEY_PASSWORD;
    delete process.env.VALKEY_TLS;
    const opts = getBullMQConnectionOptions();
    expect(opts.host).toBe("localhost");
    expect(opts.port).toBe(6379);
    expect(opts.password).toBeUndefined();
    expect(opts.tls).toBeUndefined();
  });

  it("enables TLS when VALKEY_TLS=true", () => {
    process.env.VALKEY_TLS = "true";
    const opts = getBullMQConnectionOptions();
    expect(opts.tls).toEqual({});
  });
});
