import { getDb } from "./db";

// One place that answers "is the owner's setup complete?", used by the setup guide and to gate automatic signing.
export async function readiness() {
  const db = getDb();
  const [conn, image, profile, enabledRules, ccRules] = await Promise.all([
    db.oAuthConnection.findFirst(),
    db.signatureImage.findFirst({ where: { active: true } }),
    db.signatureProfile.findFirst({ where: { active: true } }),
    db.signingRule.count({ where: { enabled: true } }),
    db.signingRule.count({ where: { enabled: true, cc: { isEmpty: false } } }),
  ]);
  const certificateOk = Boolean(profile?.runtimeApprovedAt && profile.certNotAfter > new Date());
  const steps = {
    connected: Boolean(conn),
    signatureImage: Boolean(image),
    certificate: certificateOk,
    rules: enabledRules > 0,
    recipients: ccRules > 0,
  };
  const missing: string[] = [];
  if (!steps.connected) missing.push("connect your Microsoft account");
  if (!steps.signatureImage) missing.push("upload your signature");
  if (!steps.certificate) missing.push("set up your digital signature");
  if (!steps.rules) missing.push("add at least one automatic signing rule");
  return { steps, missing, complete: missing.length === 0 };
}
