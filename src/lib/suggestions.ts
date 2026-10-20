import { getDb } from "./db";
import { graph, mailboxPath } from "./graph";
import { searchContacts } from "./contacts";

// Live sender and recipient suggestions read from the owner's mailbox through Microsoft Graph.
// Names and addresses only: message bodies are never requested. A suggestion never adds anyone to a
// draft by itself; only the recipients the owner saves in a sender rule are used.

export type Suggestion = { email: string; name: string; reason: string; score: number };

type Address = { emailAddress?: { name?: string; address?: string } };
type Msg = { from?: Address; toRecipients?: Address[]; ccRecipients?: Address[]; receivedDateTime?: string };
type Person = { displayName?: string; scoredEmailAddresses?: { address?: string }[] };

const norm = (e: string) => e.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// KQL inside a quoted $search value: no quotes, backslashes or control characters.
const kql = (s: string) => s.replace(/["\\\u0000-\u001f]/g, " ").trim().slice(0, 100);

// Short per-process cache: the rule editor asks the same questions while the owner types.
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, load: () => Promise<T>, ttl = 60_000): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return value;
}

async function ownerAddress() {
  const conn = await getDb().oAuthConnection.findFirst({ orderBy: { updatedAt: "desc" }, select: { accountEmail: true } });
  return conn?.accountEmail ? norm(conn.accountEmail) : "";
}

const searchMessages = (folder: "inbox" | "sent" | "all", query: string, top = 25) =>
  cached(`m:${folder}:${query}:${top}`, async () => {
    const base = folder === "sent" ? `${mailboxPath()}/mailFolders('SentItems')/messages` : folder === "inbox" ? `${mailboxPath()}/mailFolders('Inbox')/messages` : `${mailboxPath()}/messages`;
    const r = await graph<{ value: Msg[] }>(`${base}?$search=${encodeURIComponent(`"${query}"`)}&$select=from,toRecipients,ccRecipients,receivedDateTime&$top=${top}`);
    return r.value;
  });

const people = (query: string) =>
  cached(`p:${query}`, async () => {
    const r = await graph<{ value: Person[] }>(`${mailboxPath()}/people?$search=${encodeURIComponent(`"${query}"`)}&$select=displayName,scoredEmailAddresses&$top=10`);
    return r.value.flatMap((p) => {
      const a = p.scoredEmailAddresses?.[0]?.address;
      return a && EMAIL.test(a) ? [{ email: norm(a), name: p.displayName ?? "" }] : [];
    });
  });

class Ranked {
  private m = new Map<string, Suggestion>();
  constructor(private skip: Set<string>) {}
  add(a: Address | { email: string; name: string } | undefined, reason: string, score: number) {
    const email = norm("email" in (a ?? {}) ? (a as { email: string }).email : ((a as Address)?.emailAddress?.address ?? ""));
    if (!EMAIL.test(email) || this.skip.has(email)) return;
    const name = "email" in (a ?? {}) ? (a as { name: string }).name : ((a as Address)?.emailAddress?.name ?? "");
    const cur = this.m.get(email);
    if (cur) {
      cur.score += score / 4;
      if (!cur.name && name) cur.name = name;
      return;
    }
    this.m.set(email, { email, name: name && norm(name) !== email ? name : "", reason, score });
  }
  list(limit = 12) {
    return [...this.m.values()].sort((a, b) => b.score - a.score || a.email.localeCompare(b.email)).slice(0, limit);
  }
}

// Each source may fail on its own (missing permission, throttling); the others still count.
const settle = async <T>(p: Promise<T>, fallback: T) => {
  try {
    return await p;
  } catch {
    return fallback;
  }
};

// Senders for a new rule: who sent documents recently, plus anyone matching what the owner typed.
export async function suggestSenders(query: string): Promise<Suggestion[]> {
  const q = kql(query);
  const me = await ownerAddress();
  const r = new Ranked(new Set([me]));
  const known = await getDb().contract.groupBy({ by: ["senderAddress"], where: { senderAddress: { not: null } }, _count: true, orderBy: { _count: { senderAddress: "desc" } }, take: 20 });
  for (const k of known) if (!q || k.senderAddress!.includes(q.toLowerCase())) r.add({ email: k.senderAddress!, name: "" }, `Sent ${k._count} document${k._count === 1 ? "" : "s"}`, 500 + k._count * 10);

  const [recent, matches, ppl] = await Promise.all([
    q ? Promise.resolve([] as Msg[]) : settle(searchMessages("inbox", "hasattachments:true", 50), []),
    q.length >= 2 ? settle(searchMessages("inbox", `from:${q}`), []) : Promise.resolve([] as Msg[]),
    q.length >= 2 ? settle(people(q), []) : Promise.resolve([]),
  ]);
  for (const m of recent) r.add(m.from, "Recently sent you attachments", 300);
  for (const m of matches) r.add(m.from, "Emailed you", 250);
  for (const p of ppl) r.add(p, "From your Microsoft 365 people", 150);
  return r.list();
}

// Recipients for a sender: who you addressed or copied when replying to them, who they copy themselves,
// and people matching what was typed. `role` only changes which history ranks first.
export async function suggestRecipients(opts: { sender?: string; query?: string; role: "to" | "cc"; exclude?: string[] }): Promise<Suggestion[]> {
  const sender = opts.sender ? kql(norm(opts.sender).replace(/^@/, "")) : "";
  const q = kql(opts.query ?? "");
  const me = await ownerAddress();
  const r = new Ranked(new Set([me, ...(opts.exclude ?? []).map(norm)]));
  const ql = q.toLowerCase();
  const matches = (s: Suggestion | Address | { email: string; name: string } | undefined) => {
    if (!ql) return true;
    const a = s as { email?: string; name?: string } & Address;
    return [a.email, a.name, a.emailAddress?.address, a.emailAddress?.name].some((v) => v?.toLowerCase().includes(ql));
  };

  if (sender) {
    const [sent, received] = await Promise.all([settle(searchMessages("sent", `to:${sender}`), []), settle(searchMessages("all", `from:${sender}`), [])]);
    const mine = opts.role === "cc" ? 1000 : 900;
    for (const m of sent) {
      for (const a of m.toRecipients ?? []) if (matches(a)) r.add(a, "You emailed them when writing to this sender", opts.role === "to" ? mine + 100 : 600);
      for (const a of m.ccRecipients ?? []) if (matches(a)) r.add(a, "You copied them when writing to this sender", opts.role === "cc" ? mine + 100 : 600);
    }
    for (const m of received) {
      if (matches(m.from)) r.add(m.from, "This sender", opts.role === "to" ? 800 : 300);
      for (const a of [...(m.toRecipients ?? []), ...(m.ccRecipients ?? [])]) if (matches(a)) r.add(a, "On this sender's emails", 500);
    }
  }
  if (q.length >= 2) {
    const ppl = await settle(people(q), []);
    for (const p of ppl) r.add(p, "From your Microsoft 365 people", 200);
    // Offline fallback: the local index built from Outlook contacts and sent mail.
    if (r.list().length < 4) for (const c of await settle(searchContacts({ query: q, limit: 8 }), [])) r.add({ email: c.email, name: c.name }, "Previously emailed", 100);
  }
  return r.list();
}

// The people on the original email, for one-click "reply all" style choices on a document.
export async function originalParticipants(graphMessageId: string) {
  const m = await graph<Msg>(`${mailboxPath()}/messages/${encodeURIComponent(graphMessageId)}?$select=from,toRecipients,ccRecipients`);
  const me = await ownerAddress();
  const pick = (l: Address[] | undefined) =>
    (l ?? []).flatMap((a) => {
      const email = norm(a.emailAddress?.address ?? "");
      return EMAIL.test(email) && email !== me ? [{ email, name: a.emailAddress?.name ?? "" }] : [];
    });
  return { from: pick(m.from ? [m.from] : [])[0] ?? null, to: pick(m.toRecipients), cc: pick(m.ccRecipients) };
}
