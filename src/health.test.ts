import { checkPostgres, checkValkey, getValkeyClient } from "./health";

describe("health checks", () => {
  describe("checkPostgres", () => {
    it("returns false when PostgreSQL is not available", async () => {
      // With no PostgreSQL running, the check should return false (not throw)
      const result = await checkPostgres();
      expect(result).toBe(false);
    });
  });

  describe("checkValkey", () => {
    it("returns false when ValKey is not available", async () => {
      // With no ValKey running, the check should return false (not throw)
      const result = await checkValkey();
      expect(result).toBe(false);
    });
  });
});

afterAll(async () => {
  const client = await getValkeyClient();
  await client.quit();
});
