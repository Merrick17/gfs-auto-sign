import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";
import { migrationSql, seedOAuth } from "./test-db";
import { open } from "./secret-box";

process.env.AZURE_TENANT_ID = "t";
process.env.AZURE_CLIENT_ID = "c";
process.env.AZURE_CLIENT_SECRET = "s";

let pg: PGlite;
let db: PrismaClient;
let tokenMod: typeof import("./graph-token");
const bodies: URLSearchParams[] = [];
let mode: "ok" | "revoked" | "down" = "ok";

before(async () => {
  pg = new PGlite();
  await pg.exec(migrationSql());
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  await seedOAuth(db);
  globalThis.fetch = (async (_u: string | URL | Request, init?: RequestInit) => {
    bodies.push(new URLSearchParams(String(init?.body)));
    if (mode === "revoked") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    if (mode === "down") return new Response("{}", { status: 503 });
    return new Response(JSON.stringify({ access_token: "at-1", expires_in: 3600, refresh_token: "rotated-rt", scope: "Mail.ReadWrite" }));
  }) as typeof fetch;
  tokenMod = await import("./graph-token");
});

after(async () => {
  await db.$disconnect();
  await pg.close();
});

test("refresh grant requests only mail/files scopes (never Mail.Send) and rotates the stored token sealed", async () => {
  const t = await tokenMod.accessToken();
  assert.equal(t, "at-1");
  const b = bodies[0];
  assert.equal(b.get("grant_type"), "refresh_token");
  assert.equal(b.get("refresh_token"), "test-refresh-token");
  assert.ok(!b.get("scope")!.includes("Mail.Send"));
  assert.match(b.get("scope")!, /Mail\.ReadWrite/);
  const row = await db.oAuthConnection.findFirstOrThrow();
  assert.ok(!row.refreshToken.includes("rotated-rt"), "stored sealed, not plaintext");
  assert.equal(open(Buffer.from(row.refreshToken, "base64")).toString(), "rotated-rt");
});

test("the access token is cached between calls", async () => {
  const n = bodies.length;
  await tokenMod.accessToken();
  assert.equal(bodies.length, n);
});

test("a revoked sign-in raises a non-retryable AuthRequired; a Microsoft outage stays retryable", async () => {
  const mod = await import("./graph-token");
  // expire the cache by reloading with a fresh module instance
  const fresh = (await import(`./graph-token?x=${Date.now()}`)) as typeof mod;
  mode = "revoked";
  await assert.rejects(fresh.accessToken(), (e: unknown) => e instanceof fresh.AuthRequired && e.retryable === false);
  mode = "down";
  await assert.rejects(fresh.accessToken(), (e: unknown) => !(e instanceof fresh.AuthRequired) && (e as { status?: number }).status === 503);
});
