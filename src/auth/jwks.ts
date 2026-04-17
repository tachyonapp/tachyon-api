import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS_CACHE_TTL_MS =
  parseInt(process.env.CLERK_JWKS_CACHE_TTL ?? "600", 10) * 1000;

/**
 * `jose` RemoteJWKSet — handles JWKS fetching, in-memory caching, and automatic key rotation.
 * `jose` uses RS256 (asymmetric) by default — symmetric algorithms are rejected, preventing
 * algorithm confusion attacks.
 *
 * `createRemoteJWKSet` automatically fetches a new key when a token presents an unknown `kid` —
 * no service restart needed on Clerk key rotation.
 *
 * Lazy-initialized so module load does not throw when CLERK_JWKS_URL is absent
 * (e.g. during jest.requireActual in test mocks or schema export scripts).
 */
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!_jwks) {
    const url = process.env.CLERK_JWKS_URL;
    if (!url) throw new Error("CLERK_JWKS_URL is not set");
    _jwks = createRemoteJWKSet(new URL(url), {
      cacheMaxAge: JWKS_CACHE_TTL_MS,
    });
  }
  return _jwks;
}

export interface VerifiedClaims {
  sub: string; // Clerk format: "user_xxx"
  email: string;
  publicMetadata?: {
    roles?: string[];
  };
  exp: number;
}

export async function verifyToken(token: string): Promise<VerifiedClaims> {
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: process.env.CLERK_ISSUER,
    // No audience claim — Clerk JWTs do not include aud by default.
    // If a JWT template with an audience is configured later, add it here.
  });

  return payload as unknown as VerifiedClaims;
}
