import { after } from "next/server";
import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { indexStatus, syncContacts } from "@/lib/contacts";
import { storeRefreshToken } from "@/lib/graph-token";
import { SIGN_IN_SCOPES } from "@/lib/scopes";
import { ensureSubscription } from "@/lib/subscriptions";

// Work that must never delay or break sign-in: it runs after the response where Next.js allows it.
function background(job: () => Promise<unknown>) {
  const run = () => job().catch(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}

const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

// Sign-in is limited to the owner’s accounts: OWNER_OBJECT_ID and OWNER_EMAILS take comma-separated lists.
// The mailbox watched is the one of the account that signed in last.
function isOwner(profile: { oid?: string; email?: string; preferred_username?: string } | undefined) {
  if (!profile) return false;
  if (profile.oid && list(process.env.OWNER_OBJECT_ID).includes(profile.oid.toLowerCase())) return true;
  const mail = (profile.email ?? profile.preferred_username ?? "").toLowerCase();
  return Boolean(mail) && list(process.env.OWNER_EMAILS).includes(mail);
}
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
      authorization: { params: { scope: SIGN_IN_SCOPES, prompt: "select_account" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 8 * 3600 },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile, account }) {
      const oid = (profile as { oid?: string } | undefined)?.oid;
      if (!oid || !isOwner(profile as { oid?: string; email?: string; preferred_username?: string })) return false;
      // Keep the owner's delegated refresh token so background tasks can call Graph without a browser session.
      if (account?.refresh_token) {
        const p = profile as { name?: string; email?: string; preferred_username?: string };
        await storeRefreshToken(oid, account.refresh_token, account.scope, { email: p.email ?? p.preferred_username, name: p.name });
        // The owner never manages these: start watching the inbox and build the contact index once.
        background(async () => {
          await ensureSubscription().catch(() => undefined);
          if (!(await indexStatus()).syncedAt) await syncContacts();
        });
      }
      return true;
    },
  },
});

export async function requireOwner() {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");
  return session;
}
