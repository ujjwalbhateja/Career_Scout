'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Check,Database,FileText,LoaderCircle,RefreshCw,Search,ShieldCheck,Upload,UserRound} from 'lucide-react';
import Scout from '../scout';
import SearchStep from './search-step';
import Applications,{type ApplicationJob} from '../applications';
import '../applications.css';
import {type BuilderReviewData} from './builder-review';
import {type BuilderQuestion} from './builder-interview';
import FactReview from './fact-review';
import BuilderExpansion,{type RoleQuestionnaire} from './builder-expansion';
import {buildRoleQuestionnaires,builderReviewReceiptMatches,builderQuestionnaireScope} from '@/lib/profile/builder-expansion.mjs';
import type {HandoffReceipt} from './handoff-review';
import type {ConsolidatedProfileData} from '@/lib/profile/consolidated-types';
import './builder.css';
import ProfileArchitecture from './architecture/structure';
import ProgressTracker from '../progress/tracker';
import progressRecord from '@/data/scout-progress.json';
import type {ProgressRecord} from '@/lib/progress-types';
import {Compass,ArrowRight,ChevronRight,Link2,CheckCircle2,Target,MapPin,Sparkles,Lock,Settings2} from 'lucide-react';
import {CATEGORIES,finalizationReadiness} from '@/lib/profile/domain.mjs';
import {factKey,factDecision,latestRecord,decisionBasesMatch,decisionReceiptMatches,answerReceiptMatches,experienceReviewReceiptMatches,section1ReceiptMatches,indexingActive,profileWorkPending} from '@/lib/profile/client-state.mjs';
type Ref={documentId:string;segmentId:string;quote:string};
type Fact={id:string;version:number;category:string;field:string;scope:string;statement:string;fingerprint:string;approval:string;approvalRef:string|null;confirmation:string;lifecycle:string;conflict:boolean;consistencyNotes?:string[];evidence:Ref[]};
type Doc={id:string;kind:string;title:string;selected:boolean;analysis:string;deleted?:boolean;objectPath?:string;sourceURL?:string;segments:{id:string;text:string;locator:string}[];assessment?:{profileVersion:string;mappings:Mapping[]}};
type Mapping={requirementId:string;assessment:string;explanation:string;factRefs:{id:string;version:number}[]};
type Role={id:string;version:number;roleName:string;summary:string;keywords:string[];alternativeTitles?:string[];status:string;mappings:Mapping[];basis?:string;classification?:string;factRefs:{id:string;version:number}[]};
type Question=BuilderQuestion;
type SearchPreferences={goals:string;location:string;arrangement:string;employment:string;seniority:string;preferSponsorship:boolean;onWorkVisa?:boolean};
type State={documents:Doc[];facts:Fact[];roleProfiles:Role[];requirements:{id:string;documentId?:string;text:string;importance:string}[];builderReviews?:BuilderReviewData[];questions:Question[];answers:{id:string;questionId:string;text:string;status:string;documentId?:string;requiresConsistencyReview?:boolean}[];snapshots:{version:string;stale:boolean;createdAt:string;profileRefs?:{id:string;version:number}[];consolidated?:ConsolidatedProfileData;searchPreferences?:SearchPreferences;searchProfile?:{id:string;basis:string;context:{titles:{term:string}[]}}}[];scoutHandoffs?:HandoffReceipt[];outbox:{id:string;status:string;kind:string}[];runs:{id:string;action:string;status:string;startedAt:string;message?:string}[];preferences:{disclosure?:string[];search?:SearchPreferences};approvals?:{id:string;kind:string;recordId:string;recordVersion:number;decision:string;at:string}[];memoryIntent?:{runId:string;expiresAt:string};deletion?:unknown};
type Providers={supabase:boolean;pinecone:boolean;model:boolean};
type Retrieval={results:{text:string;id:string;record_type:string}[];mode:string;warning?:string};
type RecordData={revision:number;state:State;providers?:Providers;error?:string;result?:unknown;deleted?:boolean;currentProfile?:{ready:boolean;message?:string;version:string;searchProfile:{basis:string;context:{titles:{term:string}[]}};searchPreferences?:SearchPreferences}};
const empty:State={documents:[],facts:[],roleProfiles:[],requirements:[],questions:[],answers:[],snapshots:[],outbox:[],runs:[],preferences:{}};
const label=(s:string)=>s.replaceAll('_',' ');
const decisionLabels:Record<string,string>={approved:'Approved',rejected:'Rejected',pending:'Pending review',withdrawn:'Approval withdrawn'};
const decisionLabel=(s:string)=>decisionLabels[s]||label(s);
const tabs=['Documents','Facts','Builder','Search','Memory'];
export default function ProfileWorkspace(){
  const [applicationJob,setApplicationJob]=useState<ApplicationJob|null>(null);
  const [profileLoaded,setProfileLoaded]=useState(false);
  const [reviewDocumentIds,setReviewDocumentIds]=useState<string[]|null>(null);
  const [view,setView]=useState('profile'),[jdURL,setJDURL]=useState(''),[jdEntry,setJDEntry]=useState('link'),[jdText,setJDText]=useState('');
  const [search,setSearch]=useState<SearchPreferences>({goals:'',location:'',arrangement:'any',employment:'any',seniority:'any',preferSponsorship:false});
  const searchDirty=useRef(false);
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const requested=params.get('view'),step=params.get('step');if(step&&tabs.includes(step))setTab(step);if(requested==='jobs'||params.has('profileRole')){setView('profile');setTab('Search');}else if(['applications','workflow','progress'].includes(requested||''))setView(requested!);},[]);
  const [record,setRecord]=useState<RecordData>({revision:0,state:empty}),[providers,setProviders]=useState<Providers>({supabase:false,pinecone:false,model:false});
  const [tab,setTab]=useState('Documents'),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[title,setTitle]=useState(''),[text,setText]=useState(''),[selectedJD,setSelectedJD]=useState(true),[picked,setPicked]=useState<string[]>([]),[category,setCategory]=useState('all'),[editing,setEditing]=useState(''),[correction,setCorrection]=useState(''),[answers,setAnswers]=useState<Record<string,string>>({}),[query,setQuery]=useState(''),[results,setResults]=useState<{text:string;id:string;record_type:string}[]>([]),[deleteText,setDeleteText]=useState(''),[disclosure,setDisclosure]=useState('');
  const recordRef=useRef(record),actionLock=useRef(false),disclosureDirty=useRef(false),actionError=useRef('');
  const state=record.state||empty,docs=state.documents.filter(d=>!d.deleted),facts=state.facts.filter(f=>f.lifecycle==='active'),approved=facts.filter(f=>f.approval==='approved'&&!f.conflict),jds=docs.filter(d=>d.kind==='jd'&&d.selected);
  const snapshot=record.currentProfile?.ready?record.currentProfile:null;
  const readiness=finalizationReadiness(state);
  const questionnaires=useMemo(()=>buildRoleQuestionnaires(state) as RoleQuestionnaire[],[state]);
  const questionnaireScope=useMemo(()=>builderQuestionnaireScope(state),[state]);
  const acceptRecord=useCallback((data:RecordData):RecordData=>{
    const next=latestRecord(recordRef.current,data) as RecordData;
    if(data.state&&Number.isInteger(data.revision))setProfileLoaded(true);
    if(next!==recordRef.current){recordRef.current=next;setRecord(next);setPicked(keys=>keys.filter(key=>next.state.facts.some(f=>f.lifecycle==='active'&&factKey(f)===key)));}
    return next;
  },[]);
  const load=useCallback(async({quiet=false,signal}:{quiet?:boolean;signal?:AbortSignal}={}):Promise<RecordData|undefined>=>{
    try{
      const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000);
      const status=await fetch('/api/profile?status=1',{cache:'no-store',signal:requestSignal}),statusData=await status.json() as {providers:Providers;error?:string};
      if(!status.ok)throw new Error(statusData.error||'Could not load connection status.');
      if(signal?.aborted)return;
      setProviders(statusData.providers);
      if(!statusData.providers.supabase)throw new Error('Profile storage is not connected yet. Your existing job search is available.');
      const response=await fetch('/api/profile',{cache:'no-store',signal:requestSignal}),data=await response.json() as RecordData;if(!response.ok)throw new Error(data.error);
      if(signal?.aborted)return;
      const current=acceptRecord(data);if(!disclosureDirty.current)setDisclosure((current.state.preferences?.disclosure||[]).join('\n'));if(!searchDirty.current&&current.state.preferences?.search)setSearch(current.state.preferences.search);if(!quiet)setError('');return current;
    }catch(e){if(!quiet&&!signal?.aborted)setError(e instanceof Error?e.message:'Profile could not be loaded.');}
  },[acceptRecord]);
  useEffect(()=>{const controller=new AbortController();void load({signal:controller.signal});return()=>controller.abort();},[load]);
  useEffect(()=>{
    const controller=new AbortController();let refreshing=false;
    const refresh=async()=>{if(refreshing||actionLock.current||document.visibilityState==='hidden')return;refreshing=true;try{await load({quiet:true,signal:controller.signal});}finally{refreshing=false;}};
    const timer=setInterval(()=>{if(profileWorkPending(recordRef.current.state,providers.pinecone))void refresh();},3000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[load,providers.pinecone]);
  async function act(action:string,body:Record<string,unknown>={},message='Saved'){
    if(actionLock.current)return;actionLock.current=true;actionError.current='';setBusy(action);setError('');setNotice('');
    try{
      let current=recordRef.current;
      if(action==='decideFacts'){
        const fresh=await load({quiet:true});if(!fresh)throw new Error('Decision not saved. Could not check the latest facts; reload and try again.');
        if(!decisionBasesMatch(fresh.state,body.decisions))throw new Error('Decision not saved. A selected fact or its previous decision changed. Review the reloaded facts and choose again.');
        if(indexingActive(fresh.state))throw new Error('Decision not saved yet. Memory indexing is finishing; your saved facts are unchanged. Wait for syncing to finish, then choose again.');
        current=fresh;
      }else if(['prepare','buildProfiles','approveRole','finalize','importJD','preferences','answer','analyzeAnswer','reviewExperience','reviewBuilder','extractSection1','paste'].includes(action)){
        const fresh=await load({quiet:true});if(!fresh)throw new Error('Could not refresh your saved profile. Try again.');current=fresh;
      }
      const response=await fetch('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,revision:current.revision,...body})}),data=await response.json() as RecordData;
      if(!response.ok){if(response.status===409)await load({quiet:true});throw new Error((action==='decideFacts'?'Decision not saved. ':'')+(data.error||'Operation failed.'));}
      if(action==='answer'&&!answerReceiptMatches(data,body))throw new Error('Could not verify the saved answer receipt. Your draft is kept; try again.');
      if(action==='extractSection1'&&!section1ReceiptMatches(data,body))throw new Error('Could not verify the saved Section 1 extraction. Reload before reviewing the source fields.');
      if(action==='reviewBuilder'&&(!builderReviewReceiptMatches(data,body)||(data.result as {storageVerified?:boolean})?.storageVerified!==true))throw new Error('Could not verify the saved Builder decision. Your draft is kept; retry with the same decision.');
      if(action==='reviewExperience'&&!experienceReviewReceiptMatches(data,body))throw new Error('Could not verify the saved experience review. Your selections and text are kept; try again.');
      if(action==='decideFacts'&&!decisionReceiptMatches(data,body.decisions))throw new Error('The saved result did not confirm your requested decision. Reload and check the fact status before continuing.');
      if(action==='export'){
        const blob=new Blob([JSON.stringify(data.result,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='career-scout-profile.json';a.click();URL.revokeObjectURL(url);
      }else if(action==='retrieve'){const retrieved=data.result as Retrieval;setResults(retrieved.results);setNotice(retrieved.warning||('Retrieved using '+retrieved.mode));}
      else if(data.deleted){acceptRecord({revision:data.revision,state:data.state||empty});setDeleteText('');}
      else acceptRecord({...data,providers});
      if(['analyze','prepare','buildProfiles','assessJD','decideFacts','paste','importJD','selectJD','preferences','correctFact','reviewExperience'].includes(action))await load({quiet:true});
      if(action==='decideFacts'&&!decisionReceiptMatches(recordRef.current,body.decisions))throw new Error('Your decision was saved, but a newer profile change is now loaded. Review the current fact status.');
      if(action!=='retrieve'){const receipt=data.result as {kind?:string;message?:string}|undefined;setNotice(receipt?.kind==='final_profile_needs_review'?'':receipt?.message||message);}
      return data;
    }catch(e){if(['analyze','prepare','buildProfiles','assessJD','answer','analyzeAnswer'].includes(action))await load({quiet:true});actionError.current=e instanceof Error?e.message:'Operation failed.';setError(actionError.current);}
    finally{actionLock.current=false;setBusy('');}
  }
  async function upload(file:File,documentKind='resume'){
    if(actionLock.current)return;actionLock.current=true;setBusy('upload');setError('');setNotice('');
    try{
      const form=new FormData();form.set('file',file);form.set('kind',documentKind);form.set('title','');form.set('selected',String(documentKind==='jd'));form.set('revision',String(recordRef.current.revision));
      const response=await fetch('/api/profile',{method:'POST',body:form}),data=await response.json() as RecordData;if(!response.ok)throw new Error(data.error);
      acceptRecord({...data,providers});await load({quiet:true});setNotice('Document saved privately. Analyze it to propose source-linked records.');return true;
    }catch(e){setError(e instanceof Error?e.message:'Upload failed.');return false;}finally{actionLock.current=false;setBusy('');}
  }
  const syncing=indexingActive(state),disabled=!!busy||!profileLoaded||!providers.supabase||syncing;
  function decision(value:string,chosen=facts.filter(f=>picked.includes(factKey(f)))){const decisions=chosen.map(f=>factDecision(f,value));void act('decideFacts',{decisions},`${decisions.length} fact${decisions.length===1?'':'s'} ${label(value)} and saved.`).then(data=>{if(data)setPicked([]);});}
  const resumes=docs.filter(d=>d.kind==='resume');
  const steps=[
    {id:'Documents',title:'Add your resume',detail:'Your resume source documents',done:resumes.some(d=>d.analysis==='complete')&&!readiness.blockers.some((b:{code:string})=>b.code==='source_review_incomplete')},
    {id:'Facts',title:'Review facts and experience',detail:'Factual records and professional experience',done:approved.length>0&&!facts.some(f=>f.approval==='pending'||f.conflict)&&!readiness.blockers.some((b:{code:string})=>b.code==='source_review_incomplete')},
    {id:'Builder',title:'Expand experience and skills',detail:'Questionnaires and automatically saved additions',done:!!snapshot},
    {id:'Search',title:'Search & shortlisted jobs',detail:'Your requirements and recommended openings',done:!!snapshot&&!!state.scoutHandoffs?.some(h=>h.profileVersion===snapshot.version&&h.stage==='completed')}
  ];
  const stepIndex=Math.max(0,steps.findIndex(s=>s.id===tab)),nextStep=steps.find(s=>!s.done)?.id||'Search';
  function changeSearch<K extends keyof SearchPreferences>(key:K,value:SearchPreferences[K]){searchDirty.current=true;setSearch(current=>({...current,[key]:value}));}
  function showView(next:string){if(next==='jobs'){window.history.replaceState(null,'','/?step=Search');setView('profile');setTab('Search');return;}const linked=next==='jobs'&&snapshot?.searchProfile?.basis==='validated_source_data';window.history.replaceState(null,'',next==='profile'?'/':'/?view='+next+(linked?'&profileRole=master-profile&profileVersion='+encodeURIComponent(snapshot.version):''));setView(next);}
  async function prepare(){const data=await act('prepare',{search},'Document analysis saved. Review the facts extracted from your resume.');if(data)setTab('Facts');}
  async function compareRoles(refreshAll=false){
    setReviewDocumentIds(null);
    const documentIds=refreshAll?undefined:questionnaireScope.newDocumentIds;
    if(!refreshAll&&!documentIds.length){setNotice('No new job descriptions to analyze. Earlier questionnaires are saved below.');return;}
    await act('buildProfiles',{mode:'expansion',search,...(documentIds?{documentIds}:{})},refreshAll?'Selected role comparisons refreshed.':'Questionnaires prepared for the newly added roles. Earlier answers are preserved.');
  }
  async function uploadJDs(files:File[]){if(files.length+jds.length>15){setError('Select at most 15 JDs in total.');return;}for(const file of files){const saved=await upload(file,'jd');if(!saved)return;}setNotice(files.length+' job descriptions saved privately with your source documents.');}


  function sourceList(documentKind:string){return docs.filter(d=>d.kind===documentKind).map(d=><div className="cw-source" key={d.id}><FileText size={19}/><div><strong>{d.title}</strong><span>{d.analysis==='complete'?'Analyzed and saved':'Saved · ready to analyze'}{d.sourceURL&&' · from a link'}</span></div><details><summary aria-label={'Manage '+d.title}>•••</summary><div>{d.objectPath&&<a href={'/api/profile?download='+encodeURIComponent(d.id)}>Download original</a>}{d.sourceURL&&<a href={d.sourceURL} target="_blank" rel="noreferrer">View source</a>}{d.kind==='jd'&&<label><input type="checkbox" checked={d.selected} disabled={disabled} onChange={e=>void act('selectJD',{id:d.id,selected:e.target.checked})}/>Use in my profile</label>}<button disabled={disabled} onClick={()=>void act('removeDocument',{id:d.id},'Source withdrawn. Its dependent facts need review.')}>Withdraw source</button></div></details></div>);}
  const viewLabel=view==='applications'?'Your applications':view==='jobs'?'Your job search':view==='workflow'?'How Career Scout works':view==='progress'?'Project details':'My profile';
  return <div className="cw-app">
    <header className="cw-header"><a className="cw-logo" href="/"><span><Compass size={24}/></span>career<span>scout</span></a><nav aria-label="Career Scout"><button aria-current={view==='profile'?'page':undefined} onClick={()=>showView('profile')}><UserRound size={16}/>My profile</button><button aria-current={view==='jobs'?'page':undefined} onClick={()=>showView('jobs')}><Search size={16}/>Jobs</button><button aria-current={view==='applications'?'page':undefined} onClick={()=>showView('applications')}><FileText size={16}/>Applications</button></nav><button className="cw-how" onClick={()=>showView(view==='workflow'?'profile':'workflow')}>How it works <ChevronRight size={14}/></button></header>
    {view==='profile'?<>
      <section className="cw-intro"><div><p className="cw-eyebrow">MY PROFILE · YOUR STARTING POINT</p><h1>Your next chapter<br/><em>starts with you.</em></h1><p>Add your resume. Turn your experience into a clear profile<br className="cw-desktop"/> and a job search with direction.</p></div><div className="cw-overview"><span className="cw-saved"><Lock size={13}/>Your profile, under your control</span><div><strong>{steps.filter(s=>s.done).length}<small>/ {steps.length}</small></strong><span>steps complete</span></div><div className="cw-progress-track"><i style={{width:(steps.filter(s=>s.done).length/steps.length*100)+'%'}}/></div><button onClick={()=>setTab(nextStep)}>Continue where I left off <ArrowRight size={15}/></button></div></section>
      <div className="cw-layout"><aside className="cw-sidebar"><p className="cw-eyebrow">YOUR PROFILE JOURNEY</p><nav aria-label="Profile steps">{steps.map((step,i)=><button key={step.id} className={tab===step.id?'active':''} aria-current={tab===step.id?'step':undefined} onClick={()=>setTab(step.id)}><span className={'cw-step-number '+(step.done?'done':'')}>{step.done?<Check size={16}/>:String(i+1).padStart(2,'0')}</span><span><strong>{step.title}</strong><small>{step.detail}</small></span><ChevronRight size={15}/></button>)}</nav><div className="cw-sidebar-note"><ShieldCheck size={21}/><strong>Your experience. Your say.</strong><p>Review the information extracted from your resume. Scout uses an existing saved validated profile for job research.</p><button onClick={()=>setTab(tab==='Memory'?'Documents':'Memory')}><Settings2 size={14}/> My data & privacy</button></div></aside>
      <main className="cw-panel" id="profile-step"><div className="cw-panel-top"><span>STEP {String(stepIndex+1).padStart(2,'0')} OF {String(steps.length).padStart(2,'0')}</span><span className="cw-dot-label">{busy?'Saving your progress':profileLoaded?(docs.length?'Progress saved privately':'Ready to begin'):error?'Connection needs attention':'Connecting your profile'}</span></div>
        {error&&<div className="cw-feedback error" role="alert"><strong>We couldn’t finish that step.</strong><p>{error}</p><button onClick={()=>void load()}>Refresh saved progress</button></div>}{notice&&<div className="cw-feedback" role="status"><CheckCircle2 size={17}/>{notice}</div>}{(busy||syncing)&&<div className="cw-working" role="status"><LoaderCircle className="pf-spin" size={17}/>{busy==='prepare'?'Reading your source documents. This can take a minute.':busy==='buildProfiles'?'Profile Builder is analyzing selected JDs, comparing your approved facts and preparing gap questions.':syncing?'Finishing a saved update. You can review your profile while it syncs.':'Saving your changes…'}</div>}
        {tab==='Documents'&&<section><div className="cw-section-heading"><h2>Let’s start with your experience.</h2><p>Your resume builds the foundation. Add job descriptions later in Expand experience and skills.</p></div><div><article className="cw-upload-card"><div className="cw-card-title"><span className="cw-icon"><Upload size={21}/></span><div><h3>Your resume</h3><span>Required to build your profile</span></div></div><label className="cw-dropzone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files?.[0];if(file&&!disabled)void upload(file,'resume');}}><Upload size={26}/><strong>{resumes.length?'Add an updated resume':'Drop your resume here'}</strong><span>or <u>browse files</u></span><small>PDF, Word (.docx) or TXT · up to 2 MB</small><input aria-label="Upload your resume" type="file" accept=".pdf,.docx,.txt" disabled={disabled} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file,'resume');e.target.value='';}}/></label>{sourceList('resume')}</article></div><div className="cw-gentle-note"><Sparkles size={19}/><p><strong>Start with your resume.</strong><br/>We’ll identify the experience and skills explicitly recorded in it.</p></div><details className="cw-text-intake"><summary>Prefer to paste the text instead?</summary><textarea aria-label="Resume text" rows={6} value={text} onChange={e=>setText(e.target.value)} placeholder="Paste the complete source text"/><button className="cw-secondary" disabled={disabled||text.trim().length<80} onClick={()=>void act('paste',{kind:'resume',text,selected:false},'Source text saved.').then(data=>{if(data)setText('');})}>Save source text</button></details><label className="cw-field">Anything you’d like to focus on? <small>Optional · a role, industry or career direction</small><input value={search.goals} maxLength={1500} onChange={e=>changeSearch('goals',e.target.value)} placeholder="For example: client reporting roles in financial services"/></label><div className="cw-step-footer"><span><Lock size={13}/>You’ll review extracted facts next.</span><button className="cw-primary" disabled={disabled||!resumes.length||!providers.model} onClick={()=>void prepare()}>Analyze my documents <ArrowRight size={16}/></button></div></section>}
        {tab==='Facts'&&<section>
          <div className="cw-section-heading"><h2>Your factual profile.</h2><p>Personal records, skills and professional work experience from your resume.</p></div>
          <FactReview state={state} disabled={disabled} showReviewDetails={false} onExtract={resumes.length?()=>{void act('extractSection1',{id:resumes.at(-1)!.id},'Section 1 updated from your saved resume.');}:undefined}/>
          <div className="cw-step-footer"><span>JD requirements never become facts about you.</span><button className="cw-primary" disabled={disabled||!approved.some(f=>!['personal','preferences'].includes(f.category))} onClick={()=>setTab('Builder')}>Expand experience & skills <ArrowRight size={16}/></button></div>
        </section>}
        {tab==='Builder'&&<section>
          <div className="cw-section-heading"><h2>Expand your experience and skills.</h2><p>Each role has its own questionnaire. Approve confirms the displayed wording, Reject excludes it, and Somewhat saves a revision for a separate approval. Your existing factual records remain intact.</p></div>
          <article className="cw-upload-card cw-optional"><div className="cw-card-title"><span className="cw-icon"><Target size={21}/></span><div><h3>Add job descriptions <span className="cw-tag">Optional</span></h3><span>Add job links or files to prepare role questionnaires</span></div></div><div className="cw-segmented"><button aria-pressed={jdEntry==='file'} onClick={()=>setJDEntry('file')}><FileText size={14}/>Upload a JD</button><button aria-pressed={jdEntry==='link'} onClick={()=>setJDEntry('link')}><Link2 size={14}/>Paste a link</button></div>{jdEntry==='file'?<label className="cw-jd-file"><FileText size={23}/><strong>Choose one or more job descriptions</strong><span>PDF, Word (.docx) or TXT</span><input aria-label="Upload job descriptions" type="file" multiple accept=".pdf,.docx,.txt" disabled={disabled} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void uploadJDs(files);}}/></label>:<form className="cw-link-form" onSubmit={e=>{e.preventDefault();void act('importJD',{url:jdURL},'Job description saved and selected. Choose Analyze new roles to compare it with your profile.').then(data=>{if(data)setJDURL('');});}}><label htmlFor="jd-link">Job description link</label><input id="jd-link" type="url" disabled={disabled} required value={jdURL} onChange={e=>setJDURL(e.target.value)} placeholder="https://company.com/careers/role"/><button disabled={disabled||!jdURL.trim()} className="cw-secondary">Add job link <ArrowRight size={14}/></button><small>Public pages and document links. If a page requires sign-in, upload or paste the JD instead.</small></form>}<details className="cw-text-intake"><summary>Paste a job description instead</summary><textarea aria-label="Job description text" rows={6} disabled={disabled} value={jdText} onChange={e=>setJDText(e.target.value)} placeholder="Paste the complete job description"/><button className="cw-secondary" disabled={disabled||jdText.trim().length<80} onClick={()=>void act('paste',{kind:'jd',text:jdText,selected:true},'Job description saved and selected. Choose Analyze new roles next.').then(data=>{if(data)setJDText('');})}>Save job description</button></details>{sourceList('jd')}</article>
          <p>Add one or more job descriptions above, then analyze the new roles against your saved Factual Profile. Earlier questionnaires and answers stay saved below. A role title alone does not establish requirements.</p>
          <div className="cw-completion-actions"><button className="cw-primary" disabled={disabled||!providers.model||!questionnaireScope.newDocumentIds.length||!approved.some(f=>!['personal','preferences'].includes(f.category))} onClick={()=>void compareRoles()}>Analyze new roles ({questionnaireScope.newDocumentIds.length})</button></div>
          {!approved.some(f=>!['personal','preferences'].includes(f.category))&&<p>Approved professional facts are needed before Profile Builder can compare job requirements.</p>}
          {!jds.length&&<p>Add one or more job descriptions to create separate role questionnaires.</p>}
          <BuilderExpansion groups={questionnaires} activeDocumentIds={questionnaireScope.newDocumentIds.length?questionnaireScope.activeDocumentIds:reviewDocumentIds||questionnaireScope.activeDocumentIds} disabled={disabled} onSubmit={async body=>{const data=await act('reviewBuilder',body,'Builder decision saved.');return {ok:!!data,message:data?(body.rows[0]?.decision==='somewhat'?'Revision saved as a draft. Review it and approve the wording separately.':body.rows[0]?.decision==='reject'?'Rejection saved. No claim was added.':'Profile updated and saved. Your approved statement is available to Master and Scout.'):actionError.current||'Could not save. Your draft is kept.'};}}/>
          <button className="cw-secondary" onClick={()=>setTab('Facts')}>View updated Factual Profile</button>
          <div className="cw-step-footer"><span>Approved additions are saved directly to your profile.</span><button className="cw-primary" disabled={disabled||!snapshot} onClick={()=>setTab('Search')}>Continue to Master &amp; Scout <ArrowRight size={17}/></button></div>
        </section>}
        {tab==='Search'&&<section>
          {!snapshot||snapshot.searchProfile?.basis!=='validated_source_data'?<div className="cw-empty"><h2>Search & shortlisted jobs</h2><p>{record.currentProfile?.message||'Load your saved factual profile to search with your experience and approved additions.'}</p><button className="cw-secondary" onClick={()=>setTab('Builder')}>Open Profile Builder</button></div>:<SearchStep version={snapshot.version} onPrepare={job=>{setApplicationJob(job);showView('applications');}}/>}
        </section>}
            {tab==='Memory'&&<section className="pf-two"><article className="pf-card"><Database size={23}/><h2>Find supported experience</h2><p>Search approved experience and skill records. Exact terms and semantic results are combined when Pinecone is connected. Contact information is excluded from the index.</p><form className="pf-search" onSubmit={e=>{e.preventDefault();void act('retrieve',{query});}}><input aria-label="Search your approved experience" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Institutional client reporting"/><button disabled={disabled||query.trim().length<3}><Search size={16}/> Search</button></form>{results.map(r=><blockquote key={r.id}><small>{label(r.record_type)}</small><p>{r.text}</p></blockquote>)}<p className="pf-muted">Results are related evidence, not qualification or ATS scores.</p><button disabled={disabled||!providers.pinecone} onClick={()=>void act('sync',{},'Approved records indexed. Pinecone visibility may lag briefly.')}>Sync semantic memory</button><p><small>{state.outbox.filter(e=>e.status==='pending'&&e.kind==='reindex').length} indexing update pending</small></p></article><article className="pf-card"><h2>Your data controls</h2><p>Export your record and approval history. Original uploaded files remain available from Documents. Withdrawn documents are excluded from active facts immediately.</p><div className="pf-actions"><button disabled={disabled} onClick={()=>void act('export',{},'Profile export downloaded.')}>Export profile JSON</button><button disabled={disabled} onClick={()=>void act('cleanup',{},'Withdrawn original files deleted.')}>Clean up withdrawn files</button></div><details className="pf-delete"><summary>Delete all profile data</summary><p>Deletes stored profile records, original files and the owned Pinecone namespace. Provider backups follow the configured provider retention policies.</p><label>Type DELETE MY PROFILE<input value={deleteText} onChange={e=>setDeleteText(e.target.value)} autoComplete="off"/></label><button className="pf-danger" disabled={disabled||deleteText!=='DELETE MY PROFILE'} onClick={()=>void act('deleteProfile',{confirmation:deleteText},'Profile data deleted.')}>Delete my profile</button></details></article></section>}

      </main></div>
    </>:<main className="cw-secondary-view"><div className="cw-view-heading"><div><p className="cw-eyebrow">CAREER SCOUT WORKSPACE</p><h1>{viewLabel}</h1></div><button className="cw-secondary" onClick={()=>showView('profile')}><ArrowLeft size={15}/>Back to my profile</button></div>{view==='jobs'?<><p className="cw-view-caption">Review your filters, search relevant roles, and keep a shortlist—all in this workspace.</p><Scout embedded onPrepare={job=>{setApplicationJob(job);showView('applications');}}/></>:view==='applications'?<Applications version={snapshot?.searchProfile?.basis==='validated_source_data'?snapshot.version:undefined} job={applicationJob} onProfile={()=>{showView('profile');setTab('Documents');}}/>:view==='workflow'?<div className="cw-diagnostic"><ProfileArchitecture initialRecord={progressRecord as ProgressRecord}/></div>:<div className="cw-diagnostic"><ProgressTracker initialRecord={progressRecord as ProgressRecord}/></div>}</main>}
    <footer className="cw-footer"><span><Compass size={15}/> Career Scout · A clearer path to your next role</span><div><button onClick={()=>showView('workflow')}>How it works</button><button onClick={()=>showView('progress')}>Project status</button><button onClick={()=>{showView('profile');setTab('Memory');}}>My data & privacy</button></div></footer>
  </div>;
}
