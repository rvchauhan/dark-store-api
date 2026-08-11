/**
 * Minimal HS256 JWT helpers using node:crypto.
 *
 * Avoids `jose`'s Web Crypto global (`crypto.subtle`), which throws
 * `ReferenceError: crypto is not defined` under Node 18 + tsx.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function b64urlToJson<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

/** Staff (business_admin/store_manager/store_employee) claim shape. */
export type JwtClaims = {
  sub: string;
  // Present so requireAuth can defensively reject a customer token that
  // somehow reaches a staff-only route (and vice versa in requireCustomerAuth).
  type?: "staff" | "customer";
  business_id: string;
  role: string;
  store_id: string | null;
  email: string;
  name: string;
  iat: number;
  exp: number;
};

/**
 * Generic over the claim shape so non-staff tokens (e.g. customer auth,
 * which has no business_id/store_id) can reuse the same sign/verify logic
 * instead of duplicating the HMAC plumbing.
 */
export function signAccessToken<T extends Record<string, unknown>>(
  claims: T,
  secret: string,
  expiresInSeconds: number,
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ...claims,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const data = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifyAccessToken<T = JwtClaims>(
  token: string,
  secret: string,
): T & { iat: number; exp: number } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed token");
  }

  const [header, payload, signature] = parts;
  const data = `${header}.${payload}`;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new Error("Invalid signature");
  }

  const claims = b64urlToJson<T & { iat: number; exp: number }>(payload);
  if (claims.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }

  return claims;
}
