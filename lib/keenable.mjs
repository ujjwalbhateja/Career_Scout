// Server-only orchestration. Never import this module from a client component.
import { criteriaFrom, safeURL, text } from './scout.mjs';
import { expandRoles, rankJob } from './matching.mjs';
import { classifyHit, candidateFromHit, verifyEvidence, dedupeEvidence } from './job-evidence.mjs';

export const SEARCH_VERSION = '2.0.0';
export const SEARCH_LIMITS = Object.freeze({queries:4,checks:10,batches:3,hitsPerQuery:15});
const resultCache=new Map(),pageCache=new Map();
const TTL=5*60*1000;
export class SearchError extends Error { constructor(message,status=502){super(message);this.status=status;} }
export function searchCriteria(body={}) {
  if(!body || typeof body!=='object' || Array.isArray(body))throw new SearchError('Enter valid search criteria.',400);
  const string=(name,max=600)=>typeof body[name]==='string'?body[name].trim().slice(0,max):'';
  const c={...criteriaFrom(body),sources:[],boards:[],mode:['exact','related','broad'].includes(body.mode)?body.mode:'related',requiredKeywords:string('requiredKeywords'),excludedKeywords:string('excludedKeywords'),searchDescriptions:body.searchDescriptions!==false,includeUnverified:body.includeUnverified!==false,showClosed:body.showClosed===true};
  if(Object.hasOwn(body,'relatedKeywords'))c.relatedKeywords=string('relatedKeywords',1000);
  if(!c.roles)throw new SearchError('Enter at least one role.',400);
  if(c.roles.split(/[,;\n]/).filter(s=>s.trim()).length>10)throw new SearchError('Use up to 10 alternate role titles.',400);
  const batch=Number(body.batch??0);
  if(!Number.isInteger(batch)||batch<0||batch>=SEARCH_LIMITS.batches)throw new SearchError('Start a new search after three batches.',400);
  return {criteria:c,batch,refresh:body.refresh===true};
}
export function planQueries(c,batch=0) {
  const expansions=expandRoles(c),roles=expansions.map(x=>x.term);
  if(c.mode==='broad'&&batch===0){const broad=expansions.find(x=>x.kind==='broad');if(broad)roles.splice(3,0,broad.term);}
  const sites=['myworkdayjobs.com','job-boards.greenhouse.io','jobs.lever.co','jobs.ashbyhq.com'];
  const required=c.requiredKeywords.split(/[,;\n]/).filter(Boolean).slice(0,4).join(' ');
  const location=c.location?` in ${c.location}`:'';
  const arrangement=c.arrangement!=='any'?` ${c.arrangement}`:'';
  const out=[];
  for(let i=0;i<SEARCH_LIMITS.queries;i++) {
    const role=roles[(batch*SEARCH_LIMITS.queries+i)%roles.length];
    const variants=batch===2?['open position apply employer','current vacancy recruitment','join our team opportunity','position responsibilities apply today']:['job opening careers','hiring job responsibilities qualifications','employment vacancy apply','careers job description'];
    const query=`${role}${location}${arrangement} ${required} ${variants[(i+batch)%variants.length]}`.replace(/\s+/g,' ').trim().slice(0,1300);
    const task={query,...(batch===1?{site:sites[i]}:{})};
    if(!out.some(x=>x.query===task.query&&x.site===task.site))out.push(task);
  }
  return out;
}
function cached(map,key){const hit=map.get(key);if(!hit)return null;if(hit.expires<=Date.now()){map.delete(key);return null;}return hit;}
function remember(map,key,value,limit,ttl=TTL){for(const [k,v] of map)if(v.expires<=Date.now())map.delete(k);if(map.size>=limit)map.delete(map.keys().next().value);map.set(key,{value,expires:Date.now()+ttl});}
function aborted(signal){if(signal?.aborted)throw new DOMException('Search cancelled.','AbortError');}
async function fingerprint(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
async function boundedJSON(response,limit=1800000){
  if(Number(response.headers.get('content-length'))>limit)throw new SearchError('Search provider response exceeded the size limit.');
  const reader=response.body?.getReader();if(!reader)throw new SearchError('Search provider returned an empty response.');
  const decoder=new TextDecoder();let raw='',size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new SearchError('Search provider response exceeded the size limit.');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}
  catch(e){await reader.cancel().catch(()=>{});throw e;}
  try{return JSON.parse(raw);}catch{throw new SearchError('Search provider returned unreadable data.');}
}
function errorFor(status){return new SearchError(({400:'Keenable rejected the search request.',401:'Keenable authentication failed. Check the server API key.',402:'Keenable credits are unavailable. Check your account balance.',403:'Keenable access was denied. Check the server API key.',429:'Keenable rate limit reached. Wait a moment before searching again.'})[status]||`Keenable is temporarily unavailable (HTTP ${status}).`,status===429?429:502);}
function accountUsage(data,headers,usage){
  // Only report provider-supplied credit values; never infer credits from calls.
  const record=data?._meta?.['keenable/usage']||data?._meta?.usage;
  const header=headers.get('x-keenable-credits');
  const value=record?.credits??(header!==null?Number(header):null);
  if(typeof value==='number'&&Number.isFinite(value)&&value>=0)usage.reportedCredits+=value;
  else usage.unmeteredRequests++;
}
async function providerRequest(path,options,{key,signal,fetcher,usage}) {
  aborted(signal);
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(14000)]):AbortSignal.timeout(14000);
  let response;
  try { response=await fetcher('https://api.keenable.ai'+path,{...options,headers:{Accept:'application/json','Content-Type':'application/json','X-API-Key':key},redirect:'manual',signal:combined}); }
  catch(e){aborted(signal);throw new SearchError(e?.name==='TimeoutError'?'Keenable request timed out. Try again.':'Could not reach Keenable. Try again shortly.');}
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw errorFor(response.status);}
  const data=await boundedJSON(response);accountUsage(data,response.headers,usage);return data;
}
export function directoryLeads(hit) {
  const leads=[];const content=String(hit.snippet||'').slice(0,12000);
  for(const m of content.matchAll(/\[([^\]]{5,240})\]\((https:\/\/[^\s)]+)\)/g)) {
    try{
      const url=safeURL(m[2]).href,title=text(m[1].trim().split('\n')[0]).replace(/^#+\s*/,'');
      if(!/(?:\/jobs?\/|\/careers?\/|myworkdayjobs|greenhouse|lever\.co|ashbyhq|\/job-|\.id\d)/i.test(url))continue;
      const candidate=candidateFromHit({title,url,snippet:`${title}\nIndividual job link discovered on a search-results page.`,acquired_at:hit.acquired_at});
      if(candidate)leads.push(candidate);
    }catch{/* Ignore malformed or private links. */}
    if(leads.length>=8)break;
  }
  return leads;
}
function safeMessage(e){return e instanceof SearchError?e.message:'This source could not be checked.';}
/** Server-only policy overrides are never read from request JSON. Each phase retains the normal provider ceilings. */
function policyQueries(value) {
  if(value===undefined)return null;
  if(!Array.isArray(value)||!value.length||value.length>SEARCH_LIMITS.queries)throw new SearchError('The Scout query plan exceeds the search budget.',400);
  return value.map(task=>{
    if(!task||typeof task.query!=='string'||!task.query.trim()||task.query.length>1300)throw new SearchError('The Scout query plan is invalid.',400);
    if(task.site!==undefined&&(typeof task.site!=='string'||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(task.site)))throw new SearchError('The Scout source restriction is invalid.',400);
    return {query:task.query.trim(),...(task.site?{site:task.site}:{}),...(typeof task.route==='string'?{route:task.route.slice(0,60)}:{})};
  });
}
/** @param {object} body @param {{key?:string,signal?:AbortSignal,onEvent?:(event:any)=>void,fetcher?:typeof fetch,scope?:string,queryPlan?:Array<any>,verificationLimit?:number,assessJob?:(job:any,criteria:any)=>any,cacheContext?:any}} options */
export async function searchKeenable(body,{key,signal,onEvent=()=>{},fetcher=fetch,scope='private-owner',queryPlan,verificationLimit=SEARCH_LIMITS.checks,assessJob=rankJob,cacheContext=null}={}) {
  const {criteria:c,batch,refresh}=searchCriteria(body);
  const planned=policyQueries(queryPlan);
  if(!Number.isInteger(verificationLimit)||verificationLimit<0||verificationLimit>SEARCH_LIMITS.checks)throw new SearchError('The Scout verification budget is invalid.',400);
  if(typeof key!=='string'||!key.trim())throw new SearchError('Keenable is not configured. Add the server API key before searching.',503);
  key=key.trim();
  const account=await fingerprint(scope+'|'+key);
  const cacheKey=account+'|'+JSON.stringify({c,batch,planned,verificationLimit,cacheContext});
  const hit=!refresh&&cached(resultCache,cacheKey);
  if(hit){const result=structuredClone(hit.value);result.cache={hit:true,expiresAt:new Date(hit.expires).toISOString()};result.usage={searchRequests:0,fetchRequests:0,cacheHits:1,credits:0};onEvent({type:'complete',result});return result;}
  const usage={searchRequests:0,fetchRequests:0,cacheHits:0,reportedCredits:0,unmeteredRequests:0};
  const runtime={key,signal,fetcher,usage};const queries=planned||planQueries(c,batch),reports=[];
  let candidates=[],scanned=0,directories=0,irrelevant=0,phase='discovering';
  const searchedAt=new Date().toISOString();
  function snapshot(){
    const invalid=candidates.filter(j=>j.isJob===false||j.isDirectory);
    const all=dedupeEvidence(candidates).map(j=>{
      // Reposts/duplicate portals must not replace an earlier evidenced posting date.
      const urls=new Set([j.url,...(j.sources||[]).map(s=>s.url)]);
      const dates=candidates.filter(p=>urls.has(p.url)||(j.requisitionId&&p.requisitionId===j.requisitionId)).map(p=>p.postedAt).filter(d=>d&&Number.isFinite(Date.parse(d))).sort((a,b)=>Date.parse(a)-Date.parse(b));
      return {...j,originalPostedAt:dates[0]||j.postedAt||null,assessment:assessJob(j,c)};
    });
    const excluded={},rejectedUrls=invalid.flatMap(j=>[j.url,...(j.sources||[]).map(s=>s.url)]);
    if(invalid.length)excluded['Not an individual vacancy']=new Set(invalid.map(j=>j.url)).size;
    const accepted=all.filter(j=>{
      const conflicts=[...j.assessment.conflicts];
      if(j.verification?.status==='closed'&&!c.showClosed)conflicts.push('Closed');
      if(j.verification?.status!=='available'&&j.verification?.status!=='closed'&&!c.includeUnverified)conflicts.push('Not verified');
      if(j.isDirectory||j.isJob===false)conflicts.push('Not an individual vacancy');
      if(!j.assessment.match&&!conflicts.length)conflicts.push('Missing details');
      if(conflicts.length){for(const reason of new Set(conflicts))excluded[reason]=(excluded[reason]||0)+1;rejectedUrls.push(j.url,...(j.sources||[]).map(s=>s.url));return false;}return true;
    }).sort((a,b)=>(a.verification?.status==='closed')-(b.verification?.status==='closed')||b.assessment.score-a.assessment.score||(a.verification?.status!=='available')-(b.verification?.status!=='available')||(Date.parse(b.postedAt)||0)-(Date.parse(a.postedAt)||0));
    return {version:SEARCH_VERSION,jobs:accepted.slice(0,100),totalMatches:accepted.length,scanned,duplicates:Math.max(0,candidates.length-invalid.length-all.length),excluded,rejectedUrls:[...new Set(rejectedUrls)],reports:[...reports],searchedAt,criteria:c,queries:queries.map(q=>q.query+(q.site?' site:'+q.site:'')),queryPlan:queries,expandedRoles:expandRoles(c),batch,hasMore:batch+1<SEARCH_LIMITS.batches,phase,coverage:'Keenable web discovery. Individual vacancies only; incomplete leads are labeled. Search coverage is bounded, not exhaustive. Related keywords use editable role families, not resume qualification scoring.',directoriesSkipped:directories,irrelevantSkipped:irrelevant,cache:{hit:false,expiresAt:new Date(Date.now()+TTL).toISOString()},usage:{searchRequests:usage.searchRequests,fetchRequests:usage.fetchRequests,cacheHits:usage.cacheHits,credits:usage.unmeteredRequests?null:usage.reportedCredits}};
  }
  onEvent({type:'progress',message:'Searching Keenable for your role and related keywords…'});
  await Promise.all(queries.map(async task=>{
    try{
      aborted(signal);usage.searchRequests++;
      const data=await providerRequest('/v1/search',{method:'POST',body:JSON.stringify({query:task.query,...(task.site?{site:task.site}:{}),mode:'pro',max_results:SEARCH_LIMITS.hitsPerQuery,snippet_max_length:3500})},runtime);
      if(!Array.isArray(data?.results))throw new SearchError('Keenable returned an unsupported search format.');
      const hits=data.results.slice(0,SEARCH_LIMITS.hitsPerQuery);scanned+=hits.length;
      for(const entry of hits){
        const kind=classifyHit(entry);
        if(kind==='directory'){directories++;candidates.push(...directoryLeads(entry));continue;}
        if(kind==='irrelevant'){irrelevant++;continue;}
        const job=candidateFromHit(entry);if(job)candidates.push(job);
      }
      reports.push({name:task.query+(task.site?' · '+task.site:''),status:'ok',count:hits.length});
      aborted(signal);onEvent({type:'results',result:snapshot()});
    }catch(e){aborted(signal);reports.push({name:task.query,status:'error',count:0,error:safeMessage(e),httpStatus:e instanceof SearchError?e.status:502});}
  }));
  aborted(signal);
  if(reports.every(r=>r.status==='error'))throw new SearchError(reports[0]?.error||'All Keenable searches failed.',reports[0]?.httpStatus||502);
  phase='verifying';
  // Fetch before applying strict unknown filters: the complete page may supply missing facts.
  const toCheck=dedupeEvidence(candidates).map(j=>({job:j,assessment:assessJob(j,{...c,includeUnknown:true,requiredKeywords:'',excludedKeywords:''})})).filter(x=>assessJob===rankJob?!x.assessment.conflicts.some(v=>/^location$/i.test(v)):x.assessment.conflicts.length===0).sort((a,b)=>b.assessment.score-a.assessment.score).slice(0,verificationLimit).map(x=>x.job);
  onEvent({type:'progress',message:`Checking ${toCheck.length} individual job pages. Initial leads remain visible…`});
  for(let offset=0;offset<toCheck.length;offset+=3){
    aborted(signal);
    await Promise.all(toCheck.slice(offset,offset+3).map(async job=>{
      let updated;
      try{
        const url=safeURL(job.url).href;const pageKey=account+'|'+url;
        const pageHit=!refresh&&cached(pageCache,pageKey);
        let page;
        if(pageHit){page=pageHit.value;usage.cacheHits++;}
        else{
          usage.fetchRequests++;
          page=await providerRequest('/v1/fetch?'+new URLSearchParams({url,live:'true',max_chars:'24000'}),{method:'GET'},runtime);
          if(typeof page?.content!=='string')throw new SearchError('The page did not return readable job content.');
          page={title:text(page.title).slice(0,300),content:page.content.slice(0,24000),url:page.url? safeURL(page.url).href:url};
          remember(pageCache,pageKey,{...page,checkedAt:new Date().toISOString()},35,TTL);
        }
        updated=verifyEvidence(job,page,page.checkedAt||new Date().toISOString());
      }catch(e){aborted(signal);updated={...job,verification:{status:'unverified',checkedAt:new Date().toISOString(),evidence:safeMessage(e)}};}
      const replaced=candidates.some(j=>j.url===job.url);
      candidates=candidates.map(j=>j.url===job.url?updated:j);
      // Consolidated sources must survive replacing a checked candidate.
      if(!replaced)candidates.push(updated);
      aborted(signal);onEvent({type:'results',result:snapshot()});
    }));
  }
  aborted(signal);phase='complete';const result=snapshot();
  if(!reports.some(r=>r.status==='error'))remember(resultCache,cacheKey,structuredClone(result),8);
  onEvent({type:'complete',result});return result;
}

// Tests can isolate caches without exposing keys or provider responses.
export function clearSearchCaches(){resultCache.clear();pageCache.clear();}
