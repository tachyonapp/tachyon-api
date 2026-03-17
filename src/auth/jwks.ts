import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS_CACHE_TTL_MS =
  parseInt(process.env.AUTH0_JWKS_CACHE_TTL ?? "600", 10) * 1000;

/**
 * `jose` RemoteJWKSet — handles JWKS fetching, in-memory caching, and automatic key rotation
 * `jose` uses RS256 (asymmetric) by default — symmetric algorithms are rejected, preventing
 * algorithm confusion attacks.
 *
 * `createRemoteJWKSet` automatically fetches a new key when a token presents an unknown `kid`
 * no service restart needed on Auth0 key rotation.
 */
const JWKS = createRemoteJWKSet(
  new URL(`https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`),
  { cacheMaxAge: JWKS_CACHE_TTL_MS },
);

export interface VerifiedClaims {
  sub: string;
  email: string;
  "https://tachyon.app/roles"?: string[];
  aud: string | string[];
  exp: number;
}

export async function verifyToken(token: string): Promise<VerifiedClaims> {
  const { payload } = await jwtVerify(token, JWKS, {
    audience: process.env.AUTH0_AUDIENCE,
    issuer: `https://${process.env.AUTH0_DOMAIN}/`,
  });

  return payload as unknown as VerifiedClaims;
}
