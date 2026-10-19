import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Single-owner application: sign-in is refused for anyone but the configured owner.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/v2.0`,
    }),
  ],
  session: { strategy: "jwt", maxAge: 8 * 3600 },
  pages: { signIn: "/login" },
  callbacks: {
    signIn({ profile }) {
      const oid = (profile as { oid?: string } | undefined)?.oid;
      return Boolean(oid && process.env.OWNER_OBJECT_ID && oid === process.env.OWNER_OBJECT_ID);
    },
  },
});

export async function requireOwner() {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");
  return session;
}
