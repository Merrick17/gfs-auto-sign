import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import OpenAI from "openai";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";
import { migrationSql } from "./test-db";

let pg: PGlite;
let db: PrismaClient;
let mod: typeof import("./pipeline");
let graphMod: typeof import("./graph");
let tokenMod: typeof import("./graph-token");
let n = 0;

const contract = (status = "RECEIVED") =>
  db.contract.create({
    data: { mailboxId: "m", graphMessageId: `g${++n}`, attachmentId: "a", attachmentName: "SC-1.pdf", contentHash: `h${n}`, status },
  });

before(async () => {
  pg = new PGlite();
  await pg.exec(migrationSql());
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  mod = await import("./pipeline");
  graphMod = await import("./graph");
  tokenMod = await import("./graph-token");
});

after(async () => {
  await db.$disconnect();
  await pg.close();
});

test("markFailed sets FAILED with a short plain-English reason and audits only the error class", async () => {
  const c = await contract();
  await mod.markFailed(c.id, new Error("secret contract text: Total EUR 12,000 Bearer abc.def.ghi"));
  const row = await db.contract.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(row.status, "FAILED");
  assert.equal(row.exception, "Something went wrong while processing this document. Retry to continue.");
  const ev = await db.auditEvent.findFirstOrThrow({ where: { contractId: c.id, action: "failed" } });
  assert.deepEqual(ev.data, { error: "Error" });
  assert.ok(!JSON.stringify(ev).includes("secret"));
});

test("failure reasons are derived from the error type and never from its message", () => {
  const leak = "token=eyJabc /me/messages/AAMk-secret";
  assert.equal(mod.failureReason(new tokenMod.AuthRequired(leak)), "Your Microsoft 365 sign-in expired. Reconnect in Settings, then retry.");
  assert.equal(mod.failureReason(new graphMod.GraphError(503, null, leak)), "Microsoft 365 was unavailable. Retry in a few minutes.");
  assert.equal(mod.failureReason(new graphMod.GraphError(429, 1000, leak)), "Microsoft 365 was unavailable. Retry in a few minutes.");
  assert.equal(mod.failureReason(new graphMod.GraphError(403, null, leak)), "Microsoft 365 didn't allow access. Reconnect in Settings, then retry.");
  assert.equal(mod.failureReason(new OpenAI.APIConnectionError({ message: leak })), "Reading the document failed. Retry, or place the signature yourself.");
  assert.equal(mod.failureReason(Object.assign(new Error(leak), { name: "TimeoutError" })), "Processing took too long. Retry to continue.");
  assert.equal(mod.failureReason({ code: "MAX_DURATION_EXCEEDED" }), "Processing took too long. Retry to continue.");
  assert.equal(mod.failureReason("a string"), "Something went wrong while processing this document. Retry to continue.");
  for (const e of [new tokenMod.AuthRequired(leak), new graphMod.GraphError(500, null, leak), new Error(leak)])
    assert.ok(!mod.failureReason(e).includes("secret") && !mod.failureReason(e).includes("token="));
});

test("markFailed records the class name of a typed error", async () => {
  const c = await contract();
  await mod.markFailed(c.id, new tokenMod.AuthRequired("Microsoft sign-in is no longer valid (invalid_grant)"));
  const row = await db.contract.findUniqueOrThrow({ where: { id: c.id } });
  assert.equal(row.exception, "Your Microsoft 365 sign-in expired. Reconnect in Settings, then retry.");
  const ev = await db.auditEvent.findFirstOrThrow({ where: { contractId: c.id, action: "failed" } });
  assert.deepEqual(ev.data, { error: "AuthRequired" });
});

test("markFailed leaves a finished, skipped or waiting document alone, and never throws", async () => {
  for (const status of ["DRAFT_SAVED", "SKIPPED", "NEEDS_ATTENTION"]) {
    const c = await contract(status);
    await mod.markFailed(c.id, new Error("late failure"));
    assert.equal((await db.contract.findUniqueOrThrow({ where: { id: c.id } })).status, status);
    assert.equal(await db.auditEvent.count({ where: { contractId: c.id, action: "failed" } }), 0);
  }
  await assert.doesNotReject(mod.markFailed("does-not-exist", new Error("x")));
});
