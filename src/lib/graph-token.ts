import { getDb } from "./db";
import { requireEnv } from "./env";
import { open, seal } from "./secret-box";
import { GRAPH_SCOPES } from "./scopes";

export class AuthRequired extends Error {
  status = 401;
  retryAfterMs = null;
  retryable = false;
}

export async function storeRefreshToken(userOid: string, refreshToken: string, scope?: string, account?: { email?: string; name?: string }) {
  const sealed = seal(Buffer.from(refreshToken)).toString("base64");
  await getDb().oAuthConnection.upsert({
    where: { userOid },
    create: { userOid, refreshToken: sealed, scope, accountEmail: account?.email, accountName: account?.name },
    update: { refreshToken: sealed, scope, ...(account?.email ? { accountEmail: account.email } : {}), ...(account?.name ? { accountName: account.name } : {}) },
  });
  cached = null; // new sign-in: pick up the new permissions on the next call
}

// What Microsoft actually granted to the current access token (the `scp` claim), never an assumption.
export async function grantedScopes(): Promise<string[]> {
  const claims = JSON.parse(Buffer.from((await accessToken()).split(".")[1], "base64url").toString()) as { scp?: string };
  return (claims.scp ?? "").split(" ").filter(Boolean);
}

let cached: { token: string; exp: number } | null = null;

// Refresh-token grant for the owner. Failures that need a human (revoked or expired sign-in) are not retried.
export async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const db = getDb();
  const conn = await db.oAuthConnection.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!conn) throw new AuthRequired("No Microsoft sign-in stored: the owner must sign in once.");

  const res = await fetch(`https://login.microsoftonline.com/${requireEnv("AZURE_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: requireEnv("AZURE_CLIENT_ID"),
      client_secret: requireEnv("AZURE_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: open(Buffer.from(conn.refreshToken, "base64")).toString(),
      scope: GRAPH_SCOPES,
    }),
  });
  if (!res.ok) {
    const err = await res.json().then((j) => j?.error as string | undefined, () => undefined);
    if (res.status === 400 || res.status === 401) throw new AuthRequired(`Microsoft sign-in is no longer valid (${err ?? res.status}): the owner must sign in again.`);
    throw Object.assign(new Error(`token request failed: ${res.status}`), { status: res.status });
  }
  const j = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; scope?: string };
  if (j.refresh_token) await storeRefreshToken(conn.userOid, j.refresh_token, j.scope);
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}
