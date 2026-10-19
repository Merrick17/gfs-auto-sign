import { createHash, createHmac, randomBytes } from "node:crypto";
import forge from "node-forge";
import { requireEnv } from "./env";

// The stored PKCS#12 is protected twice: AES-GCM (secret-box) and a password derived from the same server secret.
// The owner never needs to know or keep a certificate password.
export const p12Password = () =>
  createHmac("sha256", Buffer.from(requireEnv("CERT_ENCRYPTION_KEY"), "base64")).update("gfs-p12-v1").digest("hex").slice(0, 32);

export class CertificateError extends Error {}

export type CertificateInfo = { subject: string; commonName: string; notAfter: Date; fingerprint: string; selfSigned: boolean };

function describe(cert: forge.pki.Certificate): CertificateInfo {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return {
    subject: cert.subject.attributes.map((a) => `${a.shortName}=${a.value}`).join(", "),
    commonName: String(cert.subject.getField("CN")?.value ?? ""),
    notAfter: cert.validity.notAfter,
    fingerprint: createHash("sha256").update(Buffer.from(der, "binary")).digest("hex"),
    selfSigned: cert.isIssuer(cert),
  };
}

function pack(key: forge.pki.rsa.PrivateKey, chain: forge.pki.Certificate[]) {
  const asn1 = forge.pkcs12.toPkcs12Asn1(key, chain, p12Password(), { algorithm: "3des", friendlyName: "GFS Contract Agent" });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary");
}

// A certificate made for the owner. It proves the file is unchanged since signing, not who the signer is to a stranger.
export function createSelfSigned(opts: { name: string; email?: string; organization?: string; years?: number }): { p12: Buffer; info: CertificateInfo } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomBytes(8).toString("hex");
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + (opts.years ?? 2) * 365 * 86_400_000);
  const attrs: forge.pki.CertificateField[] = [{ name: "commonName", value: opts.name }];
  if (opts.organization) attrs.push({ name: "organizationName", value: opts.organization });
  if (opts.email) attrs.push({ shortName: "E", value: opts.email });
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { p12: pack(keys.privateKey, [cert]), info: describe(cert) };
}

// Opens a certificate file with the owner's password (used once, never stored) and re-protects it with the server key.
export function importP12(file: Buffer, password: string): { p12: Buffer; info: CertificateInfo } {
  let parsed: forge.pkcs12.Pkcs12Pfx;
  try {
    parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(file.toString("binary")), password);
  } catch {
    throw new CertificateError("That file or password didn't work. Check the password and try again.");
  }
  const shrouded = parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const plain = parsed.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [];
  const key = (shrouded[0] ?? plain[0])?.key as forge.pki.rsa.PrivateKey | undefined;
  const certs = (parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c));
  if (!key || certs.length === 0) throw new CertificateError("This file doesn't contain a usable signing certificate.");
  // The signing certificate is the one whose public key matches the private key.
  const leaf = certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.toString(16) === key.n.toString(16)) ?? certs[0];
  if (leaf.validity.notAfter <= new Date()) throw new CertificateError("This certificate has expired.");
  return { p12: pack(key, [leaf, ...certs.filter((c) => c !== leaf)]), info: describe(leaf) };
}
