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
  // tachyon-queue-types exports map only has "import" (ESM) conditions; Jest's
  // CommonJS resolver can't match them and won't fall back to "main". Map both
  // entry points directly to the compiled CJS files.
  moduleNameMapper: {
    "^@tachyonapp/tachyon-queue-types/config$":
      "<rootDir>/node_modules/@tachyonapp/tachyon-queue-types/dist/config/index.js",
    "^@tachyonapp/tachyon-queue-types$":
      "<rootDir>/node_modules/@tachyonapp/tachyon-queue-types/dist/index.js",
  },
};

export default config;
