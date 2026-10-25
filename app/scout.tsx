'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, ArrowRight, Bookmark, Check, ChevronDown, Compass, ExternalLink, FileText, Globe2, Link2, LoaderCircle, MapPin, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { suggestRoleKeywords } from '@/lib/matching.mjs';
import { canonicalJobURL, dedupeEvidence } from '@/lib/job-evidence.mjs';

type Job = {
  id:string; title:string; company:string; location:string; arrangement:string; seniority:string; employment:string;
  salary:{text:string;min:number|null;max:number|null;currency:string;period:string};
  sponsorship:{status:string;evidence:string}; description:string; url:string; source:string;
  postedAt:string|null; retrievedAt:string; imported:boolean; provenance:string; warnings:string[];
  indexedAt?:string|null; pagePublishedAt?:string|null;
  requisitionId?:string; duplicateCount?:number; isJob?:boolean;
  sources?:{url:string;title?:string;kind?:string}[];
  verification?:{status:string;checkedAt?:string|null;evidence?:string;sourceURL?:string};
  assessment?:{match?:boolean;reasons:string[];unknowns:string[];conflicts?:string[];score?:number;matchKind?:string};
};
type Report = {name:string;status:string;count:number;error?:string};
type SearchResult = {
  jobs:Job[]; totalMatches:number; scanned:number; duplicates:number; excluded:Record<string,number>; reports:Report[];
  searchedAt:string; coverage:string; queries?:string[]; batch:number; hasMore:boolean; phase?:string;
  rejectedUrls?:string[]; usage?:{searchRequests:number;fetchRequests:number;cacheHits:number;credits:number|null};
  cache?:{hit:boolean;expiresAt?:string};
};
type Provider = {provider:string;configured:boolean;limits:{queries:number;checks:number;batches:number};version:string};
type ImportResult = {jobs:Job[];message:string;links?:{url:string;title:string}[];error?:string};
const defaults = {
  roles:'',relatedKeywords:'',mode:'related',requiredKeywords:'',excludedKeywords:'',location:'United States',
  seniority:'any',arrangement:'any',employment:'any',minSalary:'',currency:'USD',period:'year',
  preferSponsorship:false,includeUnknown:true,searchDescriptions:true,includeUnverified:true,showClosed:false,maxAge:'0',
};
type Criteria = typeof defaults;
const labels:Record<string,string> = {any:'Any',intern:'Intern / apprentice',junior:'Entry / junior',mid:'Mid-level',senior:'Senior',lead:'Lead / staff / principal',manager:'Manager',director:'Director / executive',remote:'Remote',hybrid:'Hybrid','on-site':'On-site','full-time':'Full-time','part-time':'Part-time',contract:'Contract / freelance',internship:'Internship'};
const sponsorLabel = (s:string) => s==='no'?'No sponsorship':s==='yes'?'Sponsorship available':'Sponsorship not stated';
const verificationLabel = (j:Job) => j.verification?.status==='available'?'Application page available':j.verification?.status==='closed'?'Closed':'Not verified';
const dateLabel = (s?:string|null) => s && Number.isFinite(Date.parse(s))?new Date(s).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Not stated';
const checkedLabel = (s?:string|null) => s && Number.isFinite(Date.parse(s))?new Date(s).toLocaleString():'Not checked';
function safeExternal(value:string) {try {const u=new URL(value); return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';} catch {return '';}}
function canonical(value:string) {
  return canonicalJobURL(value)||value;
}
function suggestions(c:Criteria):string {
  return suggestRoleKeywords(c).map((value:{term:string})=>value.term).join(', ');
}
function mergeJobs(batches:Map<number,SearchResult>, rejected:Set<string>) {
  const result:Job[]=[];
  for(const batch of [...batches.entries()].sort((a,b)=>a[0]-b[0]).map(([,value])=>value))for(const job of batch.jobs||[]) {
    const identities=[job.url,...(job.sources||[]).map(source=>source.url)].filter(Boolean).map(canonical);
    if(identities.some(url=>rejected.has(url)))continue;
    result.push(job);
  }
  return (dedupeEvidence(result) as Job[]).sort((a,b)=>(b.assessment?.score||0)-(a.assessment?.score||0));
}
function storedJobs(value:unknown):Job[] {
  return Array.isArray(value)?value.filter(j=>j&&typeof j.id==='string'&&typeof j.title==='string'&&typeof j.company==='string'&&typeof j.description==='string'&&j.salary&&j.sponsorship).slice(0,30):[];
}

export default function Scout() {
  const [criteria,setCriteria]=useState<Criteria>(defaults),[ready,setReady]=useState(false),[tab,setTab]=useState('search');
  const [keywordsEdited,setKeywordsEdited]=useState(false),[provider,setProvider]=useState<Provider|null>(null),[providerError,setProviderError]=useState('');
  const [jobs,setJobs]=useState<Job[]>([]),[saved,setSaved]=useState<Job[]>([]),[imported,setImported]=useState<Job[]>([]);
  const [summary,setSummary]=useState<SearchResult|null>(null),[busy,setBusy]=useState(false),[importBusy,setImportBusy]=useState(false),[progress,setProgress]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[importMessage,setImportMessage]=useState(''),[importError,setImportError]=useState('');
  const [sourceOpen,setSourceOpen]=useState(false),[querySnapshot,setQuerySnapshot]=useState('');
  const [url,setUrl]=useState(''),[links,setLinks]=useState<{url:string;title:string}[]>([]),[paste,setPaste]=useState(false);
  const [manual,setManual]=useState({title:'',company:'',location:'',description:''});
  const [selected,setSelected]=useState<Job|null>(null),[sort,setSort]=useState('relevance');
  const detailRef=useRef<HTMLDialogElement>(null),requestRef=useRef(0),abortRef=useRef<AbortController|null>(null);
  const batchesRef=useRef(new Map<number,SearchResult>()),rejectedRef=useRef(new Set<string>());

  function field<K extends keyof Criteria>(name:K,value:Criteria[K]) {
    setCriteria(c=>{const next={...c,[name]:value};if((name==='roles'||name==='mode')&&!keywordsEdited)next.relatedKeywords=suggestions(next);return next;});
  }
  useEffect(()=>{
    try {
      const current=localStorage.getItem('career-scout.criteria.v2');
      const stored=JSON.parse(current||localStorage.getItem('career-scout.criteria.v1')||'null');
      if(stored&&typeof stored==='object') {
        const next={...defaults};
        for(const key of Object.keys(defaults) as (keyof Criteria)[])if(typeof stored[key]===typeof defaults[key])(next as Record<string,unknown>)[key]=stored[key];
        if(!['exact','related','broad'].includes(next.mode))next.mode='related';
        if(!current){next.searchDescriptions=true;next.relatedKeywords=suggestions(next);}
        setCriteria(next);setKeywordsEdited(!!current&&next.relatedKeywords!==suggestions(next));
      }
      setSaved(storedJobs(JSON.parse(localStorage.getItem('career-scout.saved.v1')||'null')));
      setImported(storedJobs(JSON.parse(localStorage.getItem('career-scout.imported.v1')||'null')));
    } catch {setNotice('Previous browser data could not be restored. You can start a new search.');}
    setReady(true);
    const controller=new AbortController();
    fetch('/api/scout',{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('Search connection status is unavailable.');return await r.json() as Provider;}).then(setProvider).catch(e=>{if(e.name!=='AbortError')setProviderError('Connection status unavailable. You can still try a search.');});
    return ()=>{controller.abort();abortRef.current?.abort();};
  },[]);
  useEffect(()=>{if(!ready)return;try{localStorage.setItem('career-scout.criteria.v2',JSON.stringify(criteria));localStorage.setItem('career-scout.saved.v1',JSON.stringify(saved));localStorage.setItem('career-scout.imported.v1',JSON.stringify(imported));}catch{setNotice('Browser storage is full or unavailable. Export your jobs before closing this page.');}},[criteria,saved,imported,ready]);
  useEffect(()=>{if(selected&&!detailRef.current?.open)detailRef.current?.showModal();},[selected]);

  async function api(payload:unknown):Promise<ImportResult> {
    const response=await fetch('/api/scout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json() as ImportResult;if(!response.ok)throw new Error(result.error||'Request failed.');return result;
  }
  async function runSearch(event?:React.FormEvent,options:{more?:boolean;refresh?:boolean}={}) {
    event?.preventDefault();
    if(!criteria.roles.trim()){setError('Enter at least one role or role keyword.');return;}
    if(options.more&&summary?.phase!=='complete')return;
    const batch=options.more?(summary?.batch??0)+1:0;
    if(batch>=(provider?.limits?.batches||3))return;
    abortRef.current?.abort();
    const controller=new AbortController();abortRef.current=controller;
    const request=++requestRef.current;
    if(!options.more){batchesRef.current=new Map();rejectedRef.current=new Set();setJobs([]);setSummary(null);}
    setBusy(true);setError('');setProgress('Finding individual job listings with Keenable…');setTab('search');setQuerySnapshot(JSON.stringify(criteria));
    let completed=false;
    const receive=(message:{type:string;message?:string;error?:string;result?:SearchResult})=>{
      if(request!==requestRef.current)return;
      if(message.type==='error')throw new Error(message.error||'Search could not be completed.');
      if(message.type==='progress')setProgress(message.message||'Checking job pages…');
      if(message.result) {
        const result=message.result;
        batchesRef.current.set(batch,result);
        const rejected=new Set<string>();
        for(const snapshot of [...batchesRef.current.entries()].sort((a,b)=>a[0]-b[0]).map(([,value])=>value)) {
          for(const value of snapshot.rejectedUrls||[])rejected.add(canonical(value));
          for(const accepted of snapshot.jobs||[])for(const value of [accepted.url,...(accepted.sources||[]).map(source=>source.url)])if(value)rejected.delete(canonical(value));
        }
        rejectedRef.current=rejected;
        const merged=mergeJobs(batchesRef.current,rejectedRef.current);
        setJobs(merged);setSummary(result);
        setSelected(old=>old?merged.find(j=>j.id===old.id||canonical(j.url)===canonical(old.url))||old:null);
        setProgress(result.phase==='verifying'?'Checking application pages and updating evidence…':'Collecting search results…');
      }
      if(message.type==='complete'){completed=true;setProgress('Search complete.');}
    };
    try {
      const response=await fetch('/api/scout',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify({action:'search',stream:true,...criteria,batch,refresh:!!options.refresh}),signal:controller.signal});
      if(!response.ok){const result=await response.json().catch(()=>({})) as {error?:string};throw new Error(result.error||`Search failed (${response.status}).`);}
      if(response.headers.get('content-type')?.includes('application/x-ndjson')) {
        if(!response.body)throw new Error('The search response was empty.');
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
        try {
          while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>4000000)throw new Error('Search response exceeded its safety limit.');let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);if(line)receive(JSON.parse(line));}}
          buffer+=decoder.decode();if(buffer.trim())receive(JSON.parse(buffer));
        } finally {reader.releaseLock();}
        if(!completed)throw new Error('The search ended before all checks finished. Shown leads may still be unverified.');
      } else {const result=await response.json() as SearchResult;receive({type:'complete',result});}
    } catch(e) {
      if(request===requestRef.current){controller.abort();if(e instanceof Error&&e.name==='AbortError')setProgress('Search cancelled. Partial results have been kept.');else{setError(e instanceof Error?e.message:'Search failed.');setProgress('Search incomplete.');}}
    } finally {if(request===requestRef.current){setBusy(false);abortRef.current=null;}}
  }
  function cancelSearch(){abortRef.current?.abort();setProgress('Cancelling…');}
  async function importJob(input=url,action='import') {
    if(importBusy)return;setImportBusy(true);setImportError('');setImportMessage('');setLinks([]);
    try {const result=await api({action,url:input,...(action==='paste'?manual:{})});setImported(old=>[...new Map([...result.jobs,...old].map(j=>[j.id,j])).values()].slice(0,30));setImportMessage(result.message);setLinks(result.links||[]);if(!result.jobs.length)setPaste(true);}
    catch(e){setImportError(e instanceof Error?e.message:'Import failed.');setPaste(true);}finally{setImportBusy(false);}
  }
  function toggleSave(job:Job){if(saved.some(j=>j.id===job.id))setSaved(s=>s.filter(j=>j.id!==job.id));else if(saved.length>=30)setNotice('Your shortlist holds 30 jobs. Export or remove a saved role before adding another.');else setSaved(s=>[job,...s]);}
  function exportJobs(){const data={schemaVersion:2,exportedAt:new Date().toISOString(),collection:tab,...(tab==='search'&&querySnapshot?{criteria:JSON.parse(querySnapshot)}:{}),jobs:tab==='saved'?saved:tab==='import'?imported:jobs};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='career-scout-jobs.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  const visible=(tab==='saved'?saved:tab==='import'?imported:jobs).slice().sort(sort==='newest'?(a,b)=>(Date.parse(b.postedAt||'')||0)-(Date.parse(a.postedAt||'')||0):()=>0);
  const changed=!!querySnapshot&&querySnapshot!==JSON.stringify(criteria),savedIds=new Set(saved.map(j=>j.id));
  const batchResults=[...batchesRef.current.values()];
  const usage=batchResults.reduce((total,b)=>({searchRequests:total.searchRequests+(b.usage?.searchRequests||0),fetchRequests:total.fetchRequests+(b.usage?.fetchRequests||0),cacheHits:total.cacheHits+(b.usage?.cacheHits||0)}),{searchRequests:0,fetchRequests:0,cacheHits:0});
  const creditKnown=batchResults.length>0&&batchResults.every(b=>typeof b.usage?.credits==='number');
  const credits=creditKnown?batchResults.reduce((n,b)=>n+(b.usage?.credits||0),0):null;
  const select=(name:keyof Criteria,options:string[])=><select id={name} value={String(criteria[name])} onChange={e=>field(name,e.target.value as never)}>{options.map(o=><option value={o} key={o}>{labels[o]||o}</option>)}</select>;
  const closeDetails=()=>{detailRef.current?.close();setSelected(null);};

  return <div className="app-shell">
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Career Scout home"><span className="brand-mark"><Compass size={23}/></span><span>career<span className="brand-light">scout</span></span></Link>
      <nav aria-label="Main navigation">{[['search','Discover',0],['import','Import a role',imported.length],['saved','Shortlist',saved.length]].map(([key,title,count])=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(String(key))}>{title}{Number(count)>0&&<span className="nav-count">{count}</span>}</button>)}<Link className="progress-link" href="/progress">Progress</Link></nav>
      <button className="sources-button" onClick={()=>setSourceOpen(!sourceOpen)} aria-expanded={sourceOpen}><Settings2 size={17}/><span>Search coverage</span></button>
    </header>
    <main>
      <section className="intro"><div><div className="eyebrow"><span/> YOUR JOB SEARCH, WITH DIRECTION</div><h1>{tab==='import'?<>Found a role?<br/><em>Bring it here.</em></>:tab==='saved'?<>Good opportunities.<br/><em>All in one place.</em></>:<>Find the roles<br/><em>worth your time.</em></>}</h1><p>{tab==='import'?'Import an individual job or a company career board. Keep its evidence in one place.':tab==='saved'?'Your saved roles, ready to compare and pass to the future resume Matcher.':'Search the web with Keenable. Explore related roles, check the evidence, and build your shortlist.'}</p></div><div className="intro-side"><div className="orbit"><Compass size={70} strokeWidth={1}/><span className="orbit-dot"/></div><span><ShieldCheck size={15}/> Your shortlist is saved in this browser</span></div></section>
      {notice&&<div className="notice" role="status">{notice}<button aria-label="Dismiss notice" onClick={()=>setNotice('')}><X size={16}/></button></div>}
      {provider?.configured===false&&<div className="error-message" role="alert">Keenable is not connected on this deployment. The site owner needs to configure the server connection.</div>}
      {sourceOpen&&<section className="source-settings"><div className="section-head"><div><span className="eyebrow">SEARCH COVERAGE</span><h2>Keenable discovery, evidence you can inspect</h2></div><button className="icon-button" aria-label="Close search coverage" onClick={()=>setSourceOpen(false)}><X size={20}/></button></div><div className="source-grid"><div><span className="connection-status"><Globe2 size={18}/>{provider?(provider.configured?'Keenable connected':'Connection needs setup'):providerError||'Checking connection…'}</span><p className="source-copy">Searches individual job pages across the indexed web. Employer application links are preferred when available. General job directories and duplicate copies are filtered.</p><p className="source-copy">Each batch uses up to {provider?.limits?.queries||4} search requests and {provider?.limits?.checks||10} page checks. Search more runs another bounded batch, up to {provider?.limits?.batches||3} batches per search.</p></div><div className="broad-connection"><h3>Know what has been checked</h3><p><strong>Application page available</strong> means readable job evidence was found without a detected closure notice. <strong>Not verified</strong> means the page could not be confirmed. Closed roles are hidden unless you include them.</p><p className="source-copy">Posting dates come from job evidence. Index dates show when a search engine collected a page; they do not prove a vacancy is new.</p></div></div><div className="coverage-note">Coverage is bounded and cannot guarantee every job or current hiring activity. Direct Greenhouse, Lever, Ashby, and structured-page imports remain available under Import a role. Salary, eligibility, and sponsorship stay unknown when the source does not say.</div></section>}
      <div className={tab==='search'?'workspace':'workspace single'}>
        {tab==='search'&&<aside className="filters"><form onSubmit={e=>runSearch(e)}>
          <div className="filter-title"><SlidersHorizontal size={18}/><h2>Your search criteria</h2></div>
          <label className="field-label" htmlFor="roles">Roles <span className="required">*</span></label><input id="roles" required maxLength={600} value={criteria.roles} onChange={e=>field('roles',e.target.value)} placeholder="e.g. Portfolio analyst"/><small className="helper">Separate alternate titles with commas.</small>
          <fieldset className="mode-field"><legend>Search breadth</legend><div className="mode-options">{['exact','related','broad'].map(mode=><button type="button" key={mode} aria-pressed={criteria.mode===mode} onClick={()=>field('mode',mode)}>{mode[0].toUpperCase()+mode.slice(1)}</button>)}</div><small className="helper">{criteria.mode==='exact'?'Match your original role keywords. Related terms are not used.':criteria.mode==='related'?'Include the related terms below; original titles rank first.':'Include adjacent roles too. Broader matches may need different experience.'}</small></fieldset>
          {criteria.mode!=='exact'&&<><div className="label-with-action"><label className="field-label" htmlFor="relatedKeywords">Related role keywords</label><button type="button" className="text-button" onClick={()=>{setKeywordsEdited(false);setCriteria(c=>({...c,relatedKeywords:suggestions(c)}));}}>Reset suggestions</button></div><textarea id="relatedKeywords" rows={3} maxLength={1000} value={criteria.relatedKeywords} onChange={e=>{setKeywordsEdited(true);field('relatedKeywords',e.target.value);}} placeholder="Add related titles, separated by commas"/><small className="helper">Edit or remove suggested terms. Suggestions cover common role families; you can add your own for any field.</small></>}
          <label className="field-label" htmlFor="requiredKeywords">Required keywords</label><input id="requiredKeywords" maxLength={600} value={criteria.requiredKeywords} onChange={e=>field('requiredKeywords',e.target.value)} placeholder="e.g. Python, SQL"/><small className="helper">Every comma-separated keyword or phrase must appear.</small>
          <label className="field-label" htmlFor="excludedKeywords">Exclude keywords</label><input id="excludedKeywords" maxLength={600} value={criteria.excludedKeywords} onChange={e=>field('excludedKeywords',e.target.value)} placeholder="e.g. sales, internship"/><small className="helper">Hide a role if any of these terms appear.</small>
          <label className="field-label" htmlFor="location">Location</label><input id="location" value={criteria.location} maxLength={600} onChange={e=>field('location',e.target.value)} placeholder="e.g. United States or New York"/><small className="helper">Country and city/state names are recognized. Remote work still has hiring-location requirements.</small>
          <label className="field-label" htmlFor="seniority">Seniority</label>{select('seniority',['any','intern','junior','mid','senior','lead','manager','director'])}
          <div className="two-fields"><div><label className="field-label" htmlFor="arrangement">Work arrangement</label>{select('arrangement',['any','remote','hybrid','on-site'])}</div><div><label className="field-label" htmlFor="employment">Employment type</label>{select('employment',['any','full-time','part-time','contract','internship'])}</div></div>
          <label className="field-label" htmlFor="minSalary">Minimum compensation</label><div className="pay-row"><select aria-label="Currency" value={criteria.currency} onChange={e=>field('currency',e.target.value)}>{['USD','EUR','GBP','CAD','AUD','INR'].map(c=><option key={c}>{c}</option>)}</select><input id="minSalary" type="number" min="0" max="100000000" value={criteria.minSalary} onChange={e=>field('minSalary',e.target.value)} placeholder="No minimum"/><select aria-label="Pay period" value={criteria.period} onChange={e=>field('period',e.target.value)}><option value="year">/ year</option><option value="hour">/ hour</option></select></div><small className="helper">Currencies and pay periods are not converted.</small>
          <label className="check-row sponsorship-option"><input type="checkbox" checked={criteria.preferSponsorship} onChange={e=>field('preferSponsorship',e.target.checked)}/><span><strong>Prefer visa sponsorship</strong><small>Prioritize explicit support. Roles with no sponsorship remain visible and flagged.</small></span></label>
          <details className="refine"><summary>Evidence and freshness <ChevronDown size={15}/></summary><label className="check-row"><input type="checkbox" checked={criteria.includeUnverified} onChange={e=>field('includeUnverified',e.target.checked)}/><span>Include unverified leads</span></label><label className="check-row"><input type="checkbox" checked={criteria.showClosed} onChange={e=>field('showClosed',e.target.checked)}/><span>Show closed listings</span></label><label className="check-row"><input type="checkbox" checked={criteria.includeUnknown} onChange={e=>field('includeUnknown',e.target.checked)}/><span>Keep jobs with missing filter details</span></label><label className="check-row"><input type="checkbox" checked={criteria.searchDescriptions} onChange={e=>field('searchDescriptions',e.target.checked)}/><span>Match role keywords in descriptions too</span></label><label className="field-label" htmlFor="maxAge">Employer posting date</label><select id="maxAge" value={criteria.maxAge} onChange={e=>field('maxAge',e.target.value)}><option value="0">Any time</option><option value="3">Within 3 days</option><option value="7">Within 7 days</option><option value="14">Within 14 days</option><option value="30">Within 30 days</option></select></details>
          <button className="primary search-submit" disabled={!ready||provider?.configured===false}><Search size={18}/>{busy?'Start a new search':'Find opportunities'}<ArrowRight size={17}/></button><small className="filter-footer">Powered by Keenable · Exact titles first</small>
        </form></aside>}
        <section className="results" aria-label="Job results">
          {tab==='import'&&<div className="import-panel"><div className="import-heading"><span className="import-icon"><Link2 size={23}/></span><div><h2>Import from a link</h2><p>One role or a company career board. Restricted pages may require pasted text.</p></div></div><form className="import-row" onSubmit={e=>{e.preventDefault();importJob();}}><label className="sr-only" htmlFor="jobURL">Job or company careers URL</label><input id="jobURL" type="url" required value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://company.com/careers/…"/><button className="primary" disabled={importBusy}>{importBusy?<LoaderCircle className="spin" size={17}/>:<ArrowRight size={17}/>} Import</button></form><div className="import-support">Direct support: Greenhouse · Lever · Ashby · pages with JobPosting data</div>{importMessage&&<p className="success-message" role="status"><Check size={17}/>{importMessage}</p>}{importError&&<p className="error-message" role="alert">{importError}</p>}{links.length>0&&<div className="link-options">{links.map(l=><button key={l.url} disabled={importBusy} onClick={()=>{setUrl(l.url);importJob(l.url);}}>{l.title}<ArrowRight size={14}/></button>)}</div>}<button className="text-button paste-toggle" onClick={()=>setPaste(!paste)} aria-expanded={paste}><FileText size={15}/>{paste?'Hide manual import':'Page blocked or incomplete? Paste the description'}</button>{paste&&<form className="paste-form" onSubmit={e=>{e.preventDefault();importJob(url,'paste');}}><div className="two-fields"><div><label htmlFor="manualTitle" className="field-label">Job title *</label><input id="manualTitle" required value={manual.title} onChange={e=>setManual({...manual,title:e.target.value})}/></div><div><label htmlFor="manualCompany" className="field-label">Company</label><input id="manualCompany" value={manual.company} onChange={e=>setManual({...manual,company:e.target.value})}/></div></div><label htmlFor="manualLocation" className="field-label">Listed location</label><input id="manualLocation" value={manual.location} onChange={e=>setManual({...manual,location:e.target.value})}/><label htmlFor="manualDescription" className="field-label">Full job description *</label><textarea id="manualDescription" minLength={80} maxLength={65000} required rows={6} value={manual.description} onChange={e=>setManual({...manual,description:e.target.value})}/><small className="helper">Pasted text is not independently verified. Missing information stays unknown.</small><button className="primary" disabled={importBusy}>Import pasted job <ArrowRight size={16}/></button></form>}</div>}
          <div className="results-toolbar"><div><span className="eyebrow">{tab==='saved'?'YOUR SHORTLIST':tab==='import'?'ON-DEMAND IMPORTS':'OPPORTUNITIES'}</span><h2>{tab==='saved'?`${saved.length} saved roles`:tab==='import'?`${imported.length} imported roles`:summary?`${jobs.length} matching role${jobs.length===1?'':'s'}`:'Your next move starts here'}</h2></div>{visible.length>0&&<div className="result-actions"><select aria-label="Sort jobs" value={sort} onChange={e=>setSort(e.target.value)}><option value="relevance">Most relevant</option><option value="newest">Newest posting</option></select><button className="icon-button" onClick={exportJobs} aria-label="Export jobs as JSON"><ArrowDownToLine size={18}/></button></div>}</div>
          {changed&&tab==='search'&&<div className="notice">Filters changed. Start a new search to apply them.</div>}
          {error&&tab==='search'&&<div className="error-message" role="alert">{error}</div>}
          {tab==='search'&&progress&&<div className={'search-progress '+(busy?'is-busy':'')} role="status" aria-live="polite">{busy?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>}<span>{progress}</span>{busy&&<button type="button" onClick={cancelSearch}>Cancel search</button>}</div>}
          {tab==='search'&&summary&&<details className="coverage"><summary><Globe2 size={15}/>{batchResults.reduce((n,b)=>n+(b.scanned||0),0)} search hits reviewed · {batchResults.reduce((n,b)=>n+(b.duplicates||0),0)} duplicate copies combined<ChevronDown size={15}/></summary><div className="coverage-body"><p>{summary.cache?.hit?'Recent cached results':'Results retrieved'} {checkedLabel(summary.searchedAt)}. {summary.cache?.expiresAt&&`Cache expires ${checkedLabel(summary.cache.expiresAt)}.`}</p><div className="usage-line"><span>{usage.searchRequests} search requests</span><span>{usage.fetchRequests} page checks</span><span>{usage.cacheHits} cache hits</span><span>{credits===null?'Credits: not reported':`${credits} credits reported`}</span></div><p>Request counts and credit charges are different. Cached results may reuse earlier page checks.</p>{batchResults.flatMap((b,bi)=>(b.reports||[]).map((r,ri)=><div className="source-report" key={`${bi}-${ri}`}><span>{r.name}</span><span className={r.status==='error'?'error-text':''}>{r.status==='ok'?`${r.count} results`:r.error||r.status}</span></div>))}{Object.keys(summary.excluded||{}).length>0&&<p>Excluded in this batch: {Object.entries(summary.excluded).map(([key,value])=>`${key} (${value})`).join(' · ')}. A job may fail multiple filters.</p>}{!!summary.queries?.length&&<details className="query-details"><summary>Queries used in this batch</summary><ul>{summary.queries.map((query,i)=><li key={i}>{query}</li>)}</ul></details>}<p>{summary.coverage}</p></div></details>}
          {tab==='import'&&imported.length>0&&<p className="results-note">Imported directly; search filters have not been applied. Up to 30 imports are kept in this browser.</p>}{tab==='saved'&&<p className="results-note">Saved in this browser. These are saved snapshots; check the original listing before applying.</p>}
          {visible.length>0?<div className="job-list">{visible.map(job=><article className="job-card" key={job.id}>
            <div className="job-top"><div className="company-avatar" aria-hidden="true">{job.company.slice(0,2).toUpperCase()}</div><div className="job-main"><span className="company-name">{job.company}</span><button className="job-title" onClick={()=>setSelected(job)}>{job.title}</button></div><button className={'save-button '+(savedIds.has(job.id)?'is-saved':'')} onClick={()=>toggleSave(job)} aria-label={savedIds.has(job.id)?`Remove ${job.title} from shortlist`:`Save ${job.title}`} aria-pressed={savedIds.has(job.id)}><Bookmark size={19} fill={savedIds.has(job.id)?'currentColor':'none'}/></button></div>
            <div className="job-meta"><span><MapPin size={14}/>{job.location}</span>{job.arrangement!=='unknown'&&<span>{labels[job.arrangement]||job.arrangement}</span>}{job.employment!=='unknown'&&<span>{labels[job.employment]||job.employment}</span>}</div>
            <div className="job-pay">{job.salary.text||'Pay not disclosed'}</div>
            <div className="job-flags"><span className={'badge verification-'+(job.verification?.status||'unverified')}>{verificationLabel(job)}</span><span className={'badge sponsor-'+job.sponsorship.status}>{sponsorLabel(job.sponsorship.status)}</span>{(job.sources?.length||0)>1&&<span className="badge">{job.sources!.length} sources combined</span>}</div>
            {!!job.assessment?.reasons?.length&&<p className="match-reason">{job.assessment.reasons.slice(0,2).join(' · ')}</p>}
            {!!job.assessment?.unknowns?.length&&<p className="unknown-details">{job.assessment.unknowns.length} detail{job.assessment.unknowns.length===1?'':'s'} to verify</p>}
            <div className="job-bottom"><span>Posted: {dateLabel(job.postedAt)}</span><button onClick={()=>setSelected(job)}>Evidence & details <ArrowRight size={15}/></button></div>
          </article>)}</div>:busy&&tab==='search'?<div className="search-loading"><LoaderCircle className="spin" size={32}/><h3>Looking for your next opportunity</h3><p>Results will appear as sources respond.</p></div>:<div className="empty-state"><div className="empty-icon">{tab==='saved'?<Bookmark size={31}/>:tab==='import'?<Link2 size={31}/>:<Search size={31}/>}</div><h3>{tab==='saved'?'Keep the roles that stand out':tab==='import'?'Your imported roles will appear here':summary?'No matching roles in this batch':'A focused search. A better shortlist.'}</h3><p>{tab==='saved'?'Save any role using its bookmark. Export your shortlist whenever you need it.':tab==='import'?'Paste a job URL above, or import the description if the page requires sign-in.':summary?'Try related keywords, keep unverified leads or missing details, or search another batch. An empty result does not mean no jobs exist.':'Enter a role and location. Edit related keywords to make the search your own.'}</p>{tab==='search'&&<div className="empty-steps"><span><span>01</span> Choose your search breadth</span><span><span>02</span> Review the evidence</span><span><span>03</span> Save the possibilities</span></div>}{tab==='search'&&<button className="text-button" onClick={()=>setTab('import')}>Already have a job link? Import it <ArrowRight size={15}/></button>}</div>}
          {tab==='search'&&summary&&<div className="search-next"><button type="button" className="secondary" disabled={busy||changed} onClick={()=>runSearch(undefined,{refresh:true})}><RefreshCw size={16}/> Refresh search</button><button type="button" className="primary" disabled={busy||changed||!summary.hasMore||summary.phase!=='complete'} onClick={()=>runSearch(undefined,{more:true})}>Search more <ArrowRight size={16}/></button><small>{summary.hasMore?'Another batch may return new roles or overlapping results.':'Search batches complete. Change your keywords to explore further.'}</small></div>}
        </section>
      </div>
      <footer><span><Compass size={16}/> Career Scout</span><span>Search relevance today. Resume matching next.</span><span>Keenable · Clear unknowns · Your shortlist</span></footer>
    </main>
    <dialog ref={detailRef} className="job-dialog" aria-labelledby="job-detail-title" onCancel={()=>setSelected(null)} onClick={e=>{if(e.target===detailRef.current)closeDetails();}}>{selected&&<>
      <div className="dialog-header"><span className="eyebrow">ROLE DETAILS</span><button className="icon-button" aria-label="Close job details" onClick={closeDetails}><X size={22}/></button></div>
      <div className="dialog-content"><span className="company-name">{selected.company}</span><h2 id="job-detail-title">{selected.title}</h2><p className="job-meta"><MapPin size={15}/>{selected.location}</p><div className="job-flags"><span className={'badge verification-'+(selected.verification?.status||'unverified')}>{verificationLabel(selected)}</span><span className={'badge sponsor-'+selected.sponsorship.status}>{sponsorLabel(selected.sponsorship.status)}</span><span className="badge">{selected.salary.text}</span></div>
        <div className="evidence-box"><strong>Availability evidence</strong><p>{selected.verification?.evidence||'This saved or imported role has not been independently checked for current availability.'}</p><small>Checked: {checkedLabel(selected.verification?.checkedAt)}. A readable application page does not guarantee active hiring.</small></div>
        <div className="evidence-box"><strong>Sponsorship evidence</strong><p>{selected.sponsorship.evidence}</p><small>Rule-based extraction. Confirm nuanced wording on the original posting.</small></div>
        {selected.assessment&&<div className="assessment-grid"><div><h3>Why it appeared</h3><ul>{selected.assessment.reasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul><small className="helper">Search relevance, not a resume qualification score.</small></div>{selected.assessment.unknowns.length>0&&<div><h3>Verify these details</h3><ul>{selected.assessment.unknowns.map((reason,i)=><li key={i}>{reason}</li>)}</ul></div>}</div>}
        <dl className="evidence-dates"><div><dt>Employer posting date</dt><dd>{dateLabel(selected.postedAt)}</dd></div><div><dt>Search index date</dt><dd>{dateLabel(selected.indexedAt)}</dd></div><div><dt>Webpage publication date</dt><dd>{dateLabel(selected.pagePublishedAt)}</dd></div></dl><p className="helper">Index and webpage dates are not treated as the job’s posting date.</p>
        {(selected.sources?.length||0)>0&&<div className="source-links"><h3>Source pages</h3>{selected.sources!.filter(source=>safeExternal(source.url)).map((source,i)=><a key={i} href={safeExternal(source.url)} target="_blank" rel="noreferrer">{source.title||new URL(source.url).hostname}<ExternalLink size={13}/></a>)}</div>}
        {selected.warnings?.map((warning,i)=><p className="results-note" key={i}>{warning}</p>)}
        <div className="description-heading"><h3>{selected.verification?.status==='available'?'Job description':'Source text'}</h3><span>{selected.source}</span></div><div className="job-description">{selected.description||'No readable description available. Open the original page for details.'}</div><p className="provenance">{selected.provenance} · Retrieved {checkedLabel(selected.retrievedAt)}</p>
      </div>
      <div className="dialog-footer"><button className="secondary" onClick={()=>toggleSave(selected)}><Bookmark size={17}/>{savedIds.has(selected.id)?'Remove from shortlist':'Save to shortlist'}</button>{safeExternal(selected.url)&&<a className="primary" href={safeExternal(selected.url)} target="_blank" rel="noreferrer">Original listing <ExternalLink size={16}/></a>}</div>
    </>}</dialog>
  </div>;
}
