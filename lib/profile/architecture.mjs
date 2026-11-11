import {progressCounts} from '../project-progress.mjs';

// Presentation maps stable task IDs. Status/evidence lives only in the reviewed
// progress record, shared with /progress; runtime configuration is separate.
export const PROFILE_LAYERS=[
  {id:'master',title:'Master',label:'Workflow coordination',description:'Routes requests and approved results. The local Python pipeline now connects current-profile loading, bounded discovery, matching, tailoring, independent Critic checks and local validated packages. Hosted Python deployment and representative user validation remain separate.',tasks:['master-routing','master-profile-scout','master-guided-intake','master-python-foundation','master-python-adapters','master-python-service']},
  {id:'profile',title:'Profile',label:'Collect, validate, approve and save',description:'Owns one current factual profile. Builder approvals are saved immediately and verified by reloading Supabase. Master requests the latest resume-sourced information and approved additions through Profile; there is no separate Final Profile save step. Existing Fact/Builder extraction and decisions are unchanged.',tasks:['profile-subgraph','profile-document-parsers','profile-ingest','profile-approval','profile-consolidation','profile-data-lifecycle','profile-browser-review','profile-architecture-board','profile-guided-workspace','profile-automatic-final-save','profile-current-record-handoff','profile-public-visitor-access']},
  {id:'fact',title:'Fact Agent',label:'Source text → factual proposals',description:'Reads its editable prompt and accounts for every resume passage. Section 1 groups factual records and separate employment stints; Section 2 organizes atomic responsibilities and achievements. Structured review flags missing fields and calculates source-precise employment duration without double-counting overlaps. User approval remains separate; it cannot infer experience from a JD or access memory directly.',tasks:['fact-personal','fact-employment','fact-education','fact-records']},
  {id:'builder',title:'Profile Builder',label:'Expand experience and skills per role',description:'Uses the Factual Profile as its source of truth. Each supplied JD has separate work-experience and skills tables. Approve saves the exact statement; Reject excludes it; Somewhat saves a draft requiring a separate approval of revised wording. Profile alone persists approved additions and preserves existing fact versions. Job postings are context, never evidence of user experience. Confirmed additions are immediately available in the current stored profile used by Master and Scout. No separate Final Profile save is required.',tasks:['builder-intake','builder-requirements','builder-confirmation','builder-profiles','builder-resume-only','builder-jd-link-intake','builder-guided-single-jd','builder-role-expansion']},
  {id:'analysis',title:'Gemini analysis',label:'Read and interpret',description:'Gemini 3.1 Flash-Lite returns constrained JSON for extraction, JD analysis, role building and assessment. Code validates source evidence; you approve individual versions.',tasks:['profile-gemini-analysis','profile-provider-activation','profile-embedding-evaluation']},
  {id:'memory',title:'Profile memory interface',label:'Save, retrieve and reuse',description:'Profile alone reads and writes memory. Keyword retrieval stays available when embeddings are paused, missing or quota-limited.',tasks:['profile-memory-interface','memory-design','memory-implementation','profile-reuse-contract','profile-keyword-fallback']},
  {id:'supabase',title:'Supabase',label:'Authoritative records + private files',description:'Stores originals, source passages, factual proposals, approvals, role profiles, immutable snapshots and recovery history.',tasks:['profile-storage','profile-supabase-migration']},
  {id:'embeddings',title:'Gemini embeddings',label:'Text → 3,072 numbers',description:'Gemini Embedding 001 converts approved passages and search queries into vectors. A new per-owner namespace keeps Gemini and legacy OpenAI vectors separate.',tasks:['profile-gemini-embeddings','profile-provider-activation','profile-embedding-evaluation']},
  {id:'pinecone',title:'Pinecone',label:'Find related evidence',description:'Searches vectors by meaning. Matches are reloaded from current approved Supabase records; similarity cannot approve a claim or establish a qualification.',tasks:['profile-vector-transport','profile-gemini-embeddings']}
];

export function layerTasks(record,id){
  const layer=PROFILE_LAYERS.find(item=>item.id===id);if(!layer)throw new Error('Unknown Profile architecture layer.');
  return layer.tasks.map(taskId=>{const task=record.tasks.find(item=>item.id===taskId);if(!task)throw new Error('Profile architecture refers to a missing task.');return task;});
}
export function architectureTasks(record){
  const ids=new Set(PROFILE_LAYERS.flatMap(layer=>layer.tasks));
  return [...ids].map(id=>{const task=record.tasks.find(item=>item.id===id);if(!task)throw new Error('Profile architecture refers to a missing task.');return task;});
}
export function layerState(record,id){
  const counts=progressCounts(layerTasks(record,id));
  return counts.complete===counts.total?'complete':counts.blocked?'blocked':counts.in_progress||counts.in_review||counts.complete?'in_progress':'not_started';
}
