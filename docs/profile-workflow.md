# Profile workflow: Gemini, Supabase and Pinecone

Updated: 2026-10-30, America/New_York. Gemini replaces the prior OpenAI
analysis and embedding integrations at the user's request. Supabase records and
Pinecone storage are retained. Local synthetic extraction/embedding checks passed;
provider activation, representative quality and full browser flows are tracked
separately. Configuration alone is not successful operation.

Structural diagram: `/profile/architecture`; maintained source diagram and layer
checklist: [profile-architecture.md](profile-architecture.md). Its statuses come
from the same reviewed `data/scout-progress.json` record as `/progress`.

## Editable Fact, Builder and Scout instructions (local update, 2026-10-30)

The local web flow loads the editable `prompt.md` for Fact, Profile Builder and
Scout from `backend/src/career_scout/agents/` through the token-authenticated
Python service. Fact uses its policy for resume/answer extraction; Builder uses
its policy for JD analysis, requirement assessments and targeted questions. These
analysis runs record the source and fingerprint of the instructions used.

Profile-linked Scout uses its current policy to prioritize only supplied,
source-checked professional search terms. Model planning may select existing
terms; code enforces search limits, recency, verification and duplicate handling.
If term planning fails, bounded discovery can use the source-checked terms and
reports the planning warning. Python application discovery receives the Scout
prompt through its bound adapter. Hosted JS bundles these policies at build time;
the current local changes have not been published to the hosted Site. Prompt
edits do not change agent permissions, source validation or approval gates.

## Seven explicit steps through profile completion

The local profile journey is:

1. **Add your resume and JDs** - upload or paste the resume and optional employer JDs.
2. **Review facts and experience** - Section 1 groups factual records by personal details, employment stint, education, certifications and listed skills. Section 2 displays every extracted work claim, organized by source-supported employer/position and experience area. Review all proposed facts by version. Re-read old resumes to account for previously unrepresented work passages.
3. **Compare JDs with validated facts** - compare every employer requirement with all approved factual records and cumulative experience. Keep complete, partial and missing support distinct; exclude AI summaries, recommended jobs and navigation from imported JDs. No generated role cards or role approval gate.
4. **Review missing JD experience** - use one table with Approve / Decline / Somewhat. Approve confirms the exact displayed atomic statement; Somewhat confirms only inline edited wording. Both are saved directly with user-confirmation evidence and a per-version approval. Decline adds no claim. Ambiguous qualifications stay inline for specific details; do not invent a degree, certification, employer or dates.
5. **Review profile additions** - inspect the saved decisions and cumulative Section 2; refresh the JD comparison with the updated facts. Legacy free-text answers can still need extraction/approval. The table does not ask for an extra narrative or a second approval.
6. **Build and save consolidated profile** - inspect both sections, explicit gaps and source/approval references, then save a current version.
7. **Send to Master and Scout** - review the saved source-backed search context and start research for actual web openings.

Direct local links include `/?view=profile&step=Facts`, `/?view=profile&step=Questions`, `/?view=profile&step=Consolidated` and `/?view=profile&step=Search`. New table decisions use an atomic `reviewExperience` action with content-bound submission IDs and proposal fingerprints. A lost response can replay before the revision guard without duplicating a fact or approval. Confirmed statements use an answer-source passage; JD quotations remain requirement provenance only. Row-level source segments prevent batch siblings from acquiring one another's evidence. Declines and partial decisions persist across subsequent JDs; changing a declined decision requires explicit reopening.

The editable JS web flow performs onboarding using the current Fact and Profile Builder prompt files. The Python application pipeline loads the approved saved profile through Profile/Memory and coordinates downstream agents; its legacy raw-source Fact/Builder contracts are not a second implementation of this table.

## Multi-JD comparison and cumulative experience

Uploading documents saves them privately. After approving resume facts and experience, choose **Analyze JDs & compare experience**. Every selected employer requirement is assessed against the whole approved profile, in bounded batches with every requirement ID required. Related evidence remains partial when the exact missing scope is not established. Repeated requirements are grouped; independently confirmable compound claims are separated, while OR alternatives and shared qualifiers remain explicit.

The table uses only surviving primary employer source passages. Reanalyzing an existing JD archives its previous requirements instead of erasing history. The current factual profile and exact user decisions remain the experience evidence. Previously declined or partially confirmed proposals are recognized across later JDs, without approving the remaining gap.

An inline table save makes no model call and does not require an example or second approval. It stores one exact user-confirmation source passage per row. New claims, per-version approvals, answers and the durable receipt share one atomic aggregate write. Reusing a submission ID with different text is rejected; retries of the same content return the original receipt. Missing generic qualification details remain pending in that row. A changed proposal or concurrent profile revision requires review rather than a blind retry.

Legacy free-text answers remain available for historical review. They follow the earlier save-first extraction path: a failed model call retains the saved source and can be retried without recreating the answer. Old bare-Yes answers still need factual details; that requirement does not apply to an explicit Approve decision on an exact statement in the new table.

Multi-file JD intake supports up to 15 selected descriptions. Hosted publication, representative real-user review and browser/mobile interaction QA remain separate from code and bounded synthetic-provider checks.

## Approval display and save synchronization

The workspace checks the latest saved record before a fact decision. Each
decision binds the reviewed fact ID/version, fingerprint and prior approval/ref.
Changed facts or another decision require review; aggregate revision conflicts
remain enforced. No automatic approval or blind retry is performed.

The UI validates returned fact statuses before showing a positive saved receipt.
Older in-flight reads cannot replace a newer profile revision. A synchronous
action lock prevents rapid conflicting submissions. Background indexing is
polled while pending and on foreground/focus; active writer leases pause editing
until safe. Read refreshes preserve disclosure drafts. Fact selections bind
individual versions and expire when those versions are no longer current.

The Facts screen shows saved status counts, direct per-fact approval and
version-specific decision history. Reject/withdraw controls are grouped under
Other decisions. A rejected fact changes only after a new explicit user decision;
this repair never rewrites existing user approvals or rejection history.

## Routing

User → Master → Profile. Profile alone coordinates Fact, Builder and Permanent
Memory. Children receive scoped, cloned inputs through an actual LangGraph
subgraph. Master obtains approved results through Profile; Critic feedback
continues through Master. Existing Sites authentication remains in place.

## Storage and ownership

- Supabase career_profile_states: one revisioned JSONB aggregate per Sites owner.
  Stores passages, fact versions, evidence, approvals, answers, role profiles,
  snapshots, operation runs and indexing outbox. Initial maximum: 12 MB.
- Supabase career_profile_usage: durable per-owner daily operation budget.
- Private Storage bucket career-profile-private: original files under a hashed
  owner namespace and document ID.
- Pinecone career-scout-profile-3large-v1: cosine similarity, 3,072 dimensions.
- Embeddings: Gemini `gemini-embedding-001`, pinned to 3,072 dimensions.
- Analysis: Gemini `gemini-3.1-flash-lite`, constrained JSON with domain validation.
- Credentials: server-only `GEMINI_API_KEY`. Profile ignores legacy OpenAI keys,
  endpoint overrides and model settings. No paid fallback or automatic retries are
  used. Model eligibility does not inspect the Google billing tier; keep the
  Google project on its free tier with billing disabled.

Aggregate updates make approvals, snapshots and outbox changes transactional.
Writes for one user serialize; normalize tables when histories outgrow this
initial bound. Vectors are not duplicated inside the aggregate.

New tables enable RLS and revoke direct access from public/anon/authenticated/
service_role. Narrow SECURITY DEFINER RPCs use fixed search paths, role guards,
owner filters and compare-and-swap revisions. The trusted Sites backend derives
the owner; browser-supplied owner IDs/namespaces are rejected.

This is trusted-server authorization, not per-user Supabase auth.uid() RLS.
The server secret is privileged and stays on the server. The Worker must remain
behind its identity-enforcing platform boundary. Administrative migration tokens
are local-only and never deployment secrets.

## Fact schema and categorization

Categories: personal, employment, education, skills, experience_claims,
quantitative_claims, client_relationships, certifications and preferences.
Questions, answers, disclosure preferences and conflicts are separate records.

Each fact has id, version, category, field, scope, statement, original wording,
fingerprint, evidence, origin, confirmation, approval, approval reference,
lifecycle and conflict references.

- Quotes must occur in an identified source passage.
- A JD cannot establish user experience.
- Preserve employer/role associations, date precision and metric scope.
- Listed skills do not establish project/tool links, tenure or authority.
- Missing information stays unknown.
- User confirmation is separate from independent verification.
- Unchanged assertions reuse approval; corrections create pending versions.
- Conflicts require resolution; affected snapshots are invalidated.
- Remaining independent evidence can preserve an unchanged approval.

### Structured Fact review and professional experience

**My profile → Review your facts → Fact Agent: structured resume review and
missing information** organizes personal details, each employment stint,
education, certifications and explicitly stated skill categories. Unavailable
fields show **Missing / Not Provided**. These markers are derived review output,
never fabricated fact proposals. Each field retains source references, current
approval status and confirmation status. A source match or user confirmation
does not become independent verification.

The extractor uses stable field names and a consistent scope for each separate
employment stint, qualification or certification. Unrecognized narrative fields
remain available as facts; the summary does not infer a company or institution
from a scope label. Skills are deduplicated without guessing them from a title.

Code calculates employment durations from explicit dates with matching surviving
resume/answer evidence. It preserves individual employment records and counts
overlapping periods once in the aggregate. Month-precision dates produce
inclusive calendar-month coverage, labelled as such rather than day-exact
tenure. Day-precision dates preserve exact covered days, completed calendar
months and residual days; residual days are not converted using an assumed
30-day month.

Missing, conflicting, ambiguous, year-only or incompatible date precision yields
**Unable to Calculate Accurately.** Valid individual durations remain visible
when another incomplete record blocks the total. Source-stated Present requires
an explicit review date. The local UI supplies the current America/New_York date;
for a month-precision start, ongoing coverage is labelled through that review
month. No missing historical date is filled in. Proposed-date calculations stay
marked for fact review; Builder's experience context uses approved date facts.

## Parsing, chunks and embeddings

DOCX: bounded ZIP directory inspection, streaming XML decompression, paragraph/
table text and source locators. Reject traversal, unsafe expansion, DTD/entities,
malformed XML and unresolved tracked changes.

PDF: pinned unpdf text extraction with page references and a 25-page maximum.
Missing extractable page text is surfaced. OCR is not implemented. TXT and pasted
text are supported. Limits: 2 MB upload and 60,000 extracted characters.

Extraction reads the whole bounded document. Passage coverage is recorded for
review; coverage does not prove every assertion was correctly extracted.

Semantic chunks are atomic approved experience/skill statements with role
context, plus separately labelled JD requirements. Keep short statements intact.
Contact/preferences are excluded from embedding. Full provenance stays in
Supabase; indexed citation metadata is bounded.

Chunking happens before embedding. Gemini produces 3,072-value finite, nonzero
vectors with RETRIEVAL_DOCUMENT or RETRIEVAL_QUERY task types. Pinecone stores and
queries them. Index-host identity, provider, model, dimensions, namespace and
retrieval version are bound to synchronization state. Unchanged records are not
re-embedded. Gemini vectors use an owner-scoped `-gemini-001-3072-v1` namespace;
legacy OpenAI vectors are never compared with Gemini queries. Existing file paths
and approval records are unchanged. Recorded old/new index locations remain
available to explicit profile deletion, including both namespaces on one host.

## Unified profile-first workspace

The main URL lands on My Profile. Seven steps keep document intake, fact
decisions, independent JD requirement analysis, questionnaire responses, answer review,
consolidated saving and research handoff explicit. Jobs are embedded in the same
workspace. Legacy /profile, /profile/architecture, /workflow and /progress URLs
redirect to the corresponding workspace view. Workflow/project diagnostics are
secondary product views. Native cross-page anchors remain the convention;
primary workspace navigation uses local React state and same-page query
parameters.

Intake passes through dispatchProfileOperation: User → Master → Profile. Resume uploads remain private Supabase originals. Optional JD links use public HTTPS only, validate DNS/destinations and every redirect, cap response bytes, and parse HTML/PDF/DOCX/TXT without forwarding cookies or provider keys. Store source URL and extracted segments; scanned, protected, login and unreadable sources require upload or pasted text. Linked content is untrusted evidence, never instructions.

Prepare analyzes pending resume/answer documents and selected JDs in sequence, preserving each saved run and source. It never approves extracted facts. In guided mode one optional analyzed JD is sufficient; approved resume facts alone remain sufficient without one. Existing legacy mode retains its 10–15-JD contract.

Search goals, location, arrangement, seniority, employment and sponsorship
preference are user inputs saved separately from facts. Material clarifications
may still be relevant without JDs, with answer/disclosure reuse guards. Answers
become source documents for factual extraction/review. The saved source-backed
master profile goes through Profile → Master → Scout with allowed search
preferences. Raw factual records and free-form goals stay outside Keenable
queries.

The backend stores, Gemini models/vector isolation, CAS revisions, per-version approvals, invalidation and full downstream career-pipeline boundaries are retained.

## JD and Builder records

The current app uses Builder for complete JD requirement comparison and targeted
questions, saving a standalone assessment ledger with source-bound approved fact
references. It does not ask Gemini to create job titles, role summaries or
alternative-role proposals. Approved resume/answer data can form a master
profile without a generated role or a JD.

The workspace accepts up to 15 optional selected JDs. Later application JDs can
be added singly without repeating onboarding. Legacy `resume`, `guided` and
10–15-JD role-proposal APIs remain compatibility/history paths, not the current
user journey or a prerequisite for saving the source-backed master profile.

Preserve required/preferred tasks, skills, qualifications, experience, sector,
location and source passages. Builder returns requirement mappings, explanations
and questions linked to unmet requirements.
Reject missing/duplicate requirement mappings and unknown fact references.

Evidence mappings are candidate support, not eligibility proof. Factual approvals
remain explicit. No JD requirement becomes a user fact. New experience answers
become documents for Fact extraction/review. Vacancy suitability is assessed
against the validated profile when actual openings are retrieved.

Questions retain canonical topics, scope and answered/needs_details/declined/
deferred states.
Common declined implementation-topic paraphrases and disclosure preferences are
suppressed. This conservative normalization needs real-model evaluation; it does
not guarantee perfect semantic equivalence. Never reuse an answer outside its
supported scope. Optional declined information does not block the whole profile.

## Consolidated profile and save readiness

`buildConsolidatedProfile` in `lib/profile/consolidated.mjs` creates a deterministic
review projection. It uses approved facts with matching approval receipts and
surviving resume/answer quotations. The professional summary presents exact
approved professional statements; it never copies a generated role summary.
The profile
groups subject-matter expertise, skills, tools/technologies, industry/function,
employment, leadership, client/stakeholder work, education/certifications,
responsibilities and source-stated measurable outcomes. Empty sections remain
empty; grouping does not infer skills or leadership from a title.

Each professional claim retains its fact/version, source quotes, approval
reference, confirmation status and source status. `buildValidatedSearchProfile`
in `lib/profile/search-profile.mjs` derives literal titles and professional search
terms from the supplied data. Employment titles need explicit approved title
fields. Selected JD titles need a literal matching JD span and are labelled
employer targets, never user experience. Case-insensitive matching preserves the
actual spelling of the source span. Missing titles remain missing and do not
block responsibility/skill routes. Legacy generated role names, summaries,
alternate titles and keywords are excluded even if an older flow approved them.
JD requirement mappings, missing/conflicting/unverified
support, questionnaire decisions and pending review items stay separate from
professional claims. The JSON profile is downloadable after an explicit save.

The shared `finalizationReadiness` guard drives both the save action and the UI.
It blocks bare Yes confirmations needing details, unfinished answer extraction,
pending facts from answers, unresolved conflicts, required unanswered questions
and requirement analysis that predates relevant facts/responses. The user can explicitly
choose No, defer or decline to preserve a qualification gap. New approved
experience requires refreshing affected requirement comparisons; it is not
silently treated as proof of an unsupported qualification. There is no generated
role-approval gate.

The Profile service persists the projection as `snapshot.consolidated` when the
user clicks **Build & save consolidated profile**. The snapshot binds exact fact
versions, source-only `searchProfile`, selected JD/source references, requirement
assessment scope, latest answer references, search/disclosure preferences and a
review fingerprint. A saved projection never pulls in later approved facts,
later JD titles or later responses. Source-stated ongoing experience
keeps its saved review-date basis rather than drifting when the old version is
viewed later. A preview is not a save or an approval, and implementation work does
not save or approve the real user's data.

## Approval reuse and new jobs

Batch approval applies to displayed fact versions, with individual exceptions.
An explicit consolidated-profile save creates a version-bound snapshot. Legacy
role approval history is retained without making it part of the source-only
search artifact or the current save prerequisite.
Master can request profileInput.savedProfileVersion equal to current or an
explicit version. approvedProfileLoader(service) captures the trusted owner and
loads through Profile → Memory without repeating JD intake or fact approval.

Changing the onboarding selection does not silently alter an existing snapshot.
JD-based finalization must match the newly assessed JD set. Document withdrawal, changed
facts or withdrawn approval invalidate affected dependencies. Changes to answers,
requirement assessments and preferences also require a current review/save before the
Master handoff. Older snapshots can be inspected as saved versions without
treating them as the current approved research context.

The main-page search handoff uses the structural profile identifier
`master-profile` and saved snapshot version. This identifier is not a job title.
Master invokes Profile → Memory to load the current approved source-backed
snapshot and dispatches its professional search context. Each linked search
revalidates the current snapshot. The browser preserves location/filter
preferences. Editing linked criteria can detach the saved profile context. Manual
search remains available. The Jobs discovery path does not activate Matcher,
Tailor, Critic or application storage; Applications uses the separate pipeline
described in [pipeline-usage.md](pipeline-usage.md).

### Preview, dispatch and research receipts

Step 7 requests a read-only Profile → Master → Scout handoff preview from the
saved profile. It shows the exact profile version, explicit source titles, professional
search terms, preferences, source coverage, missing context and planned routes.
The preview does not call Keenable or record an executed dispatch.

**Send to Master & start job research** opens Jobs with a one-use start flag and
starts one bounded search after the saved plan loads. **Open search filters**
only opens the filters. Master requests current approved data through Profile;
Scout receives the scoped professional phrases and preferences. Client-supplied
profile claims cannot replace the saved source context.

The server validates selected Scout terms against that source context and saves
a dispatched handoff receipt through Profile before Keenable research starts.
The receipt binds the profile version, master-profile identifier, plan hash, source coverage
and permitted agent route. The UI distinguishes preview, dispatched, completed
and failed states. Completion/failure receipts and seen-history saves are
separate writes; persistence failures are surfaced. If the dispatched receipt
cannot be confirmed, discovery does not start. This is an on-demand handoff, not
a scheduler or a claim that the current provider connection succeeded.

### Profile-linked Scout discovery

Profile projects approved facts into source-checked professional phrases:
performed responsibilities, industry knowledge, specialist skills/tools and
qualifications. Raw factual records, resume text, contacts, employer identity and
free-form personal goals are excluded from Scout planning and Keenable queries.
Role keywords need supporting approved facts before becoming search terms.

Scout plans up to three independent search routes: titles and supplied alternate
titles; responsibilities with available industry context; specialist skills/tools
with role function. Missing responsibility or skill terms omit their respective
route; missing industry context leaves that route without an industry
restriction. All missing context is reported. It searches seven days first and expands to thirty days when fewer than
five strong recent matches survive. One invocation permits at most six search
requests and ten verification fetches across both windows. This bound does not
claim exhaustive search coverage or a global daily budget.

Results are deduplicated and assessed using performed work, skills, industry,
essential qualifications and preferences. Title similarity alone cannot produce
a strong match. Explicit conflicts are excluded; unsupported qualifications and
unknown sponsorship remain review items. Strong results require verified active
availability and an official employer/ATS application source. Closed vacancies,
passed application deadlines and jobs originally posted over thirty days ago
are excluded. Known repost/source copies preserve the earliest evidenced
original posting date; indexing dates do not substitute for unknown posting dates.
Unknown dates remain identified in potential matches requiring review.

Result metadata includes original posting date, deadline evidence, verification
time, official application URL, match reasons and uncertainties. Owner-scoped
history suppresses unchanged recommendations and labels material updates or
verified reopenings. Linked Jobs searches save bounded history in Supabase;
Python application searches save it in the local owner-scoped journal. A history
save failure is surfaced, so duplicate suppression is not guaranteed after that
failure. These are on-demand searches; no daily scheduler or alert delivery is
implemented.

New-JD assessments use only facts in their bound snapshot. They do not generate
tailored resumes or ATS percentages.

## Retrieval, indexing, deletion and retention

Direct lookup retrieves known facts. Whole-token keyword and Pinecone semantic
results are fused by reciprocal rank. Results are rehydrated against current
owned records; scores cannot authorize claims or revive withdrawn evidence.

Without Gemini credentials, when `PROFILE_SEMANTIC_SEARCH=disabled`, or after a
semantic provider failure/quota rejection, approved database keyword retrieval
remains available. Paused search makes no embedding calls. Quota errors preserve
documents and approvals, expose bounded Retry-After/RetryInfo guidance and do not
automatically retry, change models, enable billing or fall back to OpenAI.

Indexing persists an intent and lease before remote writes. Mutations schedule
a bounded 20-passage background drain using the Worker lifetime extension.
Manual sync handles at most 160 changed passages and resumes through a manifest.
Use Sync semantic memory while changes remain pending; no scheduler is claimed.
Interrupted indexing has a five-minute safety window before deletion/retry.

Records and approval history remain until withdrawn/deleted. Historical
approvals do not expire merely because another job is considered. Export
includes history and authenticated references for original downloads.

Withdrawals immediately exclude unsupported facts. Cleanup removes withdrawn
files. Whole-profile deletion persists a tombstone, removes known namespace/
file copies, then clears profile content. A content-free owner/revision guard
prevents stale requests recreating erased records; today's usage cap is retained
separately. Failures remain retryable. Provider
backups follow provider retention policies; immediate backup erasure is not
claimed.

## Setup

1. Save SUPABASE_URL and SUPABASE_SECRET_KEY in ignored .env.local.
2. Apply supabase/migrations/202610280001_profile_memory.sql using SQL Editor
   or an administrative connection. A runtime secret cannot run arbitrary SQL.
   Projects that ran revision 2026-10-29.1 should also run the small
   202610290002_profile_conflict_response.sql correction. Revision 2026-10-29.2
   uses PostgREST PT409 for expected stale-write conflicts rather than a
   transaction-rollback/server-error response.
3. Create a Gemini key in Google AI Studio on a free-tier project; save only to
   ignored `.env.local` as `GEMINI_API_KEY`. Never paste a key into chat or source.
4. Run node scripts/profile-setup.mjs pinecone-vectors.
5. Run node scripts/profile-setup.mjs check.
6. Configure allowlisted values as hosted server secrets.
7. Evaluate real extraction/retrieval using consented or fixture data.

`node scripts/profile-gemini-check.mjs` performs at most three live Gemini requests
using synthetic evidence: factual extraction and document/query embeddings. It
does not load Supabase user records, approve real facts or call OpenAI. A successful
smoke check does not establish representative JD/Builder or retrieval quality.

Gemini free-tier quotas and data-use terms apply to submitted text. The free tier
may use content to improve Google's products. This migration changes the provider,
not the privacy status or disclosure preference of existing records. Keep real
resume/account migration a separate deliberate step.

Never copy the private resume exercise into source or deployments. Its local
confirmations remain intact; account migration needs identity/source mapping.

## Validation and remaining gates

The earlier 2026-10-30 questionnaire-repair checkpoint passed 240 Node tests, 41 Python tests,
TypeScript and Ruff. A subsequent ongoing-employment precision adjustment passed
the 21-test Fact review suite. Final production-build verification is tracked
separately. Synthetic live questionnaire saving and replay succeeded; Gemini
extraction was temporarily unavailable, and the saved-answer failure receipt was
verified. The disposable synthetic profile was purged. This does not certify
successful live extraction for the repaired flow or representative user quality.

The seven-step completion, consolidated save guards and executed-handoff changes
have separate validation gates. Record full regression/build and browser/live
results when performed; no success for those new gates is implied by the earlier
questionnaire check. These changes remain local until explicitly published.

Tests exercise actual LangGraph, approval reuse, revocation, snapshots, source
validation, parser failures, model payloads, and real PostgreSQL migration/
permissions/revision/deletion behavior using PGlite.

Pinecone's synthetic transport test upserts/queries/deletes a vector without
embedding calls or personal documents. This does not prove semantic quality.

Remaining gates include representative real-model evaluation, browser/mobile QA
and publication/verification of the current hosted changes. Local Applications
already has real bound Tailor/Critic adapters; hosted Python runtime, durable
hosted package delivery and daily scheduling remain separate work. Historical
setup and release checks do not establish current provider availability.

## Workers transport verification

Provider requests use manual redirect mode and explicitly reject redirects.
Cloudflare Workers rejects redirect:error before sending a request; ordinary
Node tests do not catch this runtime difference. The regression tests in
tests/profile-worker.test.mjs execute the real provider module under workerd.
They cover profile load/health, private download, Pinecone, embeddings and model
transport with mocked responses, plus credential-preserving redirect rejection.

/api/profile/health is metadata-only behind the private Sites access gate. It
checks migration health and an empty random diagnostic owner through the exact
profile-loading RPC. It returns no keys, provider URLs or user records and grants
no visitor-profile access. It supports hosted transport checks without borrowing
a person's identity. Private profile endpoints still require visitor identity.

## Historical OpenAI analysis errors (before the Gemini migration)

An API key and successful model metadata requests do not establish available
credits or successful inference. A minimal synthetic analysis request on
2026-10-29 returned HTTP 429 with type insufficient_quota. Local credentials
were saved at that time. OpenAI is no longer the active Profile provider and is
not a fallback for the current Gemini flow.

The earlier OpenAI adapter used fixed, sanitized messages for exhausted credits, spend
limits, organization usage limits, generic insufficient quota, temporary rate
limits, authentication and model access. Specific billing codes take precedence
over the broader insufficient_quota type. Temporary throttling reports a valid
Retry-After delay when supplied. Provider messages and source text are never
reflected. No automatic model retries occur, including for billing failures.

The earlier Profile banner linked to OpenAI Platform billing and limits. The
current UI reports Gemini quota/availability errors. Failed analysis records a
failed run without replacing documents, facts or approvals; no partial model
proposals are accepted.

Node and actual Workers tests cover quota versus rate limits for both analysis
and embeddings. These checks validate failure handling, not real extraction or
semantic quality. Official error guidance:
https://developers.openai.com/api/docs/guides/error-codes

## Primary references

- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/getting-started/api-keys
- https://docs.pinecone.io/reference/api/2025-10/data-plane/upsert
- https://docs.pinecone.io/reference/api/2025-10/data-plane/query
- https://developers.openai.com/api/docs/guides/embeddings
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.cloudflare.com/workers/runtime-apis/request/
