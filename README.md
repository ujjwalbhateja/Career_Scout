# Career Scout

A private job discovery tool with criteria-based search, company-board imports, on-demand job links, sponsorship evidence, and a browser-local shortlist.

## Run locally

Use Node.js 22.13 or newer. On Windows ARM, use an x64 Node runtime because the local Cloudflare workerd runtime does not support Windows ARM.

```sh
npm ci
npm run dev
```

Open the local URL printed by the server. Production uses the Sites/Vinext Cloudflare Worker build, with no database or model key required.

## What works

- Role keywords and comma-separated title alternatives; seniority, location, work arrangement, employment type, and compensation filters.
- Optional sponsorship preference. Explicit negative sponsorship statements are flagged with their source sentence. Missing information stays unknown.
- Live Remotive and Arbeitnow feeds, with caching, bounded retrieval, independent source errors, and duplicate detection.
- Company board and exact-role import for Greenhouse, Lever, and Ashby.
- Generic public pages exposing JobPosting JSON-LD; career-page links can lead to a supported company board.
- Paste-description fallback for inaccessible, sign-in, or unsupported pages, including LinkedIn pages that cannot be fetched.
- Optional OpenWeb Ninja JSearch integration for indexed web coverage. Supply your provider key under Sources. The key is held in tab memory and is never saved to localStorage.
- Browser-local saved criteria, up to 30 imported roles and 30 shortlisted roles, plus JSON export for a future Matcher.

## Coverage and limitations

No adapter promises every job website. Remotive is a remote-only feed delayed by 24 hours; it is cached for six hours. Arbeitnow covers a bounded selection of European listings. Its UK endpoint returned HTTP 403 during verification and is therefore optional rather than selected by default. Company board coverage depends on the URLs you supply. JSearch needs your own active provider connection and was tested with contract fixtures only, not with a live key.

Search filters use structured fields and conservative rules. Seniority is inferred from explicit title words. Location matching uses listed text and limited aliases, not geographic distance. A missing salary period/currency is flagged, and currencies are not converted. Sponsorship extraction is a heuristic and may miss nuanced wording; verify the original source before applying. Search results are not resume qualification scores.

Public-page requests accept HTTPS only, validate public DNS addresses, revalidate redirects, bound response size/time, and return extracted data rather than an arbitrary proxy response. Stored job text is rendered as plain text. The application does not submit applications.

## Structure

- `app/scout.tsx`: criteria, results, import, shortlist, source settings, and detail UI.
- `app/api/scout/route.ts`: same-origin bounded request handling.
- `lib/scout.mjs`: source adapters, normalization, filtering, sponsorship detection, and page extraction.
- `tests/scout.test.mjs`: criteria, uncertainty, sponsorship, URL safety, normalization, and failure behavior.
- `.openai/hosting.json`: private Site identity and deployment configuration.

## Validation

```sh
node --test tests/scout.test.mjs
npx tsc --noEmit
npm run build
```

Live checks during development confirmed search results from Remotive and Arbeitnow, board and individual-role imports from all three supported ATS adapters, and clear errors on restricted public pages. The local browser verified search, sponsorship evidence, and shortlist saving. See the chat for the final deployment and remaining verification limits.

## Extension points

Add a source adapter that returns normalized job records and a source report. Preserve source URLs, retrieval dates, explicit unknowns, and evidence. Keep new connector keys server-side or transient; never place them in the repository. Add pagination, richer geographic matching, and authenticated persistent storage before scaling to multiple users or high volumes.
