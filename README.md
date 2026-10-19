# GFS Contract Agent

Event-driven sales contract processing for Green Fashion Solutions.
Outlook email → Microsoft Graph notification → Vercel webhook → Trigger.dev tasks → Neon records →
signed PDF in SharePoint → reply draft in Outlook. Nothing is ever sent automatically.

See `docs/DEPLOYMENT.md` for setup, Entra permissions and the security assessment.

## Flow

| Stage | Where | Code |
| --- | --- | --- |
| Accept + dedupe + outbox | Vercel | `app/api/webhooks/microsoft-graph/route.ts`, `src/lib/dispatch.ts` |
| Intake, PDF validation, original to SharePoint | Trigger.dev | `src/lib/intake.ts`, `outlook-email-received` |
| GPT extraction (Responses API, structured output) | Trigger.dev | `analyze-sales-contract` |
| Policy decision | Trigger.dev | `src/lib/policy.ts`, `authorize-contract-signing` |
| Visible + cryptographic signature, verification | Trigger.dev | `src/lib/pdf-sign.ts`, `src/lib/signing.ts` |
| Store + draft | Trigger.dev | `store-signed-document`, `src/lib/drafts.ts` |
| Subscription renewal, lifecycle, delta recovery | Trigger.dev | `src/trigger/subscription-maintenance.ts`, `delta-sync.ts` |

## Commands

```
npm test                 # unit + integration tests (embedded Postgres, faked Graph/SharePoint)
npm run typecheck
npm run db:migrate       # prisma migrate deploy
npm run trigger:dev      # local Trigger.dev dev server (needs `trigger.dev login` and TRIGGER_SECRET_KEY)
npm run trigger:deploy
npm run smoke:webhook -- https://<app>
```

## Known limits

- Documents that already carry a digital signature, are encrypted, or are certified are escalated unsigned:
  the JS signer rewrites the file and cannot keep earlier signatures valid.
- A self-signed certificate proves the file is unchanged since signing, not the signer's legal identity.
- Live Graph, OpenAI, SharePoint and Trigger.dev behaviour is untested until credentials are configured.
