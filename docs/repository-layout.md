# Repository layout

The app and Git repository share one root: `C:\Users\ujjwa\job_search`.

```text
job_search/
  .git/                 Existing application history
  app/                  Web pages and API routes
  backend/              Python package, agent.py files and editable prompts
  lib/                  Existing JavaScript services and workflow contracts
  components/, hooks/   Web components
  data/                 Reviewed project-progress record
  docs/                 Maintained architecture and sanitized project handoff
  scripts/, tests/      Maintained automation and app tests
  supabase/, db/, drizzle/  Database code and migrations
  public/, vendor/, build/  App assets, dependencies and hosting integration
  research/             LOCAL ONLY: consolidated research and private history
    inputs/             Original supplied architecture material
    architecture/       Earlier design documents and interactive blueprint
    private/            Personal resume intake and evidence records
    migration/          Earlier migration manifests and verification records
    work/               Historical analysis scripts, reports and release archives
    previews/           Previous screenshots
    archive/            Superseded workspace documentation
    PROJECT_CONTEXT.md  Full historical handoff, including private intake history
  .local/               LOCAL ONLY: tools, caches and preserved generated state
    tools/              Existing bundled Node and npm
    cache/              npm, pnpm and uv caches
    backups/            Prior generated state and migration integrity manifest
  .env.local            LOCAL ONLY: existing credentials, preserved unchanged
  package.json          Run the web app from this root
  Start-Scout.cmd        Windows launch without changing PowerShell policy
  Start-Scout.ps1        PowerShell launch when scripts are permitted
```

## Run from the root

Open this root folder in the IDE. On this machine run `Start-Scout.cmd`, or run `npm run dev` with Node 22.13+ and npm on PATH. The existing development port is 5173. The PowerShell launcher is also relative to its own location; no launcher depends on the old folder name.

For Python, run uv from `backend/` with Python 3.12+. The environment is regenerated after relocation because virtual environments contain absolute installation paths. See [the backend guide](../backend/README.md).

## Version-control boundary

Track application source, agent prompts, tests, configuration, maintained docs and lockfiles. `.gitignore` excludes the entire `research/` and `.local/` trees, credentials, installed dependencies and generated builds. `.dockerignore` applies equivalent exclusions to future container contexts. Research is available locally but is not part of a fresh clone or remote push. Promote a reviewed, sanitized result into `docs/` or a maintained script/test if it needs version control.

The existing `.git` directory was promoted with the app. Existing file paths relative to Git, commits and remote configuration are preserved. No new empty repository, nested application repository, force push or remote publication is required for this move.

Historical scripts/manifests in `research/` retain their original paths as evidence. They are archived, not supported launch or migration commands. Do not run old migration scripts against the new root; some were one-off repair tools. Current commands belong in `scripts/` and the root launchers.

## Context and deployment

Use [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) as the current, version-controlled handoff. The full older context is retained locally in `research/PROJECT_CONTEXT.md` and must not be force-added. Existing hosting identity and private access remain unchanged. A local filesystem migration does not deploy a new hosted version.
