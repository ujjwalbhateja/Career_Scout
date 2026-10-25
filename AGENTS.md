# Keeping project progress accurate

When implementing or changing a capability, update `data/scout-progress.json` in the same change. This reviewed record powers `/progress`; polling does not infer feature completion from code, Git or provider health.

- Mark a deliverable `done` only with implementation and concrete validation evidence. Use `partial` for a genuine remaining acceptance gap and `pending` for unimplemented work.
- Keep task IDs stable, dependencies valid and acyclic, and acceptance criteria explicit. Add new capabilities as new tasks; do not silently change the denominator to inflate progress.
- Update `reviewedOn`, `revision` and relevant validation entries with actual user-local dates and results. Historical checks must retain their dates and scope. Do not call them current runtime health checks.
- Configuration presence is not provider authentication, available credits or successful search. Never put credentials, resume details or verification tokens in this record.
- Update the workspace `outputs/PROJECT_CONTEXT.md` handoff after meaningful releases. Preserve deployment identity and private access.
