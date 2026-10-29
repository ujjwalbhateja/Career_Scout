// No provider calls or automatic decisions. These guards preserve exactly the
// fact versions and prior decisions the user saw before pressing a button.
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
export function indexingActive(state,at=Date.now()){
  const lease=state.memoryIntent,run=lease&&state.runs.find(r=>r.id===lease.runId);
  return !!(lease&&Date.parse(lease.expiresAt)>at&&run?.status!=='complete');
}
export function profileWorkPending(state,semanticConfigured,at=Date.now()){
  return indexingActive(state,at)||state.runs.some(r=>r.status==='running'&&at-Date.parse(r.startedAt)<120000)||!!(semanticConfigured&&state.outbox.some(e=>e.kind==='reindex'&&e.status==='pending'));
}
