import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  // Integration tests are excluded from `npm test` (require Docker stack).
  // Set INTEGRATION_TESTS=true to include them (used by `npm run test:integration`).
  testPathIgnorePatterns: process.env.INTEGRATION_TESTS
    ? ["<rootDir>/node_modules/"]
    : ["<rootDir>/node_modules/", "\\.integration\\.test\\.ts$"],
  setupFiles: ["<rootDir>/src/__tests__/setup/loadEnv.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts"],
};

export default config;
