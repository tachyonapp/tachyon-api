import type { verifyToken as VerifyTokenFn } from "../jwks";

const mockJwtVerify = jest.fn();

jest.mock("jose", () => ({
  jwtVerify: mockJwtVerify,
  createRemoteJWKSet: jest.fn().mockReturnValue("mock-jwks"),
}));

let verifyToken: typeof VerifyTokenFn;

beforeEach(async () => {
  jest.resetModules();
  mockJwtVerify.mockReset();
  process.env.CLERK_JWKS_URL =
    "https://test-clerk.clerk.accounts.dev/.well-known/jwks.json";
  process.env.CLERK_ISSUER = "https://test-clerk.clerk.accounts.dev";
  ({ verifyToken } = await import("../jwks"));
});

describe("verifyToken", () => {
  it("returns VerifiedClaims when jose resolves a valid payload", async () => {
    const mockPayload = {
      sub: "user_test123",
      email: "user@example.com",
      publicMetadata: { roles: ["trader"] },
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    mockJwtVerify.mockResolvedValue({ payload: mockPayload });

    const claims = await verifyToken("valid.jwt.token");

    expect(claims.sub).toBe("user_test123");
    expect(claims.publicMetadata?.roles).toEqual(["trader"]);
  });

  it("throws when jose rejects (expired token)", async () => {
    mockJwtVerify.mockRejectedValue(new Error("jwt expired"));

    await expect(verifyToken("expired.jwt.token")).rejects.toThrow(
      "jwt expired",
    );
  });

  it("throws when jose rejects (wrong audience)", async () => {
    mockJwtVerify.mockRejectedValue(new Error('unexpected "aud" claim value'));

    await expect(verifyToken("wrong-aud.token")).rejects.toThrow("unexpected");
  });

  it("calls jwtVerify with the correct audience and issuer from env", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "user_test123",
        email: "u@example.com",
        exp: 9999999999,
      },
    });

    await verifyToken("some.jwt.token");

    expect(mockJwtVerify).toHaveBeenCalledWith(
      "some.jwt.token",
      "mock-jwks",
      expect.objectContaining({
        issuer: "https://test-clerk.clerk.accounts.dev",
      }),
    );
  });
});
