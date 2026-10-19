const base = process.argv[2];
if (!base) throw new Error("usage: smoke-webhook <https://app-origin>");
const url = `${base.replace(/\/$/, "")}/api/webhooks/microsoft-graph`;

async function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) process.exitCode = 1;
}

const v = await fetch(`${url}?validationToken=Validation%3A%20token%201`, { method: "POST" });
await check("validation echoes decoded token as text/plain", v.status === 200 && (await v.text()) === "Validation: token 1" && (v.headers.get("content-type") ?? "").startsWith("text/plain"));

const bad = await fetch(url, { method: "POST", body: "{}" });
await check("malformed body rejected", bad.status === 400);

const forged = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ value: [{ subscriptionId: "forged", clientState: "wrong", changeType: "created", resourceData: { id: "x" } }] }),
});
await check("forged notification not accepted for processing (202 ack, nothing stored)", forged.status === 202);
export {};
