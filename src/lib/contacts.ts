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
        "displayName" = CASE WHEN EXCLUDED.sources[1] = 'outlook-contact' OR "Contact"."displayName" = "Contact".email
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

// First run reads the newest `maxMessages`; later runs only read what was sent since the last run.
export async function syncSentItems(ownerEmail: string | null, maxMessages = 600) {
  const db = getDb();
  const mark = await db.appSetting.findUnique({ where: { key: WATERMARK } });
  const since = mark ? String(mark.value) : null;
  const filter = since ? `&$filter=${encodeURIComponent(`sentDateTime gt ${since}`)}` : "";
  let url: string | undefined =
    `/me/mailFolders('SentItems')/messages?$select=id,conversationId,sentDateTime,toRecipients,ccRecipients&$orderby=sentDateTime desc&$top=100${filter}`;
  const owner = ownerEmail ? normEmail(ownerEmail) : "";
  const links: Prisma.SentRecipientCreateManyInput[] = [];
  const people: Row[] = [];
  let seen = 0;
  let newest: string | null = null;
  while (url && seen < maxMessages) {
    const page: Page<SentMessage> = await g(url);
    for (const m of page.value) {
      seen++;
      newest ??= m.sentDateTime;
      const to = (m.toRecipients ?? []).flatMap((r) => (r.emailAddress?.address ? [{ ...r.emailAddress, address: normEmail(r.emailAddress.address) }] : []));
      const cc = (m.ccRecipients ?? []).flatMap((r) => (r.emailAddress?.address ? [{ ...r.emailAddress, address: normEmail(r.emailAddress.address) }] : []));
      const toDomains = [...new Set(to.map((r) => domainOf(r.address)).filter(Boolean))];
      for (const [role, list] of [["to", to], ["cc", cc]] as const)
        for (const r of list) {
          if (r.address === owner) continue;
          people.push({ email: r.address, name: r.name && r.name !== r.address ? r.name : "", source: "sent" });
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

export type ContactSuggestion = {
  email: string;
  name: string;
  organization: string | null;
  labels: string[];
  score: number;
};

// What the index knows about this customer: its email domains and the conversations its contracts arrived in.
async function customerLinks(customer: string) {
  const db = getDb();
  const [rules, contracts] = await Promise.all([
    db.signingRule.findMany({ where: { customerName: { equals: customer, mode: "insensitive" } }, select: { customerDomains: true } }),
    db.contract.findMany({ where: { customer: { equals: customer, mode: "insensitive" } }, select: { conversationId: true, senderAddress: true } }),
  ]);
  const domains = new Set<string>(rules.flatMap((r) => r.customerDomains.map((d) => d.toLowerCase())));
  for (const c of contracts) if (c.senderAddress) domains.add(domainOf(c.senderAddress));
  domains.delete("");
  const conversations = [...new Set(contracts.map((c) => c.conversationId).filter((x): x is string => Boolean(x)))];
  return { domains: [...domains], conversations };
}

export async function searchContacts(opts: { query?: string; customer?: string; exclude?: string[]; limit?: number }): Promise<ContactSuggestion[]> {
  const db = getDb();
  const q = (opts.query ?? "").trim();
  const exclude = new Set((opts.exclude ?? []).map(normEmail));
  const links = opts.customer ? await customerLinks(opts.customer) : { domains: [], conversations: [] };

  // Who was involved in correspondence with this customer, and in which role.
  const linked = new Map<string, { to: number; cc: number }>();
  if (links.domains.length || links.conversations.length) {
    const rows = await db.sentRecipient.findMany({
      where: { OR: [...(links.conversations.length ? [{ conversationId: { in: links.conversations } }] : []), ...(links.domains.length ? [{ toDomains: { hasSome: links.domains } }] : [])] },
      select: { email: true, role: true },
      take: 5000,
    });
    for (const r of rows) {
      const cur = linked.get(r.email) ?? { to: 0, cc: 0 };
      if (r.role === "cc") cur.cc++;
      else cur.to++;
      linked.set(r.email, cur);
    }
  }

  const textMatch: Prisma.ContactWhereInput = q
    ? { OR: ["displayName", "email", "organization", "domain"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) as Prisma.ContactWhereInput[] }
    : {};
  const [byText, byLink] = await Promise.all([
    db.contact.findMany({ where: textMatch, orderBy: [{ ccCount: "desc" }, { toCount: "desc" }], take: 60 }),
    q || linked.size === 0 && links.domains.length === 0
      ? Promise.resolve([])
      : db.contact.findMany({ where: { OR: [{ email: { in: [...linked.keys()] } }, ...(links.domains.length ? [{ domain: { in: links.domains } }] : [])] }, take: 60 }),
  ]);

  const seen = new Set<string>();
  const out: ContactSuggestion[] = [];
  for (const c of [...byLink, ...byText]) {
    if (seen.has(c.email) || exclude.has(c.email)) continue;
    seen.add(c.email);
    const l = linked.get(c.email);
    const labels: string[] = [];
    let score = 0;
    // For a CC picker, the people the owner has actually copied on this customer's mail come first.
    if (l && l.cc >= 2) {
      labels.push("Frequently copied for this customer");
      score += 1200 + l.cc;
    } else if (l && l.cc === 1) {
      labels.push("Copied once on this customer's emails");
      score += 900;
    }
    if (links.domains.includes(c.domain)) {
      labels.push("From this customer's company");
      score += 800;
    }
    if (l && l.to > 0 && !labels.length) {
      labels.push("Emailed about this customer");
      score += 500;
    }
    if (c.sources.includes("outlook-contact")) labels.push("Saved Outlook contact");
    if (c.toCount + c.ccCount > 0) labels.push("Previously emailed");
    if (c.sources.includes("directory")) labels.push("Company directory");
    score += Math.min(c.toCount + c.ccCount, 50) * 5;
    if (c.lastInteractionAt) score += Math.max(0, 30 - (Date.now() - c.lastInteractionAt.getTime()) / 86_400_000);
    out.push({ email: c.email, name: c.displayName, organization: c.organization, labels, score });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return out.slice(0, opts.limit ?? 12);
}
