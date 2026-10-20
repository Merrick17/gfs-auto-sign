import { getDb } from "./db";
import { AuthRequired, grantedScopes } from "./graph-token";

export type Health = "connected" | "connecting" | "attention" | "disconnected";
export type Part = { state: Health; message: string };

const publicUrl = () => (process.env.APP_BASE_URL ?? "").startsWith("https://");

export type ConnectionStatus = {
  overall: Health;
  account: { name: string | null; email: string | null } | null;
  outlook: Part;
  oneDrive: Part;
  contacts: Part;
  lastEmailAt: Date | null;
};

// Everything shown here comes from what Microsoft actually granted and what the database actually holds.
export async function connectionStatus(): Promise<ConnectionStatus> {
  const db = getDb();
  const conn = await db.oAuthConnection.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!conn)
    return {
      overall: "disconnected",
      account: null,
      outlook: { state: "disconnected", message: "Outlook isn't connected" },
      oneDrive: { state: "disconnected", message: "OneDrive isn't connected" },
      contacts: { state: "disconnected", message: "Connect Outlook to find people you email" },
      lastEmailAt: null,
    };

  let scopes: string[] = [];
  let expired = false;
  let unreachable = false;
  try {
    scopes = (await grantedScopes()).map((s) => s.toLowerCase());
  } catch (e) {
    expired = e instanceof AuthRequired;
    // A Microsoft outage must not break the settings page; it is reported as a temporary problem.
    unreachable = !expired;
  }
  const has = (...names: string[]) => names.some((n) => scopes.includes(n.toLowerCase()));
  const [sub, last] = await Promise.all([
    db.graphSubscription.findFirst({ where: { status: "active", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    db.incomingEvent.findFirst({ where: { kind: "message.created" }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
  ]);

  const expiredMsg: Part = unreachable
    ? { state: "attention", message: "We couldn't reach Microsoft just now. This usually clears up on its own." }
    : { state: "attention", message: "Your Microsoft sign-in has expired. Reconnect to keep documents coming in." };
  let outlook: Part;
  if (expired || unreachable) outlook = expiredMsg;
  else if (!has("Mail.ReadWrite")) outlook = { state: "attention", message: "Outlook access wasn't allowed. Reconnect and allow access to your mail." };
  else if (sub) outlook = { state: "connected", message: "Watching your inbox for emails with documents" };
  else if (!publicUrl()) outlook = { state: "attention", message: "Signed in, but new-mail alerts can't start until this app is published online." };
  else outlook = { state: "connecting", message: "Starting to watch your inbox…" };

  const oneDrive: Part = expired || unreachable
    ? expiredMsg
    : has("Files.ReadWrite", "Files.ReadWrite.All")
      ? { state: "connected", message: "Your signature and documents are kept in a private OneDrive folder" }
      : { state: "attention", message: "OneDrive access wasn't allowed. Reconnect and allow access to your files." };

  const contacts: Part = expired || unreachable
    ? expiredMsg
    : has("Contacts.Read", "Contacts.ReadWrite")
      ? { state: "connected", message: "Your contacts and people you email are used for recipient suggestions" }
      : { state: "attention", message: "Suggestions use your mail only. Reconnect and allow contacts to include your address book." };

  const parts = [outlook, oneDrive];
  const overall: Health = parts.some((p) => p.state === "attention") ? "attention" : parts.some((p) => p.state === "connecting") ? "connecting" : "connected";
  return {
    overall,
    account: { name: conn.accountName, email: conn.accountEmail },
    outlook,
    oneDrive,
    contacts,
    lastEmailAt: last?.receivedAt ?? null,
  };
}
