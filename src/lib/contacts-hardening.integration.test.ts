import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@/generated/prisma/client";
import { migrationSql, seedOAuth } from "./test-db";

process.env.AZURE_TENANT_ID = "t";
process.env.AZURE_CLIENT_ID = "c";
process.env.AZURE_CLIENT_SECRET = "s";
process.env.CERT_ENCRYPTION_KEY = randomBytes(32).toString("base64");

let pg: PGlite;
let db: PrismaClient;
let contacts: typeof import("./contacts");

type Msg = { id: string; sentDateTime: string; to: string };
let sent: Msg[] = [];
let outlookContacts: unknown[] = [];

const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json" } });

// Behaves like Graph for the one query shape this app sends: optional `sentDateTime gt|ge X`, orderby sentDateTime, $top.
function sentPage(url: string) {
  const f = /sentDateTime (gt|ge) (\S+)/.exec(url);
  let rows = sent.filter((m) => !f || (f[1] === "gt" ? m.sentDateTime > f[2] : m.sentDateTime >= f[2]));
  rows = [...rows].sort((a, b) => a.sentDateTime.localeCompare(b.sentDateTime));
  if (/orderby=sentDateTime desc/.test(url)) rows.reverse();
  const skip = Number(/skip=(\d+)/.exec(url)?.[1] ?? 0);
  const top = 2;
  const page = rows.slice(skip, skip + top).map((m) => ({ id: m.id, sentDateTime: m.sentDateTime, toRecipients: [{ emailAddress: { address: m.to, name: "" } }], ccRecipients: [] }));
  const more = skip + top < rows.length;
  const base = url.replace(/&?skip=\d+/, "");
  return { value: page, ...(more ? { "@odata.nextLink": `${base}${base.includes("?") ? "&" : "?"}skip=${skip + top}` } : {}) };
}

before(async () => {
  pg = new PGlite();
  await pg.exec(migrationSql());
  db = new PrismaClient({ adapter: new PrismaPGlite(pg) });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
  await seedOAuth(db);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = decodeURIComponent(String(input instanceof Request ? input.url : input));
    if (url.includes("oauth2/v2.0/token")) {
      const claims = Buffer.from(JSON.stringify({ scp: "Mail.Read Contacts.Read" })).toString("base64url");
      return json({ access_token: `h.${claims}.s`, expires_in: 3600 });
    }
    if (url.includes("/me/contacts")) return json({ value: outlookContacts });
    if (url.includes("mailFolders('SentItems')/messages")) return json(sentPage(url));
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  contacts = await import("./contacts");
});

after(async () => {
  await db.$disconnect();
  await pg.close();
});

test("an Outlook contact without a name does not replace a real name learned from sent mail with the bare address", async () => {
  sent = [{ id: "n1", sentDateTime: "2026-01-01T10:00:00Z", to: "named@x.test" }];
  const sentRow = [{ emailAddress: { address: "named@x.test", name: "Nina Named" } }];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (decodeURIComponent(url).includes("mailFolders('SentItems')/messages"))
      return json({ value: [{ id: "n1", sentDateTime: "2026-01-01T10:00:00Z", toRecipients: sentRow, ccRecipients: [] }] });
    return real(input, init);
  }) as typeof fetch;
  await contacts.syncSentItems(null);
  globalThis.fetch = real;
  outlookContacts = [{ id: "oc9", emailAddresses: [{ address: "named@x.test" }] }];
  await contacts.syncOutlookContacts();
  const row = await db.contact.findUniqueOrThrow({ where: { email: "named@x.test" } });
  assert.equal(row.displayName, "Nina Named");
  await db.appSetting.deleteMany({ where: { key: "contactsSentWatermark" } });
});

test("a message sent in the same second as the watermark but read later is still picked up", async () => {
  await db.sentRecipient.deleteMany();
  sent = [{ id: "a1", sentDateTime: "2026-02-01T10:00:00Z", to: "first@x.test" }];
  await contacts.syncSentItems(null);
  sent.push({ id: "a2", sentDateTime: "2026-02-01T10:00:00Z", to: "second@x.test" });
  await contacts.syncSentItems(null);
  const got = (await db.sentRecipient.findMany()).map((r) => r.email).sort();
  assert.deepEqual(got, ["first@x.test", "second@x.test"]);
});

test("when more mail arrived since the last run than one run reads, the next runs continue where it stopped instead of skipping the gap", async () => {
  await db.sentRecipient.deleteMany();
  await db.appSetting.deleteMany({ where: { key: "contactsSentWatermark" } });
  sent = [{ id: "b0", sentDateTime: "2026-03-01T00:00:00Z", to: "p0@x.test" }];
  await contacts.syncSentItems(null, 10);
  sent = [
    ...sent,
    ...Array.from({ length: 6 }, (_, i) => ({ id: `b${i + 1}`, sentDateTime: `2026-03-0${i + 2}T00:00:00Z`, to: `p${i + 1}@x.test` })),
  ];
  for (let run = 0; run < 8; run++) await contacts.syncSentItems(null, 2);
  const got = (await db.sentRecipient.findMany()).map((r) => r.email).sort();
  assert.deepEqual(got, ["p0", "p1", "p2", "p3", "p4", "p5", "p6"].map((p) => `${p}@x.test`));
});
