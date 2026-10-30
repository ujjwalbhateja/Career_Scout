# Career Scout — current project context

Updated 2026-10-29, America/New_York. Repository/app root: `C:\Users\ujjwa\job_search`.

## Current structure

- One Git repository at the workspace root, preserving the application history. `package.json`, `app/`, `lib/`, `backend/`, tests and documentation are directly below it. The former `outputs/job-scout/` nesting has been removed.
- `Start-Scout.cmd` and `Start-Scout.ps1` launch from their own root. Local Node/npm are under `.local/tools`; caches are under `.local/cache`. The Python venv is regenerated after relocation.
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

## Python multi-agent foundation

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

## Next work

1. User amends agent prompts.
2. Connect Python Memory to current owner-scoped approved Profile/Supabase snapshots.
3. Connect existing Gemini Fact/Builder behavior, proposal persistence and explicit approvals.
4. Implement bounded Keenable Scout adapter with structured job packets and tested keyword semantics.
5. Add real Matcher, Tailor, Critic and idempotent application-storage adapters.
6. Add authenticated Python hosting, durable recovery/checkpoints, stale-revision guards before side effects, cancellation and redacted observability; then connect the web service.

GitHub CLI 2.103.3 is installed but was not signed in during the scaffold work. Existing Git remote configuration is retained. Do not create a public repo, push private material or deploy merely because a local commit exists.

## Root migration verification (2026-10-29)

- Preserved Git history and verified 160 protected file hashes, including the unchanged local environment file. Research, local tools/caches and private files are ignored and absent from the tracked tree. Removed generated tsconfig.tsbuildinfo from tracking while retaining its local copy.
- From the final root: 167 JS tests, 35 Python tests, Ruff, TypeScript and production build passed. The root Windows launcher served the profile workspace and progress API with HTTP 200. No paid provider call or real-profile operation was used for these checks.
- Local tracker revision: 2026-10-29.14; 93 tasks, 37 Complete, 19 In Progress, 37 Not Started. Counts/statuses are unchanged by this reorganization.
- The old C:\Users\ujjwa\Job Search directory is empty but held open by the active workspace. Open job_search.code-workspace (or the new root folder) in the IDE; the old empty directory can be removed when released. No compatibility symlink or duplicate app was created.
- Python tests now use backend/.cache/pytest because the old generated pytest cache retained restrictive permissions after the move. The stale cache is ignored; permissions were not weakened. The relocated venv was recreated from uv.lock.
- The local verification server is stopped after checking; restart with Start-Scout.cmd when needed.
