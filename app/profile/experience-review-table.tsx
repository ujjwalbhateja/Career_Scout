'use client';

import {useRef,useState} from 'react';

export type ExperienceReviewRow={
  id:string;questionId:string;fingerprint:string;proposedStatement:string;scope?:string;
  requirementIds?:string[];documentIds:string[];parentQuestionIds?:string[];
  coverage?:string;comparisonExplanation?:string;approvedFactRefs?:{id:string;version:number}[];
  sourceQuotes?:{documentId:string;quote:string}[];status?:string;
  kind?:string;category?:string;destinationSection?:string;requiresDetails?:boolean;supportsSomewhat?:boolean;
  decision?:{decision:string;statement?:string;at?:string|null};
};
type Decision='approve'|'decline'|'somewhat';
type ReviewSubmission={submissionId:string;rows:{questionId:string;proposalFingerprint:string;decision:Decision;text?:string;reopen?:boolean}[]};
type Draft={fingerprint:string;decision?:Decision;text:string;reopen:boolean};
type Props={rows:ExperienceReviewRow[];documents:{id:string;title:string}[];disabled:boolean;onSubmit:(body:ReviewSubmission)=>Promise<{ok:boolean;message:string}>;onFacts:()=>void};
const statusLabel=(status?:string)=>({approved:'Approved',declined:'Declined',somewhat:'Somewhat — narrower claim saved',needs_details:'Details still needed'}[status||'']||'Awaiting your response');

export default function ExperienceReviewTable({rows,documents,disabled,onSubmit,onFacts}:Props){
  const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
  const submission=useRef<{key:string;id:string}|null>(null);
  const documentNames=new Map(documents.map(document=>[document.id,document.title]));
  const draftFor=(row:ExperienceReviewRow)=>drafts[row.id]||{fingerprint:row.fingerprint,text:'',reopen:false};
  const change=(row:ExperienceReviewRow,update:Partial<Draft>)=>{setDrafts(current=>({...current,[row.id]:{...(current[row.id]||{fingerprint:row.fingerprint,text:'',reopen:false}),...update}}));setMessage('');};
  const selected=rows.flatMap(row=>{const draft=drafts[row.id];return draft?.decision?[{row,draft}]:[];});
  const stale=selected.filter(({row,draft})=>draft.fingerprint!==row.fingerprint),emptySomewhat=selected.some(({draft})=>draft.decision==='somewhat'&&!draft.text.trim());

  async function save(){
    if(busy||disabled||!selected.length||stale.length||emptySomewhat)return;
    const submittedRows=selected.map(({row,draft})=>({questionId:row.questionId||row.id,proposalFingerprint:draft.fingerprint,decision:draft.decision!,...(draft.decision==='somewhat'?{text:draft.text.trim()}:{}),...(draft.reopen?{reopen:true}:{})})).sort((a,b)=>a.questionId.localeCompare(b.questionId));
    const key=JSON.stringify(submittedRows);
    if(!submission.current||submission.current.key!==key)submission.current={key,id:crypto.randomUUID()};
    const body={submissionId:submission.current.id,rows:submittedRows};
    setBusy(true);setMessage('');setFailed(false);
    try{
      const result=await onSubmit(body);setMessage(result.message);setFailed(!result.ok);
      if(result.ok){const saved=new Set(selected.map(({row})=>row.id));setDrafts(current=>Object.fromEntries(Object.entries(current).filter(([id])=>!saved.has(id))));submission.current=null;}
    }catch(error){setFailed(true);setMessage(error instanceof Error?error.message:'The responses could not be saved. Your choices and text are kept; retry when ready.');}
    finally{setBusy(false);}
  }

  if(!rows.length)return <section className="cw-experience-review cw-builder-interview"><p>No pending review statements are shown for this comparison. Approved experience remains in Section 2. Refresh the JD analysis when its source inputs change.</p></section>;

  return <section className="cw-experience-review cw-builder-interview" aria-label="Review additional experience">
    <p>These statements come from the selected job descriptions. Review each exact statement against your own experience. Approve confirms only what is shown; Somewhat saves only the narrower text you enter. Decline keeps the requirement outside your profile.</p>
    <p>Confirmed work goes to Section 2. Standalone skills and qualifications belong in <button type="button" className="text-button" onClick={onFacts} disabled={busy}>Facts (Section 1)</button>; they do not establish a work project.</p>
    <div className="experience-review-scroll">
      <table className="cw-experience-review-table">
        <caption>Missing or partially supported capabilities compared with your full approved cumulative profile</caption>
        <thead><tr><th scope="col">Originating JD</th><th scope="col">Specific experience not clearly established</th><th scope="col">Your response</th></tr></thead>
        <tbody>{rows.map(row=>{
          const draft=draftFor(row),isStale=!!draft.decision&&draft.fingerprint!==row.fingerprint;
          const savedHistory=!!row.status&&!['pending','unresolved','needs_details'].includes(row.status),locked=savedHistory&&!draft.reopen;
          const inactive=disabled||busy||locked||isStale,id='experience-'+row.id.replace(/[^a-zA-Z0-9_-]/g,'-');
          return <tr key={row.id}>
            <td><ul>{row.documentIds.map(documentId=><li key={documentId}>{documentNames.get(documentId)||'Selected job description'}</li>)}</ul>{row.documentIds.length>1&&<p>Shared by {row.documentIds.length} selected JDs.</p>}</td>
            <td>
              <p id={id+'-statement'}><strong>{row.proposedStatement}</strong></p>
              <p>{row.coverage==='partial'?'Part of the requirement has support. This row shows the remaining scope.':'This statement is not established by the approved cumulative profile.'}</p>
              {row.comparisonExplanation&&<p>{row.comparisonExplanation}</p>}
              {row.destinationSection==='facts'&&<p><strong>{row.kind==='skill'||row.category==='skills'?'Skill or tool':'Qualification'}:</strong> this confirmation belongs in Facts (Section 1), with its exact limits. It will not be added as a work project.</p>}
              {row.requiresDetails&&<p id={id+'-details'}>This wording is broad or has alternatives. Choose Somewhat and enter the exact work or qualification you can confirm. A generic Approve is saved as needing details and adds no claim.</p>}
              {!!row.sourceQuotes?.length&&<details><summary>View the JD source</summary>{row.sourceQuotes.map((source,index)=><blockquote key={source.documentId+'-'+index}><p>{source.quote}</p><cite>{documentNames.get(source.documentId)||'Selected JD'}</cite></blockquote>)}</details>}
              <p className="experience-review-history">Saved status: {statusLabel(row.status)}</p>
              {row.status==='somewhat'&&row.decision?.statement&&<p><strong>Saved narrower statement:</strong> {row.decision.statement}</p>}
              {savedHistory&&!draft.reopen&&<button type="button" onClick={()=>change(row,{reopen:true,decision:undefined,fingerprint:row.fingerprint})} disabled={disabled||busy}>Change saved decision</button>}
              {isStale&&<div role="alert"><p>The comparison changed. Your draft is kept; review this current statement and choose a response again.</p><button type="button" disabled={disabled||busy} onClick={()=>change(row,{fingerprint:row.fingerprint,decision:undefined})}>Review updated row</button></div>}
            </td>
            <td>
              <fieldset disabled={inactive} aria-describedby={row.requiresDetails?id+'-details':undefined}>
                <legend className="sr-only">Your response to {row.proposedStatement}</legend>
                {(['approve','decline','somewhat'] as Decision[]).map(decision=><label key={decision}><input type="radio" name={id+'-decision'} value={decision} checked={draft.decision===decision} onChange={()=>change(row,{decision,fingerprint:row.fingerprint})}/>{decision==='approve'?'Approve':decision==='decline'?'Decline':'Somewhat'}</label>)}
              </fieldset>
              {draft.decision&&<button type="button" onClick={()=>change(row,{decision:undefined})} disabled={disabled||busy}>Clear response</button>}
              {draft.decision==='somewhat'&&<div className="experience-review-narrower"><label htmlFor={id+'-text'}>What you can confirm, in your own words</label><textarea id={id+'-text'} rows={4} maxLength={1800} value={draft.text} onChange={event=>change(row,{text:event.target.value})} disabled={disabled||busy||isStale} placeholder="Enter only the experience or qualification you actually have." aria-describedby={id+'-text-help'}/><p id={id+'-text-help'}>Only this text will be considered for your profile. Keep the scope accurate; do not copy an unsupported part of the JD. {draft.text.length}/1,800 characters.</p>{!draft.text.trim()&&<p>Enter the narrower statement before saving Somewhat.</p>}</div>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {message&&<p role={failed?'alert':'status'} aria-live="polite">{message}{failed?' Your choices and text have been kept.':''}</p>}
    {!!stale.length&&<p role="alert">Review the {stale.length} updated {stale.length===1?'row':'rows'} before submitting your retained draft.</p>}
    <button type="button" onClick={()=>void save()} disabled={disabled||busy||!selected.length||!!stale.length||emptySomewhat}>{busy?'Saving your responses…':'Add approved experience to Section 2'}</button>
    {!!selected.length&&<p>{selected.length} explicit {selected.length===1?'response':'responses'} selected. Unanswered rows will remain unchanged.</p>}
  </section>;
}
