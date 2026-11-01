'use client';
import {useCallback,useEffect,useState} from 'react';
import {ArrowDownToLine,FileText,LoaderCircle,RefreshCw,ShieldCheck} from 'lucide-react';

export type ApplicationJob={id:string;title:string;company:string;description:string;application_url:string};
type Role={id:string;roleName:string};
type Run={id:string;status:string;phase:string;updated?:string;result?:{
  status:string;assessment?:{suitable:boolean;reasons:string[]};draft?:{content:string};
  feedback?:string[];error?:{message:string};receipt?:{stored:boolean};
}};
const phaseLabel:Record<string,string>={master:'Starting',memory:'Checking your approved profile',scout:'Discovering jobs',matcher:'Assessing the job',tailor:'Preparing your resume',critic:'Reviewing facts and alignment','application-storage':'Storing your validated package'};
const active=(run:Run|null)=>!!run&&['queued','running'].includes(run.status);
export default function Applications({version,job,onProfile}:{roles?:Role[];version?:string;job?:ApplicationJob|null;onProfile:()=>void}){
  const [mode,setMode]=useState('job');const roleId='master-profile';
  const [form,setForm]=useState({title:'',company:'',description:'',application_url:''});
  const [run,setRun]=useState<Run|null>(null),[history,setHistory]=useState<Run[]>([]);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(job){setForm(job);setMode('job');}},[job]);
  const loadHistory=useCallback(async()=>{
    const response=await fetch('/api/pipeline',{cache:'no-store'}),data=await response.json() as {runs:Run[];error?:string};
    if(!response.ok)throw new Error(data.error||'Application history could not be loaded.');
    setHistory(data.runs);return data.runs as Run[];
  },[]);
  const loadRun=useCallback(async(id:string)=>{
    const response=await fetch('/api/pipeline?id='+encodeURIComponent(id),{cache:'no-store'}),data=await response.json() as Run&{error?:string};
    if(!response.ok)throw new Error(data.error||'Application progress could not be loaded.');
    setRun(data);return data as Run;
  },[]);
  useEffect(()=>{
    let disposed=false;
    void loadHistory().then(async items=>{if(disposed)return;setReady(true);if(items[0])await loadRun(items[0].id);}).catch(e=>{if(!disposed)setError(e.message);});
    return()=>{disposed=true;};
  },[loadHistory,loadRun]);
  useEffect(()=>{
    if(!active(run))return;
    let pending=false;
    const timer=setInterval(()=>{if(pending)return;pending=true;void loadRun(run!.id).then(next=>{setError('');if(!active(next))void loadHistory();}).catch(e=>setError(e.message)).finally(()=>{pending=false;});},1500);
    return()=>clearInterval(timer);
  },[run?.id,run?.status,loadRun,loadHistory]);
  async function act(action:string,id=run?.id){
    if(busy)return;setBusy(true);setError('');
    try{
      const payload:Record<string,unknown>={action,id:action==='start'?crypto.randomUUID():id};
      if(action==='start'){
        payload.profileSelection={roleId,version};
        if(mode==='job')payload.job={...form,id:job?.id||'job-'+crypto.randomUUID()};
      }
      const response=await fetch('/api/pipeline',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),data=await response.json() as Run&{error?:string};
      if(!response.ok)throw new Error(data.error||'Application request failed.');
      setRun(data.status==='deleted'?null:data);await loadHistory();
    }catch(e){setError(e instanceof Error?e.message:'Application request failed.');}
    finally{setBusy(false);}
  }
  const needsProfile=!version;
  const result=run?.result,stored=result?.status==='ready_to_apply'&&result.receipt?.stored;
  return <div className="ap-layout">
    <section className="pf-card ap-form"><FileText size={25}/><h2>Prepare an application</h2>
      <p>Master checks the job against your approved profile, prepares a resume, and asks Critic to review it before saving.</p>
      <div className="cw-gentle-note"><ShieldCheck size={20}/><p>Add your resume in <button className="cw-text-button" onClick={onProfile}>My profile → Add your resume</button>. Optional example job descriptions go there before profile analysis. Paste the actual job you want to apply for below.</p></div>
      {needsProfile&&<p role="status">Review your facts, then use “Build &amp; save consolidated profile” in My profile to activate your profile.</p>}
      {version&&<p>Saved master profile: {version}</p>}
      <fieldset disabled={active(run)}><legend>Choose the target job</legend><label className="ap-radio"><input type="radio" name="application-mode" checked={mode==='job'} onChange={()=>setMode('job')}/>Use a specific job</label><label className="ap-radio"><input type="radio" name="application-mode" checked={mode==='discover'} onChange={()=>setMode('discover')}/>Discover an actual job using my saved master profile</label></fieldset>
      {mode==='job'&&<div className="ap-fields">{(['title','company','application_url'] as const).map(key=><label key={key}>{key==='application_url'?'Application URL (HTTPS)':key==='title'?'Job title':'Company'}<input value={form[key]} type={key==='application_url'?'url':'text'} disabled={active(run)} onChange={e=>setForm(current=>({...current,[key]:e.target.value}))}/></label>)}<label>Full target job description<textarea rows={10} maxLength={60000} value={form.description} disabled={active(run)} onChange={e=>setForm(current=>({...current,description:e.target.value}))} placeholder="Paste the employer’s responsibilities and qualifications. This is used to assess the job; it does not become your experience."/></label></div>}
      {error&&<p role="alert" className="pf-error">{error}</p>}
      <button className="cw-primary" disabled={needsProfile||!roleId||!ready||busy||active(run)||(mode==='job'&&(!form.title.trim()||!form.company.trim()||form.description.trim().length<80||!form.application_url.trim()))} onClick={()=>void act('start')}>{busy?<LoaderCircle size={17} className="spin"/>:<FileText size={17}/>}Prepare application package</button>
      {!ready&&<button className="cw-text-button" onClick={()=>void loadHistory().then(()=>{setReady(true);setError('');}).catch(e=>setError(e.message))}><RefreshCw size={14}/>Check pipeline connection</button>}
      <p className="pf-muted">Packages are stored on this computer and contain a Markdown/text resume, job description, application link, match assessment, and validation. You submit the application yourself.</p>
    </section>
    <section className="pf-card ap-results"><h2>Your application runs</h2>
      {history.length>0&&<label>Saved run<select value={run?.id||''} disabled={active(run)} onChange={e=>void loadRun(e.target.value).catch(e=>setError(e.message))}>{history.map(item=><option key={item.id} value={item.id}>{item.updated?new Date(item.updated).toLocaleString():item.id.slice(0,8)} · {item.status.replaceAll('_',' ')}</option>)}</select></label>}
      {run?<div aria-live="polite"><p className="ap-run-status">{active(run)&&<LoaderCircle size={18} className="spin"/>}<strong>{active(run)?phaseLabel[run.phase]||run.phase:(result?.status||run.status).replaceAll('_',' ')}</strong></p>
        {active(run)&&<><p>You can switch workspace views while this runs. Completed steps are saved for recovery.</p><button className="cw-secondary" disabled={busy} onClick={()=>void act('cancel')}>Cancel run</button></>}
        {result?.assessment?.reasons?.length? <ul>{result.assessment.reasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul>:null}
        {result?.error&&<p role="alert">{result.error.message}</p>}
        {result?.feedback?.length? <><h3>Issues needing review</h3><ul>{result.feedback.map((issue,i)=><li key={i}>{issue}</li>)}</ul></>:null}
        {stored&&<p><a className="cw-primary" href={'/api/pipeline?download='+encodeURIComponent(run.id)}><ArrowDownToLine size={17}/>Download validated package</a></p>}
        {['interrupted','failed','cancelled'].includes(run.status)&&<><p>Retry reuses completed steps and checks your current approved profile again.</p><button className="cw-secondary" disabled={busy} onClick={()=>void act('retry')}>Resume run</button></>}
        {result?.status==='needs_review'&&<p>Review the gaps above. Correct or clarify your profile in My profile, then start a new run.</p>}
        {result?.draft&&<details><summary>{stored?'Validated resume':'Draft resume — review incomplete'}</summary><pre className="ap-resume">{result.draft.content}</pre></details>}
        {!active(run)&&<p><button className="cw-text-button" disabled={busy} onClick={()=>{if(window.confirm('Delete this run and its stored package from this computer?'))void act('delete');}}>Delete run and package</button></p>}
      </div>:<p>Your prepared packages and progress will appear here.</p>}
    </section>
  </div>;
}
