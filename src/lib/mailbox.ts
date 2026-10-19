import { getDb } from "./db";

// The monitored mailbox is the signed-in owner's own. MAILBOX_ID only serves as a fallback label.
export async function mailboxKey(): Promise<string> {
  const conn = await getDb().oAuthConnection.findFirst({ orderBy: { updatedAt: "desc" } });
  return conn?.accountEmail?.toLowerCase() || process.env.MAILBOX_ID || "me";
}
