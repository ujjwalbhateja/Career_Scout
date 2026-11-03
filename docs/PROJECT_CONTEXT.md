# Career Scout — current project context

Updated 2026-11-03, America/New_York. Repository/app root: `C:\Users\ujjwa\job_search`.

## Latest checkpoint: Scout and Master prompts aligned with Step 4 (2026-11-03)

At the user's request, updated only `backend/src/career_scout/agents/scout/prompt.md` and `backend/src/career_scout/agents/master/prompt.md`. Existing instructions remain in place. Added the Step 4 requirements/results presentation contract, effective search preferences and defaults, partial salary-range matching, explicit sponsorship-refusal handling, newest-first display versus match groups, and the distinction between reviewed snapshots, restored browser results, partial leads and completed searches.

Both prompts retain the current Profile -> Master -> Scout route, same-version receipt checks, eligible resume information plus approved Builder additions, source-only evidence, privacy and no separate Final Profile save or repeated resume approval. Opening Step 4 is a preview, not authorization for a new search. Changed filters/profile content require a new search; old results must keep their original criteria and version. Browser-local job storage must not be described as a Supabase profile save or durable cross-device storage. Application preparation remains separate.

The Scout prompt still follows the invoked runtime schema: its Gemini planning stage selects exact supplied candidate terms; only the configured provider returns actual vacancies. Master remains a deterministic coordinator whose prompt documents policy rather than changing routing code. These edits do not change extraction, approvals, search implementation, profile records or other agents' prompts.

No additional agent prompt needs updating for this Step 4 change. Profile and Memory already cover current authoritative retrieval and approved additions. Fact Agent, Profile Builder, Matcher, Tailor, Critic and Application Storage keep their existing responsibilities. Do not extend prompt edits to those agents without a relevant workflow change and user authorization.

Validation: 70 targeted Node checks passed using the updated Scout prompt, covering source-term selection, current-profile loading, handoff guards, discovery policy, visa filtering, Step 4 result persistence/rendering and Markdown loading. This is local automated validation, not a new Gemini/provider search, visual acceptance or hosted deployment. No real profile writes or Git push occurred. Progress revision: `2026-11-03.8`.

## Previous checkpoint: Step 4 search requirements and shortlist (2026-11-03)

Step 4 is now **Search & shortlisted jobs**, with the search requirements and source-linked results on the Career Scout profile page. Jobs navigation and existing Jobs deep links enter this step. Scout obtains the current saved profile through the existing Profile/Master preview; the server still validates the version when a search starts. Fact Agent, Profile Builder, their prompts and approval/storage workflows are unchanged.

The local preview shows the ten previously reviewed openings as a dated research snapshot, with salary ranges, location, relevant areas, gaps and employer links. Unknown sponsorship stays unknown; ranges that only partly reach the salary minimum are labeled. This is not a new live search or a score for the current profile. Public job evidence is kept in ignored research/step4-shortlist.json, loaded only for loopback development by build/reviewed-shortlist-plugin.mjs; production exports null and does not bundle that local research. Without a snapshot the page opens the live search controls directly.

Search controls start with the requested New York/New Jersey/SF Bay Area/US remote, $180,000 USD/year and explicit-sponsorship-refusal filter for this local review, then retain edits separately. Profile-derived role titles come from the saved database profile. New requests keep the existing API, provenance, visa checks and handoff guards. No automatic paid research is triggered just by visiting Step 4. Completed search results retain the exact input criteria and content version in browser storage (not Supabase); changed filters or profile versions require a new search. Partial or failed streams do not overwrite the last completed saved search. Bookmarks, import, export and application actions remain available.

Validation: 661 Node checks, TypeScript and production build passed; focused tests cover result snapshots, Step 4 rendering, current profile selection, uncertainty labels and production exclusion of local research. Page and frontend modules return HTTP 200. Browser inspection showed the new navigation, but minimized-window/input limitations prevented full visual click-through. User acceptance and hosted publication remain separate. No profile writes, new model/search calls, Git push or hosted deployment were performed for this frontend change. Progress revision: 2026-11-03.7.

Local page: http://127.0.0.1:5173/?step=Search . If first-time local sign-in returns to the home page, select **04 Search & shortlisted jobs**.

## Previous checkpoint: optional work-visa search preference (2026-11-03)

Added **I am on a work visa** to Scout search filters. The user requested an optional parameter, not a change to their personal immigration status; it remains off unless selected. When enabled, jobs explicitly refusing employment visa sponsorship are excluded. Unstated or conflicting policies remain eligible for review and are not labeled as sponsorship offers. A general work-authorization requirement or an application question alone does not establish a refusal. Existing **Prefer visa sponsorship** remains a separate ranking preference.

The preference is carried through search criteria, cache identity, Profile/Master/Scout handoff receipts and the Python Preferences contract. Saved preferences preserve the value when an older form omits the field. Employer-page refusals remove provisional streamed results. Changing the search override binds a new plan receipt without changing the current professional profile content. Only the Scout prompt changed; Fact/Builder extraction, their prompts, approval rules and other agent prompts are unchanged.

Validation: the full Node regression suite, 50 Python tests, TypeScript, targeted Ruff and production build passed. New extraction, filtering, rendering, persistence and handoff tests cover opt-in defaults, explicit refusals, unknown/conflicting policies, unrelated negation, authorization-only wording, application questions, strict-detail compatibility, cache separation and streamed lead removal. Authenticated read-only previews carried the preference without changing the entire stored profile. The idle local services were restarted to load the Python contract; pipeline health, page, compiled Scout module and profile preview returned HTTP 200. No real profile writes, approvals, model requests, live job searches, Git push or hosted deployment occurred. Visual browser/user acceptance is still separate. Progress revision: `2026-11-03.6`.

Local page: http://127.0.0.1:5173/ . Open **Jobs** and select the new checkbox in search filters. The local website is running; GitHub and hosted versions have not been updated for this change.

## Previous checkpoint: current workflow published to GitHub (2026-11-03)

At the user's request, pushed source commit `efdbb907f7f1c7992f3d5083ca2ed2bf5b7fa64d` to `main` in https://github.com/ujjwalbhateja/Career_Scout. GitHub confirmed that the repository is public. The 39-file source checkpoint contains the current factual-profile save/retrieval implementation, related regression tests and documentation, and exactly five updated agent prompts: Profile, Memory, Master, Scout and Profile Builder. Fact, Matcher, Tailor, Critic and Application Storage prompts are unchanged.

The current workflow saves approved Builder additions through Profile, verifies storage by reloading, and makes the same current profile available to Master and Scout without a separate Final Profile save or repeated resume approval. Local state and Git history were preserved. Local and remote `main` were synchronized before the fast-forward push.

Publication checks: scanned 329 source files with no credential-pattern or configured-secret matches and no private-input files in the upload. Verified that all 39 staged files matched their reviewed contents. The final five-prompt audit passed 95 Node checks and 49 Python tests; the production build passed during prompt alignment. Earlier implementation validation and the read-only live profile check are documented below. Private resumes, credentials, `.local/` diagnostics, installed runtimes and external Supabase profile records were not uploaded. This is a GitHub source update; no hosted application deployment or job search occurred. Progress revision `2026-11-03.5` records this publication without changing feature acceptance statuses.

## Previous checkpoint: agent prompts aligned with the current profile workflow (2026-11-03)

The user's intended scope is the five agents in the review table: Profile, Memory, Master, Scout and Profile Builder. Updated `backend/src/career_scout/agents/{profile,memory,master,scout,profile_builder}/prompt.md` to describe the implemented current-profile flow. Profile owns immediate Builder saves and verifies them by reloading authoritative storage. Master obtains the current eligible profile through Profile, then supplies professional search context from that same version to Scout when research is requested. No separate Final Profile save or repeated resume approval is required.

Scope correction: the initial edit also changed Matcher and Tailor prompts. That exceeded the user's intended five-agent scope. Both files have been restored byte-for-byte from their pre-edit backups; no Matcher or Tailor implementation code was changed. Do not extend this prompt update to those agents without a new explicit request.

The prompts distinguish source-stated resume information, user-confirmed additions and independently verified evidence. Rejected claims, unapproved Somewhat revisions, missing-source/conflicting records and unsupported JD requirements are excluded. Save failures cannot be reported as success; explicit retries preserve submission identity. Current-version checks, source/approval receipts, privacy, coordinator routes and application-package validation remain enforced by code.

Only Profile Builder's persistence section changed; its comparison, coverage thresholds, independent evidence review, questionnaire formats, Approve/Reject/Somewhat decisions and security/output sections remain byte-identical. Scout's search routes, recency, eligibility, vacancy verification, deduplication and result rules remain byte-identical. Fact, Matcher, Tailor, Critic and Application Storage prompts and all implementation files are unchanged relative to the pre-edit baseline. Existing uncommitted implementation work is preserved.

Validation before the scope correction: 88 focused Node tests, all 49 Python tests and the production build passed; seven progress/architecture checks also passed. After restoring Matcher and Tailor, exact file hashes match their original backups and the existing ten-agent prompt-loading test passed. Only the five requested prompt files retain changes. Prompt backups and audit are private under ignored `.local/current-profile-prompt-sync/`. No saved-profile mutation, Gemini request, questionnaire refresh, job search, Git push or hosted deployment was performed. These checks do not claim live-model output equivalence. The local Python prompt loader reads the files on each invocation; hosted bundles require their separate deployment. Progress revision: `2026-11-03.4`.

Current local page: http://127.0.0.1:5173/profile?step=Builder. The implementation checkpoint below describes the underlying workflow and its earlier live read-only verification.

## Previous checkpoint: one current profile, no Final Profile save step (2026-11-03)

The user explicitly approved removing the entire One Final Profile section and making Builder approvals immediately usable by Master and Scout. This supersedes the manual save/review gate described in the previous checkpoint. The save button, historical save timestamp, preview and extra pending-resume approval panel are removed from the website. Existing stored snapshot history is preserved for compatibility; current research no longer depends on it.

Profile Agent continues saving exact Builder decisions into the same authoritative Supabase record. It now reloads the record before acknowledging a Builder save and validates the stored decision, fact and owner approval. Retrying the same submission is idempotent after lost responses. Reject adds no claim; Somewhat remains a draft until separate approval of its exact revision. Fact/Builder extraction, questionnaire policies, prompts and views remain unchanged (16 protected file hashes verified).

`lib/profile/current-profile.mjs` reads existing source-backed resume records, the factual view's exact work passages and user-approved additions. It does not create another stored profile or approval. Pending resume approval/analysis flags do not block already source-matched information or confirmed additions. Rejected, withdrawn, conflicting, missing-source and foreign-approval claims are excluded. Resume statements retain source-stated status; Builder additions retain their individual approval receipts. JD requirements stay context, never candidate facts. Saved state is not rewritten or migrated by reading it.

Master requests the current record through Profile and Memory. A deterministic content version binds the eligible records, sources and preferences; Scout dispatch checks that same version before research. Handoff/history writes do not change the professional content version. Preview loads the latest record even from a URL referencing an old Final Profile; execution pins the verified result. Only scoped professional search terms leave Profile for Scout. The Python application boundary accepts this current version with a separate resume-source record type while retaining legacy snapshot validation. No Fact/Builder agent or prompt was changed.

Validation: 633 Node tests, 49 Python tests, TypeScript, Ruff and the production build passed. The live authenticated read-only preview returned all six existing approved Builder additions to Master/Scout plus resume-source context, without a Final Profile save or resume reapproval. The full profile remained identical at revision 194. After restarting the local app, the Python pipeline was healthy and the page, compiled workspace and current-profile previews returned HTTP 200. An old Final Profile bookmark also loaded the current profile successfully. Rendered UI tests confirm the removed section and usable research path with no snapshots. The current real-profile packet also passed Python contract validation. Progress and architecture checks passed with the new capability recorded at revision `2026-11-03.2`. No real approvals, Gemini requests, job searches, Git push or hosted deployment were performed. Private backup and audit: ignored `.local/current-profile-repair/`.

Current local page: http://127.0.0.1:5173/profile?step=Builder. Use Continue to Master & Scout to inspect the current stored profile, then start research explicitly. The user reports GitHub is public; keep private sources and diagnostics ignored. Browser click-through/user acceptance and hosted publication remain separate.

## Previous checkpoint: verified Final Profile save and Master/Scout handoff (2026-11-03)

Implemented the user-approved save/handoff repair. Fact Agent and Profile Builder code, prompts, extraction, grounding, decision policy and their views are unchanged: all 16 protected file hashes match the private baseline. Profile remains the only owner of profile memory and the coordinator of Fact/Builder. Master loads the saved profile through Profile and passes its scoped professional context to Scout.

The diagnosis found a stale legacy Final Profile, withdrawn earlier resume sources and a replacement resume whose full analysis was still pending. Existing finalization checks did not block that pending analysis or pending resume facts. Consequently a later save could omit unapproved resume records while including approved questionnaire additions. The repair does not recover withdrawn evidence, approve records, reanalyse the resume or change user decisions automatically. The real profile remains unchanged; completing resume analysis and reviewing pending records is still required before a new Final Profile can be saved.

`lib/profile/final-profile-integrity.mjs` checks complete resume analysis, outstanding resume decisions, exact approved fact versions, approval/source bindings and the stored consolidated/search projections. Save Final Profile retains bounded stale-comparison refresh and existing approval, conflict, quota, revision, deletion and indexing gates. After saving it reloads storage, checks the acknowledged revision and intended snapshot, and returns a content-hash receipt only after verification. Lost-response retries reuse the saved version. Legacy incomplete snapshots cannot bypass validation in current Master/Scout or Python pipeline loading.

Master's receipt and the persisted Scout dispatch carry the same profile version, snapshot ID and content hash. Profile rechecks them before the production discovery route starts research. Saving and previewing do not start Scout. Approved questionnaire additions remain permanent factual records; rejected and unapproved Somewhat statements are excluded. Search projection removes example-list punctuation without changing source statements or approval evidence.

The Final Profile panel now distinguishes saved additions, a verified Final Profile, Master loading and Scout dispatch. It routes incomplete analysis to Your Resume and offers explicit decisions for pending resume records through the existing fact-decision checks. Previously approved Builder answers are not asked again. It does not change the Factual Profile or Builder questionnaire views.

Validation: all 622 Node tests, 43 Python tests, TypeScript and production build passed. Python reported a cache-write warning only. Tests cover Builder approval-to-save-to-handoff, exact content/version binding, rejected/draft exclusion, pending source blockers, legacy bypass attempts, failed/incorrect storage reloads, concurrent additions, source withdrawal, idempotent retries, clean search terms and rendered readiness states. An isolated replay of the real state stopped before any writes/model calls; authenticated local reads confirmed the full profile stayed identical and the old handoff was blocked. The local page and updated modules returned HTTP 200. Private backup and audit: ignored `.local/profile-handoff-repair/` (never publish).

Local review: http://127.0.0.1:5173/profile?step=Builder. Progress revision `2026-11-03.1`; automatic Final Profile save remains In Review for real-user completion, live comparison-refresh acceptance and browser interaction acceptance. No real-profile save, approval, Gemini request, Keenable search, Git push or hosted deployment was performed for this repair. The user reports the GitHub repository is now public; the November 1 private-publication note below is historical, not current visibility verification.

## Previous checkpoint: private GitHub source repository (2026-11-01)

Repository: https://github.com/ujjwalbhateja/Career_Scout (private). Local origin points to https://github.com/ujjwalbhateja/Career_Scout.git and main tracks origin/main. Existing Git history was retained. The uploaded application checkpoint is 890cb717fccb07d3b836a995f22681e576a3bb26; its remote SHA matched the local commit. This documentation checkpoint follows that code upload.

Before publication, all 603 Node tests and the production build passed. A credential-pattern scan found no matches in 321 working files and 364 historical file versions. Existing ignore rules exclude local credentials, private resume inputs, research, caches, local runtimes and installed dependencies. This is source-code hosting only; Supabase profile data and other external service data are not copied into GitHub. No application hosting, collaborator invitations or profile changes occurred. Agent prompts were preserved as part of the current source checkpoint.

Use GitHub while signed in to the owner account or an explicitly invited collaborator account. Future source changes require a commit and push; they are not uploaded automatically. Runtime deployment remains a separate task with its existing authentication and acceptance gates. Progress revision 2026-11-01.13 records the publication evidence without changing feature-completion statuses.

## Previous checkpoint: Final Profile save timestamp on the main website (2026-11-01)

2026-11-01: One Final Profile now displays the latest successful snapshot save time in America/New_York, its version and validated current/outdated status. Historical stale saves stay visible without enabling handoff. Loading, never-saved and unavailable timestamp states are explicit. This is a successful-save timestamp, not a button-click audit. No agent prompt, Fact ingestion, approval, persistence or handoff rules changed.

2026-11-01: All 26 targeted save/status tests and TypeScript passed. Rendering checks cover historical stale saves, validated version matching, empty/loading/invalid timestamps and New York daylight-saving transitions. Authenticated local page and status module returned HTTP 200; read-only profile retrieval retained revision 194. No profile writes, model calls, hosted deployment or visual browser interaction were performed.

The main local website is http://127.0.0.1:5173/profile?step=Builder. Look under One Final Profile. The latest snapshot is read independently of the currently valid handoff snapshot, so an outdated save date remains visible; only savedPacket validation can establish current status. Save buttons and all existing guards are unchanged. No additional agent prompt updates are needed for this display change. Context, progress record and generated architecture documentation are updated at revision 2026-11-01.12.

Files: app/profile/final-profile-save-status.tsx, app/profile/workspace.tsx, tests/final-profile-save-status.test.mjs.

## Previous checkpoint: automatic guarded Final Profile save (2026-11-01)

Save Final Profile now performs server-owned preflight, bounded stale-JD analysis/comparison, full-selection validation and consolidated snapshot persistence. Current comparisons are reused only when document/requirement, source, fact, answer, decision, disclosure, policy and prompt bindings match. Missing bindings from older reviews trigger revalidation. Existing fact and questionnaire decisions are never generated or approved by this operation. Unresolved comparisons stop the save; explicit recheck is available. Existing finalization, source/approval binding, owner, revision, deletion and indexing guards remain. No Scout dispatch occurs during save.

2026-11-01: Full Node regression suite, 22 dedicated automatic-save checks, TypeScript and production build passed. Tests cover current-comparison reuse, new-JD-only refresh and assembly, changed facts/prompts, source coverage, required responses, pending extraction/facts, conflicts, deletion/indexing, missing model, provider/storage failure, concurrent edits, receipt tampering, unchanged retries, excluded drafts/rejections and no Scout dispatch. Read-only local preflight found three legacy comparisons needing binding refresh and no manual blockers; eight protected Fact/ingestion/view files stayed byte-identical. Local page/client modules returned HTTP 200. No real-profile save, real approval, live model request, hosted deployment or visual browser acceptance was performed.

The website invokes saveFinalProfile through the existing authenticated Master/Profile dispatch. Profile performs manual-blocker preflight before paid analysis, refreshes stale selected JDs once, rechecks the stored revision between stages and assembles independently current batches for the existing full-selection gate. A final compare-and-swap save creates the validated artifact; a retry of unchanged inputs reuses it. The client verifies snapshot identity, approval receipt, binding and returned artifact before announcing success. Needs-review results show their blockers without a success banner. A separate user-triggered recheck is offered only for unresolved comparisons. Provider failures never trigger retries or invented results. The save button does not start job research.

Relevant files: lib/profile/final-profile-save.mjs, lib/profile/service.mjs, lib/profile/client-state.mjs and app/profile/workspace.tsx. Agent prompts, Fact extraction and approval rules are unchanged. Private checks: .local/automatic-final-profile-*.log and .local/automatic-final-profile-preflight.json. The first save may refresh older comparisons that predate freshness bindings. Progress revision 2026-11-01.11 adds the explicit profile-automatic-final-save task as In Review; prior task IDs and statuses are preserved.

## Previous checkpoint: answered archive and incremental role questionnaires (2026-11-01)

2026-11-01: Approved, rejected and already-supported questionnaire rows now appear beneath a collapsed Already answered bar; pending, Somewhat revisions and source-review issues stay unfinished. New JD intake focuses the visible questionnaire on new roles and retains earlier questionnaires under a collapsed bar with an unfinished-item count. Analyze new roles sends only unreviewed selected document IDs; Profile validates that scope, extracts/compares only those JDs and preserves prior reviews, selected sources, facts, decisions and drafts. A separate explicit refresh-all action remains available for Final Profile readiness. All 577 Node tests and TypeScript passed, including scoped model input, approval/history preservation and archive rendering. Read-only rendering of the saved profile confirmed seven completed rows under the closed archive; local page and client modules returned HTTP 200. No real decisions, model requests or profile writes were made for this change; visual browser interaction and hosted deployment remain separate.

Current-role focus is derived from unreviewed selected JDs, then the latest saved comparison batch, so it survives reloads. Earlier unfinished questions remain accessible and are not labelled answered. Somewhat still requires separate revised-wording approval; rejected rows retain the explicit reopen control. Scope affects model input and comparison persistence without changing JD selection flags. Final Profile retains its existing full-comparison freshness gate; use Refresh all selected role comparisons when needed. Agent prompts and Fact ingestion are unchanged. Private read-only check: .local/builder-archive-check.mjs. Progress revision 2026-11-01.10; existing Builder review blockers remain.

## Previous checkpoint: LinkedIn search-link JD intake fixed (2026-11-01)

2026-11-01: Fixed LinkedIn selected-job search links at JD intake. A valid currentJobId on an official LinkedIn jobs/search or jobs/search-results URL is converted to the direct jobs/view posting before fetching; search/tracking parameters are discarded. Missing, malformed or conflicting selections receive an actionable error. Existing HTTPS, DNS, redirect, size and source-text guards remain enforced. The reported search page reproduced the unreadable-JD error before the fix; the normalized posting returned its actual title and description in a live read-only check. 21 targeted tests and TypeScript passed. No Gemini request, profile write, prompt change or hosted deployment occurred.

The normalization is in lib/profile/link-intake.mjs; regression tests are in tests/linkedin-jd-intake.test.mjs. Private live receipt: .local/linkedin-intake-review/verification.json. The user can paste their original selected-job search URL again in Builder. This handles that URL format; it does not guarantee access to closed or sign-in-only postings. Progress revision 2026-11-01.9; existing Builder acceptance blockers remain.

## Previous checkpoint: job-description intake moved to Builder (2026-11-01)

2026-11-01: Moved all JD intake (public link, file upload, pasted text and saved-source selection) from the resume step to the top of Expand experience and skills. Link entry is the default; import success directs the user to Analyze roles & refresh questionnaires. Resume text and JD text use separate drafts and explicit source kinds. Existing link reader, model logic, agent prompts, facts and approvals were not changed. TypeScript and 34 existing Builder/link-intake/workflow tests passed; authenticated local page and client module returned HTTP 200 without compile errors. Browser automation was unavailable, so visual interaction acceptance is not claimed. No profile mutations, model requests or hosted deployment were performed for this UI change.

Local page: http://127.0.0.1:5173/profile?step=Builder. Progress revision 2026-11-01.8; existing Builder review blockers and task status remain unchanged.

## Previous checkpoint: independent evidence review before Builder questions (2026-11-01)

The user approved fixing repeated questions despite existing source-supported experience, and updating the Profile Builder prompt. Scored proposed questions and invalid comparisons now receive one separate evidence review in batches of two. The review reads the saved source catalog and candidate passages without receiving the previous score. Candidate retrieval is only a review aid, not evidence of a match. The policy combines passages for general capabilities, separates duties/deliverables from audience qualifiers, rejects contradictory explanations with no evidence references, and preserves genuinely missing tools and responsibilities. Unsupported prospective-audience scope stays unconfirmed. Invalid second-pass comparisons remain unresolved instead of becoming broad approval questions. Provider failures are not automatically retried.

The saved prompt is `backend/src/career_scout/agents/profile_builder/prompt.md`. Existing 75% thresholds, source-versus-approved-evidence separation, exact decisions, Somewhat revision approval and Final Profile gates remain intact. Fact Agent and ingestion files were not edited. This adds model requests and latency for independent review; it is a bounded safeguard, not proof of exhaustive semantic accuracy.

Validation: 571 Node tests and TypeScript passed. Isolated Gemini output, revalidated against the final policy, recognized the reported collaboration/reporting example at 85% and communication at 100%; a synthetic genuinely missing mandatory tool remained 0% and a question. The full live refresh saved all 43 comparisons: 32 recorded, six skipped/deferred and three unresolved. The reported example is now an 85% minor-gap skip with its audience qualifier unconfirmed. Nine comparisons received independent review. Unresolved financial-return metrics, investor due diligence and daily risk-control comparisons remain visible separately. Exact before/after checks preserved factual records, approvals and all eight protected Fact/ingestion/view file hashes. No real decisions or approvals were made.

Private baseline, isolated responses, live response and verification are under ignored `.local/builder-evidence-review/`. An intermediate review was overly strict about duplicate evidence bookkeeping; final validation accounts for both review IDs and component citations. Local questionnaire: http://127.0.0.1:5173/profile?step=Builder. Progress revision `2026-11-01.7`; Builder remains In Review for unresolved comparisons, representative quality and real-user acceptance. No hosted deployment.

## Previous checkpoint: prompt-save build overlay fixed (2026-11-01)

Saving an agent prompt triggered a Vite import-analysis error because the RSC hot-update path transformed the bare `.md` module as JavaScript. Existing `?raw` imports were correct. `vite.config.ts` now narrowly registers `**/backend/src/career_scout/agents/*/prompt.md` in `assetsInclude`; bare module paths become asset modules while raw imports retain the full policy text. No dependency update, broad Markdown conversion, prompt wording change or model call was needed.

Two regression tests in `tests/agent-prompt-assets.test.mjs` reproduce the failure without asset classification and verify bare/raw paths, exact policy text and invalidated-module transformation in client, RSC and SSR environments. A live local authenticated WebSocket check re-saved the Builder, Fact and Scout prompt files with identical bytes, received an `rsc:update` for each with zero error events, and verified Profile HTTP 200. Private results are in `.local/prompt-hmr-review/live.json`. The production build passed. The existing dev server applied the config change; a browser refresh clears an old overlay. Profile data, approvals and questionnaire rules are preserved. Progress revision is `2026-11-01.6`; no hosted deployment.

## Previous checkpoint: 75% questionnaire coverage rule (2026-11-01)

The user approved the proposed semantic coverage filter and requested the complete updated Profile Builder prompt. The implementation and saved prompt now cover JD ingestion, specific professional headings, full saved-profile comparison, source coverage versus approvals, weighted coverage thresholds, grouped questions, explicit decisions and permanent approved additions.

`builder-question-policy.mjs` calculates estimated coverage from source-linked semantic components: core responsibilities weight 3, details weight 1. At least 75% suppresses only minor remaining differences; core or critical gaps still prompt review. At 50-74%, focused questions remain. Below 50%, only material requirements or critical gaps are asked; incidental differences are deferred. Missing mandatory qualifications are visibly routed to factual review rather than added as work or skills. Scores are estimates for question selection, not ATS scores, verification, or new claims. Existing comparisons without components are not assigned invented percentages.

Related pending gaps are combined within each role, professional heading and storage category. The exact grouped wording is approved as a unit; Somewhat preserves a draft and requires separate approval of the revision. Rejected decisions, source links and existing facts remain intact. The UI distinguishes recorded matches from skipped/deferred questions, lists their unconfirmed details and shows the reasons remaining questions are retained.

Live Gemini refresh saved 43 comparisons: 42 scored, 23 recorded matches, one >=75% minor-gap skip, four incidental deferrals, and one unresolved cross-asset comparison. The current role questionnaires contain 15 review rows (11 and four), compared with 23 previously. The unresolved comparison is not counted as a match. No missing detail was saved as a fact and no user decision was made. Private baseline, saved response, questionnaire projection and verification are in `.local/builder-threshold-review/`. The original Builder prompt is backed up there. Fact prompt/agent, resume parsing, factual projections and grounding files remained byte-identical; factual records and approvals were unchanged.

Validation: 561 Node tests and TypeScript passed, including threshold boundaries, important-gap overrides, duplicate/nested component rejection, skipped-versus-matched separation, grouped Somewhat persistence and rendered controls. Progress revision `2026-11-01.5`; capability remains In Review for the outstanding comparison and user interaction acceptance. No hosted deployment. Local questionnaire: http://127.0.0.1:5173/profile?step=Builder. Complete policy: `backend/src/career_scout/agents/profile_builder/prompt.md`.

## Previous checkpoint: source-aware Builder questions and specific headings (2026-11-01)

The questionnaire previously checked only approved fact IDs, although the Factual Profile displayed additional source-stated work and skills. It therefore repeated existing experience while approval remained pending. Generic work-area and skill-storage labels also obscured the actual JD topics. This checkpoint supersedes the earlier full-requirement fallback for the new Builder questionnaire.

Builder now receives a deduplicated catalog of the saved Professional Work Experience and grounded active skills. Source coverage is distinct from approved evidence: recognizing a recorded capability never approves or rewrites a fact. `builder-source-coverage.mjs` validates source IDs, source versions and verbatim missing JD spans. Rejected, conflicting, withdrawn or stale evidence cannot suppress questions. The approved-evidence mapping and Final Profile approval gates remain intact. Full matches appear under Already recorded; partial matches ask only remaining scope, with saved experience and original JD context available. Specific JD-derived professional headings label the work and skills tables without altering skill-storage categories or adding candidate claims.

Gemini receives requirements in batches of eight to keep its response schema bounded. One focused semantic refinement handles unsafe comparison output. Any still-unresolved comparison remains visibly separate without approval controls or a match claim. Provider/network failures are not automatically retried. No Fact prompt, Fact Agent, ingestion, factual projection or approval record was changed.

Live validation saved all 43 comparisons and reloaded them from Supabase. The two role questionnaires now have 17 already-recorded requirements, 23 remaining rows (13 and 10 by role), and three explicitly unresolved comparisons. The reported risk-reporting and financial-instrument/risk-metric requirements are covered without repeat questions. The cross-asset requirement is narrowed to source-unestablished asset-class/relationship details rather than repeating the complete requirement. Three other comparisons still need clarification; do not report exhaustive semantic matching as solved.

Validation: 555 Node tests and TypeScript passed, including pending-source reuse, exact gap-only approval, stale/rejected evidence, bounded refinement, and rendered matched/unresolved sections. Private before/after checks confirmed identical facts and approvals and identical hashes for eight protected Fact/ingestion/view files. Local artifacts are under `.local/builder-source-review/`; `verification.json` and `questionnaires.json` record the saved result. Earlier failed provider/schema/scope attempts did not save partial comparisons. Progress revision is `2026-11-01.4`, with Builder still In Review. Local site: http://127.0.0.1:5173/profile?step=Builder. No hosted deployment or real user decisions were performed.

## Previous checkpoint: actual questionnaires prepared and saved (2026-11-01)

At the user's explicit retry request, Gemini successfully analyzed the two previously retrieved public descriptions and compared their requirements against the current saved profile. The descriptions were added to Documents; no Fact Agent analysis or fact approval was performed. Website: **http://127.0.0.1:5173/profile?step=Builder**.

- Hilco / Manager, Portfolio Analytics & Reporting: **9 Professional Work Experience + 9 Skills** items.
- AQR / Market Risk, Vice President: **9 Professional Work Experience + 10 Skills** items.
- **43 requirements assessed; 37 review items**, all pending. Qualifications outside this expansion's work/skills scope are not shown as additions. The first supplied LinkedIn posting remains unavailable.
- The saved profile has two active approved facts and additional pending resume records. Pending source information is available as context but cannot establish approved support. Before/after comparisons confirmed that the complete facts and approvals arrays were unchanged. New JD documents, requirements, comparisons and questions were persisted; later background indexing did not change these factual decisions.

The retry revealed three concrete Builder issues: missing employer bullets in model JD extraction; partial-support claims without approved references (or references to pending records); and proposed wording outside source quotations. `lib/profile/builder-inputs.mjs` now preserves omitted literal bullets only under explicit employer duty/skill headings, excluding unrelated sections. Unsupported references or unsafe narrowing are discarded as evidence; the original full requirement becomes an unconfirmed review question. No invented reference or paraphrase is saved as a user fact. Other malformed assessments remain errors. `service.mjs` preserves expansion mode and exposes assessment failures appropriately. A trial enum schema was rejected by Gemini and reverted; the production schema remains compatible, with reference checks in code.

The new role questionnaires preserve complete statements rather than splitting conjunctions into fragments. The legacy review projection keeps its default atomic behavior. Fact Agent prompt/code and factual ingestion/view modules are unchanged. Live retries initially failed before the final successful comparison; the saved final review is not a synthetic test. Actual answers still require the user's own explicit decisions, including separate approval of revised Somewhat wording.

Validation: **546 Node tests and TypeScript passed**. Reloading the saved profile confirmed both questionnaire groups and unchanged facts/approvals. Private snapshots, attempts, diagnostics and verification are under `.local/builder-questionnaire-retry/`; `questionnaires.json`, `generated-record.json`, `final-verification.json`, `report.json` and `regression-final.log` record the final outcome. Do not copy private snapshots into tracked files. Progress revision is `2026-11-01.3`; the capability stays In Review pending user interaction acceptance. No hosted deployment occurred.

## Previous checkpoint: Profile Builder role questionnaires (2026-11-01)

The user subsequently requested a revised Profile Builder that uses the Factual Profile as its source of truth and expands only Professional Work Experience and Skills. This supersedes the earlier removal of all Builder review controls, without restoring the four old standalone steps. The local navigation now has Documents, Facts, **Expand experience and skills**, and Master/Scout. Direct link: **http://127.0.0.1:5173/profile?step=Builder**.

- The editable `backend/src/career_scout/agents/profile_builder/prompt.md` now specifies separate work and skills questionnaires per supplied role, grounded comparison with existing facts, and one shared Final Profile. Runtime gap-assessment instructions agree with this policy. Role titles without readable descriptions do not justify invented requirements.
- `lib/profile/builder-expansion.mjs` projects role-specific tables and implements the new `reviewBuilder` action through Profile-owned storage. Approve confirms the exact visible statement; Reject records a decision without adding a claim; Somewhat persists revised wording as a draft with no fact or approval. A separate **Approve revised wording** action binds approval to the saved text and revision. Stale requests fail, mixed batches are atomic, retries reuse the original receipt, existing approvals are preserved, and shared approved capabilities are reused. Decision history is retained.
- Confirmations create source documents containing the user's exact approved wording. Job requirements remain context metadata, never evidence of personal experience. New skills use the existing skill buckets; work claims enter the existing Professional Work Experience projection. No employer, date or metric is inferred from a target JD.
- `app/profile/builder-expansion.tsx` displays two tables per role and preserves failed-submission drafts. The workspace offers a current Final Profile preview and the existing validated save action. Approved factual additions are durable independently of finalization. Refresh comparison after additions, then save the single Final Profile. Unapproved revisions and rejections are excluded; unresolved discovery questions may remain gaps, while source/approval/conflict checks still apply. No automatic research starts.
- Fact Agent prompt/code, factual-view component, factual projection, literal resume extraction, evidence grounding and professional-experience projection were checked against pre-change hashes: **8/8 unchanged**. Test runs did not read or write the real user's saved profile. Existing legacy backend review handlers remain for compatibility; the revised website uses `reviewBuilder` and its separate revision gate.

Validation: **538 Node regression tests passed**, including eight new persistence/approval tests. A subsequent **19 focused checks** passed, including two new server-rendered questionnaire tests, ten decision tests and progress/architecture checks. TypeScript passed. The local `/profile?step=Builder` HTTP check returned 200 and showed four navigation steps including the new Builder entry. These checks are not full browser click-through or hosted publication.

The user requested Keenable retrieval for three LinkedIn examples. The first ID (`4485269884`) returned HTTP 422 and no verified matching description. The other LinkedIn pages exposed metadata/recommendations rather than full primary descriptions. Keenable title/employer searches retrieved a matching Hilco listing and an AQR employer posting. These are matching external sources, not a claim that LinkedIn itself supplied complete descriptions:

- Hilco: https://emploive.com/jobs/4733696/manager-portfolio-analytics-reporting-hilco-global-professional-services-llc
- AQR: https://careers.aqr.com/jobs?gh_jid=8220146

An isolated Gemini test attempted the first JD extraction and failed with a provider-unavailable error. **One model call attempted; no completed model analysis or comparison.** No automatic retry was performed. An offline source-bound subset test using the two retrieved descriptions and explicitly synthetic facts verified two role questionnaires, zero facts from a Somewhat draft, and one fact only after separate revision approval. It does not establish live model extraction quality.

Private artifacts are under `.local/builder-role-review/`: `before/`, `preservation-check.json`, `live-test-report.json`, `source-bound-report.json`, `source-bound-questionnaires.json`, `regression-tests.log`, `final-checks.log`, and the two `*-job-description.txt` fixtures. No test answer is an assertion about the real user. Reviewed progress revision is `2026-11-01.2`; the new `builder-role-expansion` task is **In Review**, with live model validation, user interaction acceptance and the unavailable first posting outstanding. Existing task IDs/statuses are retained. The architecture mapping and generated document reflect the new workflow.

## Previous checkpoint: four profile steps removed (2026-11-01)

The user requested removal of these website steps: Compare JDs with validated facts, Review missing JD experience, Review profile additions, and Build and save consolidated profile. `app/profile/workspace.tsx` now presents three numbered steps: Documents, Facts, and Send to Master and Scout. Removed panels cannot be reopened through old step query parameters, continuation buttons or automatic navigation after document analysis; analysis now returns to Facts. Document intake and the existing backend analysis actions remain unchanged.

Existing saved facts, approvals, snapshots and agent prompts were not modified. Backend comparison and consolidation capabilities remain intact, but their four website steps are unavailable. The remaining Master/Scout handoff still requires an existing saved validated profile; without one it explains the limitation and returns to Facts. No automatic approval, consolidation or job search was added to bypass this requirement. Jobs and data/privacy controls remain available.

Validation: TypeScript passed; 31 existing guided-workflow, Scout-handoff, progress and architecture tests passed. A read-only local HTTP check returned 200 for `/profile`, with exactly three server-rendered navigation buttons and none of the four removed steps. This was not a full browser interaction test or hosted deployment. Reviewed progress revision is `2026-11-01.1`; all task IDs and statuses were retained, and `docs/profile-architecture.md` was regenerated. Private pre-change file backups are under `.local/remove-profile-steps/`.

Local website: **http://127.0.0.1:5173/profile**. Refresh to load the updated navigation. This checkpoint supersedes earlier seven-step website descriptions; the prompt activation and comparison history below remains valid.

## Previous checkpoint: minimal PDF Fact prompt activated

The user authorized activating the tested minimal PDF-only Fact prompt, then explicitly requested this context update. This checkpoint supersedes the older UI and resume instructions below. It does not authorize further application changes, reanalysis, profile approvals, job searches or deployment.

### Active prompt and preserved behavior

- Active file: `backend/src/career_scout/agents/fact/prompt.md`. It exactly matches `.local/fact-pdf-prompt-review/draft-prompt.md` and the draft frozen in `.local/fact-pdf-prompt-comparison/`.
- Active SHA256: `e8ed6cbadd99cc42eb9aef62479e2765351df6d7b5c2cd32c662d4a24cb81c6d`.
- Previous prompt backup: `.local/fact-pdf-prompt-review/prompt-before-activation.md`. Activation receipt: `.local/fact-pdf-prompt-review/activation-receipt.json`; latest review state: `.local/fact-pdf-prompt-review/review-status.json`.
- The addition, **Evidence from extracted PDF text**, requires supplied document/segment identifiers, verbatim quotes preserving case, punctuation, numbers and qualifiers, separate citations for wrapped fragments, and complete source-listed skill items in their existing categories. Unreadable or missing text must not be invented.
- All previous prompt text was retained. The addition does not change record grouping, date calculations, approval rules or Section 1 presentation. Earlier larger comparison drafts were not activated.
- The latest agreed Section 1 presents factual records, each role's elapsed employment duration and supported experience, total work experience under Personal Details, and a Professional Work Experience table with key areas and source-supported experience. Durations respect source precision and avoid double-counting overlaps; ambiguous dates must not be assigned an assumed century.
- Section 2, inline source/approval-date details, the Professional Work Experience source/review-status column and the manual approval checker were removed from this presentation at the user's request. Keep underlying evidence and existing approvals intact. The older two-section UI descriptions below are historical, not instructions to restore those controls.

### Validation outcome: evidence passed, no-loss comparison did not

The minimal-draft comparison used one PDF and two DOCX resume fixtures, empty isolated profiles, identical source segments/schema/model settings, and a fixed as-of date of **2026-10-31**. Private resume contents and outputs remain under ignored `.local/`; do not copy them into tracked documentation or deployments.

- Six before/after Gemini runs completed. There were seven actual attempts including an initial HTTP 503. An additional retry was initially blocked by automatic approval review and was not sent; the user's subsequent **try to run again** instruction authorized retrying. No unapproved retry was sent.
- **46 local PDF/evidence tests passed**. All **309/309** raw evidence references matched their original segments exactly. All **37/37** prior work-experience statement texts were retained, with one additional statement; this does not mean every field or record was identical.
- The PDF draft improved education-institution extraction but omitted a contact-location field. One DOCX improved locations and education metrics but lost four leadership skills. The other DOCX lost a role qualifier, a scholarship and three location fields. These are real comparison regressions, not a passed equivalence check.
- Calculable durations remained unchanged. The fresh fixture with short-year dates remained unresolved in both phases; no century was inferred. A comparison-key difference caused a duration-equality flag even though the numerical duration behavior did not change.
- Local merged-pipeline checks also exposed pre-existing duplicate employment/education rows for one fixture. The minimal prompt did not resolve that defect.
- The historical report correctly retains `hold_regressions`. The user subsequently explicitly authorized activation despite those results; activation does not convert the comparison into a pass. A single before/after pair per resume does not establish repeatability or prove which prompt sentence caused an omission.
- After activation, the Python prompt-loading/path-safety test passed (**1 passed**). No full application suite or new live model run was performed during activation or this context update.

Private comparison artifacts: `.local/fact-pdf-prompt-comparison/comparison-report.json`, `results.html`, `merged-pipeline-check.json`, `preservation-check.json`, and `local-test-output.txt`. The report's `activePromptUpdated:false` records test-completion state; the later activation receipt records the subsequent authorized prompt update. Preserve both historical records.

### Remaining ingestion issues and safe continuation

Prior investigation identified code-level problems that prompt wording alone does not reliably fix:

1. `lib/profile/fact-review.mjs` can project free-text grouping scopes into company/institution fields, producing false conflicts. Short-year record identity can also prevent reconciliation of duplicate source records.
2. `lib/profile/service.mjs` accounts for a segment once any fact cites it or a nonempty review reason is supplied. It does not independently prove that every field, skill, qualifier or work clause was extracted. Zero unreviewed passages is not proof of complete ingestion.
3. Skill projection can split compound source-listed items; exact evidence grounding does not guarantee correct categorization or complete extraction.

There was no evidence that the larger draft was truncated: the full prompt reached the request builder and accepted outputs finished normally. Long-prompt adherence remains a hypothesis, not an established root cause. The web intake runs through the JS Profile service with the editable Fact prompt; the Python Fact agent is not a separate replacement intake implementation.

Existing PDF byte-preservation, literal extraction and conservative evidence-grounding fixes predate this prompt-only activation. They were not replaced. No OCR or broad fuzzy quote matching was added. Future work should isolate one ingestion defect at a time, validate captured/synthetic outputs locally, preserve fact IDs/versions and approvals, and obtain authorization for additional live comparison calls. Do not launch the previously discussed broader changes together or restore Section 2 as part of a PDF fix.

### Preservation and local access

- Before activation, the comparison preservation check found all 301 tracked/unignored project files unchanged. The saved profile was unchanged at the last read-only check: revision 126, 261 facts, 19 approvals, 7 documents. These are historical verification counts, not a new live database check.
- Activation changed only the active Fact prompt among those project files, with zero model calls and zero profile writes. No resume was reanalyzed, no approval was changed and no deployment occurred.
- This requested handoff update changes only `docs/PROJECT_CONTEXT.md`; it does not change capability statuses in `data/scout-progress.json`. Older progress/test totals below retain their historical scope.
- Local profile link: **http://127.0.0.1:5173/profile**. It returned HTTP 200 in the preceding link check; this context update performs no new runtime or browser verification. If the app is stopped, use `Start-Scout.cmd` from the repository root. No new hosted URL was deployed.

## Historical checkpoint: 2026-10-30 context update

The latest user request is to update this context file. The implementation below is complete locally; this checkpoint does not authorize additional application changes, profile decisions, job searches or deployment.

Resume with the existing documents and approvals:

1. Open http://127.0.0.1:5173/ and refresh. If the local app has stopped, run `Start-Scout.cmd` from the repository root. Verify any recorded launcher PID before stopping or restarting a process.
2. In **Facts**, choose **Re-read resume with Fact Agent** to rebuild older, incomplete extractions with the updated prompt. The user reviews and approves new proposals; retain all existing approval history.
3. Run the JD comparison against the updated factual records and cumulative experience. Review the single **Approve / Decline / Somewhat** table; do not introduce a second questionnaire or approval for its confirmed statements.
4. In **Step 5**, review profile additions and refresh the JD comparison. In **Step 6**, build and save the consolidated master profile.
5. In **Step 7**, review the saved Master-to-Scout handoff and explicitly start research when requested. Scout returns actual web openings; generated role directions are retired.

The last implementation checkpoint passed **399 Node tests + 43 Python tests (442 total)**, TypeScript, Ruff, production build and diff checks. Its disposable live Gemini/Supabase test used a synthetic resume and two JDs, saved two confirmed additions and two declines, verified replay and saved-profile inclusion, and purged the fixture. These are recorded results, not new tests or runtime health checks performed during this context-only update.

No real-user approvals were changed by that implementation verification. Hosted Site version 17 remains unchanged. Full browser/mobile interaction and representative real-user extraction/review remain outstanding. Progress revision is `2026-10-30.7`, with all 93 task IDs preserved. Relevant implementation files include `lib/profile/domain.mjs`, `service.mjs`, `fact-review.mjs`, `experience-bank.mjs`, `experience-review.mjs`, `jd-content.mjs`, and `app/profile/experience-review-table.tsx`; editable policies remain under `backend/src/career_scout/agents/{fact,profile_builder}/prompt.md`.

## Historical implementation: two profile sections and inline JD decisions

The user authorized updating the project using the latest Fact and Profile Builder prompt drafts from chat after the saved files still contained the earlier instructions. Both editable prompt files now encode the agreed operational contract.

- Section 1 groups personal/employment/education/certification/declared-skill facts with source, version and approval details. Distinct stints at one employer remain separate. Legacy source-derived context is visibly pending review. Legacy/structured records merge only with corroborating role, parsed dates and surviving source segments, preserving every original approval; uncertain duplicates remain separate and flagged.
- Section 2 is a cumulative bank of atomic resume responsibilities, client work and achievements plus exact user-confirmed additions from JD review. No employer, period, metric, degree, tool application or authority is inferred. Missing links stay unspecified.
- The single JD review table uses Approve / Decline / Somewhat. Approve saves the displayed statement; Somewhat saves only inline edited wording; Decline adds no fact and remains suppressed until explicit reopening. There is no extra example request or second approval for these table decisions. Existing free-text answer history remains available.
- The new reviewExperience action validates authoritative proposal fingerprints and saves answers, per-row user-confirmation source passages, fact versions, approvals and the receipt atomically. Identical retries return the original receipt before revision checking. Sources are answer documents; JD references are requirement metadata only. Batch siblings do not share fact evidence.
- Fact runs account for every paragraph using facts or explicit no-claim review reasons. Known unreviewed passages block finalization. Re-read previously analyzed resumes to extract omitted work; new proposals still need explicit approval.
- Builder compares all approved facts and Section 2 entries, preserves partial/missing support, and filters portal AI summaries, unrelated recommended jobs and navigation. Old requirement analyses are archived on reanalysis. Repeated gaps and user decisions are reused across later JDs.
- Step 5 reviews additions and refreshes the comparison; Step 6 builds/saves both sections in the master profile. Master passes only the saved source-backed search context to Scout in Step 7 for actual web openings. Listed tools and qualification alternatives must not be promoted into project or degree claims.
- Primary onboarding runs in the JS Profile service using the editable backend Fact/Builder prompts. The Python application pipeline loads the approved saved profile through Profile/Memory and continues downstream; its legacy raw-source onboarding contracts do not implement a duplicate table.
- A bounded live Gemini/Supabase check used a disposable synthetic resume and two JDs: 13 proposed facts, all 9 paragraphs accounted, 4 review rows, 2 confirmed additions, 2 declines, replay without duplicate writes, saved profile with 4 approved experience claims and source-only search context. The fixture was purged. No actual job search ran in this check and no real user decision changed.
- Final local regression: 399 Node tests + 43 Python tests (442 total), TypeScript, Ruff, production build and diff checks passed. The reviewed record retains all 93 task IDs at revision 2026-10-30.7; the architecture document is regenerated.
- Hosted Site version 17 remains unchanged. Full browser/mobile click-through QA remains separate from HTTP, automated and synthetic-provider checks. The local launcher is kept running at http://127.0.0.1:5173/; its owned PID is stored in ignored .local/scout-launch.pid.

## Previous source-only workflow correction

The user explicitly requested implementation after the explanation-only handoff
below. That later instruction supersedes its no-change note and the earlier
assistant-chosen generated-role stage.

- The intended order is resume/Fact extraction and approvals, JD/Builder analysis,
  targeted questionnaire and factual validation, consolidated master-profile
  save, Master coordination, then Scout returning actual job openings. Step 3
  analyzes JDs and prepares questions; it no longer asks the user to approve
  generated role cards. Step 5 reviews answer facts and refreshes requirement
  assessments without a generated-role approval gate.
- `lib/profile/search-profile.mjs` deterministically projects approved,
  source-matched professional data. Employment titles must be explicit approved
  title fields. Selected JD titles must occur literally in their JD source and
  remain labelled employer-target requirements, not user experience. Missing
  titles remain missing; responsibility/skill routes can search without one.
- Consolidated summaries quote approved professional statements. Legacy AI role
  names, alternate titles, keywords and summaries are excluded even if previously
  approved. The saved source-only search artifact is bound to exact fact/source
  references, frozen JD/answer scope and preferences. Master uses profile scope
  `master-profile`, a structural identifier rather than a claimed job title.
- That earlier source-only implementation left real fact approvals unchanged. Its validation is historical; see the current update and reviewed progress record for later checks.

## Historical conversation handoff (2026-10-30, 18:09 America/New_York)

This section records the earlier explanation-only pause. Its statements about
authorization and the then-current role-card UI are historical; the current user
instruction above governs the implementation now.

- The user is leaving and requested this context update only. Their latest questions explicitly requested explanations without changes. No application, prompt, workflow, approval or deployment change is authorized by this handoff request.
- The user questioned **step 3: Explore target role directions**, including whether its cards are actual jobs. The cards are AI-generated preliminary role proposals based on approved facts and optional selected JDs. Past employment is displayed as supporting evidence. These cards are not vacancy listings retrieved from a portal, and Keenable does not run in this app step.
- The exact step-3 label and early placement were an assistant implementation choice. The Profile Builder prompt requires appropriate job families and target/related/alternative titles in section 6, and suitable-role evaluation from the validated profile in section 7. It does not explicitly prescribe an early role-approval stage before the questionnaire. The current UI order is therefore an interpretation, not a literal implementation of the prompt's numbered sequence. Do not describe that order as user-requested or assume the user has accepted it; they have not requested its removal or redesign yet.
- Actual profile-guided vacancy discovery begins with **Send to Master & start job research** in app step 7. A manual **Search** in Jobs also calls Keenable, using entered criteria. A previously numbered explanation's item 3 meant the internal Scout search phase, not app step 3; this distinction was clarified with the user.
- Explained discovery workflow: Master loads the saved approved version through Profile/Memory; Profile derives source-checked professional context; Gemini can prioritize supplied terms using the Scout prompt; Keenable performs web search and page fetches. Three conditional routes cover titles, responsibilities/industry, and specialist skills/function. Seven-day discovery expands to thirty days when fewer than five strong recent results remain, bounded to six searches and ten page fetches per invocation. Code checks available evidence, dates/deadlines/closure, preferences and duplicate history, then ranks and groups results. Discovery ranking uses rules and phrase matching; Matcher performs the deeper vacancy assessment during application preparation.
- The seven-step completion implementation and its validation are recorded below. The last read-only profile inspection found answer-fact proposals awaiting review and role analysis predating the latest responses. Re-read current state when resuming; do not approve facts or roles for the user or assume those observations remain current.
- The requested step-5 link was opened in the default browser: http://127.0.0.1:5173/?view=profile&step=Review%20answers . This is the local app. Hosted version 17 remains unchanged. Prior tests/health results below are historical evidence, not a new runtime/provider check performed for this context update.
- Resume from the user's next instruction. Preserve the distinction between generated role directions, approved factual profile content, and retrieved real vacancies. No code changes were made during the explanatory follow-ups.

## Local application pipeline (2026-10-30)

- `Start-Scout.cmd` / `Start-Scout.ps1` now launch the Python service and web app together. Use http://127.0.0.1:5173/ . The existing hosted Site remains version 17; local changes are not deployed.
- The existing JS Master/Profile intake persists resume documents, optional example JDs, per-version factual approvals and consolidated snapshots in Supabase. Users approve factual claims and explicitly save the consolidated master profile. Legacy role records remain historical compatibility data; the current path does not require their approval. See [pipeline-usage.md](pipeline-usage.md) for exact input steps.
- Applications accepts a specific target JD/title/company/application URL, a job selected from the Jobs dialog, or automatic bounded discovery. Python Master then loads current approvals through Profile/Memory, assesses suitability, tailors, runs two independent Gemini Critic checks, rechecks Profile and saves a validated package. Two revisions maximum by default; unresolved issues remain held.
- All eight Python tool contracts have real local production bindings. A fixed Node subprocess reuses the existing Gemini, Keenable and Profile transports without introducing a second provider implementation. Agent prompts reach their bindings; Master/Profile coordinator decisions remain deterministic. Default `create_registry()` is still deliberately unbound for library callers; the service explicitly supplies `production_registry()`.
- Loopback HTTP requires a temporary server-only token. The authenticated website supplies owner identity. Local SQLite records owner-scoped run history, completed-tool checkpoints and idempotent application packages in ignored `.local/pipeline/`. Retry/cancel/delete and validated eight-file ZIP downloads are connected to Applications. Static dev-server access to `.local/` and `research/` is denied.
- Memory is never cached. Current owner-specific snapshots, factual approvals, source-only search artifacts and surviving exact evidence are checked. A final Profile recheck and the local SQLite write are separate operations, not an atomic cross-store transaction. In-flight external results not yet checkpointed may be requested again after interruption.
- Live synthetic verification reached `ready_to_apply`, zero revisions, six tool calls, both Critic checks clean and a downloaded ZIP. Synthetic Supabase profiles were purged after fixing never-indexed-profile deletion to avoid unused Pinecone calls. A separate live bounded Keenable batch returned one verified packet. No real user resume or account approvals were used by these checks.
- Local web auth/health/history are verified. Browser-host/native accessibility failures prevented full visual/interaction QA; representative real-user onboarding and model quality are still open. Hosted Python deployment, atomic hosted stale-revision enforcement, daily quota/scheduling, alerts and rich resume exports remain separate work.

## Fact, Builder, Scout and questionnaire correction (2026-10-30)

- Local web Fact, Profile Builder and profile-linked Scout now load their editable prompts through the authenticated Python service. Hosted JS bundles the same files at build time; these local changes are not deployed. Fact/Builder runs record prompt source/hash. Scout may prioritize only supplied source-checked professional terms; deterministic code enforces discovery policy even if model planning is unavailable.
- Questionnaire saving is separate from Fact extraction. Responses are durably saved first, with a source document for substantive examples. Short factual answers are accepted without a minimum character count. A bare Yes saves `needs_details`, creates no experience facts, and remains open for an example. No, deferred and declined answers create no positive facts.
- Submissions carry a content-bound idempotency token. Replaying the same saved request returns the original receipt; a changed payload with the same token is rejected. Extraction failures explicitly preserve the saved answer and offer extraction from the same source. Answers do not start semantic indexing or its lease. Changed decisions flag linked approved facts for consistency review; approvals are not silently rewritten.
- The Facts screen includes a structured review of personal details, employment, education, certifications and explicit skill categories, using Missing / Not Provided markers. Code calculates source-backed employment date unions without double-counting overlaps and retains individual jobs. Missing/conflicting/imprecise dates block an accurate total. Month coverage and exact-day calculations are labelled separately; Present uses an explicitly supplied review date. Proposal/approval status is retained and does not imply independent verification.
- Profile-linked Scout projects approved facts into professional search terms, excluding raw resumes, contacts and employer identity. Up to three routes cover titles, responsibilities/industry and skills/function. Seven-day discovery expands to thirty days when recent strong results are sparse, with at most six search requests and ten verification fetches per invocation. Missing context, mandatory-qualification uncertainty, unknown posting dates and official-source verification remain explicit. Owner-scoped seen history suppresses unchanged results in Supabase for linked Jobs searches and the local journal for Python application discovery. No daily scheduler is claimed.
- Previous questionnaire-repair checkpoint: 240 Node tests, 41 Python tests, TypeScript and Ruff passed. A subsequent ongoing-employment date-precision fix passed all 21 Fact review tests. Live disposable-profile questionnaire save/replay succeeded, while Gemini Fact extraction was temporarily unavailable. The failed-extraction receipt preserved the saved answer and the synthetic profile was purged. This is not a claim of successful live extraction or representative user/browser QA.

## Explicit profile completion and research handoff (local update, 2026-10-30)

- My profile has seven steps: documents, resume facts, JD analysis, questionnaire, answer review, consolidated-profile save, and Master/Scout handoff. Step 5 exposes latest answers' extraction/approval state and refreshes requirement assessments; it does not show AI-generated role proposals.
- Step 6 projects a complete professional profile from approved source-backed facts, with a summary of exact professional statements, ten professional sections, requirement support/gaps, explicit verification status and linked evidence. `lib/profile/consolidated.mjs` is deterministic and makes no model/provider call or approval decision. Review-only previews are distinct from the user's explicit **Build & save consolidated profile** action.
- Finalization blocks unfinished Yes details, unfinished answer extraction, pending answer facts, conflicts, required unanswered questions and outdated requirement assessment. The saved snapshot includes `consolidated`, source-only `searchProfile`, exact fact versions, frozen JD/answer/assessment scope, search/disclosure preferences and a review fingerprint. Master/Profile revalidate the saved scope; subsequent data or preference changes cannot silently enter an older profile version. No generated-role approval is required.
- Step 7 shows the actual scoped handoff preview: saved profile version, literal employment/JD titles where supplied, performed responsibilities, skills/tools, industry, qualifications, preferences, missing context and planned routes. **Send to Master & start job research** opens Jobs and starts one bounded search returning actual vacancies. **Open search filters** only opens filters. Preview is separate from dispatch; completed/failed research has explicit status.
- Profile owns persisted handoff receipts. A dispatched receipt is saved before Keenable research, with the exact source-checked plan reference and agent route; completion/failure updates and persistence warnings remain visible. Raw resume/contact records stay outside search queries. A selected JD title is search-target evidence, never user experience, and missing titles do not trigger a fabricated replacement.
- This completion work does not approve or save the real user's profile automatically. Current full-suite/build, live-provider and browser verification must be recorded separately when performed. Hosted Site version 17 remains unchanged.

## Current structure

- One Git repository at the workspace root, preserving the application history. `package.json`, `app/`, `lib/`, `backend/`, tests and documentation are directly below it. The former `outputs/job-scout/` nesting has been removed.
- `Start-Scout.cmd` and `Start-Scout.ps1` launch both local services from their own root. Local Node/npm are under `.local/tools`; caches are under `.local/cache`. The Python venv is regenerated after relocation.
- Entire `research/` and `.local/` folders are ignored. Former inputs, migration, private material, work analysis/checks/archives and architecture artifacts are consolidated in `research/`. Existing credentials remain in ignored root `.env.local`.
- Full earlier context, including private intake history, is preserved in local-only `research/PROJECT_CONTEXT.md`. Historical paths there describe past layouts. Do not force-add that file or old migration scripts.
- See [repository-layout.md](repository-layout.md) for the map and Git/deployment boundaries.

## Hosted application

- Private live site: https://career-scout-ujjwa.halebard129.chatgpt.site/ . Root is My Profile; Jobs, Workflow and Progress are workspace views. Legacy `/profile`, `/workflow`, `/profile/architecture` and `/progress` routes redirect into the unified workspace.
- Last deployed version: 17, source `9f06912078fec9b551655dbe4d8178bf8dc75ae2`, project `appgprj_6ad81e748e0c81919bcc35b57ca498a0`, deployment `appgdep_6ae3eb90a9fc8191bdfa3eb2d51c0453`. Environment revision 3, owner-only access. The local Python scaffold and root reorganization are not deployed.
- Resume intake supports PDF/DOCX/TXT or pasted text. JDs are optional, with a public-link reader and guided 1–15 JD support. Fact decisions, role approvals and snapshot activation remain explicit user actions.
- Gemini is the selected analysis/embedding provider. Existing JS configuration uses Gemini 3.1 Flash-Lite and Gemini Embedding 001 (3072 dimensions); no OpenAI/paid fallback. Quota availability and representative model quality are separate validation requirements.
- Supabase holds authoritative private files, facts, per-version approvals, roles, snapshots and run history. Pinecone is a derived owner-scoped semantic index with Gemini vectors isolated from legacy embeddings. Never treat vector similarity or a JD requirement as evidence of user experience.
- Existing Master intake and Profile-to-Scout handoff work in JS. Hosted discovery uses the selected approved role and saved filters; Builder keywords remain metadata and are not yet automatically applied to Keenable queries.

## Python foundation baseline (2026-10-29)

The following records the original foundation. The local integration above supersedes its adapter/service pending statements; hosted deployment is still separate.

- Local foundation commit: `c02f7138d1348bbc48426bc91ffbc89a3db4eaa9`. Python LangGraph 1.2.18, Pydantic, uv.lock, `src/` package, CLI and tests in `backend/`.
- Production composition entrypoint: `backend/src/career_scout/agent.py`. Ten agent packages each contain `agent.py` and editable `prompt.md`. Master/Profile use real nested graph routing; eight provider/tool implementations remain explicitly unbound.
- Only Master coordinates Profile, Scout, Matcher, Tailor and Critic. Only Profile invokes Fact, Builder and Memory. Code enforces exact source quotes, approval stops, scoped Scout inputs, shortlist/draft identities, independent hash-bound Critic checks, bounded revisions and a matching durable storage receipt.
- Coordinator prompts document deterministic routing; edits do not change permissions. Bound tool adapters receive their agent prompt. Owner identity and credentials must stay outside model prompts and client-controlled inputs.
- No default network/model calls, fake approvals or fixture bindings in production composition. No authenticated Python service, durable checkpoint backend or website bridge is deployed yet.
- Design and next adapters: [python-agent-architecture.md](python-agent-architecture.md); setup: [backend guide](../backend/README.md).

## Validation and authoritative progress

- Python scaffold: 35 offline tests, Ruff, locked dependency sync, source/wheel builds and ten-prompt package inspection passed. Existing JS regression suite: 167 tests passed. Fixtures are synthetic and do not certify real adapters or model quality.
- Hosted version 17 previously passed 16 bounded HTTP/access checks plus local TypeScript/build and component checks. Those are historical release checks, not current provider-health claims. Full real-user/mobile onboarding and representative model evaluation remain open.
- Current status/evidence lives in `data/scout-progress.json`; preserve all legacy task IDs/history and distinguish local code, synthetic validation and deployment. Regenerate `docs/profile-architecture.md` after changes. Root restructuring does not complete any pending production agent.

## Next work after local integration

1. User completes the seven My profile steps, explicitly saves the consolidated profile, reviews the scoped handoff and starts job research.
2. Review representative matching, tailoring and Critic results on real user-selected jobs; finish browser/mobile onboarding QA.
3. Add a per-requirement match/evidence matrix, richer document exports and application outcome tracking.
4. Add durable daily usage budgets, scheduling and alerts when requested.
5. Deploy a separately hosted authenticated Python runtime and durable package storage, with atomic stale-revision guards before writes. The Cloudflare/Sites worker cannot execute the Python process.

GitHub CLI 2.103.3 is installed but was not signed in during the scaffold work. Existing Git remote configuration is retained. Do not create a public repo, push private material or deploy merely because a local commit exists.

## Root migration verification (2026-10-29)

- Preserved Git history and verified 160 protected file hashes, including the unchanged local environment file. Research, local tools/caches and private files are ignored and absent from the tracked tree. Removed generated tsconfig.tsbuildinfo from tracking while retaining its local copy.
- From the final root: 167 JS tests, 35 Python tests, Ruff, TypeScript and production build passed. The root Windows launcher served the profile workspace and progress API with HTTP 200. No paid provider call or real-profile operation was used for these checks.
- Local tracker revision: 2026-10-29.14; 93 tasks, 37 Complete, 19 In Progress, 37 Not Started. Counts/statuses are unchanged by this reorganization.
- The old C:\Users\ujjwa\Job Search directory is empty but held open by the active workspace. Open job_search.code-workspace (or the new root folder) in the IDE; the old empty directory can be removed when released. No compatibility symlink or duplicate app was created.
- Python tests now use backend/.cache/pytest because the old generated pytest cache retained restrictive permissions after the move. The stale cache is ignored; permissions were not weakened. The relocated venv was recreated from uv.lock.
- The local verification server is stopped after checking; restart with Start-Scout.cmd when needed.

## Windows command launcher correction (2026-10-30)

`Start-Scout.cmd` now invokes `scripts/start-pipeline.mjs`, matching the PowerShell launcher. The corrected command was executed with provider network access. The website, Python pipeline health and metadata-only Supabase profile connection/load probe returned HTTP 200 at http://127.0.0.1:5173/. The local app was left running for user intake.

## Profile Builder interview repair (2026-10-30)

The web Profile workflow uses the editable Profile Builder policy, loaded fresh from the local Python service for each Builder stage. One action analyzes all selected pending JDs and compares every requirement with approved facts. Omitted mappings get a bounded schema-complete evidence assessment; remaining unknowns stay explicit. Material gaps create grouped questions even when the model omits its interview. Yes confirmations save immediately and need a substantive example before Fact extraction and individual approval; No creates no experience. The current app uses a standalone requirement-assessment ledger and source-backed consolidated master profile, with no generated-role card or approval prerequisite. The UI shows coverage, source requirements and the questionnaire, including /?view=profile&step=Questions. Existing fact approvals were preserved. Hosted publication and full browser/mobile QA are separate.

Final local verification for revision 2026-10-30.4: 246 Node tests, 41 Python tests, TypeScript, Ruff and the production build passed. The authenticated Questions page, Python pipeline health bridge and Profile health returned HTTP 200. The latest disposable live extraction specifically returned Gemini HTTP 503 UNAVAILABLE; durable answer saving and duplicate-safe replay passed, and its synthetic profile was removed. The local app remains running; hosted version 17 is unchanged.

Verification for revision 2026-10-30.5: 292 Node tests, 41 Python tests, TypeScript and Ruff passed. A disposable live Supabase check saved the consolidated profile, loaded the identical version through both adapters, carried approved questionnaire evidence into the Master/Scout preview, and updated one dispatch/completion receipt without changing approvals; the fixture was purged. No real-user approvals or live vacancy searches were performed. Supabase JSONB key ordering is normalized in role/input/snapshot/preference comparisons while ordered arrays are retained. The revised step URLs and authenticated service health endpoints returned HTTP 200. Interactive browser QA remains unverified because browser access was unavailable and native input returned unavailable geometry. Final production build is checked separately.

Final release checks for revision 2026-10-30.5: production build and diff checks passed; revised client modules and completion styles returned HTTP 200 on the running local server. All 93 progress IDs were retained and validated, and the Profile architecture document was regenerated.

Final verification for user-corrected workflow, revision 2026-10-30.6: 322 Node tests, 43 Python tests, TypeScript, Ruff and production build passed. A live disposable Supabase profile saved without generated roles or role approvals; approved answer evidence reached source-only JS/Python contexts, missing titles stayed missing, handoff receipt persistence passed and the fixture was purged. A separate bounded Keenable source-fixture check returned three valid actual vacancy packets; no model-created jobs were used. The updated pages returned HTTP 200 and exposed JD analysis instead of generated role suggestions. The owned local launcher was restarted for Python changes; its recorded PID is in ignored .local/scout-launch.pid. Existing user factual decisions were not altered. Hosted version 17 remains unchanged; browser click-through is unverified.

Last read-only local check after the corrected restart: 14 active facts were approved, one prior snapshot and 12 legacy role-history records were retained. No factual decisions were written for the user. The source-backed workflow excludes that generated metadata; complete the current JD comparison and explicitly save a new consolidated profile before research. Pipeline and Profile health returned HTTP 200. These counts are observations at this checkpoint, not assumptions about later user changes.
