// Minimal HS256 JWT signer/verifier for the marketing-unsubscribe one-click
// link. Dependency-free (uses node:crypto only) — we don't need the full
// jsonwebtoken/jose surface for a single-purpose, single-claim token.
//
// Token shape:
//   header: { alg: "HS256", typ: "JWT" }
//   payload: { sub: <user_id uuid>, iat: <unix-seconds> }
// Signed with MARKETING_UNSUB_SECRET (a 32-byte random base64 string).
//
// We DO NOT include an `exp` claim — unsubscribe links live in old marketing
// emails and must keep working even years later. The link is single-purpose
// (always sets marketing_consent_at=NULL), so it's not security-sensitive in
// the way an auth token would be.

import { createHmac, timingSafeEqual } from "node:crypto";

function b64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  let padded = s.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4) padded += "=";
  return Buffer.from(padded, "base64");
}

export function signUnsubToken(userId: string, secret: string): string {
  const header = b64urlEncode(
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  );
  const payload = b64urlEncode(
    Buffer.from(JSON.stringify({ sub: userId, iat: Math.floor(Date.now() / 1000) }))
  );
  const data = `${header}.${payload}`;
  const sig = b64urlEncode(createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

export type UnsubClaims = { sub: string; iat: number };

export function verifyUnsubToken(token: string, secret: string): UnsubClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, s] = parts;
  const expected = b64urlEncode(
    createHmac("sha256", secret).update(`${h}.${p}`).digest()
  );
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("bad signature");
  }
  const claims = JSON.parse(b64urlDecode(p).toString("utf8")) as UnsubClaims;
  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("missing sub claim");
  }
  return claims;
}
