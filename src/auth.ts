import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { storeRefreshToken } from "@/lib/graph-token";
import { SIGN_IN_SCOPES } from "@/lib/scopes";

// Single-owner application: sign-in is refused for anyone but the configured owner.
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
      if (!oid || !process.env.OWNER_OBJECT_ID || oid !== process.env.OWNER_OBJECT_ID) return false;
      // Keep the owner's delegated refresh token so background tasks can call Graph without a browser session.
      if (account?.refresh_token) {
        const p = profile as { name?: string; email?: string; preferred_username?: string };
        await storeRefreshToken(oid, account.refresh_token, account.scope, { email: p.email ?? p.preferred_username, name: p.name });
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
