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
  process.env.AUTH0_DOMAIN = "test.auth0.com";
  process.env.AUTH0_AUDIENCE = "https://api.tachyon.app";
  ({ verifyToken } = await import("../jwks"));
});

describe("verifyToken", () => {
  it("returns VerifiedClaims when jose resolves a valid payload", async () => {
    const mockPayload = {
      sub: "auth0|123",
      email: "user@example.com",
      "https://tachyon.app/roles": ["trader"],
      aud: "https://api.tachyon.app",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    mockJwtVerify.mockResolvedValue({ payload: mockPayload });

    const claims = await verifyToken("valid.jwt.token");

    expect(claims.sub).toBe("auth0|123");
    expect(claims.email).toBe("user@example.com");
    expect(claims["https://tachyon.app/roles"]).toEqual(["trader"]);
  });

  it("throws when jose rejects (expired token)", async () => {
    mockJwtVerify.mockRejectedValue(new Error("jwt expired"));

    await expect(verifyToken("expired.jwt.token")).rejects.toThrow("jwt expired");
  });

  it("throws when jose rejects (wrong audience)", async () => {
    mockJwtVerify.mockRejectedValue(new Error("unexpected \"aud\" claim value"));

    await expect(verifyToken("wrong-aud.token")).rejects.toThrow("unexpected");
  });

  it("calls jwtVerify with the correct audience and issuer from env", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "auth0|123",
        email: "u@example.com",
        aud: "https://api.tachyon.app",
        exp: 9999999999,
      },
    });

    await verifyToken("some.jwt.token");

    expect(mockJwtVerify).toHaveBeenCalledWith(
      "some.jwt.token",
      "mock-jwks",
      expect.objectContaining({
        audience: "https://api.tachyon.app",
        issuer: "https://test.auth0.com/",
      }),
    );
  });
});
