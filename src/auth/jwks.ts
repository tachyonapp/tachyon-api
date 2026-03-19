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
 */
const JWKS = createRemoteJWKSet(new URL(process.env.CLERK_JWKS_URL!), {
  cacheMaxAge: JWKS_CACHE_TTL_MS,
});

export interface VerifiedClaims {
  sub: string; // Clerk format: "user_xxx"
  email: string;
  publicMetadata?: {
    roles?: string[];
  };
  exp: number;
}

export async function verifyToken(token: string): Promise<VerifiedClaims> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: process.env.CLERK_ISSUER,
    // No audience claim — Clerk JWTs do not include aud by default.
    // If a JWT template with an audience is configured later, add it here.
  });

  return payload as unknown as VerifiedClaims;
}
