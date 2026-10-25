'use client';
import {useRef,useState} from 'react';
import {Maximize2,Minus,Plus,ArrowRight,GitBranch} from 'lucide-react';
import {progressCounts,stageState,STATUS_LABELS} from '@/lib/project-progress.mjs';
import {routingPath} from '@/lib/workflow/policy.mjs';
import type {ProgressRecord,ProgressStatus} from '@/lib/progress-types';

const positions:Record<string,{x:number;y:number;width:number;height:number;step?:string}>={
  master:{x:535,y:150,width:290,height:145},profile:{x:125,y:375,width:250,height:140,step:'1'},
  fact:{x:40,y:565,width:190,height:145},'profile-builder':{x:245,y:565,width:210,height:145},
  memory:{x:125,y:760,width:250,height:105},scout:{x:520,y:375,width:250,height:140,step:'2'},
  matcher:{x:940,y:375,width:250,height:140,step:'3'},tailor:{x:940,y:615,width:250,height:140,step:'4'},
  critic:{x:535,y:615,width:250,height:140,step:'5'},'application-storage':{x:850,y:830,width:330,height:105,step:'6'}
};
const paths=[
  {d:'M680 95V150',both:false},
  {d:'M535 222C430 222 250 285 250 375',both:true},
  {d:'M640 295C640 325 645 345 645 375',both:true},
  {d:'M780 295C920 310 1065 320 1065 375',both:true},
  {d:'M825 222H1260V685H1190',both:true},
  {d:'M825 275C865 365 865 540 660 615',both:true},
  {d:'M825 180H1320V882H1180',both:false},
  {d:'M190 515L135 565',both:true},
  {d:'M315 515L350 565',both:true},
  {d:'M375 445H465V812H375',both:true}
];
export default function WorkflowBoard({record,selected,onSelect}:{record:ProgressRecord;selected:string;onSelect:(id:string)=>void}){
  const [zoom,setZoom]=useState(.85),[from,setFrom]=useState('scout'),[to,setTo]=useState('profile-builder');
  const viewport=useRef<HTMLDivElement>(null);
  const route=routingPath(from,to) as string[];
  const label=(id:string)=>record.agents.find(agent=>agent.id===id)?.title||id;
  return <section className="workflow-board" aria-labelledby="workflow-map-title">
    <div className="progress-section-head"><div><span className="eyebrow">PERMITTED COMMUNICATION · SIX WORKFLOW STAGES</span><h2 id="workflow-map-title">One Master. A coordinated workflow.</h2></div><div className="board-tools"><button className="secondary" aria-label="Zoom out" disabled={zoom<=.6} onClick={()=>setZoom(value=>Math.max(.6,Math.round((value-.1)*100)/100))}><Minus size={15}/></button><span>{Math.round(zoom*100)}%</span><button className="secondary" aria-label="Zoom in" disabled={zoom>=1.2} onClick={()=>setZoom(value=>Math.min(1.2,Math.round((value+.1)*100)/100))}><Plus size={15}/></button><button className="secondary" onClick={()=>setZoom(Math.min(1,Math.max(.6,(viewport.current?.clientWidth||1100)/1360)))}><Maximize2 size={15}/>Fit</button></div></div>
    <p className="board-description">Select an agent to inspect its deliverables. Pan inside the board to explore. Arrows show allowed paths, not live agent traffic.</p>
    <div className="board-viewport" ref={viewport} role="region" aria-label="Scrollable multi-agent communication board" tabIndex={0}>
      <div style={{width:1360*zoom,height:955*zoom}}>
        <div className="board-scene" style={{transform:`scale(${zoom})`}}>
          <div className="profile-boundary"><span>PROFILE AGENT SCOPE</span><small>Only Profile talks to these children and memory.</small></div>
          <svg className="board-connections" viewBox="0 0 1360 955" aria-hidden="true"><defs><marker id="workflow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="currentColor"/></marker></defs>{paths.map((path,index)=><path key={index} d={path.d} fill="none" markerEnd="url(#workflow-arrow)" markerStart={path.both?'url(#workflow-arrow)':undefined}/>)}</svg>
          <div className="board-user"><strong>User</strong><span>Profile information · existing resume · 10–15 selected JDs</span></div>
          <span className="board-line-label" style={{left:895,top:284}}>Master routes all top-level exchanges</span>
          <span className="board-line-label" style={{left:1207,top:795}}>Validated save only</span>
          {record.agents.map(agent=>{const position=positions[agent.id],tasks=record.tasks.filter(task=>task.owner===agent.id),counts=progressCounts(tasks),status=stageState(tasks) as ProgressStatus;return <button key={agent.id} className={'board-node node-'+agent.id+(selected===agent.id?' node-selected':'')} style={{left:position.x,top:position.y,width:position.width,height:position.height}} aria-pressed={selected===agent.id} onClick={()=>onSelect(selected===agent.id?'all':agent.id)}><div className="board-node-heading"><strong>{position.step&&<span>{position.step}.</span>}{agent.title}</strong><span className={'board-dot dot-'+status}/></div><span className="board-node-role">{agent.id==='critic'?'Master’s validation sub-agent':agent.id==='memory'?'Permanent design deferred':agent.id==='application-storage'?'Daily folders · job-linked packages':agent.id==='master'?'Coordinates, routes, manages state':agent.id==='profile'?'Coordinates facts and role profiles':agent.kind==='subagent'?'Communicates only with Profile':agent.outputs}</span><div className="node-progress"><span style={{width:counts.total?`${counts.complete/counts.total*100}%`:'0%'}}/></div><span className="board-node-count">{counts.complete}/{counts.total} complete · {STATUS_LABELS[status]}<ArrowRight size={13}/></span></button>;})}
          <div className="board-review-loop"><GitBranch size={17}/><span>Revision loop: Critic → Master → Tailor → Master → Critic</span></div>
        </div>
      </div>
    </div>
    <div className="route-explorer"><div><strong>Inspect an information request</strong><p>Dependencies do not grant permission to communicate directly.</p></div><label><span>From</span><select value={from} onChange={event=>setFrom(event.target.value)}>{record.agents.map(agent=><option key={agent.id} value={agent.id}>{agent.title}</option>)}</select></label><label><span>To</span><select value={to} onChange={event=>setTo(event.target.value)}>{record.agents.map(agent=><option key={agent.id} value={agent.id}>{agent.title}</option>)}</select></label><p className="route-result" role="status">{from===to?'Choose different participants.':route.length?route.map(label).join(' → '):'No permitted route. Storage is a final sink.'}</p></div>
  </section>;
}
