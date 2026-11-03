'use client';
export type SaveVerification={snapshotId:string;profileVersion:string;revision:number;verifiedAt:string;contentHash:string;factCount:number;questionnaireFactCount:number};
export type FinalProfileStatus={approvedAdditions:number;includedAdditions:number;blockers:{code:string;message:string;documentId?:string}[];verification:SaveVerification|null;message:string};
type Fact={id:string;version:number;category:string;field:string;scope:string;statement:string;origin?:string;approval:string;lifecycle:string;conflict:boolean;evidence:{documentId:string;quote:string}[]};
type Doc={id:string;kind:string;deleted?:boolean;analysis:string};
type Receipt={profileVersion:string;stage:string;at:string;persistence?:{saved:boolean};profileReceipt?:{profileVersion:string;contentHash:string;loadedAt:string}};
export default function FinalProfileReadiness({loaded,status,currentVersion,facts,documents,handoffs,onResume,onDecision,disabled}:{loaded:boolean;status?:FinalProfileStatus;currentVersion?:string;facts:Fact[];documents:Doc[];handoffs:Receipt[];onResume:()=>void;onDecision:(fact:Fact,decision:'approved'|'rejected')=>void;disabled:boolean}){
  if(!loaded)return null;
  const resumeIds=new Set(documents.filter(d=>d.kind==='resume'&&!d.deleted).map(d=>d.id));
  const pending=facts.filter(f=>f.lifecycle==='active'&&f.approval==='pending'&&(f.origin==='resume'||f.evidence.some(e=>resumeIds.has(e.documentId))));
  const analysisPending=documents.some(d=>resumeIds.has(d.id)&&d.analysis!=='complete');
  const candidate=status?.verification;
  const verified=candidate&&candidate.profileVersion===currentVersion?candidate:null;
  const handed=verified?handoffs.findLast(h=>h.profileVersion===verified.profileVersion&&h.profileReceipt?.contentHash===verified.contentHash&&h.persistence?.saved):undefined;
  return <div aria-label="Final Profile readiness and handoff">
    <ol>
      <li><strong>Approved additions saved:</strong> {status?status.approvedAdditions:'Reload to verify'}.</li>
      <li><strong>Final Profile:</strong> {verified?`${verified.profileVersion} reloaded and verified; ${status!.includedAdditions} of ${status!.approvedAdditions} approved additions included.`:status?.message||'Reload to verify the current saved version.'}</li>
      <li><strong>Master:</strong> {handed?`Loaded ${handed.profileVersion}.`:verified?'Ready to load. Open the Master & Scout preview to check its input.':'Waiting for a current validated Final Profile.'}</li>
      <li><strong>Scout:</strong> {handed?`${handed.profileVersion} dispatch recorded; research ${handed.stage==='completed'?'completed':handed.stage==='failed'?'failed':'started'}.`:'No dispatch recorded for the current validated version.'}</li>
    </ol>
    {analysisPending&&<p role="status">The current resume has not completed analysis. <button className="cw-secondary" disabled={disabled} onClick={onResume}>Go to Your Resume</button></p>}
    {!!pending.length&&<details id="final-profile-record-review"><summary>Review {pending.length} pending resume records before final saving</summary>
      <p>These records have no current approval. Approve only accurate statements or reject them. Existing approvals and Builder answers are preserved. Approval here uses the existing factual-decision checks.</p>
      {analysisPending&&<p>Finish resume analysis first; then review the resulting records.</p>}
      <table><thead><tr><th>Section / record</th><th>Statement and evidence</th><th>Your decision</th></tr></thead><tbody>{pending.map(f=><tr key={f.id+':'+f.version}>
        <td>{f.category.replaceAll('_',' ')} · {f.field.replaceAll('_',' ')}<br/>{f.scope}</td>
        <td>{f.statement}<details><summary>Source passage</summary>{f.evidence.map((e,i)=><blockquote key={i}>{e.quote}</blockquote>)}</details>{f.conflict&&<p>Conflicting record: resolve it in Facts before approving.</p>}</td>
        <td><button className="cw-secondary" disabled={disabled||analysisPending||f.conflict} onClick={()=>onDecision(f,'approved')}>Approve</button><button className="cw-secondary" disabled={disabled||analysisPending} onClick={()=>onDecision(f,'rejected')}>Reject</button></td>
      </tr>)}</tbody></table>
    </details>}
  </div>;
}
