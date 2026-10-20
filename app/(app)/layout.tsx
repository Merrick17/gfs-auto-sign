import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { auth, signOut } from "@/auth";
import { Sidebar, type ShellStatus } from "@/components/shell/sidebar";
import { ShellStateProvider } from "@/components/shell/shell-state";
import { TopBar } from "@/components/shell/top-bar";
import { brandAssets } from "@/lib/brand-assets";
import { connectionStatus } from "@/lib/connection";
import { folderCounts, FOLDERS } from "@/lib/mailbox-view";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

const LABEL: Record<ShellStatus["state"], string> = {
  connected: "Connected",
  connecting: "Connecting",
  attention: "Needs attention",
  disconnected: "Not connected",
};

const NO_COUNTS = Object.fromEntries(FOLDERS.map((f) => [f, 0])) as Awaited<ReturnType<typeof folderCounts>>;

// Proton-style shell: navigation on the tinted canvas at the left, the search bar across the top, and one white
// work surface below it. The window never scrolls; only the work surface (or its columns) do.
async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [status, counts] = await Promise.all([connectionStatus().catch(() => null), folderCounts().catch(() => NO_COUNTS)]);
  const state = status?.overall ?? "attention";
  const sidebar = { counts, status: { state, label: status ? LABEL[state] : "Unavailable" }, assets: brandAssets() };
  return (
    <ShellStateProvider>
      <div className="flex h-dvh overflow-hidden bg-secondary/70">
        <Suspense fallback={<div className="hidden w-[250px] shrink-0 lg:block" />}>
          <Sidebar {...sidebar} />
        </Suspense>
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={<div className="h-[60px] shrink-0" />}>
            <TopBar sidebar={sidebar} user={{ name: session.user.name, email: session.user.email }} signOut={signOutAction} />
          </Suspense>
          <main data-scroll className="relative flex min-h-0 flex-1 flex-col overflow-y-auto border-t bg-card shadow-panel lg:rounded-tl-lg lg:border-l">
            {children}
          </main>
        </div>
      </div>
    </ShellStateProvider>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading" className="min-h-dvh bg-background" />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
