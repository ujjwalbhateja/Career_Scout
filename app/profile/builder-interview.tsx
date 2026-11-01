'use client';
import {useRef,useState} from 'react';
export type BuilderQuestion={id:string;question:string;status:string;scope:string;required?:boolean;requirementId?:string|null;requirementIds?:string[];priority?:string;jdCount?:number;coveredByApprovedFacts?:boolean};
export type InterviewReply={ok:boolean;message:string;analysisStatus?:string;answerId?:string};
type Requirement={id:string;documentId?:string;text:string;importance:string};
type Answer={id:string;questionId:string;text:string;status:string;documentId?:string;requiresConsistencyReview?:boolean};
export default function BuilderInterview({questions,requirements,documents,answers,disabled,onAnswer,onAnalyze,onFacts}:{questions:BuilderQuestion[];requirements:Requirement[];documents:{id:string;title:string;analysis?:string}[];answers:Answer[];disabled:boolean;onAnswer:(body:Record<string,unknown>)=>Promise<InterviewReply>;onAnalyze:(id:string)=>Promise<InterviewReply>;onFacts:()=>void}){
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const [notices,setNotices]=useState<Record<string,InterviewReply>>({}),[saving,setSaving]=useState('');
  const submissions=useRef(new Map<string,string>());
  const ordered=[...questions].sort((a,b)=>Number(b.priority==='required'||b.required)-Number(a.priority==='required'||a.required)||(b.jdCount||0)-(a.jdCount||0));
  async function analyze(questionId:string,answerId:string){
    setSaving(questionId);setNotices(n=>({...n,[questionId]:{ok:true,message:'Your answer is saved. Fact Agent is extracting facts…'}}));
    try{const reply=await onAnalyze(answerId);setNotices(n=>({...n,[questionId]:reply}));}
    catch{setNotices(n=>({...n,[questionId]:{ok:false,message:'Your answer is saved. Fact extraction could not finish; retry from this saved answer.'}}));}
    finally{setSaving('');}
  }
  async function submit(q:BuilderQuestion,decision:string,capabilityDecision?:string,reopen=false){
    if(saving||disabled)return;
    const text=drafts[q.id]||'',key=JSON.stringify([q.id,decision,capabilityDecision,text,reopen]);
    const submissionId=submissions.current.get(key)||crypto.randomUUID();submissions.current.set(key,submissionId);
    setSaving(q.id);setNotices(n=>({...n,[q.id]:{ok:true,message:'Saving your response…'}}));
    try{
      const reply=await onAnswer({questionId:q.id,decision,capabilityDecision,text,reopen,submissionId,analyze:false});
      setNotices(n=>({...n,[q.id]:reply}));
      if(reply.ok){submissions.current.delete(key);setDrafts(d=>({...d,[q.id]:''}));}
      if(reply.ok&&reply.analysisStatus==='pending'&&reply.answerId)await analyze(q.id,reply.answerId);
    }catch{setNotices(n=>({...n,[q.id]:{ok:false,message:'Could not confirm the saved response. Your text is kept; try again.'}}));}
    finally{setSaving('');}
  }
  return <div className="cw-questions cw-builder-interview"><h3>Missing experience: your review</h3><p>Choose Yes, No or Not sure. A Yes confirmation is saved immediately; an example is needed before Fact Agent can propose experience facts.</p>
    {!ordered.length&&<p>No current experience questions. Analyze your selected JDs to check for gaps.</p>}
    {ordered.map(q=>{
      const refs=requirements.filter(r=>(q.requirementIds||[q.requirementId]).includes(r.id)),last=answers.filter(a=>a.questionId===q.id).at(-1),answered=['answered','not_experienced','declined'].includes(q.status),document=documents.find(d=>d.id===last?.documentId);
      const locked=disabled||!!saving,needsExtraction=last?.status==='answered'&&document?.analysis!=='complete';
      return <article key={q.id}><span className="cw-tag">{q.status==='needs_details'?'Yes saved — example needed':q.status==='not_experienced'?'You reported no experience':q.status.replaceAll('_',' ')}</span>{q.priority&&<span className="cw-tag">{q.priority==='required'?'Mandatory requirement':'Preferred requirement'}{(q.jdCount||0)>1?' · '+q.jdCount+' JDs':''}</span>}
        <h4>{q.question}</h4><small>{q.scope}</small>
        {!!refs.length&&<details><summary>Why Profile Builder is asking</summary>{refs.map(r=><p key={r.id}><strong>{documents.find(d=>d.id===r.documentId)?.title||'Selected JD'}</strong>: {r.text}</p>)}</details>}
        {last&&<blockquote>{last.text||last.status.replaceAll('_',' ')}</blockquote>}
        {last?.requiresConsistencyReview&&<p className="cw-inline-error" role="alert">This response conflicts with facts approved from an earlier answer. Those facts need review before they can be used. <button className="cw-text-button" onClick={onFacts}>Review these facts</button></p>}
        {notices[q.id]&&<p role={notices[q.id].ok?'status':'alert'} className={notices[q.id].ok?'cw-answer-saved':'cw-inline-error'}>{notices[q.id].message}</p>}
        {!answered&&<><label>Your example or clarification (optional when confirming Yes)<textarea aria-label={'Answer: '+q.question} rows={3} maxLength={5000} disabled={locked} value={drafts[q.id]||''} onChange={e=>setDrafts(d=>({...d,[q.id]:e.target.value}))} placeholder="Describe what you actually did. Short factual answers are accepted."/></label><small>{(drafts[q.id]||'').length} / 5,000 characters</small>
          <div className="cw-small-actions"><button className="cw-secondary" disabled={locked} onClick={()=>void submit(q,'answered','yes')}>{drafts[q.id]?.trim()?'Yes — save my answer':'Yes — confirm and add details later'}</button><button disabled={locked} onClick={()=>void submit(q,'not_experienced','no')}>No, I haven’t done this</button><button disabled={locked} onClick={()=>void submit(q,'deferred','unsure')}>Not sure / answer later</button><button disabled={locked} onClick={()=>void submit(q,'declined')}>Don’t ask again</button></div>
        </>}
        {needsExtraction&&<p><button className="cw-secondary" disabled={locked} onClick={()=>void analyze(q.id,last!.id)}>Extract facts from my saved answer</button></p>}
        {q.status==='answered'&&document?.analysis==='complete'&&<p><button className="cw-text-button" onClick={onFacts}>Review and approve the extracted facts</button></p>}
        {answered&&<details><summary>Change or clarify my response</summary><textarea aria-label={'Update answer: '+q.question} maxLength={5000} rows={3} disabled={locked} value={drafts[q.id]||''} onChange={e=>setDrafts(d=>({...d,[q.id]:e.target.value}))}/><div className="cw-small-actions"><button className="cw-secondary" disabled={locked} onClick={()=>void submit(q,'answered','yes',true)}>Save updated response</button><button disabled={locked} onClick={()=>void submit(q,'not_experienced','no',true)}>Change my response to No</button></div><small>If this changes an approved fact, review that fact in Facts.</small></details>}
      </article>;
    })}
  </div>;
}
