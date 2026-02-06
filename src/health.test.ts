import { checkPostgres, checkRedis, getRedisClient } from "./health";

describe("health checks", () => {
  describe("checkPostgres", () => {
    it("returns false when PostgreSQL is not available", async () => {
      // With no PostgreSQL running, the check should return false (not throw)
      const result = await checkPostgres();
      expect(result).toBe(false);
    });
  });

  describe("checkRedis", () => {
    it("returns false when Redis is not available", async () => {
      // With no Redis running, the check should return false (not throw)
      const result = await checkRedis();
      expect(result).toBe(false);
    });
  });
});

afterAll(async () => {
  const client = await getRedisClient();
  await client.quit();
});
