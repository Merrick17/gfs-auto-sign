import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { reconnectAction } from "@/actions";
import { RuleDialog } from "@/components/rules/rule-dialog";
import { AutoSignSwitch, DisconnectButton, DraftPreferences } from "@/components/settings/preferences";
import { SignatureCard } from "@/components/settings/signature-card";
import { SettingsNav } from "@/components/settings/settings-nav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { connectionStatus, type Part } from "@/lib/connection";
import { DEFAULT_MESSAGE } from "@/lib/drafts";
import { listRules } from "@/lib/sender-rules";
import { getDraftSettings, getSigningSettings } from "@/lib/settings";
import { getActiveSignatureImage } from "@/lib/signature-image";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 grid gap-4 border-b py-7 last:border-b-0 md:grid-cols-[190px_minmax(0,1fr)] md:gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <h2 id={`${id}-title`} className="text-section">{title}</h2>
        <p className="mt-1 max-w-sm text-dense text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

const DOT: Record<Part["state"], string> = { connected: "bg-success", connecting: "bg-primary", attention: "bg-warning-dot", disconnected: "bg-subtle" };

function Health({ label, part }: { label: string; part: Part }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[part.state])} />
      <div className="min-w-0">
        <p className="text-dense font-medium">{label}</p>
        <p className="text-meta text-muted-foreground">{part.message}</p>
      </div>
    </div>
  );
}

async function MicrosoftSection() {
  const s = await connectionStatus().catch(() => null);
  const connected = Boolean(s?.account);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 rounded-sm bg-secondary/60 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium">{connected ? "Connected" : "Not connected"}</p>
          <p className="truncate text-dense text-muted-foreground">
            {connected ? `as ${s?.account?.email ?? s?.account?.name}` : "Connect your Microsoft 365 account so emails with documents reach the inbox."}
          </p>
        </div>
        <form action={reconnectAction}>
          <Button type="submit" variant={connected ? "outline" : "default"}>
            {connected ? "Reconnect" : "Connect Microsoft 365"}
          </Button>
        </form>
        {connected && <DisconnectButton />}
      </div>
      {s && connected && (
        <div className="mt-2 divide-y px-1">
          <Health label="Outlook" part={s.outlook} />
          <Health label="OneDrive" part={s.oneDrive} />
          <Health label="Contacts" part={s.contacts} />
        </div>
      )}
    </div>
  );
}

async function SignatureSection() {
  const [image, signing] = await Promise.all([getActiveSignatureImage(), getSigningSettings()]);
  return (
    <div className="flex flex-col gap-6">
      <SignatureCard current={image ? { version: image.version, fileName: image.fileName, uploadedAt: image.createdAt.toISOString() } : null} />
      <div className="border-t pt-5">
        <h3 className="mb-3 text-dense font-medium">Automatic signing</h3>
        <AutoSignSwitch on={signing.autoSign} authorizedAt={signing.authorizedAt} hasImage={Boolean(image)} />
      </div>
    </div>
  );
}

async function RulesSection() {
  const rules = await listRules();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <p className="text-dense text-muted-foreground">
          {rules.length ? `${rules.length} rule${rules.length === 1 ? "" : "s"}` : "No rules yet. Without a rule, the draft replies to the sender."}
        </p>
        <div className="ml-auto">
          <RuleDialog rule={null} trigger="New rule" />
        </div>
      </div>
      {rules.length > 0 && (
        <div className="overflow-hidden rounded-sm border bg-card">
          <div className="hidden h-9 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_100px_96px] items-center gap-3 border-b bg-background/60 px-4 text-meta font-medium text-muted-foreground md:grid" aria-hidden="true">
            <span>Sender</span>
            <span>To</span>
            <span>CC</span>
            <span>Signing</span>
            <span />
          </div>
          <ul>
            {rules.map((r) => (
              <li key={r.id} className="grid gap-1 border-b px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_100px_96px] md:items-center md:gap-3 md:py-2.5">
                <span className="min-w-0 truncate text-dense font-medium" title={r.sender}>
                  {r.sender.startsWith("@") ? `Everyone at ${r.sender.slice(1)}` : r.sender}
                </span>
                <span className="min-w-0 truncate text-dense text-muted-foreground" title={r.to.join(", ")}>
                  <span className="md:hidden">To: </span>
                  {r.to.length ? r.to.join(", ") : "Reply to sender"}
                </span>
                <span className="min-w-0 truncate text-dense text-muted-foreground" title={r.cc.join(", ")}>
                  <span className="md:hidden">CC: </span>
                  {r.cc.length ? r.cc.join(", ") : "—"}
                </span>
                <span className="text-dense">
                  {r.autoSign ? <span className="font-medium text-primary">Automatic</span> : <span className="text-muted-foreground">Ask me</span>}
                </span>
                <span className="md:text-right">
                  <RuleDialog rule={{ id: r.id, sender: r.sender, to: r.to, cc: r.cc, autoSign: r.autoSign }} trigger="Edit" />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

async function DraftSection() {
  const d = await getDraftSettings();
  return <DraftPreferences message={d.message} cc={d.cc} placeholder={DEFAULT_MESSAGE} />;
}

const Loading = ({ h = 120 }: { h?: number }) => <Skeleton className="w-full" style={{ height: h }} />;

async function SettingsContent() {
  await connection();
  return (
    <div className="px-5 md:px-10">
      <div className="max-w-[880px]">
        <header className="border-b py-7">
          <h1 className="text-page">Settings</h1>
          <p className="mt-1 max-w-2xl text-dense text-muted-foreground">Manage the account, signature, and rules behind your document workflow.</p>
        </header>
        <Section id="microsoft" title="Microsoft 365" description="Your Outlook inbox is watched for emails with PDF attachments. Signed copies and your signature are kept in your OneDrive.">
          <Suspense fallback={<Loading />}>
            <MicrosoftSection />
          </Suspense>
        </Section>
        <Section id="signature" title="My signature" description="The image placed on documents. Stored in your OneDrive and only used where you or your rules allow.">
          <Suspense fallback={<Loading h={200} />}>
            <SignatureSection />
          </Suspense>
        </Section>
        <Section id="rules" title="Sender rules" description="For each sender or company: who the draft goes to, who is copied, and whether it may be signed automatically.">
          <Suspense fallback={<Loading />}>
            <RulesSection />
          </Suspense>
        </Section>
        <Section id="draft" title="Draft preferences" description="The message and the copies that every Outlook draft gets.">
          <Suspense fallback={<Loading h={200} />}>
            <DraftSection />
          </Suspense>
        </Section>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div data-fill className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="shrink-0 md:w-[220px] md:border-r md:bg-secondary/30">
        <SettingsNav scroller="settings-scroll" />
      </aside>
      <div id="settings-scroll" className="min-h-0 flex-1 overflow-y-auto">
        <Suspense fallback={<div className="p-6 md:p-10"><Loading h={300} /></div>}>
          <SettingsContent />
        </Suspense>
      </div>
    </div>
  );
}
