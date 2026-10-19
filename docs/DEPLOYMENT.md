# GFS Contract Agent: setup and deployment

Status: code complete up to the point where credentials are required. Nothing here has been run against
real Microsoft 365, Neon, Trigger.dev or OpenAI yet. Signing is pure Node (`src/lib/pdf-sign.ts`: pdf-lib + @signpdf + node-forge) and is covered by local tests: it signs, places the visible image, verifies the CMS signature independently and detects tampering.

## 1. Microsoft sign-in (delegated OAuth, existing "GFS OP Hub" app)
The app signs the owner in once and keeps an encrypted refresh token (table `OAuthConnection`, AES-256-GCM with
`CERT_ENCRYPTION_KEY`). Background tasks exchange it for short-lived Graph tokens. No admin consent and no
application permissions are needed.
- Uses the app registration behind `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`.
- Requested scopes (src/lib/scopes.ts): `Mail.Read`, `Mail.ReadWrite`, `Files.ReadWrite`, `offline_access`.
  **`Mail.Send` is never requested**, even though the registration holds consent for it, so tokens issued to this
  app cannot send mail. The code never calls a send endpoint.
- Add these redirect URIs (Web) to the registration: `https://<app>/api/auth/callback/microsoft-entra-id` and, for
  local work, `http://localhost:3000/api/auth/callback/microsoft-entra-id`.
- Only `OWNER_OBJECT_ID` can sign in. Mail is the signed-in owner's own mailbox (`/me`).
- If the sign-in is revoked or expires, tasks stop with a non-retryable error until the owner signs in again.
- Graph mail subscriptions work with delegated tokens and expire after at most ~2.9 days; renewal is automatic.

## 2. Neon
Create a project. `DATABASE_URL` = pooled connection string, `DATABASE_URL_UNPOOLED` = direct (`neon env pull` writes both to `.env.local`). Then:
`npx prisma migrate deploy` (reads `DATABASE_URL_UNPOOLED` via `prisma.config.ts`).

## 3. Trigger.dev
1. Create a v4 project, copy the project ref to `TRIGGER_PROJECT_REF` in `trigger.config.ts` env.
2. Add every variable in `.env.example` that tasks use (DATABASE_URL, AZURE_*, MAILBOX_ID, SHAREPOINT_DRIVE_ID,
   OPENAI_*, PRICE_*, CERT_ENCRYPTION_KEY, SIGNING_P12_PASSWORD) in the Trigger.dev dashboard.
3. `npx trigger.dev@4.7.4 deploy`.
4. No Python or build extension is needed; signing runs in the Node task runtime.

## 4. Vercel
Import the repo (Node runtime, a plan that permits commercial use: Pro). Set `DATABASE_URL`, `AZURE_*`,
`AUTH_SECRET`, `OWNER_OBJECT_ID`, `TRIGGER_SECRET_KEY`, `APP_BASE_URL`, `SHAREPOINT_DRIVE_ID`, `CERT_ENCRYPTION_KEY`. Deploy. The webhook is `POST /api/webhooks/microsoft-graph`.

## 5. Connect the mailbox
Sign in, open Settings, press **Create Graph subscription**. The app registers a `created` subscription on the
Inbox, stores the ID, expiry and secret `clientState`, and `renew-graph-subscriptions` renews it every 6 hours when
less than 24 h remain. Lifecycle events (`reauthorizationRequired`, `subscriptionRemoved`, `missed`) arrive at the
same URL and are routed to `handle-subscription-lifecycle`, which renews, recreates, or runs `inbox-delta-sync`.

## 6. Signing setup (Settings)
Import the `.p12`, the PNG signature and tick the authorization box. Then save a policy and turn on autonomous
signing. Until both exist every contract stops at "Requires review", unsigned.

## Security assessment: Trigger.dev Cloud and the signing key
- **Limitation:** the JS signer rewrites the PDF, so it cannot keep an earlier customer digital signature valid. Documents that already carry a signature, are encrypted, or are DocMDP-certified are escalated to review unsigned. Supporting those needs an incremental-update signer, which no maintained JS library provides.
- The `.p12` is stored AES-256-GCM encrypted in SharePoint. The decryption key (`CERT_ENCRYPTION_KEY`) and the
  `.p12` password live in the Trigger.dev environment, so Trigger.dev, a third party, can technically reach the
  plaintext key while the signing task runs. The import form therefore requires explicit owner consent, recorded
  in `SignatureProfile.runtimeApprovedAt` and the audit log.
- Neither key nor password is ever sent to OpenAI; the model only receives the PDF and trusted customer history.
- Contract text is not logged. Task payloads carry database IDs only.
- Lower-exposure alternative: sign in a self-hosted worker or use an HSM/KMS-backed key. Prefer this if the
  certificate is ever upgraded to a CA-issued, legally binding one.
- A self-signed certificate proves the file is unchanged since signing. It does not prove identity to a recipient.

## Smoke tests
`npm run smoke:webhook -- https://<app>` checks the validation handshake and rejection of bad bodies.
End-to-end: send a PDF contract to the mailbox, watch Contract Operations, find the draft in Outlook Drafts.
Never-send check: confirm the app registration has no `Mail.Send`; the Sent Items folder stays empty.
