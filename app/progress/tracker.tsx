'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, Clock3, Compass, GitBranch, LoaderCircle, RefreshCw, Search, ShieldCheck, Wifi, WifiOff, X } from 'lucide-react';
import { progressCounts, stageState, taskBlockers, validateProgress, PROGRESS_POLL_SECONDS } from '@/lib/project-progress.mjs';
import type { ProgressRecord, ProgressResponse, ProgressStatus, ProgressTask } from '@/lib/progress-types';
import './progress.css';

const statusLabel:Record<ProgressStatus,string>={done:'Built',partial:'Partial',pending:'Pending'};
const dateLabel=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
function Status({status}:{status:ProgressStatus}){
  const Icon=status==='done'?CheckCircle2:status==='partial'?Clock3:Circle;
  return <span className={'progress-status status-'+status}><Icon size={13}/>{statusLabel[status]}</span>;
}

export default function ProgressTracker({initialRecord}:{initialRecord:ProgressRecord}){
  const [record,setRecord]=useState(initialRecord);
  const [stage,setStage]=useState('all'),[filter,setFilter]=useState('all'),[query,setQuery]=useState('');
  const [selectedId,setSelectedId]=useState('keenable'),[syncedAt,setSyncedAt]=useState(''),[syncing,setSyncing]=useState(false);
  const [connection,setConnection]=useState<boolean|null>(null),[syncError,setSyncError]=useState('');
  const [announcement,setAnnouncement]=useState(''),[mobileDetails,setMobileDetails]=useState(false);
  const [readyOnly,setReadyOnly]=useState(false);
  const refreshRef=useRef<()=>void>(()=>{}),detailRef=useRef<HTMLDivElement>(null),revisionRef=useRef(initialRecord.revision);
  const counts=progressCounts(record.tasks);
  const needle=query.trim().toLowerCase();
  const visible=record.tasks.filter(task=>(stage==='all'||task.stage===stage)&&(filter==='all'||task.status===filter)&&(!readyOnly||(task.status==='pending'&&taskBlockers(task,record.tasks).length===0))&&(!needle||[task.title,task.detail,task.evidence,task.source,task.acceptance,...(task.inputs||[])].filter(Boolean).join(' ').toLowerCase().includes(needle)));
  const selected=visible.find(task=>task.id===selectedId)||visible[0];
  const stageInfo=record.stages.find(item=>item.id===stage);
  const readyTasks=record.tasks.filter(task=>task.status==='pending'&&taskBlockers(task,record.tasks).length===0);

  useEffect(()=>{
    let disposed=false,active:AbortController|null=null;
    async function refresh(){
      if(active||disposed)return;
      active=new AbortController();setSyncing(true);
      try{
        const response=await fetch('/api/progress',{cache:'no-store',signal:AbortSignal.any([active.signal,AbortSignal.timeout(12000)])});
        if(!response.ok)throw new Error('The progress record could not be reached.');
        const value=await response.json() as ProgressResponse;
        validateProgress(value.record);
        if(!value.servedAt||!Number.isFinite(Date.parse(value.servedAt))||typeof value.connection?.keenableConfigured!=='boolean')throw new Error('Invalid progress response.');
        if(disposed)return;
        if(revisionRef.current!==value.record.revision){setAnnouncement('The project record was updated.');revisionRef.current=value.record.revision;}
        setRecord(value.record);
        setSyncedAt(new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'}));
        setConnection(value.connection.keenableConfigured);setSyncError('');
      }catch(error){
        if(!disposed){setSyncError(error instanceof Error&&error.name==='TimeoutError'?'The sync timed out. Showing the last loaded record.':'Sync unavailable. Showing the last loaded record; retry or check your sign-in.');setAnnouncement('Progress sync unavailable.');}
      }finally{active=null;if(!disposed)setSyncing(false);}
    }
    refreshRef.current=()=>{void refresh();};
    const onVisible=()=>{if(document.visibilityState==='visible')void refresh();};
    const interval=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},PROGRESS_POLL_SECONDS*1000);
    document.addEventListener('visibilitychange',onVisible);window.addEventListener('focus',onVisible);
    void refresh();
    return ()=>{disposed=true;active?.abort();window.clearInterval(interval);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',onVisible);refreshRef.current=()=>{};};
  },[]);

  useEffect(()=>{if(mobileDetails)detailRef.current?.focus();},[selectedId,mobileDetails]);

  function chooseStage(id:string){setStage(id);setReadyOnly(false);setMobileDetails(false);}
  function selectTask(task:ProgressTask){if(!visible.some(item=>item.id===task.id)){setStage(task.stage);setFilter('all');setQuery('');setReadyOnly(false);}setSelectedId(task.id);setMobileDetails(true);}
  function exportRecord(){
    const url=URL.createObjectURL(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),record},null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='scout-project-progress.json';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const blockers=(selected?taskBlockers(selected,record.tasks):[]) as ProgressTask[];
  const selectedStage=record.stages.find(item=>item.id===selected?.stage);
  return <div className="progress-page">
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Career Scout home"><span className="brand-mark"><Compass size={23}/></span><span>career<span className="brand-light">scout</span></span></Link>
      <nav className="progress-nav" aria-label="Main navigation"><Link href="/">Discover jobs</Link><Link href="/progress" aria-current="page">Project progress</Link></nav>
      <Link className="sources-button" href="/"><ArrowLeft size={16}/>Back to Scout</Link>
    </header>
    <main className="progress-main">
      <section className="progress-hero">
        <div><span className="eyebrow"><span/> FROM SCOUT TO YOUR DAILY AGENT</span><h1>See what’s built.<br/><em>Know what comes next.</em></h1><p>{record.summary}</p></div>
        <div className="progress-sync">
          <div className={'sync-indicator '+(syncError?'sync-offline':'')}>{syncing?<LoaderCircle size={16} className="spin"/>:syncError?<WifiOff size={16}/>:syncedAt?<Wifi size={16}/>:<Clock3 size={16}/>}<strong>{syncing?'Syncing project record':syncError?'Sync unavailable':syncedAt?'Connected to project record':'Checking connection'}</strong></div>
          <p>{syncedAt?`Last sync ${syncedAt}`:'Loading the latest published record…'}</p>
          <button className="secondary" onClick={()=>refreshRef.current()} disabled={syncing}><RefreshCw size={14}/>Sync now</button>
          <small>Auto-checks every {PROGRESS_POLL_SECONDS} seconds while this page is visible.</small>
        </div>
      </section>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {syncError&&<div className="notice" role="alert">{syncError}</div>}
      <section className="progress-metrics" aria-label="Deliverable counts">
        <button className={filter==='done'?'metric is-selected':'metric'} aria-pressed={filter==='done'} onClick={()=>{setFilter(filter==='done'?'all':'done');setReadyOnly(false);}}><span>Built</span><strong>{counts.done}<small> / {counts.total}</small></strong><span>Implemented deliverables</span></button>
        <button className={filter==='partial'?'metric is-selected':'metric'} aria-pressed={filter==='partial'} onClick={()=>{setFilter(filter==='partial'?'all':'partial');setReadyOnly(false);}}><span>Partial</span><strong>{counts.partial}</strong><span>Acceptance work remains</span></button>
        <button className={filter==='pending'?'metric is-selected':'metric'} aria-pressed={filter==='pending'} onClick={()=>{setFilter(filter==='pending'?'all':'pending');setReadyOnly(false);}}><span>Pending</span><strong>{counts.pending}</strong><span>Planned deliverables</span></button>
        <button className={readyOnly?'metric is-selected':'metric'} aria-pressed={readyOnly} onClick={()=>{setReadyOnly(!readyOnly);setFilter('all');setStage('all');}}><span>Ready to plan</span><strong>{readyTasks.length}</strong><span>Recorded prerequisites complete</span></button>
      </section>
      <p className="progress-caption">Counts describe {counts.total} defined deliverables, not an estimate of effort or time. Feature statuses are reviewed with each release; syncing does not infer completion from code or run the test suite.</p>

      <section className="capability-map" aria-labelledby="capability-title">
        <div className="progress-section-head"><div><span className="eyebrow">CAPABILITY MAP</span><h2 id="capability-title">Your agent, stage by stage</h2></div><button className="text-button" onClick={()=>chooseStage('all')}>Show all stages <ArrowRight size={14}/></button></div>
        <ol className="stage-map">
          {record.stages.map((item,index)=>{const tasks=record.tasks.filter(task=>task.stage===item.id),total=progressCounts(tasks),state=stageState(tasks) as ProgressStatus;return <li key={item.id}><button aria-pressed={stage===item.id} className={'stage-node stage-'+state} onClick={()=>chooseStage(stage===item.id?'all':item.id)}><div className="stage-node-top"><span className="stage-number">{String(index+1).padStart(2,'0')}</span><Status status={state}/></div><h3>{item.title}</h3><p>{item.description}</p><div className="stage-track" role="img" aria-label={`${total.done} built, ${total.partial} partial, ${total.pending} pending`}><span className="track-done" style={{width:`${total.done/total.total*100}%`}}/><span className="track-partial" style={{width:`${total.partial/total.total*100}%`}}/><span className="track-pending" style={{width:`${total.pending/total.total*100}%`}}/></div><span className="stage-count">{total.done} of {total.total} built <ArrowRight size={14}/></span></button></li>;})}
        </ol>
        <div className="map-legend"><span><i className="legend-done"/>Built</span><span><i className="legend-partial"/>Partial</span><span><i className="legend-pending"/>Pending</span><span>Select a stage, then a deliverable to inspect its evidence and dependencies.</span></div>
      </section>

      <section className="progress-work" aria-labelledby="deliverables-title">
        <div className="progress-section-head"><div><span className="eyebrow">IMPLEMENTATION RECORD</span><h2 id="deliverables-title">{stageInfo?.title||'All deliverables'} <span className="result-count">{visible.length}</span></h2></div><button className="secondary" onClick={exportRecord}><ArrowDownToLine size={15}/>Export record</button></div>
        {stageInfo&&<p className="stage-next"><ArrowRight size={16}/>{stageInfo.next}</p>}
        <div className="progress-filters"><label className="progress-search"><Search size={17}/><span className="sr-only">Find a feature or task</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Find a feature, rule or next step…"/></label><label><span className="sr-only">Filter by status</span><select value={filter} onChange={event=>{setFilter(event.target.value);setReadyOnly(false);}}><option value="all">All statuses</option><option value="done">Built</option><option value="partial">Partial</option><option value="pending">Pending</option></select></label>{(stage!=='all'||filter!=='all'||query||readyOnly)&&<button className="text-button" onClick={()=>{setStage('all');setFilter('all');setQuery('');setReadyOnly(false);}}>Clear filters <X size={14}/></button>}</div>
        {readyOnly&&<div className="notice">Showing pending work whose recorded dependencies are complete. Some items still need your preferences or documents.</div>}
        <div className="progress-detail-grid">
          <div className="progress-task-list">
            {visible.length===0&&<div className="progress-empty">No deliverables match these filters. Clear filters to see the whole plan.</div>}
            {record.stages.map(group=>{const tasks=visible.filter(task=>task.stage===group.id);return tasks.length>0&&<section className="task-group" key={group.id} aria-label={group.title}><h3>{group.title}</h3>{tasks.map(task=><button className={'task-row '+(selected?.id===task.id?'task-selected':'')} aria-pressed={selected?.id===task.id} key={task.id} onClick={()=>selectTask(task)}><div><span className="task-title">{task.title}</span><span className="task-summary">{task.detail}</span></div><Status status={task.status}/><ArrowRight size={16}/></button>)}</section>;})}
          </div>
          {selected&&<aside className={'task-inspector '+(mobileDetails?'inspector-open':'')} aria-label="Selected deliverable" ref={detailRef} tabIndex={-1}>
            <div className="inspector-top"><span className="eyebrow">{selectedStage?.title}</span><button className="icon-button inspector-close" aria-label="Close task detail" onClick={()=>setMobileDetails(false)}><X size={18}/></button></div>
            <Status status={selected.status}/><h2>{selected.title}</h2><p>{selected.detail}</p>
            <div className="inspector-section"><h3>{selected.status==='done'?'What was delivered':'What completion requires'}</h3><p>{selected.acceptance}</p></div>
            {selected.evidence&&<div className="inspector-evidence"><ShieldCheck size={18}/><div><h3>Recorded evidence</h3><p>{selected.evidence}</p><small>Reviewed {dateLabel(record.reviewedOn)}. Historical checks retain their original dates.</small></div></div>}
            {selected.status!=='done'&&<div className="inspector-section"><h3>{blockers.length?'Waiting on these deliverables':'Prerequisites'}</h3>{blockers.length?<div className="dependency-list">{blockers.map(task=><button key={task.id} onClick={()=>selectTask(task)}><GitBranch size={14}/>{task.title}<ArrowRight size={13}/></button>)}</div>:<p className="prerequisites-met"><Check size={15}/>No incomplete prerequisites recorded.</p>}</div>}
            {(selected.inputs?.length||0)>0&&<div className="inspector-section"><h3>Needed from you</h3><ul>{selected.inputs!.map(input=><li key={input}>{input}</li>)}</ul></div>}
            {(selected.dependsOn.length>0&&selected.status==='done')&&<div className="inspector-section"><h3>Depends on</h3><div className="dependency-list">{selected.dependsOn.map(id=>record.tasks.find(task=>task.id===id)).filter((task):task is ProgressTask=>!!task).map(task=><button key={task.id} onClick={()=>selectTask(task)}><GitBranch size={14}/>{task.title}<ArrowRight size={13}/></button>)}</div></div>}
            {selected.source&&<details className="inspector-source"><summary>Implementation reference</summary><code>{selected.source}</code></details>}
          </aside>}
        </div>
      </section>

      <section className="progress-bottom" aria-label="Validation history and current connection">
        <div className="progress-history"><span className="eyebrow">EVIDENCE HISTORY</span><h2>What has been checked</h2>{record.validation.map((event,index)=><article className="history-entry" key={index}><time dateTime={event.date}>{dateLabel(event.date)}</time><div><h3>{event.title}</h3><p>{event.detail}</p></div></article>)}</div>
        <aside className="progress-boundaries"><span className="eyebrow">CURRENT OPERATION</span><h2>Scout is ready to use</h2><p><strong>Keenable key:</strong> {connection===null?'checking configuration':syncError?'last configuration check is stale':connection?'configured on this deployment':'not configured on this deployment'}.</p><p>Configuration checks do not spend search credits or confirm provider authentication. They do not run searches.</p><p>Job refresh is manual today. A daily schedule, resume Matcher and resume drafting are still pending.</p><Link className="primary" href="/">Open Discover <ArrowRight size={16}/></Link></aside>
      </section>
      <footer><span><Compass size={14}/> career scout · project progress</span><span>Record {record.revision} · Reviewed {dateLabel(record.reviewedOn)}</span></footer>
    </main>
  </div>;
}
