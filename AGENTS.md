# Keeping project progress accurate

When implementing or changing a capability, update `data/scout-progress.json` in the same change. This reviewed record powers `/progress`; polling does not infer feature completion from code, Git or provider health.

- Use `not_started`, `in_progress`, `blocked`, `in_review`, and `complete`, displayed as Not Started, In Progress, Blocked, In Review, and Complete. Mark Complete only with implementation and concrete validation evidence. Preserve the actual progress of partially completed work.
- Every point has an owner, dependencies, acceptance criteria, blockers, notes and output links. Responsibilities may be reassigned. Preserve IDs, original content/status and `ownerHistory` for legacy tracker points; never delete a point to change its owner. The user's later clarification supersedes the earlier request to keep all legacy ownership under Scout.
- Master is the only coordinator for Profile, Scout, Matcher, Tailor and Critic. Profile alone coordinates Fact Agent and Profile Builder and accesses profile memory. The Critic is Master's validation sub-agent. Communication must satisfy `lib/workflow/policy.mjs`; dependencies do not grant direct communication rights.
- The LangGraph foundation uses explicitly injected adapters. Never report fixture adapters or a compiled graph as a complete production agent. Profile memory now follows the approved Supabase + Pinecone design in docs/profile-workflow.md; hosted schema/model activation and real-model/browser validation remain separate gates. General daily checkpoints and application storage remain tracked gaps.
- Profile facts are approved by individual version. Preserve confirmation versus independent verification. Saved snapshots reuse approvals through Profile and Memory. JD requirements never establish user experience. Keep private local resume examples outside deployments.
- Keep task IDs stable, dependencies valid and acyclic, and acceptance criteria explicit. Add new capabilities as new tasks; do not silently change the denominator to inflate progress.
- Update `reviewedOn`, `revision` and relevant validation entries with actual user-local dates and results. Historical checks must retain their dates and scope. Do not call them current runtime health checks.
- Configuration presence is not provider authentication, available credits or successful search. Never put credentials, resume details or verification tokens in this record.
- Update the workspace `outputs/PROJECT_CONTEXT.md` handoff after meaningful releases. Preserve deployment identity and private access.
