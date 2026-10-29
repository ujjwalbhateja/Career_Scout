# Profile workflow: Supabase and Pinecone

Implementation: 2026-10-29, America/New_York. This documents implemented code and
explicit activation gates; configuration alone is not successful operation.

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
- Embeddings: user-selected OpenAI text-embedding-3-large.
- Analysis: user-selected GPT Sol, configured as gpt-6.1-sol.

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

Chunking happens before embedding. OpenAI produces 3,072-value finite vectors.
Pinecone stores and queries them. Index-host identity, model and dimensions are
bound to synchronization state. Unchanged records are not re-embedded.

## JD and Builder records

Initial building requires 10–15 distinct selected and analyzed JDs. Later
application JDs can be added singly without repeating onboarding.

Preserve required/preferred tasks, skills, qualifications, experience, sector,
location and source passages. Builder returns proposed role profiles, keywords,
requirement mappings, explanations and questions linked to unmet requirements.
Reject missing/duplicate requirement mappings and unknown fact references.

Evidence mappings are candidate support, not eligibility proof. User approval of
the role profile is separate from factual approval. No JD requirement becomes a
user fact. New experience answers become documents for Fact extraction/review.

Questions retain canonical topics, scope and answered/declined/deferred states.
Common declined implementation-topic paraphrases and disclosure preferences are
suppressed. This conservative normalization needs real-model evaluation; it does
not guarantee perfect semantic equivalence. Never reuse an answer outside its
supported scope. Optional declined information does not block the whole profile.

## Approval reuse and new jobs

Batch approval applies to displayed fact versions, with individual exceptions.
Role profiles are reviewed separately. Activation creates an immutable snapshot.
Master can request profileInput.savedProfileVersion equal to current or an
explicit version. approvedProfileLoader(service) captures the trusted owner and
loads through Profile → Memory without repeating JD intake or fact approval.

Changing the onboarding selection does not silently alter an existing snapshot.
New finalization must match the newly assessed JD set. Document withdrawal,
changed facts or withdrawn approval invalidate affected dependencies.

New-JD assessments use only facts in their bound snapshot. They do not generate
tailored resumes or ATS percentages.

## Retrieval, indexing, deletion and retention

Direct lookup retrieves known facts. Whole-token keyword and Pinecone semantic
results are fused by reciprocal rank. Results are rehydrated against current
owned records; scores cannot authorize claims or revive withdrawn evidence.

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
3. Configure OpenAI API access through OpenAI Developers secure-key setup.
4. Run node scripts/profile-setup.mjs pinecone-vectors.
5. Run node scripts/profile-setup.mjs check.
6. Configure allowlisted values as hosted server secrets.
7. Evaluate real extraction/retrieval using consented or fixture data.

Never copy the private resume exercise into source or deployments. Its local
confirmations remain intact; account migration needs identity/source mapping.

## Validation and remaining gates

Tests exercise actual LangGraph, approval reuse, revocation, snapshots, source
validation, parser failures, model payloads, and real PostgreSQL migration/
permissions/revision/deletion behavior using PGlite.

Pinecone's synthetic transport test upserts/queries/deletes a vector without
embedding calls or personal documents. This does not prove semantic quality.

Remaining gates: hosted schema installation, model credentials, real-model
evaluation, browser QA and hosted end-to-end profile verification. Daily
scheduling, production Tailor/Critic generation and application delivery remain
separate existing work.

## Primary references

- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/getting-started/api-keys
- https://docs.pinecone.io/reference/api/2025-10/data-plane/upsert
- https://docs.pinecone.io/reference/api/2025-10/data-plane/query
- https://developers.openai.com/api/docs/guides/embeddings
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
