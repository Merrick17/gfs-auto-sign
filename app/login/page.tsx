import type { Metadata } from "next";
import { Suspense } from "react";
import { signIn } from "@/auth";
import { FileText, MailCheck, PenLine, TriangleAlert } from "@/components/icons";
import { Brand } from "@/components/shell/brand";
import { brandAssets } from "@/lib/brand-assets";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Sign in" };

async function SignInNotice({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { error } = await searchParams;
  if (!error) return null;
  const denied = error === "AccessDenied";
  return (
    <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-sm border border-warning/30 bg-warning-soft px-3 py-2.5 text-dense">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <div>
        <p className="font-medium">{denied ? "This account can't use GFS Contract Agent." : "Sign-in didn't work."}</p>
        <p className="text-muted-foreground">{denied ? "Sign in with the Microsoft account that owns this workspace." : "Please try again."}</p>
      </div>
    </div>
  );
}

export default function Login(props: PageProps<"/login">) {
  return (
    <main className="grid min-h-dvh place-items-center bg-secondary/35 px-4 py-8 sm:px-8">
      <div className="animate-appear grid w-full max-w-[1040px] overflow-hidden rounded-xl border bg-card shadow-raised md:min-h-[520px] md:grid-cols-[1.15fr_0.85fr]">
        <section className="relative flex flex-col justify-between overflow-hidden bg-secondary/45 p-7 sm:p-10 lg:p-14">
          <div className="relative z-10">
            <Brand assets={brandAssets()} />
            <h1 className="mt-12 max-w-lg text-[32px] font-semibold leading-tight tracking-[-0.03em] sm:text-[40px]">From inbox to ready-to-send.</h1>
            <p className="mt-4 max-w-lg text-[15px] leading-6 text-muted-foreground">GFS finds incoming PDF contracts, prepares the signature, and leaves the reply in Outlook Drafts for you to review.</p>
          </div>
          <ol className="relative z-10 mt-10 grid gap-3 sm:grid-cols-3 md:mt-14 md:grid-cols-1 lg:grid-cols-3">
            {[
              { label: "PDF arrives", Icon: FileText },
              { label: "PDF signed", Icon: PenLine },
              { label: "Draft saved", Icon: MailCheck },
            ].map(({ label, Icon }, index) => (
              <li key={label} className="flex items-center gap-3 rounded-lg border bg-card/80 px-3 py-3 md:max-w-[280px] lg:max-w-none">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary-soft text-primary"><Icon className="size-4" aria-hidden="true" /></span>
                <span className="min-w-0">
                  <span className="block text-meta text-muted-foreground">{index === 0 ? "Incoming" : index === 1 ? "Review" : "In Outlook"}</span>
                  <span className="block text-dense font-medium">{label}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex items-center p-7 sm:p-10 lg:p-12">
          <div className="w-full">
            <h2 className="text-page">Sign in</h2>
            <p className="mt-2 mb-6 text-dense text-muted-foreground">Continue with the Microsoft 365 account connected to this workspace.</p>
            <Suspense fallback={null}>
              <SignInNotice searchParams={props.searchParams} />
            </Suspense>
            <form
              action={async () => {
                "use server";
                await signIn("microsoft-entra-id", { redirectTo: "/" });
              }}
            >
              <Button type="submit" size="lg" className="w-full">
                Sign in with Microsoft 365
              </Button>
            </form>
            <p className="mt-5 text-meta leading-5 text-muted-foreground">Your documents stay in your workspace. GFS saves drafts for you to review and never sends them automatically.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
