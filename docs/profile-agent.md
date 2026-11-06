# Profile Agent documentation and standalone repository

Prepared November 5, 2026, from Career Scout commit `cedc267896578988c2c4607e5cd0877e45e28f39`.

The user requested documentation explaining Profile Agent, its Fact and Profile Builder subagents, tools/APIs and diagrams, plus a separate public repository containing runnable code and documentation.

- [Standalone repository](https://github.com/ujjwalbhateja/Career-Scout-Profile-Agent)
- [Full Profile Agent documentation and diagrams](https://github.com/ujjwalbhateja/Career-Scout-Profile-Agent/blob/main/docs/PROFILE_AGENT.md)
- [Setup and operation](https://github.com/ujjwalbhateja/Career-Scout-Profile-Agent/blob/main/docs/SETUP.md)
- [API and integration](https://github.com/ujjwalbhateja/Career-Scout-Profile-Agent/blob/main/docs/API.md)
- [Validation and limitations](https://github.com/ujjwalbhateja/Career-Scout-Profile-Agent/blob/main/docs/VALIDATION.md)

The standalone library/CLI preserves the current JavaScript Profile service, its import dependencies, four Profile-family prompts, two Supabase migrations and selected regression tests. It does not reproduce the Career Scout browser UI or activate Scout, matching, applications or reminders. The older Python Profile graph is documented separately from the current JavaScript workflow.

Profile coordinates Fact extraction and Profile Builder's JD comparison/questions. Profile alone owns memory, explicit decisions and verified saving. Gemini supplies model analysis; Supabase holds authoritative records/originals; optional Gemini embeddings and Pinecone support derived retrieval. Source-stated, user-confirmed and independently verified records remain distinct.

Standalone validation passed 185 tests and verified all 52 copied upstream file hashes. No Career Scout application code, prompts, saved profile data, progress statuses or provider configuration changed during this documentation/extraction work. Live-provider and representative user validation remain separate.
