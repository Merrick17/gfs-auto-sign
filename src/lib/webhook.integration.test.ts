import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { tasks } from "@trigger.dev/sdk";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";

// Real migration + real Prisma queries on an embedded Postgres; only Trigger.dev is stubbed.
let db: PrismaClient;
let pg: PGlite;
let POST: (r: Request) => Promise<Response>;
let dispatchEvent: (id: string) => Promise<boolean>;
const calls: { id: string; payload: unknown; key?: string }[] = [];
let triggerUp = true;

const URL_ = "http://app.test/api/webhooks/microsoft-graph";
const note = (over: Record<string, unknown> = {}) => ({
  subscriptionId: "sub-1", clientState: "secret", tenantId: "tenant-1", changeType: "created",
  resource: "users/x/messages/m1", resourceData: { id: "m1" }, ...over,
});
const send = (n: unknown[]) =>
  POST(new Request(URL_, { method: "POST", body: JSON.stringify({ value: n }), headers: { "content-type": "application/json" } }));

before(async () => {
  pg = new PGlite();
  await pg.exec(readFileSync("prisma/migrations/0001_init/migration.sql", "utf8"));
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;

  (tasks as unknown as { trigger: unknown }).trigger = async (id: string, payload: unknown, opts?: { idempotencyKey?: string }) => {
    if (!triggerUp) throw new Error("trigger.dev unavailable");
    calls.push({ id, payload, key: opts?.idempotencyKey });
    return { id: `run_${calls.length}` };
  };

  const mb = await db.mailboxConnection.create({ data: { mailboxId: "owner@gfs.test", tenantId: "tenant-1" } });
  await db.graphSubscription.create({
    data: { graphId: "sub-1", mailboxId: mb.id, resource: "r", clientState: "secret", expiresAt: new Date(Date.now() + 1e9) },
  });
  ({ POST } = await import("../../app/api/webhooks/microsoft-graph/route"));
  ({ dispatchEvent } = await import("./dispatch"));
});

test("validation handshake echoes the token", async () => {
  const r = await POST(new Request(`${URL_}?validationToken=a%20b`, { method: "POST" }));
  assert.equal(await r.text(), "a b");
});

test("valid notification is stored once and dispatched with an idempotency key", async () => {
  assert.equal((await send([note()])).status, 202);
  const rows = await db.incomingEvent.findMany();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dispatchStatus, "DISPATCHED");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "outlook-email-received");
  assert.equal(calls[0].key, `event:${rows[0].id}`);
});

test("duplicate delivery creates no second event or job", async () => {
  await send([note()]);
  await Promise.all([send([note()]), send([note()])]);
  assert.equal(await db.incomingEvent.count(), 1);
  assert.equal(calls.length, 1);
});

test("forged clientState, unknown subscription and wrong tenant are not stored", async () => {
  await send([note({ clientState: "nope", resourceData: { id: "m2" } })]);
  await send([note({ subscriptionId: "other", resourceData: { id: "m2" } })]);
  await send([note({ tenantId: "evil", resourceData: { id: "m2" } })]);
  assert.equal(await db.incomingEvent.count(), 1);
});

test("Trigger.dev outage keeps the event PENDING; the relay later dispatches it", async () => {
  triggerUp = false;
  assert.equal((await send([note({ resourceData: { id: "m3" } })])).status, 202);
  const pending = await db.incomingEvent.findFirstOrThrow({ where: { graphMessageId: "m3" } });
  assert.equal(pending.dispatchStatus, "PENDING");
  assert.equal(pending.attempts, 1);

  triggerUp = true;
  assert.equal(await dispatchEvent(pending.id), true);
  const after = await db.incomingEvent.findUniqueOrThrow({ where: { id: pending.id } });
  assert.equal(after.dispatchStatus, "DISPATCHED");
  assert.ok(after.triggerRunId);
});

test("Graph redelivery of a still-PENDING event re-dispatches it without duplicating the row", async () => {
  triggerUp = false;
  await send([note({ resourceData: { id: "m4" } })]);
  triggerUp = true;
  await send([note({ resourceData: { id: "m4" } })]);
  const rows = await db.incomingEvent.findMany({ where: { graphMessageId: "m4" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dispatchStatus, "DISPATCHED");
});

test("lifecycle notifications go to the lifecycle task", async () => {
  await send([{ subscriptionId: "sub-1", clientState: "secret", tenantId: "tenant-1", lifecycleEvent: "reauthorizationRequired" }]);
  assert.equal(calls.at(-1)?.id, "handle-subscription-lifecycle");
});

test("one contract per message, attachment and content hash", async () => {
  const mb = await db.mailboxConnection.findFirstOrThrow();
  const data = { mailboxId: mb.id, graphMessageId: "m1", attachmentId: "a1", attachmentName: "sc.pdf", contentHash: "h1" };
  await db.contract.create({ data });
  await assert.rejects(db.contract.create({ data }));
  await db.contract.create({ data: { ...data, contentHash: "h2" } }); // revised file is a distinct contract
  assert.equal(await db.contract.count(), 2);
});


after(async () => {
  await db.$disconnect();
  await pg.close();
});
