'use client';
import {useCallback,useEffect,useState} from 'react';
import {ArrowDown,ArrowUpDown,ArrowUpRight,Check,GitBranch,RefreshCw,UserRound} from 'lucide-react';
import type {ProgressRecord,ProgressTask} from '@/lib/progress-types';
import {PROFILE_LAYERS,architectureTasks,layerTasks,layerState} from '@/lib/profile/architecture.mjs';
import {progressCounts,STATUS_LABELS,validateProgress} from '@/lib/project-progress.mjs';
type Layer={id:string;title:string;label:string;description:string;tasks:string[]};
type Connection={supabase:boolean;pinecone:boolean;model:boolean;semanticEnabled:boolean};
const labels:Record<string,string>={complete:'Complete',in_progress:'In progress',blocked:'Blocked',in_review:'In review',not_started:'Pending'};
export default function ProfileArchitecture({initialRecord}:{initialRecord:ProgressRecord}){
  const [record,setRecord]=useState(initialRecord),[selected,setSelected]=useState('profile'),[connection,setConnection]=useState<Connection|null>(null),[syncing,setSyncing]=useState(false),[error,setError]=useState(''),[checked,setChecked]=useState('');
  const sync=useCallback(async(signal?:AbortSignal)=>{
    setSyncing(true);
    try{
      const response=await fetch('/api/progress',{cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});if(!response.ok)throw new Error('The latest progress record could not be loaded. Showing the last reviewed version.');
      const data=await response.json() as {record:ProgressRecord;servedAt:string};validateProgress(data.record);architectureTasks(data.record);setRecord(data.record);setChecked(data.servedAt);setError('');
    }catch{if(!signal?.aborted)setError('Progress sync failed. Showing the last reviewed version.');}
    if(signal?.aborted)return;
    try{const response=await fetch('/api/profile?status=1',{cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});if(response.ok)setConnection((await response.json() as {providers:Connection}).providers);}catch{}
    if(!signal?.aborted)setSyncing(false);
  },[]);
  useEffect(()=>{
    const controller=new AbortController();let active=false;
    const refresh=async()=>{if(active||document.visibilityState==='hidden')return;active=true;try{await sync(controller.signal);}finally{active=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),30000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[sync]);
  const layer=PROFILE_LAYERS.find((item:Layer)=>item.id===selected) as Layer;
  const tasks=layerTasks(record,selected) as ProgressTask[],counts=progressCounts(architectureTasks(record));
  function node(id:string){
    const item=PROFILE_LAYERS.find((layer:Layer)=>layer.id===id) as Layer,status=layerState(record,id),counts=progressCounts(layerTasks(record,id));
    return <button type="button" className={'pa-node '+(selected===id?'pa-selected':'')} aria-pressed={selected===id} aria-controls="profile-layer-detail" onClick={()=>setSelected(id)}><span className="pa-node-label">{item.label}</span><strong>{item.title}</strong><span className={'pa-status '+status}>{labels[status]}</span><small>{counts.complete}/{counts.total} complete{counts.blocked?` · ${counts.blocked} blocked`:''}</small></button>;
  }
  return <main className="pf-shell pa-shell">
    <header className="pf-header"><a href="/" className="pf-brand"><span><UserRound size={20}/></span>Career Scout</a><nav><a href="/profile">My profile</a><a href="/profile/architecture" aria-current="page">Profile diagram</a><a href="/progress">All agents</a></nav></header>
    <section className="pa-intro"><div><p className="pf-eyebrow">PROFILE AGENT · STRUCTURE & PROGRESS</p><h1>See how your<br/><em>profile comes together.</em></h1><p>Follow the evidence from your documents to approved facts and reusable memory. Select a layer to see what is complete, open and still waiting.</p></div><div className="pa-sync"><span>Reviewed {record.reviewedOn}</span><code>{record.revision}</code><button disabled={syncing} onClick={()=>void sync()}><RefreshCw size={14} className={syncing?'pf-spin':''}/>{syncing?'Syncing…':'Sync now'}</button>{checked&&<small>Checked {new Date(checked).toLocaleTimeString()}</small>}</div></section>
    <div className="pa-summary" aria-label="Profile architecture tracking counts">{[['complete','Complete'],['in_progress','In progress'],['blocked','Blocked'],['in_review','In review'],['not_started','Pending']].map(([status,label])=><div key={status}><strong>{counts[status]}</strong><span>{label}</span></div>)}</div>
    <p className="pa-caption">Counts cover {counts.total} distinct tracking items in this diagram, including Master dispatch. Related layers share items; they are counted once. Diagram states are reviewed evidence, not live execution indicators.</p>
    {error&&<div className="pf-message error" role="status">{error}</div>}
    <article className="pf-card"><h2>Resume to job search — JDs optional</h2><p>Resume → Fact Agent → your fact approvals → Profile Builder → your role approval → activated Supabase snapshot → Profile → Master → Scout → Keenable jobs.</p><p>Builder works through Profile. You choose a proposed role before search. Location and filters stay under your control. Search discovery does not establish job fit; Matcher, Tailor and Critic are separate pending layers.</p><a href="/profile">Build or review roles</a>{' · '}<a href="/">Open main job search</a></article><div className="pa-workspace">
      <section className="pa-diagram" aria-label="Profile coordination and storage diagram">
        <div className="pa-spine">{node('master')}<div className="pa-connector"><ArrowUpDown size={18}/><span>Requests / approved results</span></div>{node('profile')}</div>
        <div className="pa-fork" aria-hidden="true"><span/><span/></div>
        <div className="pa-branches">
          <section className="pa-branch"><h2>Interpret the evidence</h2><p className="pa-branch-route">Profile ↔ Fact / Builder</p><div className="pa-workers">{node('fact')}{node('builder')}</div><div className="pa-connector"><ArrowUpDown size={18}/><span>Scoped text / JSON proposals</span></div>{node('analysis')}<p className="pa-rule"><Check size={14}/>You approve each fact and role-profile version.</p></section>
          <section className="pa-branch"><h2>Keep and find evidence</h2><p className="pa-branch-route">Profile ↔ Memory</p>{node('memory')}<div className="pa-connector"><ArrowUpDown size={18}/><span>Records / approved evidence</span></div>{node('supabase')}<div className="pa-connector"><ArrowDown size={18}/><span>Approved passages + search query, through Memory</span></div>{node('embeddings')}<div className="pa-connector"><ArrowUpDown size={18}/><span>Memory stores vectors / requests similar records</span></div>{node('pinecone')}<p className="pa-rule"><Check size={14}/>Results are checked against current approved records.</p></section>
        </div>
        <p className="pa-caption"><GitBranch size={14}/>Arrows show permitted operations through Profile. Fact and Builder do not access storage or communicate directly. Supabase does not call Gemini.</p>
      </section>
      <aside className="pa-detail pf-card" id="profile-layer-detail" aria-label="Selected Profile layer">
        <p className="pf-eyebrow">SELECTED LAYER</p><h2>{layer.title}</h2><p>{layer.description}</p>
        <h3>Reviewed deliverables</h3>
        {tasks.map(task=><details key={task.id} className="pa-task"><summary><span className={'pa-dot '+task.status}/><span>{task.title}</span><small>{labels[task.status]}</small></summary><p>{task.acceptance}</p>{task.blockers.length>0&&<div><strong>Open blockers</strong><ul>{task.blockers.map((blocker,i)=><li key={i}>{blocker}</li>)}</ul></div>}{task.evidence&&<p className="pa-evidence">Evidence: {task.evidence}</p>}{task.notes.length>0&&<p>{task.notes.at(-1)}</p>}{task.dependsOn.length>0&&<p>Prerequisites: {task.dependsOn.map(id=>{const dependency=record.tasks.find(item=>item.id===id);return dependency?`${dependency.title} (${STATUS_LABELS[dependency.status]})`:id;}).join('; ')}.</p>}</details>)}
        <a href="/progress" className="pa-board-link">Open the full progress record <ArrowUpRight size={15}/></a>
      </aside>
    </div>
    <section className="pa-bottom"><article className="pf-card"><h2>What the Gemini pivot changes</h2><p>Analysis and embeddings use Gemini. Supabase remains the record store and Pinecone remains the vector index. Legacy OpenAI vectors are isolated. Existing approvals and source evidence are preserved.</p><p>The selected models have a free tier. Keep billing disabled in Google AI Studio to stay on it. Quota errors stop AI requests; there is no automatic paid fallback.</p><a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Gemini pricing and free-tier data terms</a></article><article className="pf-card"><h2>Configuration, separately</h2><p>These indicators confirm settings are present. They do not run models, inspect quota or prove output quality.</p><ul className="pa-config">{[['Supabase',connection?.supabase],['Gemini analysis',connection?.model],['Gemini + Pinecone retrieval',connection?.pinecone]].map(([name,value])=><li key={String(name)}><span>{name}</span><strong>{connection?value?'Configured':'Setup needed':'Not checked'}</strong></li>)}</ul><p className="pa-caption">Without semantic search, database keyword retrieval remains available. Google’s free-tier data-use terms apply to text sent for analysis and embeddings.</p></article></section>
    <footer className="pf-footer"><span>Profile architecture · same reviewed record as the agent board</span><a href="/profile">Return to your profile</a></footer>
  </main>;
}
