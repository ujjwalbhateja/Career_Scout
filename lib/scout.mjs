export const SOURCE_INFO = [
  { id:'remotive', name:'Remotive', coverage:'Remote roles worldwide; eligibility varies. Feed delayed by 24 hours; refreshed at most every 6 hours.', url:'https://remotive.com' },
  { id:'arbeitnow', name:'Arbeitnow · Europe', coverage:'Latest European listings. Up to 3 feed pages per search; coverage varies.', url:'https://www.arbeitnow.com' },
  { id:'arbeitnow-uk', name:'Arbeitnow · UK', coverage:'Optional UK feed. May reject automated requests; failures are shown per source.', url:'https://www.arbeitnow.co.uk' },
];
const cache = new Map();
const now = () => new Date().toISOString();
export function text(value) {
  let s=String(value??'');
  for(let n=0;n<2;n++)s=s.replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,v)=>Number(v)<=0x10ffff?String.fromCodePoint(Number(v)):'');
  return s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n\n').trim();
}
export const clean = value => text(value).toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu,' ').trim();
const split = value => String(value || '').split(/[,;\n]/).map(s=>s.trim()).filter(Boolean).slice(0,10);
export function safeURL(value) {
  let u; try { u = new URL(value); } catch { throw new Error('Enter a complete https:// job or careers URL.'); }
  const h = u.hostname.toLowerCase();
  if(u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || h.includes(':') || /^[\d.]+$/.test(h) || !h.includes('.') || /(^|\.)(localhost|local|internal|test|invalid|lan|home|onion)$/.test(h)) throw new Error('Only public HTTPS job and company pages are supported.');
  u.hash=''; return u;
}
export function sponsorship(description) {
  // Only explicit employment sponsorship policies establish a refusal. An
  // authorization requirement, application question or unrelated "no" does not.
  const sentences = text(description).replace(/[\u2018\u2019]/g,"'").split(/(?<=[.!?])\s+|\n+|;|\bbut\b/i).filter(s=>/sponsor/i.test(s)&&!s.trim().endsWith('?'));
  const refusals = [
    /\bno\s+(?:(?:visa|immigration|employment|work[- ]visa|employer)\s+)?sponsorship\b/i,
    /\b(?:cannot|can't|will not|won't|do not|don't|does not|doesn't|unable to|not able to)\s+(?:currently\s+)?(?:offer|provide|support|arrange)\s+(?:any\s+)?(?:(?:visa|immigration|employment|work[- ]visa|employer)\s+)?sponsorship\b/i,
    /\b(?:cannot|can't|will not|won't|do not|don't|does not|doesn't|unable to|not able to)\s+sponsor\s+(?:visas?|candidates?|applicants?|employees?|work visas?)\b/i,
    /\b(?:we|company|employer)\b[^.!?\n]{0,50}\b(?:cannot|can't|do not|don't|will not|won't)\s+sponsor(?:\s+(?:at this time|now|for this (?:role|position)))?[.!]?\s*$/i,
    /\bsponsorship\s*(?:(?:is|will be)\s*|:\s*)?(?:not (?:available|provided|offered|supported)|unavailable|no\b)/i,
    /\bsponsorship\s+will not be\s+(?:available|provided|offered|supported)\b/i,
    /\b(?:must|required|requirement|only)\b[^.!?\n]{0,180}\bwithout\s+(?:(?:visa|immigration|employment|employer)\s+)?sponsorship\b/i,
    /\b(?:applicants|candidates|must)\b[^.!?\n]{0,180}\b(?:not|never)\b[^.!?\n]{0,60}\brequire\s+(?:(?:visa|immigration|employment|employer)\s+)?sponsorship\b/i,
    /\b(?:applicants|candidates)\b[^.!?\n]{0,65}\brequir(?:e|ing)\b[^.!?\n]{0,35}\bsponsorship\b[^.!?\n]{0,65}\b(?:not eligible|ineligible|cannot be considered|will not be considered)\b/i,
    /\b(?:role|position)\b[^.!?\n]{0,45}\bnot eligible for\s+(?:visa\s+)?sponsorship\b/i,
  ];
  const negative = sentences.find(s=>refusals.some(pattern=>pattern.test(s)));
  const positive = sentences.find(s=>/(?:offer|provide|support|consider)\s+(?:visa |immigration |employment )?sponsorship|\b(?:can|will) sponsor\b|(?:visa |immigration |employment )?sponsorship\s+(?:is\s+)?(?:available|provided|offered|supported)/i.test(s) && !refusals.some(pattern=>pattern.test(s)));
  if(negative && positive) return {status:'unknown', evidence:'Conflicting sponsorship statements. Review the original posting.'};
  return negative ? {status:'no',evidence:negative.slice(0,550)} : positive ? {status:'yes',evidence:positive.slice(0,550)} : {status:'unknown',evidence:'No explicit sponsorship commitment found.'};
}
function seniority(title) {
  const t=clean(title);
  if(/\b(intern|internship|apprentice)\b/.test(t))return 'intern';
  if(/\b(director|vice president|vp|chief|head of)\b/.test(t))return 'director';
  if(/\b(principal|staff|distinguished|lead)\b/.test(t))return 'lead';
  if(/\b(senior|sr)\b/.test(t))return 'senior';
  if(/\b(manager|management)\b/.test(t))return 'manager';
  if(/\b(junior|jr|entry|graduate|associate)\b/.test(t))return 'junior';
  if(/\b(mid|intermediate|ii)\b/.test(t))return 'mid';
  return 'unknown';
}
function employment(value) {
  const t=clean(Array.isArray(value)?value.join(' '):value).replace(/ /g,'');
  if(/fulltime/.test(t))return 'full-time'; if(/parttime/.test(t))return 'part-time';
  if(/intern/.test(t))return 'internship'; if(/contract|freelance|temporary/.test(t))return 'contract';return 'unknown';
}
function arrangement(value) {
  const t=clean(value); if(/hybrid/.test(t))return 'hybrid'; if(/remote|telecommute|telecommuting/.test(t))return 'remote'; if(/on site|onsite|on premises/.test(t))return 'on-site';return 'unknown';
}
export function parseSalary(value, defaultCurrency='') {
  const s=text(value); if(!s) return {text:'Not disclosed',min:null,max:null,currency:'',period:''};
  const currency=s.match(/\b(USD|EUR|GBP|CAD|AUD|INR)\b/i)?.[1]?.toUpperCase() || (s.includes('€')?'EUR':s.includes('£')?'GBP':defaultCurrency);
  const nums=[...s.matchAll(/([\d,]+(?:\.\d+)?)\s*([kK])?/g)].slice(0,2).map(m=>Number(m[1].replaceAll(',',''))*(m[2]?1000:1));
  const period=/hour|hourly|\/hr\b/i.test(s)?'hour':/year|annual|annum|\/yr\b/i.test(s)?'year':'';
  return {text:s,min:nums.length?Math.min(...nums):null,max:nums.length?Math.max(...nums):null,currency,period};
}
function publicLink(value) {try{return safeURL(value).href;}catch{return '';}}
export function normalize(raw) {
  const description=text(raw.description).slice(0,65000);
  const url=publicLink(raw.url); const title=text(raw.title).slice(0,220);
  return {id:`${raw.source}:${raw.sourceId || url || [raw.company,title,raw.location].filter(Boolean).join('|')}`,source:raw.source || 'Imported',sourceId:String(raw.sourceId||''),title,company:text(raw.company||'Company not stated').slice(0,180),location:text(raw.location||'Not stated').slice(0,400),arrangement:arrangement(raw.arrangement),seniority:seniority(title),employment:employment(raw.employment),salary:raw.salary && typeof raw.salary==='object'?raw.salary:parseSalary(raw.salary,raw.currency),sponsorship:sponsorship(description),description,url,postedAt:raw.postedAt && Number.isFinite(new Date(raw.postedAt).getTime())?new Date(raw.postedAt).toISOString():null,retrievedAt:now(),imported:!!raw.imported,provenance:raw.provenance||'Public source',warnings:raw.warnings||[]};
}
export function criteriaFrom(body={}) {
  const str=(k,n=600)=>String(body[k]??'').trim().slice(0,n);
  const choices=(k,allowed,def='any')=>allowed.includes(body[k])?body[k]:def;
  return {roles:str('roles'),location:str('location'),seniority:choices('seniority',['any','intern','junior','mid','senior','lead','manager','director']),arrangement:choices('arrangement',['any','remote','hybrid','on-site']),employment:choices('employment',['any','full-time','part-time','contract','internship']),minSalary:Math.max(0,Math.min(100000000,Number(body.minSalary)||0)),currency:choices('currency',['USD','EUR','GBP','CAD','AUD','INR'],'USD'),period:choices('period',['year','hour'],'year'),preferSponsorship:!!body.preferSponsorship,onWorkVisa:body.onWorkVisa===true,includeUnknown:body.includeUnknown!==false,searchDescriptions:!!body.searchDescriptions,maxAge:Math.max(0,Math.min(365,Number(body.maxAge)||0)),sources:Array.isArray(body.sources)?body.sources.filter(s=>SOURCE_INFO.some(x=>x.id===s)):SOURCE_INFO.map(s=>s.id),boards:split(str('boards',5000)).slice(0,8),country:/^[a-z]{2}$/i.test(str('country'))?str('country').toLowerCase():'us'};
}
const expandLocation=s=>clean(s).replace(/\busa\b|\bunited states of america\b|\bu s a\b/g,'united states').replace(/\buk\b|\bgreat britain\b/g,'united kingdom').replace(/\bnyc\b/g,'new york').replace(/\bsf\b/g,'san francisco');
export function assess(job,c) {
  const reasons=[],unknowns=[],conflicts=[]; let score=0;
  const roleOptions=split(c.roles).map(clean);
  const hay=clean(c.searchDescriptions?job.title+' '+job.description:job.title);
  const stem=t=>({engineers:'engineer',engineering:'engineer',developers:'developer',designers:'designer',analysts:'analyst'}[t]||t);
  const words=new Set(hay.split(' ').map(stem));
  if(roleOptions.length && !roleOptions.some(role=>role.split(' ').every(word=>words.has(stem(word)))))conflicts.push('Role keywords');
  else if(roleOptions.length){reasons.push('Role keywords matched');score+=10;}
  for(const key of ['seniority','arrangement','employment'])if(c[key] && c[key]!=='any') {
    if(job[key]==='unknown')unknowns.push(`${key} not stated`);
    else if(job[key]!==c[key])conflicts.push(key);
    else {reasons.push(`${key}: ${job[key]}`);score+=2;}
  }
  if(c.location) {
    const loc=expandLocation(job.location),requested=split(c.location).map(expandLocation);
    if(requested.some(l=>loc.includes(l))) {reasons.push('Location text matched');score+=3;}
    else if(/worldwide|anywhere|global/.test(loc) && job.arrangement==='remote') {reasons.push('Remote · worldwide listed');unknowns.push('Verify remote hiring eligibility');}
    else if(loc==='not stated'||loc==='remote'||!loc)unknowns.push('Location eligibility not stated');
    else conflicts.push('location');
  }
  if(c.minSalary>0) {
    const s=job.salary;
    if(s.max==null||!s.currency||!s.period)unknowns.push('Pay amount, currency, or period incomplete');
    else if(s.currency!==c.currency||s.period!==c.period)unknowns.push('Pay uses a different currency or period');
    else if(s.max<c.minSalary)conflicts.push('compensation');
    else {reasons.push('Published pay range reaches your minimum');score+=2;if(s.min<c.minSalary)unknowns.push('Only part of pay range meets your minimum');}
  }
  if(c.maxAge) {if(!job.postedAt)unknowns.push('Posting date not stated');else if(Date.now()-new Date(job.postedAt).getTime()>c.maxAge*86400000)conflicts.push('posting age');}
  if(c.onWorkVisa===true&&job.sponsorship?.status==='no')conflicts.push('Visa sponsorship explicitly unavailable');
  if(c.preferSponsorship && job.sponsorship.status==='yes')score+=3;
  const match=conflicts.length===0 && (c.includeUnknown||unknowns.length===0);
  if(c.onWorkVisa===true&&!['yes','no'].includes(job.sponsorship?.status))unknowns.push('Visa sponsorship is not confirmed.');
  return {match,reasons,unknowns,conflicts,score};
}
export function dedupe(jobs) {
  const seen=new Map();
  for(const job of jobs) {if(!job.title||!job.description)continue;
    const key=clean(job.company)+'|'+clean(job.title)+'|'+clean(job.location);
    const old=seen.get(key); if(!old || job.description.length>old.description.length)seen.set(key,job);
  }return [...seen.values()];
}
async function limitedText(response,maxBytes=10000000) {
  if(Number(response.headers.get('content-length'))>maxBytes)throw new Error('Source response is too large.');
  const reader=response.body?.getReader(); if(!reader)return '';
  const decoder=new TextDecoder();let result='',size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('Source response is too large.');}result+=decoder.decode(value,{stream:true});}return result+decoder.decode();
}
async function fetchJSON(url,{ttl=0,headers={},maxBytes=10000000}={}) {
  const key=String(url);const hit=cache.get(key);if(ttl && hit && hit.expires>Date.now())return hit.value;
  let edgeCache;
  try {edgeCache=globalThis.caches?.default;if(ttl&&edgeCache){const response=await edgeCache.match(new Request(key));if(response)return response.json();}}
  catch {edgeCache=null;}
  const response=await fetch(url,{headers:{accept:'application/json',...headers},signal:AbortSignal.timeout(14000)});
  if(!response.ok)throw new Error(`Source returned HTTP ${response.status}${response.status===429?' (rate limited)':''}.`);
  const raw=await limitedText(response,maxBytes);let value;try{value=JSON.parse(raw);}catch{throw new Error('Source did not return readable job data.');}
  if(ttl){if(cache.size>30)cache.delete(cache.keys().next().value);cache.set(key,{value,expires:Date.now()+ttl*1000});
    if(edgeCache)await edgeCache.put(new Request(key),new Response(raw,{headers:{'Content-Type':'application/json','Cache-Control':`public, max-age=${ttl}`}})).catch(()=>{});
  }return value;
}
async function feed(id) {
  if(id==='remotive') {const data=await fetchJSON('https://remotive.com/api/remote-jobs',{ttl:21600});if(!Array.isArray(data.jobs))throw new Error('Unrecognized feed format.');return data.jobs.map(j=>normalize({source:'Remotive',sourceId:j.id,title:j.title,company:j.company_name,location:j.candidate_required_location,arrangement:'remote',employment:j.job_type,salary:j.salary,currency:'USD',description:j.description,url:j.url,postedAt:j.publication_date,warnings:['Remotive feed is delayed by 24 hours.']}));}
  const domain=id==='arbeitnow-uk'?'www.arbeitnow.co.uk':'www.arbeitnow.com';const name=id==='arbeitnow-uk'?'Arbeitnow UK':'Arbeitnow';let all=[];
  for(let page=1;page<=3;page++){const data=await fetchJSON(`https://${domain}/api/job-board-api?page=${page}`,{ttl:3600});if(!Array.isArray(data.data))throw new Error('Unrecognized feed format.');all.push(...data.data);if(!data.links?.next)break;}
  return all.map(j=>normalize({source:name,sourceId:j.slug,title:j.title,company:j.company_name,location:j.location,arrangement:j.remote?'remote':'unknown',employment:j.job_types,description:j.description,url:j.url,postedAt:j.created_at?new Date(j.created_at*1000).toISOString():null}));
}
export function boardReference(value) {
  const u=safeURL(value),parts=u.pathname.split('/').filter(Boolean),h=u.hostname;
  if(['boards.greenhouse.io','job-boards.greenhouse.io'].includes(h)&&parts[0])return {type:'greenhouse',slug:parts[0],id:parts[1]==='jobs'?parts[2]:null};
  if(['jobs.lever.co','jobs.eu.lever.co'].includes(h)&&parts[0])return {type:'lever',slug:parts[0],id:parts[1],eu:h==='jobs.eu.lever.co'};
  if(h==='jobs.ashbyhq.com'&&parts[0])return {type:'ashby',slug:parts[0],id:parts[1]};
  return null;
}
async function boardJobs(ref) {
  const slug=encodeURIComponent(ref.slug);
  if(ref.type==='greenhouse'){const data=await fetchJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`,{ttl:900});if(!Array.isArray(data.jobs))throw new Error('Company board not found.');return data.jobs.map(j=>normalize({source:'Greenhouse',sourceId:j.id,title:j.title,company:ref.slug,location:j.location?.name,description:j.content,url:j.absolute_url,arrangement:j.location?.name,postedAt:j.first_published,employment:j.metadata?.find(m=>/employment/i.test(m.name))?.value}));}
  if(ref.type==='lever'){let all=[];for(let skip=0;skip<1000;skip+=250){const data=await fetchJSON(`https://${ref.eu?'api.eu.lever.co':'api.lever.co'}/v0/postings/${slug}?mode=json&limit=250&skip=${skip}`,{ttl:900});if(!Array.isArray(data))throw new Error('Company board not found.');all.push(...data);if(data.length<250)break;}return all.map(j=>normalize({source:'Lever',sourceId:j.id,title:j.text,company:ref.slug,location:j.categories?.location,arrangement:j.workplaceType,employment:j.categories?.commitment,description:[j.descriptionPlain,j.description,...(j.lists||[]).map(l=>l.text+'\n'+text(l.content)),j.additionalPlain].filter(Boolean).join('\n\n'),url:j.hostedUrl,salary:j.salaryRange?{text:`${j.salaryRange.currency} ${j.salaryRange.min}–${j.salaryRange.max} / ${j.salaryRange.interval}`,min:j.salaryRange.min,max:j.salaryRange.max,currency:j.salaryRange.currency,period:/year/i.test(j.salaryRange.interval)?'year':/hour/i.test(j.salaryRange.interval)?'hour':''}:null}));}
  const data=await fetchJSON(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`,{maxBytes:25000000});if(!Array.isArray(data.jobs))throw new Error('Company board not found.');return data.jobs.filter(j=>j.isListed!==false).map(j=>{const comp=j.compensation?.compensationTiers?.flatMap(t=>t.components||[]).find(c=>c.compensationType==='Salary');return normalize({source:'Ashby',sourceId:j.id||j.jobUrl,title:j.title,company:ref.slug,location:[j.location,...(j.secondaryLocations||[]).map(l=>l.location)].filter(Boolean).join(' · '),arrangement:j.workplaceType||(j.isRemote?'remote':''),employment:j.employmentType,description:j.descriptionPlain||j.descriptionHtml,url:j.jobUrl,postedAt:j.publishedAt,salary:comp?{text:j.compensation?.scrapeableCompensationSalarySummary||comp.summary,min:comp.minValue,max:comp.maxValue,currency:comp.currencyCode,period:/YEAR/.test(comp.interval)?'year':/HOUR/.test(comp.interval)?'hour':''}:j.compensation?.scrapeableCompensationSalarySummary});});
}
export function publicAddress(address) {
  if(address.includes(':'))return /^[23][0-9a-f]{0,3}:/i.test(address) && !/^2001:(?:db8|0):/i.test(address);
  const a=address.split('.').map(Number);if(a.length!==4||a.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  return !(a[0]===0||a[0]===10||a[0]===127||a[0]>=224||(a[0]===169&&a[1]===254)||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&(a[1]===168||a[1]===0||a[1]===2))||(a[0]===100&&a[1]>=64&&a[1]<=127)||(a[0]===198&&(a[1]===18||a[1]===19||a[1]===51))||(a[0]===203&&a[1]===0&&a[2]===113));
}
export async function assertPublicHost(host) {
  const results=await Promise.all(['A','AAAA'].map(type=>fetchJSON(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,{headers:{accept:'application/dns-json'}})));
  const ips=results.flatMap(r=>r.Answer||[]).filter(a=>a.type===1||a.type===28).map(a=>a.data);
  if(!ips.length||ips.some(ip=>!publicAddress(ip)))throw new Error('This page does not resolve to an allowed public address.');
}
async function publicHTML(value) {
  let u=safeURL(value);
  for(let n=0;n<4;n++){await assertPublicHost(u.hostname);const res=await fetch(u.href,{redirect:'manual',headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'CareerScout/1.0 (+job discovery; public pages)'},signal:AbortSignal.timeout(12000)});
    if(res.status>=300&&res.status<400){const to=res.headers.get('location');if(!to)throw new Error('Page redirect has no destination.');u=safeURL(new URL(to,u).href);continue;}
    if(!res.ok)throw new Error(`Page returned HTTP ${res.status}. Paste its job description to import it manually.`);
    if(!/text\/html|application\/xhtml/.test(res.headers.get('content-type')||''))throw new Error('Use an HTML job page, or paste the job description.');
    return {html:await limitedText(res,2500000),url:u.href};
  }throw new Error('Too many page redirects. Paste the final job link or description.');
}
function schemaJobs(html) {
  const jobs=[];const visit=(v,depth=0)=>{if(!v||typeof v!=='object'||depth>12)return;if(Array.isArray(v)){v.forEach(x=>visit(x,depth+1));return;}if([].concat(v['@type']||[]).includes('JobPosting'))jobs.push(v);Object.values(v).forEach(x=>{if(x&&typeof x==='object')visit(x,depth+1);});};
  for(const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{visit(JSON.parse(m[1]));}catch{/* Invalid publisher metadata is not a job. */}}
  return jobs.slice(0,100);
}
export function extractJobs(html,url) {
  return schemaJobs(html).filter(j=>j.title&&j.description).map(j=>{
    const places=[].concat(j.jobLocation||[]).map(p=>{const a=p.address||p;return [a.addressLocality,a.addressRegion,typeof a.addressCountry==='object'?a.addressCountry.name:a.addressCountry].filter(Boolean).join(', ');});
    const eligible=[].concat(j.applicantLocationRequirements||[]).map(x=>x.name).filter(Boolean);
    const s=j.baseSalary,v=s?.value;
    const salary=v?{text:`${s.currency||''} ${v.minValue??v.value??''}${v.maxValue?'–'+v.maxValue:''} ${v.unitText||''}`.trim(),min:v.minValue??v.value??null,max:v.maxValue??v.value??v.minValue??null,currency:s.currency||'',period:/YEAR/i.test(v.unitText)?'year':/HOUR/i.test(v.unitText)?'hour':''}:null;
    return normalize({source:new URL(url).hostname,sourceId:j.identifier?.value,title:j.title,company:j.hiringOrganization?.name,location:[...places,...eligible].join(' · '),arrangement:j.jobLocationType,employment:j.employmentType,salary,description:j.description,url:j.url?new URL(j.url,url).href:url,postedAt:j.datePosted,imported:true,provenance:'JobPosting structured data',warnings:j.validThrough&&new Date(j.validThrough)<new Date()?['Publisher expiry date has passed.']:[]});
  });
}
export async function importLink(url) {
  const ref=boardReference(url);
  if(ref){let jobs=await boardJobs(ref);if(ref.id){jobs=jobs.filter(j=>j.sourceId===ref.id||j.url.includes('/'+ref.id));if(!jobs.length)throw new Error('That role was not found on the current company board. It may have closed.');}return {jobs:jobs.map(j=>({...j,imported:true})),links:[],message:ref.id?'Role imported from the company board.':`${jobs.length} current roles imported from this company board.`,board:ref.id?null:safeURL(url).href};}
  const {html,url:finalURL}=await publicHTML(url);const jobs=extractJobs(html,finalURL);
  if(jobs.length)return {jobs:dedupe(jobs),links:[],message:`${jobs.length} role${jobs.length===1?'':'s'} imported from structured job data.`};
  const links=[];for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{const u=safeURL(new URL(m[1].replaceAll('&amp;','&'),finalURL).href);const label=text(m[2]);if(/jobs|careers|positions|openings|greenhouse|lever\.co|ashbyhq/i.test(u.href)&&!links.some(l=>l.url===u.href)&&label)links.push({url:u.href,title:label.slice(0,160)});}catch{}
  }
  const ats=links.find(l=>{try{return !!boardReference(l.url);}catch{return false;}});
  if(ats){const imported=await importLink(ats.url);return {...imported,message:'Found the company’s job board. '+imported.message};}
  return {jobs:[],links:links.slice(0,20),message:links.length?'Found possible job links. Choose a role below to import it.':'This page does not expose readable job data. Paste the description below to import it; no role has been invented.'};
}
async function broadSearch(c,key) {
  const roles=split(c.roles).slice(0,3);let jobs=[];
  for(const role of roles){const u=new URL('https://api.openwebninja.com/jsearch/search-v2');u.searchParams.set('query',`${role}${c.location?' in '+c.location:''}${c.arrangement==='remote'?' remote':''}`);u.searchParams.set('country',c.country);if(c.arrangement==='remote')u.searchParams.set('work_from_home','true');
    const result=await fetchJSON(u.href,{headers:{'x-api-key':key}});if(result.status && result.status!=='OK')throw new Error('Broad search provider rejected the request. Check your key and plan.');const data=Array.isArray(result.data)?result.data:result.data?.jobs;if(!Array.isArray(data))throw new Error('Broad search returned an unsupported format.');
    jobs.push(...data.map(j=>normalize({source:j.job_publisher?`JSearch · ${j.job_publisher}`:'JSearch',sourceId:j.job_id,title:j.job_title,company:j.employer_name,location:[j.job_city,j.job_state,j.job_country].filter(Boolean).join(', '),arrangement:j.job_is_remote?'remote':'unknown',employment:j.job_employment_type,description:j.job_description,url:j.job_apply_link||j.job_google_link,postedAt:j.job_posted_at_datetime_utc,salary:j.job_min_salary!=null||j.job_max_salary!=null?{text:`${j.job_salary_currency||''} ${j.job_min_salary??''}–${j.job_max_salary??''} ${j.job_salary_period||''}`,min:j.job_min_salary,max:j.job_max_salary??j.job_min_salary,currency:j.job_salary_currency||'',period:/YEAR/i.test(j.job_salary_period)?'year':/HOUR/i.test(j.job_salary_period)?'hour':''}:null})));
  }return jobs;
}
export async function search(body) {
  const c=criteriaFrom(body);if(!c.roles)throw new Error('Enter at least one role or role keyword.');
  const tasks=c.sources.map(id=>({name:SOURCE_INFO.find(s=>s.id===id).name,run:()=>feed(id)}));
  for(const url of c.boards)tasks.push({name:url,run:async()=>{const result=await importLink(url);if(!result.jobs.length)throw new Error(result.message);return result.jobs;}});
  const key=typeof body.broadKey==='string'?body.broadKey.trim().slice(0,300):'';
  if(key)tasks.push({name:'JSearch · web-wide',run:()=>broadSearch(c,key)});
  const reports=[];let jobs=[];
  // Small batches bound source concurrency and keep one slow source independent.
  for(let offset=0;offset<tasks.length;offset+=3){await Promise.all(tasks.slice(offset,offset+3).map(async task=>{try{const found=await task.run();jobs.push(...found);reports.push({name:task.name,status:'ok',count:found.length});}catch(e){reports.push({name:task.name,status:'error',count:0,error:e.message||'Source unavailable.'});}}));}
  const scanned=jobs.length;const unique=dedupe(jobs);const all=unique.map(j=>({...j,assessment:assess(j,c)}));
  const matched=all.filter(j=>j.assessment.match).sort((a,b)=>b.assessment.score-a.assessment.score||a.assessment.unknowns.length-b.assessment.unknowns.length||(Date.parse(b.postedAt)||0)-(Date.parse(a.postedAt)||0));
  const excluded={};all.filter(j=>!j.assessment.match).forEach(j=>{for(const reason of j.assessment.conflicts.length?j.assessment.conflicts:['Missing details'])excluded[reason]=(excluded[reason]||0)+1;});
  return {jobs:matched.slice(0,100),totalMatches:matched.length,scanned,duplicates:scanned-unique.length,excluded,reports,searchedAt:now(),criteria:c,coverage:'Connected feeds and supplied company boards only. Optional JSearch adds indexed web coverage; no source guarantees every job website.'};
}
