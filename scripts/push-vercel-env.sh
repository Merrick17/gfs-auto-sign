#!/usr/bin/env bash
# Copies the production env vars from .env.local to the Vercel project (linked to merrick17s-projects/gfs-sign).
set -a; . ./.env.local; set +a
SCOPE=merrick17s-projects
for k in DATABASE_URL DATABASE_URL_UNPOOLED TRIGGER_SECRET_KEY AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_CLIENT_SECRET MAILBOX_ID AUTH_SECRET OWNER_OBJECT_ID OPENAI_API_KEY CERT_ENCRYPTION_KEY SIGNING_P12_PASSWORD; do
  v="${!k}"; [ -z "$v" ] && { echo "SKIP $k (empty)"; continue; }
  printf '%s' "$v" | vercel env add "$k" production --force --scope $SCOPE >/dev/null 2>&1 && echo "ok $k" || echo "FAIL $k"
done
printf 'gpt-6-luna' | vercel env add OPENAI_MODEL_PRIMARY production --force --scope $SCOPE >/dev/null 2>&1 && echo "ok OPENAI_MODEL_PRIMARY"
