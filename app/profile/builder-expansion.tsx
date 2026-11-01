'use client';
import {useRef,useState} from 'react';

export type BuilderRow={id:string;documentId:string;fingerprint:string;proposedStatement:string;section:string;area:string;status:string;revisionText:string;draftVersion:number;approvedStatement?:string;requiresDetails?:boolean;historyOnly?:boolean;comparisonExplanation?:string;recordedStatements?:string[];sourceQuotes?:{quote:string}[];groupedStatements?:string[];coverageEstimates?:{requirementId:string;percent:number;criticalGap:boolean;components:{scope:string;matched:boolean;weight:number}[]}[]};
export type RoleQuestionnaire={documentId:string;title:string;analysis:string;recorded?:{requirement:string;area:string;statements:string[]}[];skipped?:{requirement:string;area:string;percent:number;reason:string;unconfirmed:string[];statements:string[]}[];unresolved?:{requirement:string;area:string;explanation:string}[];experience:BuilderRow[];skills:BuilderRow[]};
export type BuilderSubmission={submissionId:string;rows:{rowId:string;fingerprint:string;decision:'approve'|'reject'|'somewhat'|'approve_revision';text?:string;draftVersion?:number;reopen?:boolean}[]};
type Props={groups:RoleQuestionnaire[];activeDocumentIds?:string[];disabled:boolean;onSubmit:(body:BuilderSubmission)=>Promise<{ok:boolean;message:string}>};
type Draft={text:string;choice?:'approve'|'reject'|'somewhat';fingerprint:string;reopen:boolean};
const labels:Record<string,string>={programming_languages:'Programming languages',tools_technologies:'Tools and technologies',other_skills:'Other skills',needs_review:'Earlier approval needs source or fact review',pending:'Awaiting response',rejected:'Rejected — excluded from your profile',approved:'Approved — saved to your Factual Profile',already_supported:'Already supported by your profile',awaiting_approval:'Revised wording saved — awaiting your approval'};

export default function BuilderExpansion({groups,activeDocumentIds,disabled,onSubmit}:Props){
  const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[busy,setBusy]=useState(''),[feedback,setFeedback]=useState<Record<string,{ok:boolean;message:string}>>({});
  const lock=useRef(false),receipts=useRef<Record<string,{key:string;id:string}>>({});
  const getDraft=(r:BuilderRow)=>drafts[r.id]||{text:r.revisionText||'',fingerprint:r.fingerprint,reopen:false};
  const change=(r:BuilderRow,update:Partial<Draft>)=>setDrafts(current=>({...current,[r.id]:{...getDraft(r),...update}}));
  async function save(row:BuilderRow,decision:BuilderSubmission['rows'][number]['decision']){
    if(disabled||lock.current)return;
    const draft=getDraft(row);
    if(draft.fingerprint!==row.fingerprint){setFeedback(f=>({...f,[row.id]:{ok:false,message:'The comparison changed. Review the updated row before saving.'}}));return;}
    const item={rowId:row.id,fingerprint:row.fingerprint,decision,...(decision==='somewhat'?{text:draft.text.trim()}:{}),...(decision==='approve_revision'?{text:row.revisionText,draftVersion:row.draftVersion}:{}),...(draft.reopen?{reopen:true}:{})};
    const key=JSON.stringify(item);if(receipts.current[row.id]?.key!==key)receipts.current[row.id]={key,id:crypto.randomUUID()};
    lock.current=true;setBusy(row.id);
    try{
      const result=await onSubmit({submissionId:receipts.current[row.id].id,rows:[item]});setFeedback(f=>({...f,[row.id]:result}));
      if(result.ok){setDrafts(current=>Object.fromEntries(Object.entries(current).filter(([id])=>id!==row.id)));delete receipts.current[row.id];}
    }catch{setFeedback(f=>({...f,[row.id]:{ok:false,message:'Could not save. Your draft is kept; retry when ready.'}}));}
    finally{lock.current=false;setBusy('');}
  }
  function table(rows:BuilderRow[],skills:boolean){return <>
    <h3>{skills?'Skills':'Professional Work Experience'}</h3>
    {!rows.length?<p>No additional {skills?'skills':'work experience'} items are currently proposed for this role.</p>:<div className="experience-review-scroll"><table className="cw-experience-review-table">
      <thead><tr><th scope="col">{skills?'Skill category':'Area'}</th><th scope="col">{skills?'Skill to verify':'Experience to verify'}</th><th scope="col">Your response</th></tr></thead>
      <tbody>{rows.map(row=>{
        const draft=getDraft(row),stale=draft.fingerprint!==row.fingerprint,locked=disabled||!!busy||stale,done=['approved','already_supported'].includes(row.status),rejected=row.status==='rejected'&&!draft.reopen;
        return <tr key={row.id}><td>{labels[row.area]||row.area}</td><td>
          {row.groupedStatements?<><ul>{row.groupedStatements.map((statement,i)=><li key={i}><strong>{statement}</strong></li>)}</ul><p>One question for these related details: do all of them reflect your experience? Choose Somewhat if only part is accurate.</p></>:<><p><strong>{row.proposedStatement}</strong></p><p>{skills?'Have you actually used this skill in your work?':'Does this accurately describe work you have personally performed?'}</p></>}
          {!!row.coverageEstimates?.length&&<details><summary>Why this question remains</summary>{row.coverageEstimates.map((estimate,i)=><div key={i}><p>Estimated requirement coverage: {estimate.percent}%{estimate.criticalGap?' — an important gap still needs confirmation.':''}</p><ul>{estimate.components.map((c,j)=><li key={j}>{c.scope}: {c.matched?'recorded':'not established'}</li>)}</ul></div>)}<p>Coverage guides question selection. It is not an ATS score or a new profile claim.</p></details>}
          {row.comparisonExplanation&&<p>{row.comparisonExplanation}</p>}
          {!!row.recordedStatements?.length&&<details><summary>Already recorded — only the remaining detail is asked above</summary>{row.recordedStatements.map((statement,i)=><p key={i}>{statement}</p>)}<p>Existing source wording and approval status are preserved.</p></details>}
          {row.requiresDetails&&!done&&<p>This requirement is broad. Choose Somewhat to write a specific statement before approving it.</p>}
          {!!row.sourceQuotes?.length&&<details><summary>Job posting context</summary>{row.sourceQuotes.map((q,i)=><blockquote key={i}>{q.quote}</blockquote>)}<p>The posting is context for this question, not evidence about you.</p></details>}
          <p>{labels[row.status]||row.status}</p>{done&&row.approvedStatement&&<p><strong>Approved wording:</strong> {row.approvedStatement}</p>}
          {row.status==='awaiting_approval'&&<blockquote><strong>Saved revision — not yet a fact:</strong><p>{row.revisionText}</p></blockquote>}
        </td><td>
          {done||row.historyOnly?<p>{done?'No further confirmation needed.':'Historical decision retained. Review the current source and facts before changing it.'}</p>:rejected?<>{!row.historyOnly&&<button type="button" disabled={locked} onClick={()=>change(row,{reopen:true})}>Reopen rejected item</button>}</>:<>
            {row.status==='awaiting_approval'&&<button type="button" className="cw-primary" disabled={locked||draft.text!==row.revisionText} onClick={()=>void save(row,'approve_revision')}>Approve revised wording</button>}
            <fieldset disabled={locked}><legend>Choose a response</legend>{(['approve','reject','somewhat'] as const).map(choice=><label key={choice}><input type="radio" name={'builder-'+row.id} checked={draft.choice===choice} disabled={choice==='approve'&&(row.requiresDetails||row.status==='awaiting_approval')} onChange={()=>change(row,{choice})}/>{choice==='approve'?'Approve':choice==='reject'?'Reject':'Somewhat'}</label>)}</fieldset>
            {draft.choice==='somewhat'&&<label>Describe only what you have actually done or used. Include the employer or period only if you can confirm it.<textarea rows={4} maxLength={1800} value={draft.text} disabled={locked} onChange={e=>change(row,{text:e.target.value})}/><small>This saves a draft. You must approve its exact wording in a separate action before it enters your profile.</small></label>}
            {draft.choice&&<button type="button" className="cw-secondary" disabled={locked||draft.choice==='somewhat'&&!draft.text.trim()} onClick={()=>void save(row,draft.choice!)}>{busy===row.id?'Saving…':draft.choice==='somewhat'?'Save revision for review':draft.choice==='approve'?'Approve and save statement':'Save rejection'}</button>}
          </>}
          {stale&&<><p role="alert">The comparison changed. Your draft is kept.</p><button type="button" disabled={disabled||!!busy} onClick={()=>change(row,{fingerprint:row.fingerprint,choice:undefined})}>I have reviewed the updated row</button></>}
          {feedback[row.id]&&<p role={feedback[row.id].ok?'status':'alert'}>{feedback[row.id].message}</p>}
        </td></tr>;
      })}</tbody>
    </table></div>}
  </>;}
  const answered=(row:BuilderRow)=>['approved','rejected','already_supported'].includes(row.status)&&!getDraft(row).reopen;
  const current=groups.filter(g=>!activeDocumentIds||activeDocumentIds.includes(g.documentId));
  const previous=groups.filter(g=>activeDocumentIds&&!activeDocumentIds.includes(g.documentId));
  const answeredCount=groups.reduce((n,g)=>n+[...g.experience,...g.skills].filter(answered).length,0);
  const pendingCount=(items:RoleQuestionnaire[])=>items.reduce((n,g)=>n+[...g.experience,...g.skills].filter(r=>!answered(r)).length,0);
  function role(group:RoleQuestionnaire){return <section key={group.documentId} aria-label={'Questionnaire: '+group.title}>
    <h2>{group.title}</h2>
    {!!group.skipped?.length&&<details><summary>Skipped by the questionnaire filter ({group.skipped.length})</summary>{group.skipped.map((item,i)=><article key={i}><h3>{item.area}</h3><p>{item.requirement}</p><p>{item.percent}% estimated coverage — {item.reason==='skip_minor'?'at least 75% covered; only minor differences remain.':'an incidental difference, deferred to keep questions relevant.'}</p><p>Still unconfirmed: {item.unconfirmed.join('; ')}</p>{item.statements.map((statement,j)=><p key={j}>{statement}</p>)}</article>)}<p>Skipping a question does not add or approve its missing details.</p></details>}
    {!!group.unresolved?.length&&<section aria-label="Comparisons needing clarification"><h3>Comparison needs clarification ({group.unresolved.length})</h3><p>These requirements are not counted as matched or ready for approval.</p>{group.unresolved.map((item,i)=><article key={i}><strong>{item.area}</strong><p>{item.requirement}</p><p>{item.explanation}</p></article>)}</section>}
    {!!group.recorded?.length&&<details><summary>Already recorded in your Factual Profile ({group.recorded.length}) — no repeat questions</summary>{group.recorded.map((item,i)=><article key={i}><h3>{item.area}</h3><p>Job requirement: {item.requirement}</p>{item.statements.map((statement,j)=><p key={j}>{statement}</p>)}</article>)}<p>These matches reuse saved information; they do not create new facts or change approvals.</p></details>}
    {group.analysis!=='complete'?<p>Analyze this job description before reviewing its questionnaire.</p>:<>{table(group.experience.filter(r=>!answered(r)),false)}{table(group.skills.filter(r=>!answered(r)),true)}</>}
  </section>;}
  return <div className="cw-experience-review" id="builder-questionnaires">
    {current.map(role)}
    {!!previous.length&&<details className="cw-questionnaire-archive"><summary>Earlier role questionnaires ({previous.length}) · {pendingCount(previous)} unfinished items</summary>{previous.map(role)}</details>}
    {!!answeredCount&&<details className="cw-questionnaire-archive"><summary>Already answered ({answeredCount})</summary><p>Saved approvals and rejections are kept here. Somewhat revisions stay unfinished until their revised wording is approved.</p>{groups.map(group=>{
      const work=group.experience.filter(answered),skills=group.skills.filter(answered);
      return work.length||skills.length?<section key={group.documentId} aria-label={'Answered: '+group.title}><h2>{group.title}</h2>{!!work.length&&table(work,false)}{!!skills.length&&table(skills,true)}</section>:null;
    })}</details>}
  </div>;
}
