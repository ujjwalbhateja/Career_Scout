// Profile-owned save/handoff checks. Never extracts, approves or changes a fact.
import {approvedFacts,canonicalJSON,digest,ProfileError,savedPacket} from './domain.mjs';
import {buildConsolidatedProfile} from './consolidated.mjs';

const refs=facts=>facts.map(f=>({id:f.id,version:f.version,approvalRef:f.approvalRef})).sort((a,b)=>a.id.localeCompare(b.id)||a.version-b.version);
export function finalProfileInputBlockers(state){
  const resumes=state.documents.filter(d=>d.kind==='resume'&&!d.deleted);
  const blockers=resumes.filter(d=>d.analysis!=='complete').map(d=>({code:'resume_analysis_pending',documentId:d.id,message:'Finish analyzing the current resume in Your Resume before saving the Final Profile. Initial factual blocks do not mean the full resume has been analyzed.'}));
  const pending=state.facts.filter(f=>f.lifecycle==='active'&&f.approval==='pending'&&(f.origin==='resume'||f.evidence?.some(e=>resumes.some(d=>d.id===e.documentId))));
  if(pending.length)blockers.push({code:'resume_facts_pending',factIds:pending.map(f=>f.id),message:`${pending.length} resume records still need your explicit review. They cannot be silently excluded from a complete Final Profile or automatically approved.`});
  return blockers;
}

export function assertFinalProfileIntegrity(state,snapshot){
  const blockers=finalProfileInputBlockers(state);
  if(blockers.length)throw new ProfileError(blockers[0].message,409);
  const packet=savedPacket(state,snapshot?.version);
  if(!snapshot||packet.snapshot.id!==snapshot.id||!snapshot.consolidated||!snapshot.searchProfile)throw new ProfileError('Save the current consolidated Final Profile before handing it to Master.',409);
  const expected=refs(approvedFacts(state)),actual=refs(packet.facts.records);
  if(canonicalJSON(expected)!==canonicalJSON(actual))throw new ProfileError('The saved Final Profile omits or changes approved records. Save the current profile again.',409);
  const rebuilt=buildConsolidatedProfile(state,{snapshot,asOf:snapshot.profileAsOf});
  if(!rebuilt.binding.valid||canonicalJSON(rebuilt)!==canonicalJSON(snapshot.consolidated)||canonicalJSON(rebuilt.searchProfile)!==canonicalJSON(snapshot.searchProfile))throw new ProfileError('The saved Final Profile contents do not match their approved source records. Review and save again.',409);
  const professional=packet.facts.records.filter(f=>!['personal','preferences'].includes(f.category));
  const claims=[...Object.values(rebuilt.sections).flat(),...rebuilt.otherApprovedFacts];
  if(professional.some(f=>!claims.some(c=>c.id===f.id&&c.version===f.version&&c.statement===f.statement&&c.approvalRef===f.approvalRef)))throw new ProfileError('An approved professional statement is missing from the saved Final Profile.',409);
  return {packet,factRefs:expected,professionalFactCount:professional.length,questionnaireFactCount:professional.filter(f=>f.origin==='user_answer').length};
}

export async function finalProfileVerification(record,snapshot=record.state.snapshots.at(-1)){
  const checked=assertFinalProfileIntegrity(record.state,snapshot);
  return {schemaVersion:1,snapshotId:snapshot.id,profileVersion:snapshot.version,revision:record.revision,verifiedAt:new Date().toISOString(),factRefs:checked.factRefs,factCount:checked.factRefs.length,professionalFactCount:checked.professionalFactCount,questionnaireFactCount:checked.questionnaireFactCount,contentHash:await digest(canonicalJSON({snapshotId:snapshot.id,profileVersion:snapshot.version,approvalRef:snapshot.approvalRef,factRefs:checked.factRefs,consolidated:snapshot.consolidated,searchProfile:snapshot.searchProfile}))};
}

export async function finalProfileStatus(record){
  const s=record.state,snapshot=s.snapshots.at(-1),approved=approvedFacts(s).filter(f=>f.origin==='user_answer'&&!['personal','preferences'].includes(f.category));
  const status={approvedAdditions:approved.length,includedAdditions:0,blockers:finalProfileInputBlockers(s),verification:null,message:'No Final Profile saved yet.'};
  if(!snapshot)return status;
  try{status.verification=await finalProfileVerification(record,snapshot);status.includedAdditions=approved.filter(f=>snapshot.factRefs.some(r=>r.id===f.id&&r.version===f.version)).length;status.message='Saved Final Profile reloaded and verified.';}
  catch(e){status.message=e instanceof ProfileError?e.message:'The saved Final Profile could not be verified.';}
  return status;
}
