# Career Scout Python agents

This is the new **backend foundation**, not a replacement for the deployed JavaScript service yet. It compiles and runs real LangGraph orchestration with typed, explicitly injected tool adapters. Default adapters are deliberately unbound. No API key, provider request, paid fallback or sample result is used by default.

## Start here

1. Read [the architecture and migration plan](../docs/python-agent-architecture.md).
2. Edit the ten `src/career_scout/agents/*/prompt.md` files. Each sits beside its `agent.py`.
3. Inspect `contracts.py` for input/output types and `catalog.py` for registered tools.
4. Implement and bind the Memory and existing Profile-service adapters first. Keep approvals in authoritative storage.
5. Connect one provider at a time, validate it, then add the authenticated web-to-Python bridge.

## Layout

```text
backend/
  pyproject.toml             # package, CLI, dependency bounds and tooling
  uv.lock                   # exact dependency resolution
  src/career_scout/
    agent.py                # production composition entrypoint: async run(...)
    contracts.py            # version-one typed payloads
    policy.py               # routes, draft fingerprints and review gates
    tools.py                # tool registry, scopes, budgets, timeouts, prompt loading
    catalog.py              # explicitly registered tool contracts
    agents/
      master/               # top-level LangGraph coordinator
      profile/              # nested LangGraph coordinator
      fact/
      profile_builder/
      memory/
      scout/
      matcher/
      tailor/
      critic/
      application_storage/
        agent.py            # each folder contains both files
        prompt.md
  tests/                    # synthetic adapters; no network or private resumes
```

The existing `app/`, `lib/`, `supabase/`, `tests/` and `scripts/` at repository root remain the current web app, service, migrations and checks. We are extending the repo as a web + Python backend layout rather than moving functioning routes during a backend-only change.

## Install and check

Use Python 3.12+ and uv from a terminal in `backend`:

```powershell
uv sync --locked
uv run --locked pytest -q
uv run --locked ruff check .
uv run --locked python -m career_scout.agent check
uv run --locked python -m career_scout.agent contracts
uv build
```

`check` must print `needs_resume` and zero tool calls. It does not check provider health. `contracts` prints all eight JSON schemas without reading `.env.local`.

This machine's existing Python launcher is blocked by Windows Application Control. The installed Codex Python runtime works; use an explicit interpreter with uv if needed:

```powershell
$env:UV_CACHE_DIR = 'C:\Users\ujjwa\Job Search\work\uv-cache'
uv sync --locked --python 'C:\Users\ujjwa\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
.\.venv\Scripts\python.exe -m pytest -q
```

No security control was disabled. Git already exists in the Codex runtime. GitHub CLI is installed under `%LOCALAPPDATA%\Programs\GitHub CLI\bin`; new terminals receive the updated user PATH. GitHub sign-in and remote publishing are separate from a local Git commit.

## Bind an implementation

```python
from career_scout.agent import run
from career_scout.catalog import create_registry
from career_scout.contracts import RunContext, WorkflowRequest

registry = create_registry()


async def load_profile(payload, invocation):
    # Implement this through trusted Profile storage, not an LLM.
    # Check invocation.context.owner_id, payload.version, current revision,
    # source/fact/role approvals, revocations and evidence before returning.
    # Return ApprovedProfile or an object matching its schema.
    raise NotImplementedError("Connect the current Profile/Supabase service")


registry.bind("load_profile", load_profile)
# await run(WorkflowRequest(saved_profile_version="profile-1", ...),
#           context=server_authenticated_context, registry=registry)
```

Every bound async adapter receives a validated input and an `Invocation`. `Invocation.prompt` contains its editable prompt. Keep `Invocation.context` outside any model input; it carries trusted owner/request identity and limits. Registry sessions isolate budgets per invocation. Network tools must enforce their own request limits, URL restrictions and provider credentials; a tool-call budget does not count hidden provider retries. No automatic tool retries are configured. Storage adapters must deduplicate retries by owner + idempotency key and recover safely from ambiguous timeouts.

To add a tool: declare its request/result models, create a `ToolSpec` with one owner, register it, bind an async implementation, call it from that owner's agent, and test its allowed/denied scopes. Declare a new side effect explicitly. A prompt edit alone cannot add tools or bypass code-enforced permissions.

## Status and deployment limits

- Implemented locally: package/lockfile, coordinator graphs, ten agent/prompt packages, eight tool contracts, scoped calls, source-reference checks, human approval stops, shortlist/draft/review/storage gates, bounded revisions and offline regression tests.
- Pending: real Python provider adapters, durable checkpoints/resume, authenticated service boundary, revision checks immediately before external side effects, deployment/observability and live quality evaluation.
- Fresh intake returns proposed facts and pauses. Persist proposals and obtain user approval in the current Profile service. Invoke again with the approved snapshot version; Memory reloads current approvals. There is no in-memory approval toggle or checkpoint-resume endpoint.
- Supabase remains authoritative. Pinecone remains a derived semantic index using isolated Gemini embeddings. Neither is replaced by LangGraph's process memory.
- Google GenAI SDK is the intended Gemini adapter. It is not installed or called in this placeholder-only phase. Existing JS Gemini analysis/embedding calls are untouched.
- Do not expose raw graph state or accept `RunContext` from client JSON. Results may contain private profile content and belong only to the authenticated caller. Do not enable external tracing with private state until redaction/access controls are implemented.
- Python needs a separate service/runtime. The current Cloudflare/Sites JavaScript deployment does not execute this package. No deployment or GitHub push is implied by a local commit.
