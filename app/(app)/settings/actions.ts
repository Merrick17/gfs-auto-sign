"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import forge from "node-forge";
import { requireOwner } from "@/auth";
import { getDb } from "@/lib/db";
import { policyRules } from "@/lib/policy";
import { seal } from "@/lib/secret-box";
import { createSubscription } from "@/lib/subscriptions";
import { storageRoot, uploadFile } from "@/lib/sharepoint";

export type Result = { ok: boolean; message: string };
const done = (ok: boolean, message: string): Result => ({ ok, message });

export async function savePolicy(_: Result | null, form: FormData): Promise<Result> {
  const session = await requireOwner();
  const parsed = policyRules.safeParse(safeJson(String(form.get("rules") ?? "")));
  if (!parsed.success) return done(false, `Rules invalid: ${parsed.error.issues[0]?.message} at ${parsed.error.issues[0]?.path.join(".")}`);
  const db = getDb();
  const enabled = form.get("enabled") === "on";
  await db.$transaction(async (tx) => {
    const last = await tx.signingPolicy.findFirst({ orderBy: { version: "desc" } });
    await tx.signingPolicy.updateMany({ where: { active: true }, data: { active: false } });
    const row = await tx.signingPolicy.create({
      data: { version: (last?.version ?? 0) + 1, active: true, autonomousSigningEnabled: enabled, rules: parsed.data, createdBy: session.user?.email ?? "owner" },
    });
    await tx.auditEvent.create({ data: { actor: "owner", action: "policy:saved", data: { version: row.version, enabled } } });
  });
  revalidatePath("/settings");
  return done(true, enabled ? "Saved. Autonomous signing is ON for this version." : "Saved. Autonomous signing is OFF.");
}

export async function saveBudget(_: Result | null, form: FormData): Promise<Result> {
  await requireOwner();
  const v = Number(form.get("budget"));
  if (!Number.isFinite(v) || v < 0) return done(false, "Enter a valid amount");
  await getDb().appSetting.upsert({ where: { key: "monthlyAiBudgetUsd" }, create: { key: "monthlyAiBudgetUsd", value: v }, update: { value: v } });
  revalidatePath("/settings");
  return done(true, "Budget saved");
}

export async function saveSigner(_: Result | null, form: FormData): Promise<Result> {
  const session = await requireOwner();
  const p12 = form.get("certificate");
  const img = form.get("signature");
  const password = String(form.get("password") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const title = String(form.get("title") ?? "").trim();
  if (!(p12 instanceof File) || !p12.size || !(img instanceof File) || !img.size || !name) return done(false, "Name, certificate and signature image are required");
  if (form.get("approveRuntime") !== "on") return done(false, "You must authorize the signing runtime to use this certificate");
  if (img.type !== "image/png" || img.size > 1_000_000) return done(false, "Signature must be a PNG under 1 MB");

  const p12Bytes = Buffer.from(await p12.arrayBuffer());
  let cert: forge.pki.Certificate | undefined;
  try {
    const asn1 = forge.asn1.fromDer(p12Bytes.toString("binary"));
    const parsed = forge.pkcs12.pkcs12FromAsn1(asn1, password);
    const bags = parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    cert = bags[0]?.cert;
  } catch {
    return done(false, "Certificate could not be opened with that password");
  }
  if (!cert) return done(false, "No certificate found in the file");
  if (cert.validity.notAfter <= new Date()) return done(false, "Certificate has expired");

  const selfSigned = cert.isIssuer(cert);
  const fingerprint = createHash("sha256").update(Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary")).digest("hex");
  const sealed = await uploadFile(`${storageRoot()}/Config`, `signer-${fingerprint.slice(0, 12)}.p12.enc`, seal(p12Bytes));
  const image = await uploadFile(`${storageRoot()}/Config`, `signature-${fingerprint.slice(0, 12)}.png`, Buffer.from(await img.arrayBuffer()));

  const db = getDb();
  await db.signatureProfile.updateMany({ where: { active: true }, data: { active: false } });
  await db.signatureProfile.create({
    data: {
      signatoryName: name, title,
      signatureImageRef: `${image.driveId}:${image.itemId}`,
      certificateRef: `${sealed.driveId}:${sealed.itemId}`,
      certificateFingerprint: fingerprint,
      certSubject: cert.subject.attributes.map((a) => `${a.shortName}=${a.value}`).join(", "),
      certNotAfter: cert.validity.notAfter,
      selfSigned, active: true, runtimeApprovedAt: new Date(),
    },
  });
  await db.auditEvent.create({ data: { actor: "owner", action: "signer:imported", data: { by: session.user?.email, fingerprint, selfSigned } } });
  revalidatePath("/settings");
  return done(true, selfSigned ? "Imported. This is a self-signed certificate: signatures are verifiable but not backed by a trusted authority." : "Certificate imported.");
}

export async function connectMailbox(): Promise<Result> {
  await requireOwner();
  try {
    await createSubscription();
  } catch (e) {
    return done(false, e instanceof Error ? e.message : "Subscription failed");
  }
  revalidatePath("/settings");
  return done(true, "Graph subscription created");
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
