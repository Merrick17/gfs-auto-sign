import { getDb } from "./db";
import { requireEnv } from "./env";
import { open, seal } from "./secret-box";
import { GRAPH_SCOPES } from "./scopes";

export class AuthRequired extends Error {
  status = 401;
  retryAfterMs = null;
  retryable = false;
}

async function persist(userOid: string, refreshToken: string, scope?: string, account?: { email?: string; name?: string }) {
  const sealed = seal(Buffer.from(refreshToken)).toString("base64");
  await getDb().oAuthConnection.upsert({
    where: { userOid },
    create: { userOid, refreshToken: sealed, scope, accountEmail: account?.email, accountName: account?.name },
    update: { refreshToken: sealed, scope, ...(account?.email ? { accountEmail: account.email } : {}), ...(account?.name ? { accountName: account.name } : {}) },
  });
}

let cached: { token: string; exp: number } | null = null;
let inflight: Promise<string> | null = null;
// Bumped on every new sign-in so a refresh that started before it can neither fill the cache nor overwrite the new refresh token.
let generation = 0;

export async function storeRefreshToken(userOid: string, refreshToken: string, scope?: string, account?: { email?: string; name?: string }) {
  generation++;
  cached = null;
  inflight = null;
  await persist(userOid, refreshToken, scope, account);
}

// What Microsoft actually granted to the current access token (the `scp` claim), never an assumption.
// If the token is not a readable JWT, the scopes reported when the owner signed in are used instead.
export async function grantedScopes(): Promise<string[]> {
  const token = await accessToken();
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { scp?: string };
    return (claims.scp ?? "").split(" ").filter(Boolean);
  } catch {
    const conn = await getDb().oAuthConnection.findFirst({ orderBy: { updatedAt: "desc" } });
    return (conn?.scope ?? "")
      .split(/\s+/)
      .map((s) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, ""))
      .filter(Boolean);
  }
}

// Refresh-token grant for the owner. Failures that need a human (revoked or expired sign-in) are not retried.
// Concurrent callers share one request: refresh tokens rotate, so parallel grants would race each other.
export function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return Promise.resolve(cached.token);
  if (inflight) return inflight;
  const p = refresh().finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}

async function refresh(): Promise<string> {
  const gen = generation;
  const db = getDb();
  const conn = await db.oAuthConnection.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!conn) throw new AuthRequired("No Microsoft sign-in stored: the owner must sign in once.");

  const res = await fetch(`https://login.microsoftonline.com/${requireEnv("AZURE_TENANT_ID")}/oauth2/v2.0/token`, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
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
  if (gen === generation) {
    if (j.refresh_token) await persist(conn.userOid, j.refresh_token, j.scope);
    cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  }
  return j.access_token;
}
