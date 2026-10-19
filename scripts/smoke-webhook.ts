// Smoke test for a running deployment: npx tsx scripts/smoke-webhook.ts https://<app-origin>
export {};
const base = process.argv[2];
if (!base) throw new Error("usage: smoke-webhook <https://app-origin>");
const origin = base.replace(/\/$/, "");
const url = `${origin}/api/webhooks/microsoft-graph`;

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed++;
}

async function main() {
  const v = await fetch(`${url}?validationToken=Validation%3A%20token%201`, { method: "POST" });
  check(
    "validation echoes decoded token as text/plain",
    v.status === 200 && (await v.text()) === "Validation: token 1" && (v.headers.get("content-type") ?? "").startsWith("text/plain"),
  );

  const bad = await fetch(url, { method: "POST", body: "{}" });
  check("malformed body rejected", bad.status === 400);

  const forged = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: [{ subscriptionId: "forged", clientState: "wrong", changeType: "created", resourceData: { id: "x" } }] }),
  });
  check("forged notification acknowledged but not accepted for processing", forged.status === 202);

  for (const p of ["/", "/settings", "/contracts/x"]) {
    const r = await fetch(origin + p, { redirect: "manual" });
    check(`${p} redirects unauthenticated visitors to /login`, r.status === 307 && (r.headers.get("location") ?? "").endsWith("/login"));
  }
  const doc = await fetch(`${origin}/api/contracts/x/document`);
  check("document API returns 401 without a session", doc.status === 401);

  console.log(failed ? `${failed} check(s) failed` : "all checks passed");
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
