"use client";

import { useActionState } from "react";
import { connectMailbox, saveBudget, savePolicy, saveSigner, type Result } from "./actions";

const input = "w-full rounded border border-line bg-background px-2 py-1.5";
const btn = "rounded bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-60";

function Msg({ r }: { r: Result | null }) {
  return r ? <p className={r.ok ? "text-ok" : "text-bad"} role="status">{r.message}</p> : null;
}

export function PolicyForm({ rules, enabled, version }: { rules: string; enabled: boolean; version: number | null }) {
  const [r, act, pending] = useActionState(savePolicy, null);
  return (
    <form action={act} className="space-y-2">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        Enable autonomous signing within these rules {version ? <span className="text-muted">(current: v{version})</span> : null}
      </label>
      <textarea name="rules" defaultValue={rules} rows={18} spellCheck={false} className={`${input} font-mono text-xs`} aria-label="Signing rules JSON" />
      <button className={btn} disabled={pending}>Save as new version</button>
      <Msg r={r} />
    </form>
  );
}

export function BudgetForm({ value }: { value: number | null }) {
  const [r, act, pending] = useActionState(saveBudget, null);
  return (
    <form action={act} className="flex flex-wrap items-center gap-2">
      <label htmlFor="budget">Monthly AI budget (USD)</label>
      <input id="budget" name="budget" type="number" step="0.01" min="0" defaultValue={value ?? ""} className={`${input} w-32`} />
      <button className={btn} disabled={pending}>Save</button>
      <Msg r={r} />
    </form>
  );
}

export function SignerForm() {
  const [r, act, pending] = useActionState(saveSigner, null);
  return (
    <form action={act} className="grid gap-2 sm:grid-cols-2">
      <input name="name" placeholder="Signatory name" className={input} required />
      <input name="title" placeholder="Title" className={input} />
      <label className="text-muted">Certificate (.p12 / .pfx)<input name="certificate" type="file" accept=".p12,.pfx" className="mt-1 block" required /></label>
      <label className="text-muted">Handwritten signature (PNG)<input name="signature" type="file" accept="image/png" className="mt-1 block" required /></label>
      <input name="password" type="password" placeholder="Certificate password (checked, not stored)" className={input} autoComplete="off" />
      <label className="flex items-start gap-2 sm:col-span-2">
        <input type="checkbox" name="approveRuntime" className="mt-1" />
        <span>
          I authorize the automated signing service to use this certificate. The encrypted certificate is decrypted only inside the Trigger.dev Cloud signing task, a third-party runtime, and its password is held there as an environment variable.
        </span>
      </label>
      <div className="sm:col-span-2"><button className={btn} disabled={pending}>Import signer</button> <Msg r={r} /></div>
    </form>
  );
}

export function ConnectButton() {
  const [r, act, pending] = useActionState(async () => connectMailbox(), null);
  return (
    <form action={act} className="flex items-center gap-3">
      <button className={btn} disabled={pending}>Create Graph subscription</button>
      <Msg r={r} />
    </form>
  );
}
