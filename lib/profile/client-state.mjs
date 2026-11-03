// No provider calls or automatic decisions. These guards preserve exactly the
// fact versions and prior decisions the user saw before pressing a button.
import {savedPacket,canonicalJSON} from './domain.mjs';
import {assertFinalProfileIntegrity} from './final-profile-integrity.mjs';
export function finalProfileSaveReceiptMatches(record){
  const result=record?.result;
  if(result?.kind==='final_profile_needs_review')return result.saved===false&&Array.isArray(result.blockers)&&result.blockers.length>0&&result.blockers.every(b=>typeof b.code==='string'&&typeof b.message==='string');
  if(result?.kind!=='consolidated_profile_saved'||!record?.state)return false;
  try{
    const snapshot=savedPacket(record.state).snapshot;
    const checked=assertFinalProfileIntegrity(record.state,snapshot),verified=result.verification;
    if(!verified||verified.schemaVersion!==1||verified.snapshotId!==snapshot.id||verified.profileVersion!==snapshot.version||verified.revision!==record.revision||!Number.isFinite(Date.parse(verified.verifiedAt))||!/^[a-f0-9]{64}$/.test(verified.contentHash||'')||canonicalJSON(verified.factRefs)!==canonicalJSON(checked.factRefs))return false;
    return snapshot.id===result.id&&snapshot.version===result.version&&snapshot.approvalRef===result.approvalRef&&snapshot.consolidated?.binding?.valid===true&&canonicalJSON(snapshot.consolidated)===canonicalJSON(result.consolidated)&&record.state.approvals.some(a=>a.id===snapshot.approvalRef&&a.kind==='snapshot'&&a.recordId===snapshot.id&&a.recordVersion===snapshot.version&&a.decision==='approved');
  }catch{return false;}
}
export const factKey=fact=>fact.id+'.v'+fact.version;
export function latestRecord(current,incoming){
  if(!Number.isInteger(incoming?.revision)||!incoming.state)throw new Error('Profile returned an invalid saved record. Reload before continuing.');
  return incoming.revision>=current.revision?incoming:current;
}
export function factDecision(fact,decision){
  return {id:fact.id,version:fact.version,decision,expectedFingerprint:fact.fingerprint,expectedApproval:fact.approval,expectedApprovalRef:fact.approvalRef??null};
}
export function decisionBasesMatch(state,decisions){
  return decisions.length>0&&decisions.every(d=>{
    const fact=state.facts.find(f=>f.id===d.id&&f.version===d.version&&f.lifecycle==='active');
    return !!fact&&typeof d.expectedFingerprint==='string'&&fact.fingerprint===d.expectedFingerprint&&fact.approval===d.expectedApproval&&(fact.approvalRef??null)===d.expectedApprovalRef;
  });
}
export function decisionReceiptMatches(record,decisions){
  return decisions.length>0&&decisions.every(d=>record.state.facts.some(f=>f.id===d.id&&f.version===d.version&&f.lifecycle==='active'&&f.approval===d.decision));
}
export function answerReceiptMatches(record,body){
  const receipt=record?.result;
  if(receipt?.kind!=='answer_saved'||receipt.questionId!==body.questionId||(body.submissionId&&receipt.submissionId!==body.submissionId))return false;
  return record.state?.answers.some(answer=>answer.id===receipt.answerId&&answer.questionId===body.questionId&&answer.text===String(body.text??'').trim()&&(!body.capabilityDecision||answer.capabilityDecision===body.capabilityDecision)&&(answer.status===body.decision||body.decision==='answered'&&answer.status==='needs_details'))===true;
}
export function section1ReceiptMatches(record,body){
  const receipt=record?.result,state=record?.state;
  if(receipt?.kind!=='section1_extracted'||body.id&&receipt.documentId!==body.id||!Array.isArray(receipt.factIds)||!Array.isArray(receipt.addedFactIds))return false;
  const document=state?.documents?.find(item=>item.id===receipt.documentId&&item.kind==='resume'&&!item.deleted);
  const saved=document?.section1Analysis;
  if(!saved||saved.parserVersion!==receipt.parserVersion||saved.sourceHash!==receipt.sourceHash||saved.sourceVersion!==document.version)return false;
  const allowed=['personal','employment','education','certifications','skills'];
  return receipt.factIds.every(id=>{
    const fact=state.facts.find(item=>item.id===id&&item.lifecycle==='active'&&allowed.includes(item.category));
    return saved.factIds.includes(id)&&!!fact&&fact.evidence?.length>0&&fact.evidence.some(ref=>ref.quote.includes(fact.statement))&&fact.evidence.every(ref=>{
      const segment=document.segments.find(part=>part.id===ref.segmentId);
      return ref.documentId===document.id&&segment&&typeof ref.quote==='string'&&segment.text.includes(ref.quote);
    });
  })&&receipt.addedFactIds.every(id=>receipt.factIds.includes(id)&&state.facts.some(fact=>fact.id===id&&fact.approval==='pending'&&!fact.approvalRef&&fact.extractionStage==='section1'));
}
export function indexingActive(state,at=Date.now()){
  const lease=state.memoryIntent,run=lease&&state.runs.find(r=>r.id===lease.runId);
  return !!(lease&&Date.parse(lease.expiresAt)>at&&run?.status!=='complete');
}
export function experienceReviewReceiptMatches(record,body){
  const result=record?.result,state=record?.state;
  if(result?.kind!=='experience_review_saved'||result.saved!==true||result.submissionId!==body.submissionId||!Array.isArray(body.rows)||result.rows?.length!==body.rows.length)return false;
  const stored=state?.experienceReviews?.find(review=>review.id===result.reviewId&&review.submissionId===body.submissionId);
  if(!stored||stored.rows?.length!==body.rows.length)return false;
  return body.rows.every(request=>{
    const row=result.rows.find(item=>item.questionId===request.questionId);
    const saved=stored.rows.find(item=>item.questionId===request.questionId);
    if(!row||!saved||row.decision!==request.decision||saved.decision!==request.decision||saved.answerId!==row.answerId||saved.status!==row.status||row.proposalFingerprint!==request.proposalFingerprint||saved.proposalFingerprint!==request.proposalFingerprint)return false;
    const answer=state.answers.find(item=>item.id===row.answerId&&item.experienceRowId===request.questionId&&item.submissionId===body.submissionId);
    if(!answer||answer.experienceDecision!==request.decision)return false;
    if(request.decision==='decline')return row.status==='declined'&&!row.factRefs?.length;
    if(answer.text!==row.statement||request.decision==='somewhat'&&row.statement!==String(request.text||'').trim())return false;
    if(row.status==='needs_details')return !row.factRefs?.length;
    const source=state.documents.find(document=>document.id===answer.documentId&&document.kind==='answer'&&!document.deleted);
    if(!row.sourceSegmentId||row.sourceSegmentId!==answer.sourceSegmentId||!source?.segments?.some(segment=>segment.id===row.sourceSegmentId&&segment.text===row.statement))return false;
    return ['approved','somewhat'].includes(row.status)&&row.factRefs?.length>0&&row.factRefs.every(ref=>{
      const fact=state.facts.find(item=>item.id===ref.id&&item.version===ref.version&&item.lifecycle==='active'&&item.approval==='approved'&&!item.conflict&&item.approvalRef===ref.approvalRef);
      const normalize=value=>String(value).toLowerCase().replace(/\s+/g,' ').trim().replace(/[.!?]+$/,'');
      const exact=fact&&(fact.statement===row.statement||row.reused===true&&saved.reused===true&&normalize(fact.statement)===normalize(row.statement));
      return exact&&state.approvals.some(approval=>approval.id===ref.approvalRef&&approval.kind==='fact'&&approval.recordId===fact.id&&approval.recordVersion===fact.version&&approval.decision==='approved');
    });
  });
}
export function profileWorkPending(state,semanticConfigured,at=Date.now()){
  return indexingActive(state,at)||state.runs.some(r=>r.status==='running'&&at-Date.parse(r.startedAt)<120000)||!!(semanticConfigured&&state.outbox.some(e=>e.kind==='reindex'&&e.status==='pending'));
}
