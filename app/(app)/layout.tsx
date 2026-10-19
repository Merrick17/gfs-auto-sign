import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth, signOut } from "@/auth";

async function Gate({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return (
    <>
      <header className="flex h-11 items-center gap-6 border-b border-line bg-surface px-4">
        <span className="font-semibold">GFS Contract Agent</span>
        <nav className="flex gap-4 text-muted">
          <Link href="/" className="hover:text-foreground">Contracts</Link>
          <Link href="/settings" className="hover:text-foreground">Settings</Link>
        </nav>
        <form
          className="ml-auto"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="text-muted hover:text-foreground">Sign out</button>
        </form>
      </header>
      <main className="flex-1 p-4">{children}</main>
    </>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={null}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}
