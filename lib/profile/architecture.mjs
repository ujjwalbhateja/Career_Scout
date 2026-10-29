import {progressCounts} from '../project-progress.mjs';

// Presentation maps stable task IDs. Status/evidence lives only in the reviewed
// progress record, shared with /progress; runtime configuration is separate.
export const PROFILE_LAYERS=[
  {id:'master',title:'Master',label:'Workflow coordination',description:'Routes requests and approved results. Approved role discovery is connected to Keenable; full pipeline dispatch remains pending.',tasks:['master-routing','master-profile-scout']},
  {id:'profile',title:'Profile Agent',label:'Your profile coordinator',description:'Owns intake, individual approvals, corrections, snapshots and the only interface to career memory.',tasks:['profile-subgraph','profile-document-parsers','profile-ingest','profile-approval','profile-consolidation','profile-data-lifecycle','profile-browser-review','profile-architecture-board']},
  {id:'fact',title:'Fact Agent',label:'Source text → factual proposals',description:'Extracts factual assertions with exact quotations. It cannot approve a fact, access memory directly or infer experience from a JD.',tasks:['fact-personal','fact-employment','fact-education','fact-records']},
  {id:'builder',title:'Profile Builder',label:'Approved resume facts; JDs optional',description:'Proposes role profiles, requirement mappings and useful questions. Resume-only building skips JDs. Optional JD building uses 10–15 selected and analyzed descriptions; saved profiles can be reused.',tasks:['builder-intake','builder-requirements','builder-confirmation','builder-profiles','builder-resume-only']},
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
