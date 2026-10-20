import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";
import { migrationSql, seedOAuth } from "./test-db";

process.env.AZURE_TENANT_ID = "t";
process.env.AZURE_CLIENT_ID = "c";
process.env.AZURE_CLIENT_SECRET = "s";

let pg: PGlite;
let db: PrismaClient;
let tokenRequests = 0;
const accessToken = "opaque-not-a-jwt";
let scope = "https://graph.microsoft.com/Mail.Read offline_access";

before(async () => {
  pg = new PGlite();
  await pg.exec(migrationSql());
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  await seedOAuth(db);
  globalThis.fetch = (async () => {
    tokenRequests++;
    await new Promise((r) => setTimeout(r, 30));
    return new Response(JSON.stringify({ access_token: accessToken, expires_in: 3600, refresh_token: `rt-${tokenRequests}`, scope }));
  }) as typeof fetch;
});

after(async () => {
  await db.$disconnect();
  await pg.close();
});

const fresh = (tag: string) => import(`./graph-token?${tag}`) as Promise<typeof import("./graph-token")>;

test("simultaneous callers share one token refresh instead of racing the rotating refresh token", async () => {
  const m = await fresh("concurrent");
  tokenRequests = 0;
  const all = await Promise.all([m.accessToken(), m.accessToken(), m.accessToken(), m.accessToken()]);
  assert.equal(tokenRequests, 1);
  assert.equal(new Set(all).size, 1);
});

test("a stored sign-in invalidates the cached token so new permissions are used", async () => {
  const m = await fresh("rescope");
  await m.accessToken();
  tokenRequests = 0;
  await m.storeRefreshToken("owner-oid", "new-refresh", "Mail.Read Contacts.Read");
  await m.accessToken();
  assert.equal(tokenRequests, 1);
});

test("a refresh that is in flight when the owner signs in again does not put the old token back in the cache", async () => {
  const m = await fresh("inflight");
  const slow = m.accessToken();
  await new Promise((r) => setTimeout(r, 5));
  await m.storeRefreshToken("owner-oid", "signed-in-again", "Mail.Read Contacts.Read");
  await slow;
  tokenRequests = 0;
  await m.accessToken();
  assert.equal(tokenRequests, 1, "next call must fetch with the new sign-in, not reuse the stale result");
});

test("grantedScopes falls back to the scopes Microsoft reported at sign-in when the access token is not a readable JWT", async () => {
  const m = await fresh("scopes");
  scope = "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Contacts.Read offline_access";
  await m.storeRefreshToken("owner-oid", "r", scope);
  const s = await m.grantedScopes();
  assert.ok(s.map((x) => x.toLowerCase()).includes("mail.readwrite"));
  assert.ok(s.map((x) => x.toLowerCase()).includes("contacts.read"));
});

test("the connection status reports a temporary Microsoft outage instead of failing", async () => {
  const { storeRefreshToken } = await import("./graph-token");
  await storeRefreshToken("owner-oid", "r2", "https://graph.microsoft.com/Mail.ReadWrite");
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    const { connectionStatus } = await import("./connection");
    const s = await connectionStatus();
    assert.equal(s.overall, "attention");
    assert.match(s.outlook.message, /couldn't reach Microsoft/);
  } finally {
    globalThis.fetch = real;
  }
});
