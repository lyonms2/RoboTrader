import { createRemoteJWKSet, jwtVerify } from "jose";

// Verifica o token de login do Firebase sem o firebase-admin/auth: o jwks-rsa usado por ele faz require() do
// jose (so ESM) e quebra no runtime da Vercel (ERR_REQUIRE_ESM). Regras oficiais:
// https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export async function verifyIdToken(token: string): Promise<{ email?: string; email_verified?: boolean; uid: string }> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("NEXT_PUBLIC_FIREBASE_PROJECT_ID nao configurada");
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ["RS256"],
  });
  if (!payload.sub) throw new Error("token sem usuario");
  if (typeof payload.auth_time === "number" && payload.auth_time * 1000 > Date.now() + 60_000) {
    throw new Error("auth_time no futuro");
  }
  return { uid: payload.sub, email: payload.email as string | undefined, email_verified: payload.email_verified as boolean | undefined };
}
