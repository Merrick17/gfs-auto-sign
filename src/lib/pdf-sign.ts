import { createHash } from "node:crypto";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import signpdf from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import forge from "node-forge";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type Location = { page: number; x: number; y: number; width: number; height: number }; // fractions, origin top-left

export class SigningRefused extends Error {}

export type Verification = {
  intact: boolean;
  valid: boolean;
  coversWholeDocument: boolean;
  certSubject: string;
  certSha256: string;
  selfSigned: boolean;
  certExpired: boolean;
};

const latin1 = (b: Buffer) => b.toString("latin1");

// The JS signer rewrites the file, so it cannot keep earlier signatures valid. Those go to review.
export function assertSignable(pdf: Buffer) {
  const text = latin1(pdf);
  if (/\/ByteRange\s*\[/.test(text)) throw new SigningRefused("Document already carries digital signatures that cannot be preserved");
  if (/\/Encrypt\s/.test(text)) throw new SigningRefused("Encrypted PDF cannot be signed");
  if (/\/Perms\s*<</.test(text) || /\/DocMDP/.test(text)) throw new SigningRefused("Certified document (DocMDP) cannot be modified");
}

export async function signPdf(opts: {
  pdf: Buffer;
  p12: Buffer;
  passphrase: string;
  signaturePng: Buffer;
  location: Location;
  signerName: string;
  reason: string;
}): Promise<Buffer> {
  assertSignable(opts.pdf);
  const { location: l } = opts;
  if (l.x < 0 || l.y < 0 || l.width <= 0 || l.height <= 0 || l.x + l.width > 1 || l.y + l.height > 1)
    throw new SigningRefused("Signature box outside the page");

  const doc = await PDFDocument.load(opts.pdf, { updateMetadata: false });
  if (l.page < 1 || l.page > doc.getPageCount()) throw new SigningRefused("Signature page out of range");
  const page = doc.getPage(l.page - 1);
  const { width: pw, height: ph } = page.getSize();
  const x1 = l.x * pw;
  const w = l.width * pw;
  const h = l.height * ph;
  const y1 = ph - (l.y + l.height) * ph;

  // Visible handwritten signature, scaled to fit the box above a small caption.
  const img = await doc.embedPng(opts.signaturePng);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const caption = `Digitally signed by ${opts.signerName}`;
  const capH = Math.min(7, h * 0.2);
  const scaled = img.scaleToFit(w, h - capH - 1);
  page.drawImage(img, { x: x1 + (w - scaled.width) / 2, y: y1 + capH + 1, width: scaled.width, height: scaled.height });
  page.drawText(caption, { x: x1, y: y1, size: capH, font, color: rgb(0.25, 0.25, 0.25), maxWidth: w });

  pdflibAddPlaceholder({
    pdfDoc: doc,
    pdfPage: page,
    reason: opts.reason,
    contactInfo: "",
    name: opts.signerName,
    location: "",
    signatureLength: 16384,
    widgetRect: [x1, y1, x1 + w, y1 + h],
  });
  const withPlaceholder = Buffer.from(await doc.save({ useObjectStreams: false }));
  const signer = new P12Signer(opts.p12, { passphrase: opts.passphrase });
  return Buffer.from(await signpdf.sign(withPlaceholder, signer));
}

// Independent check of the CMS signature using the embedded certificate and the PDF bytes.
export function verifyPdfSignature(pdf: Buffer): Verification {
  const text = latin1(pdf);
  const br = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
  if (!br) throw new Error("No signature found");
  const [a, b, c, d] = br.slice(1).map(Number);
  const coversWholeDocument = a === 0 && c + d === pdf.length;
  const hex = pdf.subarray(b + 1, c - 1).toString("latin1"); // between < and >
  const der = Buffer.from(hex.replace(/[^0-9a-fA-F]/g, ""), "hex").toString("binary");
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der, { strict: false, parseAllBytes: false } as unknown as boolean)) as unknown as {
    certificates: forge.pki.Certificate[];
    rawCapture: { authenticatedAttributes: forge.asn1.Asn1[]; signature: string; digestAlgorithm: string };
  };
  const cert = p7.certificates[0];
  const raw = p7.rawCapture;

  const signedBytes = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
  const digest = createHash("sha256").update(signedBytes).digest("binary");

  const mdAttr = raw.authenticatedAttributes.find(
    (at) => forge.asn1.derToOid((at.value[0] as forge.asn1.Asn1).value as string) === forge.pki.oids.messageDigest,
  );
  const attrDigest = mdAttr
    ? (((mdAttr.value[1] as forge.asn1.Asn1).value as forge.asn1.Asn1[])[0].value as string)
    : "";
  const intact = forge.asn1.derToOid(raw.digestAlgorithm) === forge.pki.oids.sha256 && attrDigest === digest;

  const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, raw.authenticatedAttributes);
  const md = forge.md.sha256.create();
  md.update(forge.asn1.toDer(set).getBytes());
  let valid = false;
  try {
    valid = (cert.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().getBytes(), raw.signature);
  } catch {
    valid = false;
  }

  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const now = new Date();
  return {
    intact: intact && coversWholeDocument,
    valid: valid && intact,
    coversWholeDocument,
    certSubject: cert.subject.attributes.map((x) => `${x.shortName}=${x.value}`).join(", "),
    certSha256: createHash("sha256").update(Buffer.from(certDer, "binary")).digest("hex"),
    selfSigned: cert.isIssuer(cert),
    certExpired: cert.validity.notAfter < now || cert.validity.notBefore > now,
  };
}
