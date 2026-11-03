// Eligibility for the current stored profile. This never creates an approval.
export function recordSourceMatches(state,fact,kinds=['resume','answer']){
  return Array.isArray(fact.evidence)&&fact.evidence.length>0&&fact.evidence.every(ref=>{
    const document=state.documents.find(d=>d.id===ref.documentId&&!d.deleted&&kinds.includes(d.kind));
    const segment=document?.segments.find(s=>s.id===ref.segmentId);
    return typeof ref.quote==='string'&&ref.quote.trim()&&segment?.text.includes(ref.quote)
      &&(ref.documentVersion==null||ref.documentVersion===document.version);
  });
}
export function resumeSourceRecord(state,fact){
  return fact.origin==='resume'&&fact.lifecycle==='active'&&!fact.conflict
    &&['pending','approved'].includes(fact.approval)&&recordSourceMatches(state,fact,['resume']);
}
export function confirmedRecord(state,fact,owner){
  return fact.lifecycle==='active'&&!fact.conflict&&fact.approval==='approved'&&recordSourceMatches(state,fact)
    &&state.approvals.some(a=>a.id===fact.approvalRef&&a.kind==='fact'&&a.recordId===fact.id
      &&a.recordVersion===fact.version&&a.decision==='approved'&&a.actor===owner);
}
