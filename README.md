# Career Scout

Private job discovery powered by Keenable, with editable related roles, source evidence, direct imports, and a browser-local shortlist.

## Run locally

Use Node 22.13+ (x64 on Windows ARM), install dependencies with `npm ci`, and run `npm run dev`. The project-root `Start-Scout.ps1` uses the bundled runtime. Save `KEENABLE_API_KEY` in the ignored `.env.local` file. Never use a `VITE_` or `NEXT_PUBLIC_` prefix for this key.

The hosted site reads the same name from a Sites **secret**, supplied through request-local Worker environment bindings. A local file or VS Code MCP configuration does not configure production. Deploy after changing hosted environment variables. Keep this deployment owner-private.

## Search behavior

1. **Keenable discovery:** four bounded web searches per batch. General directory pages are excluded; identifiable individual links may become unverified leads. Remotive, Arbeitnow and JSearch are no longer selected by the search endpoint or UI. Their legacy adapter code remains for regression coverage.
2. **Editable role matching:** Exact uses original titles; Related adds curated role-family terms; Broad includes adjacent roles. Users can remove all suggestions or add any title. Arbitrary roles work without a predefined family. Safe token/phrase matching and conservative typo tolerance avoid executing user-supplied regex. Required phrases are ALL; exclusions are ANY. Description matching is optional.
3. **Location and eligibility:** country aliases, US states and common cities are normalized. Remote does not imply unrestricted hiring. Structured applicant eligibility overrides office location. Unknown facts remain explicit and may optionally be excluded.
4. **Deduplication:** canonical URLs, ATS identities and conservative title/employer/location matching combine source links and prefer employer pages. Distinct known requisitions and locations are retained. Incomplete or inconsistent copies can remain separate rather than risk merging different vacancies.
5. **Verification:** up to ten live page checks per batch. Application page available means readable individual-job and application evidence without a detected closure. It does not guarantee active hiring. Unreadable, blocked or unchecked pages stay unverified. Explicit closure/deadline evidence is closed and hidden by default. Employer posting date, index date, webpage date and checked date remain separate.
6. **Explainable ordering:** original role titles precede related, broad and description-only matches. The UI shows reasons, unknown facts and sponsorship evidence; it never invents a resume-fit percentage. Sponsorship preference boosts explicit support without hiding negatives.
7. **Progressive results and controls:** NDJSON streams discovery and verification changes; cancellation retains partial results. Refresh bypasses five-minute caches. Search more runs distinct query strategies, with a maximum of three batches. Editing criteria requires a new search.
8. **Cost and security controls:** at most four search requests and ten fetch requests per batch; no automatic paid retries. Usage shows API calls separately from credits, which stay unknown when the provider does not report them. Secret keys never enter API responses or browser bundles. HTTPS provider calls reject redirects, response sizes and time are bounded, and search responses use no-store headers.

The endpoint requires same-origin JSON requests, limits body size, and has an in-memory per-owner concurrency/rate guard (two concurrent, six batches/minute **per Worker instance**). This is a soft guard, not a distributed account quota. The private Sites authentication gate is the access boundary. Add durable distributed quotas before expanding the audience or scaling usage. Caches are bounded, short-lived, account-scoped and not durable.

## Imports and storage

Greenhouse, Lever, Ashby and public JobPosting pages can be imported directly. Blocked pages have a paste-description fallback. Imported roles are labeled unverified until separately checked. Keep up to 30 imports and 30 shortlisted snapshots in this browser; export JSON for portability. Old saved criteria/shortlists migrate. Source text renders as text, never executable HTML. Imports enforce HTTPS, public DNS/redirect validation, and response/time limits. No applications are submitted.

## Coverage limits

Web discovery is bounded and cannot enumerate every vacancy. Curated expansions are editable rules, not model-based semantic search. Geography, salary, seniority and sponsorship extraction use conservative text/structured-data rules and can miss nuanced wording. Unknown salary currency/period is not converted or inferred. Check original employer evidence before applying. Cached checks retain their original timestamps.

## Implementation and checks

- `lib/keenable.mjs`: provider orchestration, bounded calls, caching and streaming snapshots.
- `lib/matching.mjs`: expansions, geographic eligibility and ranking.
- `lib/job-evidence.mjs`: metadata, verification and deduplication.
- `lib/search-runtime.ts`, `build/sites-worker.ts`: request-local server secrets.
- `app/api/scout/route.ts`: same-origin search/import/paste API.
- `app/scout.tsx`, `app/scout.css`: criteria, progress, evidence, shortlist and export.
- `lib/scout.mjs`: normalization, sponsorship and import adapters.

```sh
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
```

Tests cover matching boundaries, unknowns, eligibility, duplicate identity, live/closed/unreadable evidence, directory invalidation, stream events, cache isolation, refresh, request caps, provider failures and redirect safety. Live integration and production verification results are recorded in the workspace project context. Browser automation was unavailable during this release; HTTP and mocked UI-state checks do not replace visual browser QA.
