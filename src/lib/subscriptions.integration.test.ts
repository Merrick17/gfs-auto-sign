import { migrationSql, seedOAuth } from "./test-db";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { tasks } from "@trigger.dev/sdk";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";
import { messageDedupeKey } from "./graph-notifications";

process.env.MAILBOX_ID = "owner@gfs.test";
process.env.AZURE_TENANT_ID = "tenant-1";
process.env.AZURE_CLIENT_ID = "c";
process.env.AZURE_CLIENT_SECRET = "s";
process.env.APP_BASE_URL = "https://gfs.example";

let pg: PGlite;
let db: PrismaClient;
let sub: typeof import("./subscriptions");
let delta: typeof import("./delta");
const created: { body: Record<string, unknown> }[] = [];
const gone = new Set<string>();
const triggered: string[] = [];
let deltaCalls = 0;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

before(async () => {
  pg = new PGlite();
  await pg.exec(migrationSql());
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  await seedOAuth(db);
  (tasks as unknown as { trigger: unknown }).trigger = async (_id: string, p: { eventId: string }) => {
    triggered.push(p.eventId);
    return { id: `run_${triggered.length}` };
  };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? "GET";
    if (url.includes("oauth2/v2.0/token")) return json({ access_token: "t", expires_in: 3600 });
    if (method === "POST" && url.endsWith("/subscriptions")) {
      const body = JSON.parse(String(init?.body));
      created.push({ body });
      return json({ id: `sub-${created.length}`, expirationDateTime: body.expirationDateTime });
    }
    const patch = /\/subscriptions\/([^/?]+)$/.exec(url);
    if (method === "PATCH" && patch) {
      if (gone.has(patch[1])) return json({ error: { code: "ResourceNotFound" } }, 404);
      return json({ id: patch[1], expirationDateTime: JSON.parse(String(init?.body)).expirationDateTime });
    }
    if (url.includes("/messages/delta")) {
      deltaCalls++;
      if (url.includes("page2")) return json({ value: [{ id: "m2" }, { id: "m9", "@removed": { reason: "deleted" } }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/messages/delta?token=final" });
      if (url.includes("token=baseline")) return json({ value: [{ id: "m1" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/messages/delta?page2" });
      if (url.includes("token=final")) return json({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/messages/delta?token=final" });
      return json({ value: [{ id: "old1" }, { id: "old2" }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/messages/delta?token=baseline" });
    }
    return json({ error: { code: "unexpected", url } }, 500);
  }) as typeof fetch;

  sub = await import("./subscriptions");
  delta = await import("./delta");
});

after(async () => {
  await db.$disconnect();
  await pg.close();
});

test("subscription targets the Inbox 'created' event with HTTPS webhook, lifecycle URL and a strong clientState", async () => {
  const row = await sub.createSubscription();
  const b = created[0].body;
  assert.equal(b.changeType, "created");
  assert.match(String(b.resource), /mailFolders\('Inbox'\)\/messages$/);
  assert.equal(b.notificationUrl, "https://gfs.example/api/webhooks/microsoft-graph");
  assert.equal(b.lifecycleNotificationUrl, "https://gfs.example/api/webhooks/microsoft-graph");
  assert.ok(String(b.clientState).length >= 64);
  assert.equal(row.clientState, b.clientState);
  const minutes = (new Date(String(b.expirationDateTime)).getTime() - Date.now()) / 60_000;
  assert.ok(minutes > 4000 && minutes <= 4230, "within Graph's 4230-minute mail limit");
});

test("renewal extends the stored expiry", async () => {
  const s = await db.graphSubscription.findFirstOrThrow();
  await db.graphSubscription.update({ where: { id: s.id }, data: { expiresAt: new Date(Date.now() + 3600_000) } });
  assert.equal(await sub.renewSubscription(s.graphId), "renewed");
  const after_ = await db.graphSubscription.findUniqueOrThrow({ where: { id: s.id } });
  assert.ok(after_.expiresAt.getTime() > Date.now() + 4000 * 60_000);
});

test("a subscription Graph no longer knows is replaced, and the old one is marked removed", async () => {
  const old = await db.graphSubscription.findFirstOrThrow({ where: { status: "active" } });
  gone.add(old.graphId);
  assert.equal(await sub.renewSubscription(old.graphId), "recreated");
  assert.equal((await db.graphSubscription.findUniqueOrThrow({ where: { id: old.id } })).status, "removed");
  const active = await db.graphSubscription.findMany({ where: { status: "active" } });
  assert.equal(active.length, 1);
  assert.notEqual(active[0].graphId, old.graphId);
  assert.ok(inMinutes(0) < active[0].expiresAt.toISOString());
});

test("the first delta run only sets a baseline; old mail is not turned into events", async () => {
  const r = await delta.syncInboxDelta();
  assert.deepEqual(r, { baseline: true, recovered: 0 });
  assert.equal(await db.incomingEvent.count(), 0);
  assert.ok(await db.appSetting.findUnique({ where: { key: "inboxDeltaLink" } }));
});

test("after an outage, missed messages (across pages) are recovered, removed ones are skipped", async () => {
  const r = await delta.syncInboxDelta();
  assert.equal(r.recovered, 2);
  const events = await db.incomingEvent.findMany({ orderBy: { graphMessageId: "asc" } });
  assert.deepEqual(events.map((e) => e.graphMessageId), ["m1", "m2"]);
  assert.ok(events.every((e) => e.dispatchStatus === "DISPATCHED"));
  assert.equal(triggered.length, 2);
});

test("a message already accepted via webhook is not duplicated by recovery, and a re-run finds nothing", async () => {
  const mb = await db.mailboxConnection.findFirstOrThrow();
  await db.incomingEvent.create({
    data: { mailboxId: mb.id, dedupeKey: messageDedupeKey(mb.id, "m3"), kind: "message.created", graphMessageId: "m3", subscriptionId: "x", payload: {}, dispatchStatus: "DISPATCHED" },
  });
  const before_ = triggered.length;
  const r = await delta.syncInboxDelta();
  assert.equal(r.recovered, 0);
  assert.equal(triggered.length, before_);
  assert.ok(deltaCalls >= 4);
});
