/**
 * GraphQL Integration Tests
 *
 * These tests run against real PostgreSQL and Valkey. They require the
 * tachyon-infra docker-compose.test.yml stack to be running before execution.
 *
 * Start the test stack:
 *   cd ../tachyon-infra && docker compose -f docker-compose.test.yml up postgres-test valkey-test db-migrate-test
 *
 * Run tests:
 *   npm test -- --testPathPattern=graphql.integration
 */

import request from "supertest";
import type { Express } from "express";
import type { ApolloServer } from "@apollo/server";
import { getTestKeyPair, generateTestJwt } from "./helpers/jwt";
import { createLocalJWKSet, type JWK } from "jose";
import type { VerifiedClaims } from "../auth/jwks";

// ─── JWKS mock ────────────────────────────────────────────────────────────────
// Replace the remote JWKS fetch with our local test key pair so tests never
// hit Auth0. The mock must be in place before createApp() imports auth modules.

jest.mock("../auth/jwks", () => {
  const original = jest.requireActual("../auth/jwks");
  return {
    ...original,
    verifyToken: jest.fn(),
  };
});

import { verifyToken } from "../auth/jwks";
const mockVerifyToken = verifyToken as jest.MockedFunction<typeof verifyToken>;

// ─── App setup ────────────────────────────────────────────────────────────────

let app: Express;
let apolloServer: ApolloServer;

beforeAll(async () => {
  // Wire verifyToken to use the test key pair
  const { publicJwk } = await getTestKeyPair();
  const localJwks = createLocalJWKSet({
    keys: [publicJwk as unknown as JWK],
  });

  mockVerifyToken.mockImplementation(async (token) => {
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(token, localJwks, {
      audience: process.env.AUTH0_AUDIENCE ?? "https://api.tachyon.app",
      issuer: `https://${process.env.AUTH0_DOMAIN ?? "test.auth0.com"}/`,
    });
    return payload as unknown as VerifiedClaims;
  });

  const { createApp } = await import("../server");
  ({ app, apolloServer } = await createApp());
}, 30000);

afterAll(async () => {
  await apolloServer.stop();
  const { getDb } = await import("../lib/db");
  await getDb().destroy();
  const { getValkey } = await import("../lib/valkey");
  getValkey().disconnect();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gql(query: string, variables?: Record<string, unknown>) {
  return { query, variables };
}

// Synchronous — accepts a pre-generated token so the supertest chain is not
// accidentally resolved by an outer `await` before `.send()` is called.
function authedRequest(token: string) {
  return request(app)
    .post("/graphql")
    .set("Authorization", `Bearer ${token}`)
    .set("Content-Type", "application/json");
}

// ─── Health / readiness ───────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with healthy status when dependencies are up", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.checks.postgres).toBe("connected");
    expect(res.body.checks.valkey).toBe("connected");
  });
});

describe("GET /ready", () => {
  it("returns 200 when ready", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
  });
});

// ─── GraphQL — unauthenticated ────────────────────────────────────────────────

describe("POST /graphql — unauthenticated", () => {
  it("returns UNAUTHENTICATED for the me query", async () => {
    const res = await request(app)
      .post("/graphql")
      .set("Content-Type", "application/json")
      .send(gql("query { me { id email } }"));

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].extensions.code).toBe("UNAUTHENTICATED");
  });

  it("sets X-Correlation-ID on every response", async () => {
    const res = await request(app)
      .post("/graphql")
      .set("Content-Type", "application/json")
      .send(gql("query { me { id } }"));

    expect(res.headers["x-correlation-id"]).toBeDefined();
  });

  it("honours a client-provided X-Correlation-ID", async () => {
    const clientId = "my-trace-id-123";
    const res = await request(app)
      .post("/graphql")
      .set("Content-Type", "application/json")
      .set("X-Correlation-ID", clientId)
      .send(gql("query { me { id } }"));

    expect(res.headers["x-correlation-id"]).toBe(clientId);
  });
});

// ─── GraphQL — authenticated ──────────────────────────────────────────────────

describe("POST /graphql — authenticated", () => {
  it("me query returns the provisioned user", async () => {
    const { token } = await generateTestJwt({ sub: "auth0|integration-1", email: "integration1@test.com" });
    const res = await authedRequest(token).send(gql("query { me { id email } }"));

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.me.email).toBe("integration1@test.com");
    expect(res.body.data.me.id).toBeDefined();
  });

  it("provisions the user on first login (idempotent on retry)", async () => {
    const { token } = await generateTestJwt({ sub: "auth0|integration-idempotent", email: "idempotent@test.com" });

    // Two concurrent requests for the same new user should not throw
    const [res1, res2] = await Promise.all([
      authedRequest(token).send(gql("query { me { id } }")),
      authedRequest(token).send(gql("query { me { id } }")),
    ]);

    expect(res1.body.data.me.id).toBe(res2.body.data.me.id);
  });

  it("bots query returns an empty array for a new user", async () => {
    const { token } = await generateTestJwt({ sub: "auth0|integration-2", email: "integration2@test.com" });
    const res = await authedRequest(token).send(gql("query { bots { id name } }"));

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.bots).toEqual([]);
  });

  it("account query returns null for a user with no broker connection", async () => {
    const { token } = await generateTestJwt({ sub: "auth0|integration-3", email: "integration3@test.com" });
    const res = await authedRequest(token).send(gql("query { account { id providerName status } }"));

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.account).toBeNull();
  });

  it("connectBroker returns NOT_IMPLEMENTED stub", async () => {
    const { token } = await generateTestJwt({ sub: "auth0|integration-4", email: "integration4@test.com" });
    const res = await authedRequest(token).send(
      gql(
        `mutation { connectBroker(brokerName: "alpaca", credentials: "token") {
          ... on ValidationError { code message field }
        }}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.connectBroker.code).toBe("NOT_IMPLEMENTED");
  });
});

// ─── Rate limiting ────────────────────────────────────────────────────────────

describe("POST /graphql — rate limiting", () => {
  it("returns 429 after exceeding the unauthenticated limit", async () => {
    // Fire 21 requests without auth — limit is 20
    const responses = await Promise.all(
      Array.from({ length: 21 }, () =>
        request(app)
          .post("/graphql")
          .set("Content-Type", "application/json")
          .send(gql("query { __typename }")),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses).toContain(429);

    const blocked = responses.find((r) => r.status === 429);
    expect(blocked?.body.errors[0].extensions.code).toBe("RATE_LIMITED");
    expect(blocked?.headers["retry-after"]).toBeDefined();
  });
});
