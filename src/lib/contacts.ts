import { Prisma } from "@/generated/prisma/client";
import { getDb } from "./db";
import { GraphError, graph } from "./graph";
import { grantedScopes } from "./graph-token";

// Contact index for recipient suggestions: names and addresses only, never message bodies.
// Suggestions are a convenience. They never authorise anybody to receive a contract: only the
// recipients the owner saves in a rule are ever copied.

export const normEmail = (e: string) => e.trim().toLowerCase();
const domainOf = (e: string) => e.split("@")[1] ?? "";
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Graph throttles bulk reads. Wait out a 429 a few times before giving up.
async function g<T>(path: string, init?: Parameters<typeof graph>[1]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await graph<T>(path, init);
    } catch (e) {
      if (e instanceof GraphError && e.status === 429 && attempt < 4) {
        await sleep(Math.min(e.retryAfterMs ?? 2000, 20_000));
        continue;
      }
      throw e;
    }
  }
}

type Row = { email: string; name: string; org?: string | null; source: string; outlookId?: string | null };

async function upsertContacts(rows: Row[]) {
  const byEmail = new Map<string, Row>();
  for (const r of rows) {
    const email = normEmail(r.email);
    if (!isEmail(email)) continue;
    const prev = byEmail.get(email);
    byEmail.set(email, { ...r, email, name: r.name || prev?.name || "", org: r.org ?? prev?.org });
  }
  const list = [...byEmail.values()];
  const db = getDb();
  for (let i = 0; i < list.length; i += 400) {
    const part = list.slice(i, i + 400);
    await db.$executeRaw(Prisma.sql`
      INSERT INTO "Contact" (id, email, "displayName", organization, domain, sources, "outlookContactId", "updatedAt")
      SELECT gen_random_uuid()::text, t.e, COALESCE(NULLIF(t.n, ''), t.e), NULLIF(t.o, ''), t.d, ARRAY[t.s]::text[], NULLIF(t.oid, ''), now()
      FROM unnest(${part.map((r) => r.email)}::text[], ${part.map((r) => r.name)}::text[], ${part.map((r) => r.org ?? "")}::text[],
                  ${part.map((r) => domainOf(r.email))}::text[], ${part.map((r) => r.source)}::text[], ${part.map((r) => r.outlookId ?? "")}::text[])
        AS t(e, n, o, d, s, oid)
      ON CONFLICT (email) DO UPDATE SET
        "displayName" = CASE WHEN (EXCLUDED.sources[1] = 'outlook-contact' AND EXCLUDED."displayName" <> EXCLUDED.email) OR "Contact"."displayName" = "Contact".email
                             THEN EXCLUDED."displayName" ELSE "Contact"."displayName" END,
        organization = COALESCE(EXCLUDED.organization, "Contact".organization),
        "outlookContactId" = COALESCE(EXCLUDED."outlookContactId", "Contact"."outlookContactId"),
        sources = (SELECT ARRAY(SELECT DISTINCT unnest("Contact".sources || EXCLUDED.sources))),
        "updatedAt" = now()`);
  }
  return list.length;
}

type OutlookContact = { id: string; displayName?: string; companyName?: string; emailAddresses?: { name?: string; address?: string }[] };
type Page<T> = { value: T[]; "@odata.nextLink"?: string };

export async function syncOutlookContacts(limit = 2000) {
  const rows: Row[] = [];
  let url: string | undefined = "/me/contacts?$select=id,displayName,companyName,emailAddresses&$top=100";
  while (url && rows.length < limit) {
    const page: Page<OutlookContact> = await g(url);
    for (const c of page.value)
      for (const e of c.emailAddresses ?? [])
        if (e.address) rows.push({ email: e.address, name: c.displayName || e.name || "", org: c.companyName, source: "outlook-contact", outlookId: c.id });
    url = page["@odata.nextLink"];
  }
  return upsertContacts(rows);
}

type SentMessage = {
  id: string;
  conversationId?: string;
  sentDateTime: string;
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  ccRecipients?: { emailAddress?: { name?: string; address?: string } }[];
};

const WATERMARK = "contactsSentWatermark";

// First run reads the newest `maxMessages`. Later runs read forward from the watermark, oldest first, so a backlog larger than
// one run is worked off over the next runs instead of leaving a gap. The filter is inclusive (`ge`) because Graph timestamps
// have one-second resolution; messages already stored are skipped as duplicates.
export async function syncSentItems(ownerEmail: string | null, maxMessages = 600) {
  const db = getDb();
  const mark = await db.appSetting.findUnique({ where: { key: WATERMARK } });
  const since = mark ? String(mark.value) : null;
  const filter = since ? `&$filter=${encodeURIComponent(`sentDateTime ge ${since}`)}` : "";
  const order = since ? "asc" : "desc";
  let url: string | undefined =
    `/me/mailFolders('SentItems')/messages?$select=id,conversationId,sentDateTime,toRecipients,ccRecipients&$orderby=sentDateTime ${order}&$top=100${filter}`;
  const owner = ownerEmail ? normEmail(ownerEmail) : "";
  const links: Prisma.SentRecipientCreateManyInput[] = [];
  const people: Row[] = [];
  let seen = 0;
  let newest: string | null = null;
  while (url && seen < maxMessages) {
    const page: Page<SentMessage> = await g(url);
    for (const m of page.value) {
      seen++;
      if (!newest || m.sentDateTime > newest) newest = m.sentDateTime;
      const to = (m.toRecipients ?? []).flatMap((r) => (r.emailAddress?.address ? [{ ...r.emailAddress, address: normEmail(r.emailAddress.address) }] : []));
      const cc = (m.ccRecipients ?? []).flatMap((r) => (r.emailAddress?.address ? [{ ...r.emailAddress, address: normEmail(r.emailAddress.address) }] : []));
      const toDomains = [...new Set(to.map((r) => domainOf(r.address)).filter(Boolean))];
      for (const [role, list] of [["to", to], ["cc", cc]] as const)
        for (const r of list) {
          if (r.address === owner) continue;
          people.push({ email: r.address, name: r.name && normEmail(r.name) !== r.address ? r.name : "", source: "sent" });
          links.push({ messageId: m.id, email: r.address, role, conversationId: m.conversationId, sentAt: new Date(m.sentDateTime), toDomains });
        }
    }
    url = page["@odata.nextLink"];
  }
  for (let i = 0; i < links.length; i += 500) await db.sentRecipient.createMany({ data: links.slice(i, i + 500), skipDuplicates: true });
  await upsertContacts(people);
  await db.$executeRaw(Prisma.sql`
    UPDATE "Contact" c SET "toCount" = s.t, "ccCount" = s.cc, "lastInteractionAt" = s.m, "updatedAt" = now()
    FROM (SELECT email, count(*) FILTER (WHERE role = 'to')::int t, count(*) FILTER (WHERE role = 'cc')::int cc, max("sentAt") m
          FROM "SentRecipient" GROUP BY email) s
    WHERE c.email = s.email`);
  if (newest) await db.appSetting.upsert({ where: { key: WATERMARK }, create: { key: WATERMARK, value: newest }, update: { value: newest } });
  return { messages: seen, recipients: links.length };
}

type PeopleHit = { resource?: { displayName?: string; scoredEmailAddresses?: { address?: string }[]; companyName?: string } };
type SearchResponse = { value?: { hitsContainers?: { hits?: PeopleHit[] }[] }[] };

// Microsoft Search people results (the supported replacement for relying on /me/people alone).
export async function searchPeople(query: string) {
  const res = await g<SearchResponse>("/search/query", {
    method: "POST",
    body: { requests: [{ entityTypes: ["person"], query: { queryString: query }, from: 0, size: 10 }] },
  });
  const rows: Row[] = [];
  for (const h of res.value?.[0]?.hitsContainers?.[0]?.hits ?? []) {
    const addr = h.resource?.scoredEmailAddresses?.[0]?.address;
    if (addr) rows.push({ email: addr, name: h.resource?.displayName ?? "", org: h.resource?.companyName, source: "directory" });
  }
  await upsertContacts(rows);
  return rows.length;
}

export async function syncContacts() {
  const db = getDb();
  const conn = await db.oAuthConnection.findFirst({ orderBy: { updatedAt: "desc" } });
  const scopes = await grantedScopes();
  const has = (s: string) => scopes.some((x) => x.toLowerCase() === s.toLowerCase());
  const result: { outlookContacts: number | "no-permission"; sent: number | "no-permission" } = { outlookContacts: "no-permission", sent: "no-permission" };
  if (has("Contacts.Read") || has("Contacts.ReadWrite")) result.outlookContacts = await syncOutlookContacts();
  if (has("Mail.Read") || has("Mail.ReadWrite")) result.sent = (await syncSentItems(conn?.accountEmail ?? null)).messages;
  await db.appSetting.upsert({
    where: { key: "contactsSyncedAt" },
    create: { key: "contactsSyncedAt", value: { at: new Date().toISOString(), ...result } },
    update: { value: { at: new Date().toISOString(), ...result } },
  });
  return result;
}

export async function indexStatus() {
  const db = getDb();
  const [contacts, synced] = await Promise.all([db.contact.count(), db.appSetting.findUnique({ where: { key: "contactsSyncedAt" } })]);
  const v = synced?.value as { at?: string; outlookContacts?: number | string; sent?: number | string } | undefined;
  return { contacts, syncedAt: v?.at ?? null, outlookContacts: v?.outlookContacts ?? null, sent: v?.sent ?? null };
}

export type ContactSuggestion = { email: string; name: string; organization: string | null };

// Offline fallback for suggestions when Microsoft Graph can't be reached.
export async function searchContacts(opts: { query?: string; exclude?: string[]; limit?: number }): Promise<ContactSuggestion[]> {
  const q = (opts.query ?? "").trim();
  const exclude = (opts.exclude ?? []).map(normEmail);
  const where: Prisma.ContactWhereInput = {
    ...(q ? { OR: ["displayName", "email", "organization", "domain"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) as Prisma.ContactWhereInput[] } : {}),
    ...(exclude.length ? { email: { notIn: exclude } } : {}),
  };
  const rows = await getDb().contact.findMany({ where, orderBy: [{ ccCount: "desc" }, { toCount: "desc" }, { displayName: "asc" }], take: opts.limit ?? 12 });
  return rows.map((c) => ({ email: c.email, name: c.displayName, organization: c.organization }));
}
