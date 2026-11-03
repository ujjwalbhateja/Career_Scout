// Server-only Scout policy. Profile constructs the approved search context;
// provider requests receive a few professional terms, never source facts/resumes.
import {searchKeenable,SEARCH_LIMITS,SearchError} from '../keenable.mjs';
import {canonicalJobURL,dedupeEvidence} from '../job-evidence.mjs';
import {rankJob} from '../matching.mjs';
import {text} from '../scout.mjs';

export const SCOUT_POLICY_VERSION='2.0.0';
export const SCOUT_LIMITS=Object.freeze({phases:2,queriesPerPhase:3,totalQueries:6,verificationChecks:SEARCH_LIMITS.checks,minimumRecent:5,history:1000});
const DAY=86400000;
const normal=value=>text(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu,' ').trim();
const phrase=(value,term)=>!!normal(term)&&(` ${normal(value)} `).includes(` ${normal(term)} `);
const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const safeTerm=value=>{
  if(typeof value!=='string')return '';
  const term=text(value).replace(/[\r\n]+/g,' ').trim();
  // A caller cannot accidentally turn contacts, links or resume paragraphs into queries.
  return term.length>0&&term.length<=120&&!/@|https?:|www\.|\b\d[\d ()+.-]{6,}\d\b/i.test(term)?term:'';
};
const unique=values=>[...new Map(values.filter(Boolean).map(value=>[normal(value),value])).values()];

const identityField=/\b(?:name|e.?mail|phone|mobile|contact|address|location|city|country|employer|company|institution|university|college|school|issuer|issued|start|end|date|duration|salary|compensation)\b/i;
const identitySource=fact=>{
  const field=normal(fact.field||'');
  if(['skills','certifications','education'].includes(fact.category)&&/\bname\b/.test(field)&&! /\b(?:institution|university|college|school|issuer|employer|company|contact|location|date)\b/.test(field))return false;
  return identityField.test(field);
};
const dateOrContact=/@|https?:|www\.|\b(?:19|20)\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d/i;
const generic=/^(?:skills?|technical skills?|programming languages?|tools?|responsibilities|experience|professional experience|education|certifications?|qualifications?|industry|sector|other|not provided|missing|unknown|not stated)$/i;
function sourceCandidates(fact){
  const field=String(fact.field||''),statement=String(fact.statement||'').trim(),category=fact.category;
  if(identitySource(fact)&&!(/\b(?:certification|qualification|degree)\b/i.test(field)&&!/(?:institution|issuer|date|name of (?:institution|school|university))/i.test(field)))return [];
  let kind='';
  if(/\b(?:industry|sector|domain)\b/i.test(field))kind='industries';
  else if(category==='skills')kind='skills';
  else if(['education','certifications'].includes(category)&&!/\b(?:institution|issuer|school|university|college|location|date|duration|completion|start|end)\b/i.test(field))kind='qualifications';
  else if(['experience_claims','client_relationships'].includes(category)||(/\b(?:responsibilit(?:y|ies)|duties|tasks|function)\b/i.test(field)&&category==='employment'))kind='responsibilities';
  if(!kind)return [];
  if(kind==='qualifications'&&category==='education'&&!/\b(?:degree|bachelor|master|doctor|ph\.?d|b\.?sc|m\.?sc|b\.?a|m\.?a|mba|diploma|associate|qualification)\b/i.test(statement+' '+field))return [];
  const chunks=statement.split(/\n+|;|(?<=[.!?])\s+/).flatMap(value=>kind==='skills'?value.split(/,|\s+and\s+/i):kind==='responsibilities'?value.split(/\s+and\s+/i):[value]);
  const out=[];
  for(let value of chunks.slice(0,12)){
    value=value.trim().replace(/^[•*\-\s]+/,'').replace(/[.!?]+$/,'');
    // Strip labels/action boilerplate and employer/client/institution suffixes;
    // every remaining term is still a contiguous phrase in the source statement.
    value=value.replace(/^(?:(?:technical |specialist |programming )?(?:skills?|tools?|languages?)|responsibilities|industry|sector|degree|certification)\s*:\s*/i,'');
    value=value.replace(/^(?:I\s+)?(?:(?:have|had)\s+(?:experience|expertise)\s+(?:in|with)|(?:am|was)\s+responsible\s+for|responsible\s+for|experienced\s+(?:in|with)|proficient\s+(?:in|with)|(?:performed|managed|oversaw|led|delivered|provided|supported|executed|conducted|developed|built|handled))\s+/i,'');
    value=value.split(/\s+(?:at|for|from|on behalf of|in partnership with|to clients? (?:at|including))\s+/i)[0].trim();
    if(kind==='qualifications')value=value.split(/\s*[,|]\s*/)[0].trim();
    const term=safeTerm(value);
    if(!term||generic.test(term)||dateOrContact.test(term)||!phrase(statement,term))continue;
    if(kind==='responsibilities'&&normal(term).split(' ').length<2)continue;
    // Names in source prose are not search terms. Explicit tool/degree names
    // remain usable; arbitrary multiword title-case entities in work prose do not.
    if(kind==='responsibilities'&&/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(term))continue;
    out.push({kind,term});
  }
  return out;
}

/** Call inside Profile, using only current approved professional fact records.
 * The exact phrase check prevents JD-derived role keywords becoming user evidence.
 * Additional reviewed phrases can be passed in searchTerms; each needs factIds.
 */
export function buildScoutContext({roleName='',alternativeTitles=[],keywords=[],approvedFacts=[],searchTerms={},functionName='',requiresSponsorship=false}={}){
  const facts=approvedFacts.filter(f=>f&&f.approval==='approved'&&(!f.lifecycle||f.lifecycle==='active')&&!['personal','preferences'].includes(f.category));
  const privateValues=approvedFacts.filter(f=>f&&f.approval==='approved'&&(f.category==='personal'||identitySource(f))&&String(f.statement||'').length<=160).map(f=>normal(f.statement)).filter(s=>s.length>=3);
  const professional=term=>!dateOrContact.test(term)&&!privateValues.some(value=>phrase(term,value));
  const evidence=term=>facts.filter(f=>phrase(f.statement,term));
  const terms={responsibilities:[],industries:[],skills:[],qualifications:[],functions:[]};
  const titles=[];
  for(const fact of facts){
    const field=normal(fact.field),term=safeTerm(fact.statement);
    if(fact.category==='employment'&&/^(?:job title|role title|position title|job role|title|position|role)$/.test(field)&&term&&professional(term))titles.push({term,sourceKind:'employment_title',factIds:[fact.id],sourceRefs:(fact.evidence||[]).map(e=>({documentId:e.documentId,segmentId:e.segmentId,quote:term}))});
    if(/^(?:function|job function|professional function|business function)$/.test(field)&&term&&professional(term))terms.functions.push({term,factIds:[fact.id]});
  }
  for(const kind of Object.keys(terms))for(const item of (Array.isArray(searchTerms[kind])?searchTerms[kind]:[]).slice(0,12)){
    const term=safeTerm(item?.term),refs=evidence(term).filter(f=>item.factIds?.includes(f.id));
    if(term&&refs.length&&professional(term))terms[kind].push({term,factIds:refs.map(f=>f.id)});
  }
  for(const value of keywords.slice(0,24)){
    const term=safeTerm(value),refs=evidence(term);if(!term||!refs.length||!professional(term))continue;
    const kind=refs.some(f=>f.category==='skills')?'skills':refs.some(f=>['education','certifications'].includes(f.category))?'qualifications':'responsibilities';
    terms[kind].push({term,factIds:refs.map(f=>f.id)});
  }
  for(const fact of facts)for(const candidate of sourceCandidates(fact)){
    if(!professional(candidate.term))continue;
    terms[candidate.kind].push({term:candidate.term,factIds:[fact.id]});
  }
  // roleName/alternativeTitles are display metadata from legacy callers; they
  // never become search titles or a fallback professional function.
  return normalizeScoutContext({profileId:'master-profile',basis:'validated_source_data',roleName,titles,functionName,...terms,approvedFactIds:facts.map(f=>f.id),requiresSponsorship});
}

/** The saved Profile boundary validates all source bindings before this projection. */
export function scoutContextFromSearchProfile(searchProfile){
  if(!searchProfile||searchProfile.id!=='master-profile'||searchProfile.basis!=='validated_source_data')throw new SearchError('Save a validated source-based professional profile before searching.',409);
  return normalizeScoutContext({...searchProfile.context,...searchProfile,profileId:'master-profile',roleName:searchProfile.label||'Validated professional profile',functionName:searchProfile.context?.functionName||'',basis:'validated_source_data'});
}

/** Trusted server input only. HTTP criteria must never supply this context directly. */
export function normalizeScoutContext(input={}){
  const roleName=safeTerm(input.roleName)||'Validated professional profile';
  const approved=new Set(Array.isArray(input.approvedFactIds)?input.approvedFactIds.filter(x=>typeof x==='string').slice(0,500):[]);
  const resume=new Set(Array.isArray(input.resumeFactIds)?input.resumeFactIds.filter(x=>typeof x==='string'&&!approved.has(x)).slice(0,500):[]),eligible=new Set([...approved,...resume]);
  const terms=kind=>{
    const seen=new Set(),out=[];
    for(const value of (Array.isArray(input[kind])?input[kind]:[]).slice(0,24)){
      const term=safeTerm(value?.term),factIds=unique((Array.isArray(value?.factIds)?value.factIds:[]).filter(id=>typeof id==='string'&&eligible.has(id)));
      if(!term||!factIds.length||seen.has(normal(term)))continue;
      seen.add(normal(term));out.push({term,factIds});if(out.length===12)break;
    }
    return out;
  };
  const functions=terms('functions'),titles=[],seenTitles=new Set();
  for(const value of (Array.isArray(input.titles)?input.titles:[]).slice(0,24)){
    const term=safeTerm(value?.term||value?.title),sourceKind=value?.sourceKind;
    const factIds=unique((Array.isArray(value?.factIds)?value.factIds:[]).filter(id=>eligible.has(id)));
    const sourceRefs=(Array.isArray(value?.sourceRefs)?value.sourceRefs:[]).filter(ref=>ref&&typeof ref.documentId==='string'&&typeof ref.segmentId==='string'&&typeof ref.quote==='string'&&normal(ref.quote)===normal(term)).slice(0,8).map(ref=>({documentId:ref.documentId.slice(0,200),segmentId:ref.segmentId.slice(0,200),quote:term}));
    if(!term||dateOrContact.test(term)||seenTitles.has(normal(term))||(sourceKind==='employment_title'?!factIds.length:sourceKind==='selected_jd_title'?!sourceRefs.length:true))continue;
    seenTitles.add(normal(term));titles.push({term,sourceKind,factIds,sourceRefs});if(titles.length===6)break;
  }
  const requestedFunction=safeTerm(input.functionName),functionName=functions.find(t=>t.term===requestedFunction)?.term||functions[0]?.term||'';
  return {profileId:'master-profile',basis:'validated_source_data',roleName,titles,functionName,alternativeTitles:[],functions,responsibilities:terms('responsibilities'),industries:terms('industries'),skills:terms('skills'),qualifications:terms('qualifications'),approvedFactIds:[...approved],...(input.resumeFactIds?{resumeFactIds:[...resume]}:{}),requiresSponsorship:input.requiresSponsorship===true};
}

/** Each route uses a small independent subset, never an AND of every keyword. */
export function planScoutQueries(context,{days=7,now=new Date().toISOString()}={}){
  const c=normalizeScoutContext(context),end=date(now);if(!end||![7,30].includes(days))throw new SearchError('The Scout date window is invalid.',400);
  const from=new Date(Date.parse(end)-days*DAY).toISOString().slice(0,10),until=end.slice(0,10);
  const suffix=`job opening careers apply originally posted ${from} to ${until}`;
  const titles=c.titles.slice(0,3).map(s=>`"${s.term}"`).join(' OR ');
  const queries=[],missing=[];
  if(titles)queries.push({route:'titles',query:`(${titles}) ${suffix}`});
  else missing.push('No source-backed employment or selected-JD titles are available; discovery uses approved work and skills.');
  if(c.responsibilities.length)queries.push({route:'responsibilities_industry',query:[...c.responsibilities.slice(0,2).map(x=>`"${x.term}"`),...c.industries.slice(0,1).map(x=>`"${x.term}"`),suffix].join(' ')});
  else missing.push('Approved responsibility search terms are unavailable.');
  if(c.skills.length)queries.push({route:'skills_function',query:[...c.skills.slice(0,2).map(x=>`"${x.term}"`),c.functionName,suffix].join(' ')});
  else missing.push('Approved specialist skill/tool search terms are unavailable.');
  if(!c.industries.length)missing.push('Approved industry search terms are unavailable; responsibility discovery has no industry restriction.');
  if(c.skills.length&&!c.functionName)missing.push('An explicit professional function is unavailable; specialist-skill discovery has no inferred function restriction.');
  return {days,from,until,queries,missing};
}

function essentialLines(description){
  const lines=String(description||'').split(/\n+/).map(x=>x.replace(/^\s*[-*•]\s*/,'').trim()).filter(Boolean);
  const start=lines.findIndex(x=>/^(?:requirements|(?:essential |minimum |required )?qualifications|what you (?:bring|need)|what we(?:'re| are) looking for)\s*:?$/i.test(x));
  if(start<0)return [];
  const out=[];
  for(const line of lines.slice(start+1,start+16)){
    if(/^(?:benefits|(?:our |your )?(?:responsibilities|compensation)|about (?:us|the company)|apply(?: now| for this job)?|equal opportunity)\b/i.test(line))break;
    if(!/\b(?:preferred|nice.to.have|desirable|bonus)\b/i.test(line))out.push(...line.split(/(?<=[.!?])\s+/).filter(Boolean));
  }
  return out;
}
function qualificationUnknowns(job,c){
  const lines=essentialLines(job.description),all=[...c.responsibilities,...c.skills,...c.qualifications];
  if(!lines.length)return ['Essential qualifications have not been fully assessed.'];
  return lines.filter(line=>{
    // Tenure, degrees, credentials and authorization need explicit support;
    // merely matching a tool in the same sentence cannot establish them.
    if(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*years?\b|\b(?:degree|bachelor|master|doctorate|phd|licen[cs]e|certifi(?:ed|cation)|citizen|authori[sz]ation|clearance)\b/i.test(line))return !c.qualifications.some(t=>phrase(t.term,normal(line).replace(/^(?:must|required|minimum) /,'')));
    return line.split(/\s+(?:and|&)\s+|;/).some(part=>!all.some(t=>phrase(part,t.term)));
  }).map(line=>`Essential qualification needs review: ${line.slice(0,240)}`);
}

/** Title relevance cannot outweigh performed work or create a strong match alone. */
export function assessScoutJob(job,criteria,context){
  const c=normalizeScoutContext(context),base=rankJob(job,{...criteria,roles:c.titles.map(t=>t.term).join(', '),relatedKeywords:'',mode:'exact',maxAge:'',includeUnknown:true});
  const matches=kind=>c[kind].filter(t=>phrase(job.description,t.term));
  const work=matches('responsibilities'),skills=matches('skills'),industry=matches('industries');
  const title=base.matchKind!=='none',relevant=title||work.length>0||skills.length>0;
  const conflicts=base.conflicts.filter(x=>x!=='Role keywords'||!relevant),unknowns=[...base.unknowns];
  if(c.requiresSponsorship){
    if(job.sponsorship?.status==='no')conflicts.push('Mandatory sponsorship is explicitly unavailable');
    else if(job.sponsorship?.status!=='yes')unknowns.push('Required sponsorship is not confirmed.');
  }else if(criteria.preferSponsorship&&job.sponsorship?.status!=='yes')unknowns.push('Sponsorship availability is not confirmed.');
  const qualifications=qualificationUnknowns(job,c);unknowns.push(...qualifications);
  const reasons=[...work.map(t=>`Approved performed work: ${t.term}`),...skills.map(t=>`Approved specialist skill: ${t.term}`),...industry.map(t=>`Approved industry knowledge: ${t.term}`),...base.reasons];
  if(!work.length)unknowns.push('Alignment with performed responsibilities has not been established.');
  const score=Math.round(45*work.length/Math.max(1,c.responsibilities.length)+20*skills.length/Math.max(1,c.skills.length)+15*industry.length/Math.max(1,c.industries.length)+(title?10:0)+Math.min(5,base.reasons.filter(r=>!/^Exact role|^Role keywords|^Related title|^Description mentions/.test(r)).length));
  return {match:relevant&&!conflicts.length,conflicts:[...new Set(conflicts)],unknowns:[...new Set(unknowns)],reasons:[...new Set(reasons)],score,matchKind:work.length?'approved_work':skills.length?'approved_skill':base.matchKind,strong:work.length>0&&!qualifications.length&&!unknowns.length&&!conflicts.length,evidence:unique([...work,...skills,...industry].flatMap(t=>t.factIds))};
}

function officialURL(job){
  const url=canonicalJobURL(job.verification?.sourceURL||job.url);
  return job.sources?.some(s=>s.kind==='employer'&&canonicalJobURL(s.url)===url)?url:null;
}
function applicationDeadline(job){
  const deadlineDate=raw=>{
    if(!raw)return null;
    const value=String(raw).replace(/(\d)(?:st|nd|rd|th)\b/g,'$1'),timed=/T\d|\d:\d/.test(value);
    const parsed=date(timed?value:/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00.000Z':value+' UTC');
    return parsed?new Date(Date.parse(parsed)+(timed?0:DAY-1)).toISOString():null;
  };
  const explicit=deadlineDate(job.applicationDeadline||job.validThrough);
  const pattern=/(application deadline|closing date|applications close|apply by|deadline extended to)\s*:?\s*(\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/gi;
  const found=[...String(job.description||'').matchAll(pattern)].map(m=>{
    return {at:deadlineDate(m[2]),evidence:m[0],extension:/extended/i.test(m[1])};
  }).filter(x=>x.at);
  // Only the verified official page can establish an extension.
  const extended=officialURL(job)?found.filter(x=>x.extension).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0]:null;
  if(extended)return extended;
  if(explicit)return {at:explicit,evidence:'Publisher application deadline'};
  return found.filter(x=>!x.extension).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))[0]||{at:null,evidence:'Application deadline not provided.'};
}
const jobKey=job=>job.requisitionId||canonicalJobURL(job.url);
async function contentHash(job){
  const data=JSON.stringify([normal(job.title),normal(job.company),normal(job.description),normal(job.location),job.salary||null,job.verification?.status,applicationDeadline(job).at]);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data));
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

/** Pure presentation/history policy; previousSeen must come from owner-scoped Memory. */
export async function presentScoutResults(result,{context,criteria=result.criteria||{},previousSeen=[],now=new Date().toISOString()}={}){
  const c=normalizeScoutContext(context),timestamp=date(now);if(!timestamp)throw new SearchError('The Scout clock is invalid.',400);
  const history=new Map((Array.isArray(previousSeen)?previousSeen:[]).slice(-SCOUT_LIMITS.history).filter(x=>x&&typeof x.key==='string').map(x=>[x.key,x]));
  const jobs=[],excluded={...(result.excluded||{})};let suppressedUnchanged=0;
  for(const candidate of dedupeEvidence(result.jobs||[])){
    const key=jobKey(candidate),urls=unique([canonicalJobURL(candidate.url),...(candidate.sources||[]).map(s=>canonicalJobURL(s.url))]);
    const old=history.get(key)||[...history.values()].find(h=>h.urls?.some(u=>urls.includes(u)));
    const assessment=assessScoutJob(candidate,criteria,c);
    const related=(result.jobs||[]).filter(j=>jobKey(j)===key||urls.includes(canonicalJobURL(j.url)));
    const dates=[...related.flatMap(j=>[j.originalPostedAt,j.postedAt]),old?.originalPostedAt].map(date).filter(Boolean).sort((a,b)=>Date.parse(a)-Date.parse(b));
    const original=dates[0]||null,age=original?(Date.parse(timestamp)-Date.parse(original))/DAY:null;
    const deadline=applicationDeadline(candidate),official=officialURL(candidate),hash=await contentHash(candidate);
    const status=candidate.verification?.status||'unverified';
    if(old&&old.key!==key)history.delete(old.key);
    history.set(key,{key,urls:unique([...urls,...(old?.urls||[])]),hash,originalPostedAt:original,status,lastSeenAt:timestamp,official:!!official});
    let reason='';
    if(status==='closed')reason='Closed';
    else if(deadline.at&&Date.parse(deadline.at)<Date.parse(timestamp))reason='Application deadline passed';
    else if(age!==null&&age>30)reason='Originally posted more than 30 days ago';
    else if(assessment.conflicts.length)reason=assessment.conflicts[0];
    else if(!assessment.match)reason='No evidenced relevance';
    if(reason){excluded[reason]=(excluded[reason]||0)+1;continue;}
    if(old?.hash===hash){suppressedUnchanged++;continue;}
    const unknowns=[...assessment.unknowns];
    if(!official)unknowns.push('The official employer application page has not been verified.');
    if(status!=='available')unknowns.push('The vacancy has not been verified as accepting applications.');
    if(age===null)unknowns.push('Original posting date is unknown; search indexing/repost dates are not substituted.');
    if(age!==null&&age<0)unknowns.push('The publisher posting date is in the future and needs review.');
    const strong=assessment.strong&&status==='available'&&!!official&&age!==null&&age>=0;
    const group=strong?(age<=7?'strong_recent':'other_strong'):'review';
    jobs.push({...candidate,assessment:{...assessment,unknowns:[...new Set(unknowns)],strong},group,dateGroup:age===null?'unknown':age<0?'needs_review':age<=7?'last_7_days':'days_8_to_30',originalPostingDate:original,applicationDeadline:deadline.at,deadlineEvidence:deadline.evidence,lastVerifiedAt:candidate.verification?.checkedAt||null,officialApplicationURL:official,whyMatches:assessment.reasons,uncertainties:[...new Set(unknowns)],updateKind:old?(old.status==='closed'&&status==='available'&&official?'reopened':'material_update'):'new'});
  }
  const order={strong_recent:0,other_strong:1,review:2};jobs.sort((a,b)=>order[a.group]-order[b.group]||b.assessment.score-a.assessment.score||(Date.parse(b.originalPostingDate)||0)-(Date.parse(a.originalPostingDate)||0));
  return {...result,jobs,excluded,totalMatches:jobs.length,suppressedUnchanged,seen:[...history.values()].slice(-SCOUT_LIMITS.history),groups:[{id:'strong_recent',label:'Strong recent matches'},{id:'other_strong',label:'Other strong matches'},{id:'review',label:'Potential matches requiring review'}].map(g=>({...g,jobs:jobs.filter(j=>j.group===g.id)})),unknownDateJobs:jobs.filter(j=>j.dateGroup==='unknown').map(j=>j.id)};
}

/** Two bounded phases; at most six provider searches and ten live verification fetches.
 * A caller may inject search for deterministic tests, never a synthetic production fallback.
 */
/** @param {{criteria?:any,context?:any,previousSeen?:any[]}} input @param {any} options */
export async function searchApprovedProfileJobs({criteria={},context,previousSeen=[]},options={}){
  const {search=searchKeenable,now=new Date().toISOString(),minimumRecent=SCOUT_LIMITS.minimumRecent,onEvent=()=>{},...provider}=options;
  const c=normalizeScoutContext(context),first=planScoutQueries(c,{days:7,now});
  if(!first.queries.length)throw new SearchError('Add and approve source-backed responsibilities, skills or employment titles before job discovery.',409);
  const sourcedTitles=c.titles.map(t=>t.term).join(', '),seed=sourcedTitles||c.responsibilities[0]?.term||c.skills[0]?.term;
  // The generic provider adapter requires a nonempty relevance seed. For a
  // titleless profile this is an approved work/skill phrase, never a made-up role.
  const body={...criteria,roles:seed,relatedKeywords:'',mode:'exact',includeUnknown:true,includeUnverified:true,showClosed:true,maxAge:''};
  const assessJob=(job,filters)=>assessScoutJob(job,filters,c),phases=[],attemptedWindows=[7];let expansionFailed=false;
  const execute=async(plan,verificationLimit)=>{
    onEvent({type:'progress',message:`Scout is searching ${plan.days===7?'the last seven days':'the expanded thirty-day window'} through ${plan.queries.length} evidenced routes.`});
    const location=safeTerm(criteria.location),arrangement=['remote','hybrid','on-site'].includes(criteria.arrangement)?criteria.arrangement:'';
    const queries=plan.queries.map(q=>({...q,query:[q.query,location?`in ${location}`:'',arrangement].filter(Boolean).join(' ')}));
    return search(body,{...provider,queryPlan:queries,verificationLimit,assessJob,cacheContext:{policy:SCOUT_POLICY_VERSION,context:c,window:plan.days},onEvent:event=>{if(event.type==='progress')onEvent(event);}});
  };
  const recent=await execute(first,6);phases.push({days:7,result:recent});
  const preview=await presentScoutResults(recent,{context:c,criteria:recent.criteria||body,previousSeen,now});
  const threshold=Number.isInteger(minimumRecent)?Math.max(1,Math.min(10,minimumRecent)):SCOUT_LIMITS.minimumRecent;
  if(preview.groups[0].jobs.length<threshold){
    attemptedWindows.push(30);
    const expanded=planScoutQueries(c,{days:30,now}),remaining=Math.max(0,Math.min(SEARCH_LIMITS.checks,SCOUT_LIMITS.verificationChecks-(recent.usage?.fetchRequests||0)));
    try{phases.push({days:30,result:await execute(expanded,remaining)});}
    catch(error){if(error?.name==='AbortError')throw error;expansionFailed=true;recent.reports=[...(recent.reports||[]),{name:'Thirty-day expansion',status:'error',error:error instanceof SearchError?error.message:'The expanded search could not complete.'}];}
  }
  const combined={...recent,jobs:phases.flatMap(p=>p.result.jobs||[]),reports:phases.flatMap(p=>p.result.reports||[]),queryPlan:phases.flatMap(p=>p.result.queryPlan||planScoutQueries(c,{days:p.days,now}).queries),searchedAt:now,phase:'complete',scanned:phases.reduce((n,p)=>n+(p.result.scanned||0),0),usage:{searchRequests:phases.reduce((n,p)=>n+(p.result.usage?.searchRequests||0),0),fetchRequests:phases.reduce((n,p)=>n+(p.result.usage?.fetchRequests||0),0),cacheHits:phases.reduce((n,p)=>n+(p.result.usage?.cacheHits||0),0),credits:phases.some(p=>p.result.usage?.credits==null)?null:phases.reduce((n,p)=>n+p.result.usage.credits,0)},scoutPolicy:{version:SCOUT_POLICY_VERSION,windows:phases.map(p=>p.days),routes:first.queries.map(q=>q.route),missingContext:first.missing,limits:SCOUT_LIMITS},coverage:'Bounded Scout discovery using approved professional search terms. Original posting dates are checked after discovery; provider date queries cannot guarantee complete date coverage. Official verification, qualification gaps and unknown dates are explicit. Cross-search suppression requires owner-scoped saved history.'};
  combined.scoutPolicy.attemptedWindows=attemptedWindows;combined.scoutPolicy.expansionFailed=expansionFailed;
  if(expansionFailed){combined.usage.incomplete=true;combined.usage.credits=null;}
  const output=await presentScoutResults(combined,{context:c,criteria:recent.criteria||body,previousSeen,now});
  output.criteria={...(output.criteria||body),roles:sourcedTitles,relatedKeywords:'',mode:'exact'};
  output.expandedRoles=c.titles.map(title=>({term:title.term,kind:'source_title',sourceKind:title.sourceKind}));
  onEvent({type:'complete',result:output});return output;
}
