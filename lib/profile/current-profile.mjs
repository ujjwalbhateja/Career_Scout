// Read the existing authoritative records; no finalization, provider calls,
// new facts, inferred approvals or extra stored profile are required.
import {canonicalJSON,digest,ProfileError} from './domain.mjs';
import {buildValidatedSearchProfile} from './search-profile.mjs';
import {buildProfessionalExperience} from './professional-experience.mjs';
import {confirmedRecord,resumeSourceRecord,recordSourceMatches} from './source-records.mjs';

export const currentProfileVersion=value=>typeof value==='string'&&/^current-[a-f0-9]{64}$/.test(value);
const professional=f=>!['personal','preferences'].includes(f.category);
const norm=value=>String(value||'').toLowerCase().replace(/\s+/g,' ').trim();
export function currentProfileRecords(state,owner){
  const records=state.facts.filter(f=>confirmedRecord(state,f,owner)||f.approval==='pending'&&resumeSourceRecord(state,f)).map(f=>({...structuredClone(f),confirmation:confirmedRecord(state,f,owner)?f.confirmation||'user_confirmed':'source_stated'}));
  // Reuse the existing factual view's exact resume work passages. These are
  // source statements, never new user-confirmed or model-generated facts.
  const denied=state.facts.filter(f=>f.lifecycle==='active'&&(f.conflict||['rejected','withdrawn'].includes(f.approval)));
  for(const row of buildProfessionalExperience(state).rows)for(const item of row.items){
    if(item.origin!=='resume'||records.some(f=>norm(f.statement)===norm(item.statement)))continue;
    if(denied.some(f=>norm(f.statement)===norm(item.statement)||f.evidence.some(e=>item.sourceRefs.some(r=>r.documentId===e.documentId&&r.segmentId===e.segmentId&&(r.quote.includes(e.quote)||e.quote.includes(r.quote))))))continue;
    const record={id:item.id,version:1,category:'experience_claims',field:'resume_work',scope:item.employerRole||'Resume work experience',statement:item.statement,origin:'resume',approval:'pending',approvalRef:null,confirmation:'source_stated',lifecycle:'active',conflict:false,evidence:structuredClone(item.sourceRefs)};
    if(recordSourceMatches(state,record,['resume']))records.push(record);
  }
  return records;
}

export async function currentProfilePacket(record,owner,requested='current'){
  const s=record.state;if(!owner||s.deletion)throw new ProfileError('An active profile is required.',409);
  const records=currentProfileRecords(s,owner),searchProfile=buildValidatedSearchProfile({...s,facts:[...records].sort((a,b)=>Number(b.origin==='user_answer')-Number(a.origin==='user_answer'))},{includeResumeSources:true});
  if(!records.some(professional)||!searchProfile.hasSearchableContext)throw new ProfileError('Add readable resume information or approve experience and skills before starting profile-based research.',409);
  const searchPreferences=structuredClone(s.preferences.search||{});
  const contentHash=await digest(canonicalJSON({owner,records,searchProfile,searchPreferences,disclosure:s.preferences.disclosure||[]}));
  const version='current-'+contentHash;
  if(requested!=='current'&&requested!==version)throw new ProfileError('Your stored profile changed. Reload the profile preview to use its latest saved information.',409);
  searchProfile.version=version;searchProfile.label='Current stored profile';
  const refs=records.map(f=>({id:f.id,version:f.version,approvalRef:f.approvalRef||null,confirmation:f.confirmation}));
  const verification={schemaVersion:1,snapshotId:'current-profile',profileVersion:version,contentHash,revision:record.revision,verifiedAt:new Date().toISOString(),factRefs:refs,factCount:records.length,professionalFactCount:records.filter(professional).length,questionnaireFactCount:records.filter(f=>professional(f)&&f.origin==='user_answer').length};
  return {facts:{approvalStatus:'source_validated',version,sourceRef:contentHash,evidenceRefs:[...new Set(records.flatMap(f=>f.evidence.map(e=>e.segmentId)))],records},roleProfiles:[],searchProfile,
    snapshot:{id:'current-profile',version,createdAt:null,searchProfile},
    profileSummary:{saveVerification:verification,unresolvedQuestionCount:s.questions.filter(q=>['unresolved','needs_details','deferred'].includes(q.status)).length,pendingFactCount:records.filter(f=>f.approval==='pending'&&f.origin!=='resume').length},
    searchPreferences,searchHistory:s.scoutSeen||[]};
}

export async function currentProfileSummary(record,owner){
  try{const p=await currentProfilePacket(record,owner);return {ready:true,version:p.facts.version,verification:p.profileSummary.saveVerification,searchProfile:p.searchProfile,searchPreferences:p.searchPreferences};}
  catch(e){return {ready:false,message:e instanceof ProfileError?e.message:'Could not load the current stored profile.'};}
}
