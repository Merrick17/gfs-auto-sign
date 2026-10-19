import assert from "node:assert/strict";
import { test } from "node:test";
import forge from "node-forge";
import { PDFDocument } from "pdf-lib";
import { SigningRefused, signPdf, verifyPdfSignature } from "./pdf-sign";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function makeP12(password: string) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400_000);
  const attrs = [{ name: "commonName", value: "Test Signer" }, { name: "organizationName", value: "GFS Test" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

async function blankPdf() {
  const d = await PDFDocument.create();
  d.addPage([595, 842]).drawText("Sales contract SC-1");
  return Buffer.from(await d.save());
}

const location = { page: 1, x: 0.1, y: 0.8, width: 0.3, height: 0.08 };

test("signs, places a visible signature and verifies; tampering is detected", async () => {
  const p12 = makeP12("pw");
  const signed = await signPdf({ pdf: await blankPdf(), p12, passphrase: "pw", signaturePng: PNG, location, signerName: "Test Signer", reason: "Test" });

  const v = verifyPdfSignature(signed);
  assert.equal(v.intact, true);
  assert.equal(v.valid, true);
  assert.equal(v.selfSigned, true);
  assert.match(v.certSubject, /Test Signer/);

  const tampered = Buffer.from(signed);
  const i = tampered.indexOf("/Type /Catalog") > 0 ? tampered.indexOf("/Type /Catalog") : 40;
  assert.ok(i > 0 && i < tampered.length / 2);
  tampered[i + 2] ^= 0x01; // flip a bit inside the signed range
  const t = verifyPdfSignature(tampered);
  assert.equal(t.intact, false);
});

test("visible image is on the page", async () => {
  const p12 = makeP12("pw");
  const signed = await signPdf({ pdf: await blankPdf(), p12, passphrase: "pw", signaturePng: PNG, location, signerName: "Test Signer", reason: "Test" });
  assert.match(signed.toString("latin1"), /\/Subtype\s*\/Image/);
  assert.match(signed.toString("latin1"), /\/FT\s*\/Sig/);
});

test("refuses documents that already carry a signature", async () => {
  const p12 = makeP12("pw");
  const once = await signPdf({ pdf: await blankPdf(), p12, passphrase: "pw", signaturePng: PNG, location, signerName: "A", reason: "x" });
  await assert.rejects(
    signPdf({ pdf: once, p12, passphrase: "pw", signaturePng: PNG, location, signerName: "B", reason: "x" }),
    SigningRefused,
  );
});

test("refuses a box outside the page", async () => {
  await assert.rejects(
    signPdf({ pdf: await blankPdf(), p12: makeP12("pw"), passphrase: "pw", signaturePng: PNG, location: { ...location, x: 0.9 }, signerName: "A", reason: "x" }),
    SigningRefused,
  );
});
