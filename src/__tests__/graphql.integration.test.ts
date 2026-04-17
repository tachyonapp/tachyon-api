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
import { getValkey } from "../lib/valkey";

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
  // Flush stale rate-limit keys left by previous runs so IP-based limits don't bleed across runs.
  const rlKeys = await getValkey().keys("rl:*");
  if (rlKeys.length > 0) await getValkey().del(...rlKeys);

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
  // Close any BullMQ queues instantiated during the test run — each holds its own ioredis connection.
  // Import the specific accessors so only already-created singletons are closed; avoid
  // triggering lazy initialization of queues the tests never touched.
  const { getScanBotQueue, getReconciliationQueue } = await import("../queues");
  await Promise.all(
    [getScanBotQueue(), getReconciliationQueue()].map((q) => q.close()),
  );
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
    const { token } = await generateTestJwt({
      sub: "auth0|integration-1",
      email: "integration1@test.com",
    });
    const res = await authedRequest(token).send(
      gql("query { me { id email } }"),
    );

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.me.email).toBe("integration1@test.com");
    expect(res.body.data.me.id).toBeDefined();
  });

  it("provisions the user on first login (idempotent on retry)", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|integration-idempotent",
      email: "idempotent@test.com",
    });

    // Two concurrent requests for the same new user should not throw
    const [res1, res2] = await Promise.all([
      authedRequest(token).send(gql("query { me { id } }")),
      authedRequest(token).send(gql("query { me { id } }")),
    ]);

    expect(res1.body.data.me.id).toBe(res2.body.data.me.id);
  });

  it("bots query returns an empty array for a new user", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|integration-2",
      email: "integration2@test.com",
    });
    const res = await authedRequest(token).send(
      gql("query { bots { id name } }"),
    );

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.bots).toEqual([]);
  });

  it("account query returns null for a user with no broker connection", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|integration-3",
      email: "integration3@test.com",
    });
    const res = await authedRequest(token).send(
      gql("query { account { id providerName status } }"),
    );

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.account).toBeNull();
  });

  it("connectBroker returns NOT_IMPLEMENTED stub", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|integration-4",
      email: "integration4@test.com",
    });
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

// ─── createBot mutations ──────────────────────────────────────────────────────

const CREATE_BOT_MUTATION = `
  mutation CreateBot($input: CreateBotInput!) {
    createBot(input: $input) {
      ... on Bot {
        id
        name
        status
        allocationPct
        brain { brainType modelId provider keyPreview }
      }
      ... on ValidationError {
        field
        code
        message
      }
    }
  }
`;

// Minimal valid input for a SCOUT/TACHYON_HOSTED bot
const validScoutInput = {
  name: "TestScout",
  frameName: "SCOUT",
  avatarId: "1",
  colorway: "#2C6BED",
  allocationPct: "0.1",
  riskAttitude: "BALANCED",
  tradeTempo: "ACTIVE",
  combatPatience: "CALCULATED",
  marketAwareness: {
    momentum: 0.75,
    meanReversion: 0.15,
    volatility: 0.45,
    trendFollowing: 0.75,
  },
  sectors: ["TECH"],
  exitPersonality: { name: "BALANCED" },
  stopLossStyle: { name: "FLEXIBLE" },
  dailyMaxLossPct: "0.1",
  emotionalControls: {
    freezeAfterLosses: null,
    cooldownAfterVolatility: false,
    standDownAfterNoonIfLosing: false,
  },
  rulesOfEngagement: {
    overnightHoldAllowed: false,
    noSameDayExitUnlessStopLoss: false,
  },
  brain: { brainType: "TACHYON_HOSTED", modelId: "claude-haiku-4-5-20251001" },
};

describe("POST /graphql — createBot mutations", () => {
  beforeAll(async () => {
    // Seed reference data required by the createBot resolver.
    // Uses ON CONFLICT DO NOTHING so repeated runs are safe.
    const { getDb } = await import("../lib/db");
    const db = getDb();

    await db
      .insertInto("bot_avatars")
      .values([{ img: "https://assets.tachyon.app/avatars/default.png" }])
      .execute()
      .catch(() => {
        /* avatar id=1 likely already seeded */
      });

    await db
      .insertInto("bot_frames")
      .values([
        {
          name: "SCOUT",
          description: "Momentum Confirmation",
          is_active: true,
        },
        { name: "SNIPER", description: "Breakout Trading", is_active: true },
        { name: "GUARDIAN", description: "Mean Reversion", is_active: true },
        { name: "BRUISER", description: "Trend Following", is_active: true },
        {
          name: "BERSERKER",
          description: "Volatility Trading",
          is_active: true,
        },
        { name: "BRAWLER", description: "Swing Trading", is_active: true },
      ])
      .onConflict((oc) => oc.column("name").doNothing())
      .execute();

    await db
      .insertInto("exit_personalities")
      .values([
        { name: "QUICK_FINISHER", description: "Fast exit", is_active: true },
        { name: "BALANCED", description: "Balanced exit", is_active: true },
        { name: "PATIENT", description: "Patient exit", is_active: true },
      ])
      .onConflict((oc) => oc.column("name").doNothing())
      .execute();

    await db
      .insertInto("stop_styles")
      .values([
        { name: "HARD", description: "Hard stop", is_active: true },
        { name: "FLEXIBLE", description: "Flexible stop", is_active: true },
        { name: "ADAPTIVE", description: "Adaptive stop", is_active: true },
      ])
      .onConflict((oc) => oc.column("name").doNothing())
      .execute();
  });

  afterEach(async () => {
    // Clear rate limit keys so each test starts fresh
    const valkey = getValkey();
    const keys = await valkey.keys("rate:op:*");
    if (keys.length > 0) await valkey.del(...keys);

    // Delete bots for all test users to prevent allocation accumulating across runs.
    // Cascade handles bot_settings, bot_brain_configs, etc.
    const { getDb } = await import("../lib/db");
    const db = getDb();
    await db
      .deleteFrom("bots")
      .where(
        "user_id",
        "in",
        db
          .selectFrom("users")
          .select("id")
          .where("email", "like", "%@test.com"),
      )
      .execute();
  });

  it("happy path: creates TACHYON_HOSTED bot and returns ACTIVE status", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|createbot-happy-1",
      email: "createbot-happy-1@test.com",
    });

    // Provision user
    await authedRequest(token).send(gql("query { me { id } }"));

    const res = await authedRequest(token).send(
      gql(CREATE_BOT_MUTATION, { input: validScoutInput }),
    );
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();

    const bot = res.body.data.createBot;
    expect(bot.status).toBe("ACTIVE");
    expect(bot.name).toBe("TestScout");
    expect(bot.brain.brainType).toBe("TACHYON_HOSTED");
    expect(bot.brain.keyPreview).toBeNull();
  });

  it("returns TOO_LONG when bot name exceeds 24 characters", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|createbot-namelen-1",
      email: "createbot-namelen-1@test.com",
    });
    await authedRequest(token).send(gql("query { me { id } }"));

    const res = await authedRequest(token).send(
      gql(CREATE_BOT_MUTATION, {
        input: { ...validScoutInput, name: "A".repeat(25) },
      }),
    );

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.createBot.code).toBe("TOO_LONG");
    expect(res.body.data.createBot.field).toBe("name");
  });

  it("returns OUT_OF_BOUNDS when frame bounds are violated (GUARDIAN + AGGRESSIVE riskAttitude)", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|createbot-bounds-1",
      email: "createbot-bounds-1@test.com",
    });
    await authedRequest(token).send(gql("query { me { id } }"));

    const invalidGuardianInput = {
      ...validScoutInput,
      frameName: "GUARDIAN",
      riskAttitude: "AGGRESSIVE", // GUARDIAN forbids AGGRESSIVE
      tradeTempo: "OPPORTUNISTIC",
      combatPatience: "PATIENT",
      marketAwareness: {
        momentum: 0.15,
        meanReversion: 0.8,
        volatility: 0.2,
        trendFollowing: 0.2,
      },
      dailyMaxLossPct: "0.05",
    };

    const res = await authedRequest(token).send(
      gql(CREATE_BOT_MUTATION, { input: invalidGuardianInput }),
    );

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.createBot.code).toBe("OUT_OF_BOUNDS");
    expect(res.body.data.createBot.field).toBe("riskAttitude");
  });

  it("returns ALLOCATION_CEILING_EXCEEDED when total allocation would exceed 100%", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|createbot-alloc-1",
      email: "createbot-alloc-1@test.com",
    });
    await authedRequest(token).send(gql("query { me { id } }"));

    // SNIPER frame allows up to 60% allocation — use it so the first bot passes frame bounds.
    // Create first bot consuming 60% allocation
    await authedRequest(token).send(
      gql(CREATE_BOT_MUTATION, {
        input: {
          ...validScoutInput,
          frameName: "SNIPER",
          name: "AllocBot1",
          allocationPct: "0.6",
          tradeTempo: "OPPORTUNISTIC",
        },
      }),
    );

    // Second bot requesting 50% would push total to 110%
    const res = await authedRequest(token).send(
      gql(CREATE_BOT_MUTATION, {
        input: {
          ...validScoutInput,
          frameName: "SNIPER",
          name: "AllocBot2",
          allocationPct: "0.5",
          tradeTempo: "OPPORTUNISTIC",
        },
      }),
    );

    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.createBot.code).toBe("ALLOCATION_CEILING_EXCEEDED");
    expect(res.body.data.createBot.field).toBe("allocationPct");
  });

  it("returns BYOK_KEY_INVALID when BYOK API key fails provider validation", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
    } as Response);

    try {
      const { token } = await generateTestJwt({
        sub: "auth0|createbot-byok-1",
        email: "createbot-byok-1@test.com",
      });
      await authedRequest(token).send(gql("query { me { id } }"));

      const byokInput = {
        ...validScoutInput,
        brain: {
          brainType: "BYOK",
          modelId: "claude-sonnet-4-6",
          provider: "anthropic",
          apiKey: "sk-invalid-key",
        },
      };

      const res = await authedRequest(token).send(
        gql(CREATE_BOT_MUTATION, { input: byokInput }),
      );

      expect(res.body.errors).toBeUndefined();
      expect(res.body.data.createBot.code).toBe("BYOK_KEY_INVALID");
      expect(res.body.data.createBot.field).toBe("brain.apiKey");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("idempotency: returns existing DRAFT bot when same name created within 60 seconds", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|createbot-idem-1",
      email: "createbot-idem-1@test.com",
    });
    await authedRequest(token).send(gql("query { me { id } }"));

    // Insert a DRAFT bot directly in the DB to simulate an in-flight creation
    const { getDb } = await import("../lib/db");
    const db = getDb();

    const user = await db
      .selectFrom("users")
      .select("id")
      .where("auth0_subject", "=", "auth0|createbot-idem-1")
      .executeTakeFirstOrThrow();

    // Clean up any DRAFT bots from previous runs so the idempotency window is unambiguous.
    await db
      .deleteFrom("bots")
      .where("user_id", "=", user.id)
      .where("name", "=", "IdempotentBot")
      .where("status", "=", "DRAFT")
      .execute();

    const frameRow = await db
      .selectFrom("bot_frames")
      .select("id")
      .where("name", "=", "SCOUT")
      .executeTakeFirstOrThrow();

    const avatarRow = await db
      .selectFrom("bot_avatars")
      .select("id")
      .orderBy("id", "asc")
      .executeTakeFirstOrThrow();

    const [draftBot] = await db
      .insertInto("bots")
      .values({
        user_id: user.id,
        frame_id: frameRow.id,
        avatar_id: avatarRow.id,
        name: "IdempotentBot",
        colorway: "#2C6BED",
        allocation_pct: "0.1",
        status: "DRAFT",
      })
      .returning(["id", "name", "status"])
      .execute();

    // Now try to create via GraphQL — should return the existing DRAFT
    const res = await authedRequest(token).send(
      gql(CREATE_BOT_MUTATION, {
        input: { ...validScoutInput, name: "IdempotentBot" },
      }),
    );

    expect(res.body.errors).toBeUndefined();
    const result = res.body.data.createBot;
    // Returns Bot (has status field), not ValidationError
    expect(result.status).toBe("DRAFT");
    expect(result.name).toBe("IdempotentBot");
    expect(result.id).toBe(String(draftBot!.id));
  });

  it("happy path: creates BERSERKER bot using frame defaults", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|createbot-berserker-1",
      email: "createbot-berserker-1@test.com",
    });
    await authedRequest(token).send(gql("query { me { id } }"));

    const berserkerInput = {
      name: "RageBerserker",
      frameName: "BERSERKER",
      avatarId: "1",
      colorway: "#D64545",
      allocationPct: "0.15",
      riskAttitude: "AGGRESSIVE",
      tradeTempo: "RELENTLESS",
      combatPatience: "IMPULSIVE",
      marketAwareness: {
        momentum: 0.7,
        meanReversion: 0.1,
        volatility: 0.85,
        trendFollowing: 0.5,
      },
      sectors: ["TECH"],
      exitPersonality: { name: "QUICK_FINISHER" },
      stopLossStyle: { name: "ADAPTIVE" },
      dailyMaxLossPct: "0.15",
      emotionalControls: {
        freezeAfterLosses: null,
        cooldownAfterVolatility: false,
        standDownAfterNoonIfLosing: false,
      },
      rulesOfEngagement: {
        overnightHoldAllowed: false,
        noSameDayExitUnlessStopLoss: false,
      },
      brain: {
        brainType: "TACHYON_HOSTED",
        modelId: "claude-haiku-4-5-20251001",
      },
    };

    const res = await authedRequest(token).send(
      gql(CREATE_BOT_MUTATION, { input: berserkerInput }),
    );
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();

    const bot = res.body.data.createBot;
    expect(bot.status).toBe("ACTIVE");
    expect(bot.name).toBe("RageBerserker");
    expect(bot.allocationPct).toBe("0.15");
  });

  it("zero-balance user: creates bot successfully (no USD balance check)", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|createbot-zerobal-1",
      email: "createbot-zerobal-1@test.com",
    });

    // Provision user but do not set up any cash account — user has $0 balance
    await authedRequest(token).send(gql("query { me { id } }"));

    const res = await authedRequest(token).send(
      gql(CREATE_BOT_MUTATION, {
        input: { ...validScoutInput, name: "ZeroBalBot" },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.createBot.status).toBe("ACTIVE");
  });
});

// ─── Per-operation rate limiting ──────────────────────────────────────────────

describe("POST /graphql — per-operation rate limiting", () => {
  // Each test uses a unique sub so rate limit state never bleeds between tests.
  // afterEach flushes all rate:op: keys from Valkey as a belt-and-suspenders guard.
  afterEach(async () => {
    const valkey = getValkey();
    const keys = await valkey.keys("rate:op:*");
    if (keys.length > 0) await valkey.del(...keys);
  });

  it("allows the first 10 approveProposal calls and blocks the 11th with RATE_LIMITED", async () => {
    const { token } = await generateTestJwt({
      sub: "auth0|rl-approve-1",
      email: "rl-approve-1@test.com",
    });

    const mutation = `
      mutation ApproveProposal($id: ID!) {
        approveProposal(id: $id) {
          ... on Proposal { id }
          ... on NotFoundError { message }
          ... on AuthError { message }
        }
      }
    `;

    // Calls 1–10: withOpRateLimit passes; resolver returns NotFoundError because
    // proposal id 999999 does not exist — but no RATE_LIMITED error in the response.
    for (let i = 1; i <= 10; i++) {
      const res = await authedRequest(token).send(
        gql(mutation, { id: "999999" }),
      );
      expect(res.status).toBe(200);
      const errors: Array<{ extensions?: { code?: string } }> =
        res.body.errors ?? [];
      expect(errors.some((e) => e?.extensions?.code === "RATE_LIMITED")).toBe(
        false,
      );
    }

    // Call 11: withOpRateLimit throws — Apollo returns RATE_LIMITED in errors array,
    // HTTP status remains 200 (not 429).
    const res11 = await authedRequest(token).send(
      gql(mutation, { id: "999999" }),
    );
    expect(res11.status).toBe(200);
    expect(res11.body.errors).toBeDefined();

    const rateLimitError = res11.body.errors.find(
      (e: { extensions?: { code?: string } }) =>
        e?.extensions?.code === "RATE_LIMITED",
    );
    expect(rateLimitError).toBeDefined();
    expect(typeof rateLimitError.extensions.retryAfter).toBe("number");
    expect(rateLimitError.extensions.operation).toBe("approveProposal");
  });

  it("rate limits are per-user — a second user is unaffected by the first user's limit exhaustion", async () => {
    const { token: tokenA } = await generateTestJwt({
      sub: "auth0|rl-isolation-a",
      email: "rl-isolation-a@test.com",
    });
    const { token: tokenB } = await generateTestJwt({
      sub: "auth0|rl-isolation-b",
      email: "rl-isolation-b@test.com",
    });

    const mutation = `
      mutation ApproveProposal($id: ID!) {
        approveProposal(id: $id) {
          ... on Proposal { id }
          ... on NotFoundError { message }
          ... on AuthError { message }
        }
      }
    `;

    // Exhaust User A's 10-call limit
    for (let i = 0; i < 10; i++) {
      await authedRequest(tokenA).send(gql(mutation, { id: "999999" }));
    }

    // Confirm User A is now rate-limited
    const resA = await authedRequest(tokenA).send(
      gql(mutation, { id: "999999" }),
    );
    expect(
      resA.body.errors?.some(
        (e: { extensions?: { code?: string } }) =>
          e?.extensions?.code === "RATE_LIMITED",
      ),
    ).toBe(true);

    // User B's first call must not be rate-limited — their window is independent
    const resB = await authedRequest(tokenB).send(
      gql(mutation, { id: "999999" }),
    );
    expect(resB.status).toBe(200);
    expect(
      resB.body.errors?.some(
        (e: { extensions?: { code?: string } }) =>
          e?.extensions?.code === "RATE_LIMITED",
      ) ?? false,
    ).toBe(false);
  });
});
