import { checkPostgres, checkValkey } from "../health";

jest.mock("../lib/db", () => ({
  getDb: jest.fn().mockReturnValue({
    executeQuery: jest.fn().mockRejectedValue(new Error("Connection refused")),
  }),
}));

jest.mock("kysely", () => ({
  sql: Object.assign(
    jest.fn().mockReturnValue({
      execute: jest.fn().mockRejectedValue(new Error("Connection refused")),
    }),
    { raw: jest.fn() },
  ),
}));

jest.mock("../lib/valkey", () => ({
  getValkey: jest.fn().mockReturnValue({
    status: "wait",
    connect: jest.fn().mockRejectedValue(new Error("Connection refused")),
    ping: jest.fn().mockRejectedValue(new Error("Connection refused")),
  }),
}));

describe("health checks", () => {
  describe("checkPostgres", () => {
    it("returns false when PostgreSQL is not available", async () => {
      const result = await checkPostgres();
      expect(result).toBe(false);
    });
  });

  describe("checkValkey", () => {
    it("returns false when Valkey is not available", async () => {
      const result = await checkValkey();
      expect(result).toBe(false);
    });
  });
});
