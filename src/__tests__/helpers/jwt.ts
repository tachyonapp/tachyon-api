import { SignJWT, generateKeyPair, exportJWK } from "jose";
import type { KeyLike } from "jose";

let testPrivateKey: KeyLike;
let testPublicKey: KeyLike;
let testPublicJwk: Record<string, unknown>;

export async function getTestKeyPair() {
  if (!testPrivateKey) {
    const kp = await generateKeyPair("RS256");
    testPrivateKey = kp.privateKey;
    testPublicKey = kp.publicKey;
    testPublicJwk = { ...(await exportJWK(testPublicKey)), kid: "test-key-1", alg: "RS256" };
  }
  return { privateKey: testPrivateKey, publicKey: testPublicKey, publicJwk: testPublicJwk };
}

export async function generateTestJwt(claims: {
  sub: string;
  email: string;
  roles?: string[];
}) {
  const { privateKey, publicJwk } = await getTestKeyPair();
  return {
    token: await new SignJWT({
      sub: claims.sub,
      email: claims.email,
      "https://tachyon.app/roles": claims.roles ?? [],
      aud: process.env.AUTH0_AUDIENCE ?? "https://api.tachyon.app",
    })
      .setProtectedHeader({ alg: "RS256", kid: (publicJwk as { kid: string }).kid })
      .setIssuer(`https://${process.env.AUTH0_DOMAIN ?? "test.auth0.com"}/`)
      .setExpirationTime("1h")
      .sign(privateKey),
    publicJwk,
  };
}
