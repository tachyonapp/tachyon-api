import { checkPostgres, checkValkey } from "../health";

jest.mock("pg", () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: jest.fn().mockRejectedValue(new Error("Connection refused")),
    })),
  };
});

jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => ({
    status: "wait",
    connect: jest.fn().mockRejectedValue(new Error("Connection refused")),
    ping: jest.fn().mockRejectedValue(new Error("Connection refused")),
    quit: jest.fn().mockResolvedValue("OK"),
  }));
});

describe("health checks", () => {
  describe("checkPostgres", () => {
    it("returns false when PostgreSQL is not available", async () => {
      const result = await checkPostgres();
      expect(result).toBe(false);
    });
  });

  describe("checkValkey", () => {
    it("returns false when ValKey is not available", async () => {
      const result = await checkValkey();
      expect(result).toBe(false);
    });
  });
});
