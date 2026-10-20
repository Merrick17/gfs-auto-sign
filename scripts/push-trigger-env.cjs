// Copies the variables the Trigger.dev tasks need from .env.local to the Trigger.dev PROD environment.
// Uses TRIGGER_PROD_KEY from .env.local. Run: node scripts/push-trigger-env.cjs
const { parse } = require("dotenv");
const fs = require("fs");
const e = { ...parse(fs.readFileSync(".env.local")), OPENAI_MODEL_PRIMARY: "gpt-6-luna", APP_BASE_URL: "https://gfs-sign.vercel.app" };
const keys = ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "MAILBOX_ID", "OPENAI_API_KEY", "OPENAI_MODEL_PRIMARY", "CERT_ENCRYPTION_KEY", "SIGNING_P12_PASSWORD", "APP_BASE_URL", "OWNER_OBJECT_ID", "OWNER_EMAILS"];
const variables = Object.fromEntries(keys.filter((k) => e[k]).map((k) => [k, e[k]]));
fetch("https://api.trigger.dev/api/v1/projects/proj_bfnmijwmujfncdqfciyc/envvars/prod/import", {
  method: "POST",
  headers: { Authorization: `Bearer ${e.TRIGGER_PROD_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ variables, override: true }),
}).then(async (r) => console.log(r.status, (await r.text()).slice(0, 120), "| set:", Object.keys(variables).join(", ")));
