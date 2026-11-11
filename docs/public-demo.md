# Public Career Scout

Career Scout supports a public, no-sign-in version of the same four-step profile and job-search workflow. Visitors can upload their own documents or choose fictional sample documents. Samples do not approve any facts or represent real vacancies.

## Visitor profiles

With `PUBLIC_DEMO_ENABLED=true`, every browser receives an independent, server-created `visitor-...` owner. The application ignores signed-in Site identity for public profile access, so an existing account profile is not opened accidentally. API bodies cannot select an owner or namespace. Private mode retains the existing ChatGPT sign-in behavior.

The browser receives a random 256-bit access cookie. Production cookies use the `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax` and a host-only path. Only its SHA-256 hash, generated owner and expiry are stored in the Site's D1 database. The cookie lasts up to one year. It is an access handle, not a user account; copying it would grant access to that visitor's profile, so it is never exposed to page scripts or response bodies.

Profile records, approvals and uploaded documents remain in the existing owner-scoped Supabase storage. Pinecone namespaces remain owner-scoped as well. There is no shared visitor profile and no copy of the owner's resume in the public demo. Requests retain same-origin checks and verified approval receipts.

Clearing cookies, changing browser/device or expiry creates a separate profile. It does not automatically delete previous stored documents. Visitors should export or delete their data using **My data & privacy** before clearing access. No cross-device recovery or account linking is provided by anonymous access.

## Bounded public usage

Atomic D1 counters enforce these defaults across Worker instances:

| Operation | Per browser | Shared across the public site |
| --- | --- | --- |
| Gemini analysis or embedding API calls | 60 per UTC day | 300 per UTC day |
| Search requests | 5 per UTC day | 40 per UTC day |
| Workspace API requests | 120 per minute | 6,000 per minute |
| New browser sessions | — | 500 per UTC day |

One questionnaire analysis can use multiple model calls. Errors are counted conservatively; no automatic provider retry or paid fallback was added. Reaching an allowance preserves saved data and returns an explanation. Search preview does not perform vacancy research. Existing per-operation input, storage and provider limits still apply.

## Hosting

The existing Site identity is preserved in `.openai/hosting.json`. D1 binding `DB` stores only session metadata and usage counters; migrations are generated from `db/schema.ts`. Hosted provider keys stay in Sites secrets. Local `.env.local`, private inputs and caches are excluded from source and deployment artifacts.

Deploy the new Worker and D1 migration while access is still private, verify it, then set the Site audience to `public` as requested. The public landing page and profile/search APIs do not require ChatGPT sign-in. Local-only Python application-package processing remains a separate deployment concern; it is not made cloud-hosted by public profile access.

`tests/public-visitor.test.mjs` covers cookie isolation, forged/expired access, cross-profile downloads, owner injection, cross-origin writes, persistent quotas, direct Scout requests, model call boundaries and actual Workers/D1 concurrency.
