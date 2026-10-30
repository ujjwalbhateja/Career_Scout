// Regenerate after reviewed status changes; no network/provider calls.
import {readFileSync,writeFileSync} from 'node:fs';
import {PROFILE_LAYERS,layerState,architectureTasks} from '../lib/profile/architecture.mjs';
import {validateProgress} from '../lib/project-progress.mjs';
import {ANALYSIS_MODEL,EMBEDDING_MODEL,EMBEDDING_DIMENSIONS} from '../lib/profile/providers.mjs';
const root=new URL('../',import.meta.url),record=validateProgress(JSON.parse(readFileSync(new URL('data/scout-progress.json',root),'utf8')));
const titles=Object.fromEntries(PROFILE_LAYERS.map(layer=>[layer.id,layer.title+' — '+layerState(record,layer.id).replaceAll('_',' ')]));
const graph=`flowchart TD
    U["You: documents, corrections and individual approvals"] <--> M["${titles.master}"]
    M <--> P["${titles.profile}"]
    M <--> SC["Scout: approved-role discovery"]
    SC <--> K["Keenable job search"]
    P <--> F["${titles.fact}"]
    P <--> B["${titles.builder}"]
    P <--> R["${titles.memory}"]
    F <--> A["${titles.analysis}"]
    B <--> A
    R <--> S[("${titles.supabase}")]
    R <--> E["${titles.embeddings}"]
    R <--> V[("${titles.pinecone}")]
`;
const text=`# Profile Agent: structure and reviewed progress

Reviewed ${record.reviewedOn}; record revision ${record.revision}. Generated from the same task mapping and reviewed record as /profile/architecture. States summarize tracked acceptance; they are not live health checks. There are ${architectureTasks(record).length} distinct items in the diagram, including Master dispatch; shared items are counted once.

\`\`\`mermaid
${graph}\`\`\`

Resume-only route: resume → approved facts → proposed roles → role approval → activated snapshot → Profile → Master → Scout → Keenable. JDs are optional; the guided builder accepts one optional analyzed JD (legacy JD mode retains 10–15). Search preferences remain user-controlled, and discovery does not establish job suitability.

Gemini provides analysis and embeddings. Supabase remains authoritative; Pinecone is a derived semantic index. Profile's memory interface mediates all storage and vector operations. Children cannot access memory or communicate directly. Model output is a proposal; only the user approves real facts and role profiles. JD requirements are not evidence of user experience.

## Layer status and work

${PROFILE_LAYERS.map(layer=>`### ${layer.title}\n\n${layer.description}\n\n`+layer.tasks.map(id=>{const task=record.tasks.find(task=>task.id===id);return `- **${task.status.replaceAll('_',' ')}** — ${task.title} (\`${id}\`)${task.blockers.length?': '+task.blockers.join(' '):''}${task.evidence?' Evidence: '+task.evidence:''}`;}).join('\n')).join('\n\n')}

## Current provider contract

- Analysis: ${ANALYSIS_MODEL}. Embeddings: ${EMBEDDING_MODEL}, ${EMBEDDING_DIMENSIONS} dimensions, document/query retrieval task types.
- Profile ignores legacy OpenAI keys and endpoint overrides; no paid fallback or automatic retry exists.
- Original files retain their existing owner paths. Gemini vectors use a separate per-owner namespace; different vector spaces are never mixed.
- Approvals, original quotations and saved snapshots are preserved. Legacy index locations remain recorded for explicit deletion.
- Missing/paused/quota-limited semantic search falls back to current approved database keyword evidence.
- Google AI Studio free-tier quotas and data-use terms apply. Keep billing disabled to remain on the free tier; this application does not inspect or change Google billing.

## Recorded validation

${record.validation.filter(item=>/Gemini|Profile/.test(item.title)).map(item=>`- ${item.date} — **${item.title}**: ${item.detail}`).join('\n')}

Interactive structure: /profile/architecture. Full reviewed tracker: /progress.
Regenerate this file with \`node scripts/profile-architecture-doc.mjs\` whenever the reviewed record changes.
`;
writeFileSync(new URL('docs/profile-architecture.md',root),text);
console.log(JSON.stringify({diagramDocument:'docs/profile-architecture.md',revision:record.revision,layers:PROFILE_LAYERS.length,distinctTasks:architectureTasks(record).length}));
