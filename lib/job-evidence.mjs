import { normalize, text, clean, safeURL, parseSalary, boardReference } from './scout.mjs';

const AGGREGATORS = /(^|\.)(linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|simplify\.jobs|jobera\.com|hiringcafe\.com|efinancialcareers\.[a-z.]+|ziprecruiter\.com|monster\.[a-z.]+|dice\.com|builtin\.com|themuse\.com|careerplan\.io|finseats\.com|snagajob\.com|jobrapido\.com|trabajo\.org|talent\.com|dataanalyst\.com|careerbuilder\.com|bigworldjobs\.com|remotive\.com|realanalystjobs\.com|technyc\.org|praxy\.me|refresh\.cv|metaintro\.com)$/i;
const BOARD_NAME = /^(?:CareerBuilder|LinkedIn|Indeed|Glassdoor|Simplify(?: Jobs)?|Big World Jobs|Tech:NYC Job Board)$/i;
const nonVacancy = content => /\b(?:not (?:a |an )?(?:direct |actual |specific )?job (?:opening|vacancy)|not (?:a |an )?(?:specific |current )?vacancy|this (?:is|represents) (?:a )?(?:talent (?:pool|network)|general expression of interest))\b/i.test(content);
const TRACKING = /^(utm_.+|fbclid|gclid|msclkid|ref|refid|referrer|trackingid|trk|source|src|pagenum|originalsubdomain|gh_src)$/i;
const DATE_PART = '(?:\\d{4}-\\d{2}-\\d{2}(?:T[0-9:.]+(?:Z|[+-]\\d{2}:?\\d{2}))?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}\\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{4})';
const LOCATION_HINT = /\b(?:United States(?: of America)?|USA|U\.S\.(?:A\.)?|Canada|United Kingdom|UK|Germany|India|Australia|Singapore|France|Ireland|Netherlands|New York|Chicago|Boston|Atlanta|Austin|Seattle|San Francisco|Los Angeles|Washington|California|Texas|Florida|Georgia|Illinois|Massachusetts|Pennsylvania|Maryland|Connecticut|Ohio|Colorado|Virginia|New Jersey|North Carolina|South Carolina|Toronto|London|Mumbai|Bengaluru|Hyderabad|Berlin|Dublin|Remote|Worldwide)\b|,\s*[A-Z]{2}(?:\s|,|$)/;
const known = value => value && !/^(?:not stated|company not stated|unknown)$/i.test(value);
const iso = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function plain(value) {
  return text(value).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/\*\*|__|`/g, '').trim();
}

export function canonicalJobURL(value) {
  try {
    const u = safeURL(value);
    u.hostname = u.hostname.replace(/^www\./, '');
    for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    u.pathname = u.pathname.replace(/\/$/, '');
    return u.href;
  } catch { return ''; }
}

function sourceKind(url) {
  try {
    const u = new URL(url);
    if (AGGREGATORS.test(u.hostname)) return 'job-board';
    if (/(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|workwolf\.com)$/.test(u.hostname) || /^(?:careers|jobs|recruiting)\./.test(u.hostname)) return 'employer';
    return 'public-page';
  } catch { return 'public-page'; }
}

function requisition(url) {
  try {
    const u = new URL(url);
    const ref = boardReference(url);
    if (ref?.id) return `${ref.type}:${ref.slug}:${ref.id}`;
    if (/myworkdayjobs\.com$/.test(u.hostname)) {
      const match = u.pathname.match(/_((?:R[-_]?)?\d+)(?:-\d+)?(?:\/apply)?$/i);
      if (match) return `workday:${u.hostname}:${match[1].toLowerCase()}`;
    }
    if (u.searchParams.get('gh_jid')) return `greenhouse:${u.hostname}:${u.searchParams.get('gh_jid')}`;
    return '';
  } catch { return ''; }
}

/** A job-looking URL cannot override a clearly aggregate search-result title. */
export function classifyHit(hit = {}) {
  const url = canonicalJobURL(hit.url);
  if (!url) return 'irrelevant';
  const title = plain(hit.title || '').trim();
  if (!title || /^(?:404|403|access denied|page not found|sign in|log in|just a moment|checking your browser)/i.test(title)) return 'irrelevant';
  if (nonVacancy(plain(hit.snippet||hit.description||hit.content))) return 'irrelevant';
  if (/\bjob board\s*$/i.test(title)) return 'directory';
  if (/(?:\d[\d,.+]*\s+.*\bjobs\b|\bjobs\s+(?:in|near|at)\s|\bjobs?,?\s+employment\b|\bopen (?:positions|roles)\b|\bjob (?:search|search results|listings)\b|^search results\b|^careers(?:\s+at|$)|^job openings\b)/i.test(title)) return 'directory';
  const u = new URL(url);
  if (/\/(?:jobs\/search|jobs\/[^/]+-jobs|q-[^/]+-jobs|Job\/[^/]+-jobs|search|careers|jobs)\/?$/i.test(u.pathname) && !/[?&](?:jobid|job_id|gh_jid|jk)=/i.test(u.search)) return 'directory';
  if (/\b(?:salary guide|interview questions|career advice|how to become|job description template|resume example|course|certification guide)\b/i.test(title)) return 'irrelevant';
  const specificPath = /\/(?:job|jobs|view|position|positions|posting|postings|pipelineLink|p)\/[^/?#]+|\/(?:jobs-[^/]+|job-listing\/)|[?&](?:jobid|job_id|gh_jid|jk)=/i.test(url);
  const roleTitle = /\b(?:analyst|engineer|developer|manager|specialist|nurse|designer|associate|director|scientist|technician|accountant|consultant|coordinator|assistant|officer|representative|teacher|physician|therapist|mechanic|driver|cook|chef|supervisor|administrator|architect|intern|researcher|operator|lead|head|recruiter|electrician|plumber|attorney|lawyer|paralegal|cashier|barista|clerk|counsel|surgeon)\b/i.test(title);
  const jobSignals = /\b(?:apply|hiring|requirements|qualifications|responsibilities|full.time|part.time|job requisition|job description)\b/i.test(plain(hit.snippet || hit.description || hit.content));
  return specificPath || (roleTitle && jobSignals) ? 'job' : 'irrelevant';
}

function headingDetails(pageTitle = '') {
  let title = plain(pageTitle).replace(/^(?:Job Application for\s+|\[Hiring\]\s*)/i, '').replace(/\s*\|\s*(?:Simplify(?: Jobs)?|LinkedIn|Indeed(?:\.com)?|Glassdoor|Workday|Apply Today|CareerBuilder).*$/i, '').trim();
  let company = '', location = '';
  const hiring=title.match(/^(.+?)\s+hiring\s+(.+?)\s+Job in\s+(.+)$/i);
  const jobIn=title.match(/^(.+?)\s+Job in\s+(.+?)\s+[-–—]\s+(.+)$/i);
  const pipes=title.split(/\s*\|\s*/);
  if (hiring) {company=hiring[1];title=hiring[2];location=hiring[3];}
  else if (jobIn) {title=jobIn[1];location=jobIn[2];company=jobIn[3];}
  else if (pipes.length>=3 && LOCATION_HINT.test(pipes[2])) {title=pipes[0];company=pipes[1];location=pipes[2];}
  const at = title.match(/^(.+?)\s+(?:@\s*|at\s+)([^|]+?)(?:\s*\|.*)?$/i);
  if (at) { title = at[1].trim(); company = at[2].trim(); }
  const parenthesized = title.match(/\s*\(([^()]{3,140})\)(?:\s*[-–—]\s*(.+))?$/);
  if (parenthesized && LOCATION_HINT.test(parenthesized[1])) {
    location = parenthesized[1].trim();
    if (parenthesized[2]) company = parenthesized[2].trim();
    title = title.slice(0, parenthesized.index).trim();
  }
  const companyLocation=company.match(/\s*(?:[–—]\s*(.+)|\(([^()]+)\))\s*(?:\p{Regional_Indicator}{2})?$/u);
  if (companyLocation) {
    const suffix=(companyLocation[1]||companyLocation[2]).trim();
    if (LOCATION_HINT.test(suffix)||/\b(?:on[- ]site|remote|hybrid)\b/i.test(suffix)) {company=company.slice(0,companyLocation.index).trim();if (!location && LOCATION_HINT.test(suffix)) location=suffix;}
  }
  company=company.replace(/\s*[–—]\s*Salary & Interview Data.*$/i,'').trim();
  if (BOARD_NAME.test(company)) company='';
  return {title:title.slice(0,220),company:company.slice(0,180),location:location.slice(0,400)};
}

function dateInLine(body, label) {
  const m = body.match(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*:?\\s*(${DATE_PART})`, 'i'));
  return m ? {date:iso(m[1].replace(/(\d)(?:st|nd|rd|th)\b/g,'$1')),evidence:m[0].trim(),raw:m[1]} : null;
}

function textFields(body, pageTitle) {
  const heading = headingDetails(pageTitle);
  const lines = body.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const top = lines.slice(0,25);
  const labelValue = label => {
    const m=body.match(new RegExp(`(?:^|\\n)[ \\t]*(?:${label})(?:[ \\t]*:[ \\t]*|[ \\t]*\\n[ \\t]*)([^\\n]{2,180})`, 'i'));
    return m?.[1]?.trim() || '';
  };
  const explicitLocation=labelValue('job location|location(?:s)?|where is the job');
  const locationLine = top.find(line => line.length<140 && LOCATION_HINT.test(line) && clean(line)!==clean(heading.company) && !/[.!?;]|\b(?:experience|responsibilities|benefits|about|company|join|salary|headquarters|headquartered|based in|founded|our offices|our firm|we have|we are|leading|global|across|investments?|management|capital|analytics|technologies|systems)\b/i.test(line) && !/^[-*]/.test(line));
  const compound = top.find(line=>/\|/.test(line)&&LOCATION_HINT.test(line));
  const roleLocation=body.match(/(?:^|\n|[.!?]\s+|\s[•]\s*|\bplus\s+)(?:[-*]\s*)?(?:Open to|This (?:role|position) is based in|You will be based in)\s+([^\n]{3,160})/i)?.[1]?.replace(/\s*[.!]$/,'');
  let location = (explicitLocation && LOCATION_HINT.test(explicitLocation) ? explicitLocation : '') || (roleLocation&&LOCATION_HINT.test(roleLocation)?roleLocation:'') || heading.location || (compound?compound.split('|').slice(1).join('|').trim():'') || locationLine || '';
  if (location && clean(location).includes(clean(heading.title))) location = heading.location || '';
  const company = heading.company || labelValue('company|employer|hiring organization') || (compound?compound.split('|')[0].trim():'');
  const salaryLine = lines.find(line=>line.length<600 && /(?:salary|compensation|base pay|pay range|hourly rate|annual pay)/i.test(line) && /(?:\$|USD|EUR|GBP|CAD|AUD|INR|€|£)\s*[\d,]+/.test(line));
  const salaryValue=salaryLine?.match(/(?:USD|EUR|GBP|CAD|AUD|INR|\$|€|£)\s*\$?\s*\d[\d,]*(?:\.\d+)?\s*[kK]?(?:\s*(?:[-–—]|\bto\b)\s*(?:USD|EUR|GBP|CAD|AUD|INR)?\s*(?:\$|€|£)?\s*\d[\d,]*(?:\.\d+)?\s*[kK]?)?/);
  const salary = salaryLine && salaryValue ? parseSalary(salaryValue[0]+' '+salaryLine.replace(salaryValue[0], '').replace(/\d/g,''), /\b(?:United States|USA|US)\b|,\s*(?:NY|CA|MA|GA|IL|TX|FL)\b/.test(location)?'USD':'') : null;
  const arrangementLine = top.find(line=>/^(?:remote(?:\s*[·–—-].*)?|hybrid(?:\s+schedule)?(?:\s+in.*)?|on[- ]site|in[- ]office)$/i.test(line)) || lines.find(line=>/^(?:work(?:place)? (?:model|arrangement)|work location)\s*:/i.test(line)) || location;
  const employmentLine=top.find(line=>/^(?:full[- ]time|part[- ]time|contract(?:or)?|internship|temporary)(?:\s*[·,|].*)?$/i.test(line)) || labelValue('employment type|time type|job type');
  const posted=dateInLine(body,'posted(?: on)?|date posted|posting date|job posted');
  return {title:heading.title,company,location,arrangement:arrangementLine,employment:employmentLine,salary,postedAt:posted?.date||null,fieldEvidence:{...(company?{company}:{}),...(location?{location}:{}),...(salaryLine?{salary:salaryLine}:{}),...(posted?{postedAt:posted.evidence}:{})}};
}

export function candidateFromHit(hit = {}) {
  if (classifyHit(hit)!=='job') return null;
  const url=canonicalJobURL(hit.url);
  const fields=textFields(plain(hit.snippet || hit.description || '').slice(0,12000),hit.title);
  const job=normalize({...fields,source:'Keenable',sourceId:requisition(url)||url,url,description:plain(hit.snippet||hit.description||'').slice(0,12000),provenance:'Keenable search excerpt; not yet verified'});
  return {...job,fieldEvidence:fields.fieldEvidence,sources:[{url,title:plain(hit.title).slice(0,220),kind:sourceKind(url)}],indexedAt:iso(hit.acquired_at),pagePublishedAt:iso(hit.published_at),verification:{status:'unverified',checkedAt:null,sourceURL:url,evidence:'Search lead; the live job page has not been checked.'},isJob:true,isDirectory:false,requisitionId:requisition(url)};
}

function structuredPosting(page, job) {
  const candidates=[];
  const visit=(value,depth=0)=>{
    if (!value || typeof value!=='object' || depth>10 || candidates.length>=30) return;
    if (Array.isArray(value)) {value.slice(0,100).forEach(v=>visit(v,depth+1));return;}
    if ([].concat(value['@type']||[]).includes('JobPosting')) candidates.push(value);
    for (const child of Object.values(value)) if (child && typeof child==='object') visit(child,depth+1);
  };
  visit(page.jobPosting);visit(page.structuredData);
  for (const match of String(page.content||'').slice(0,250000).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {visit(JSON.parse(match[1]));} catch { /* Broken publisher metadata is not evidence. */ }
  }
  return candidates.find(x=>clean(x.title)===clean(job.title)) || (candidates.length===1?candidates[0]:null);
}

function schemaFields(schema) {
  if (!schema) return {};
  const locations=[].concat(schema.jobLocation||[]).map(p=>{const a=p.address||p;return [a.addressLocality,a.addressRegion,typeof a.addressCountry==='object'?a.addressCountry.name:a.addressCountry].filter(Boolean).join(', ');}).filter(Boolean);
  const eligibility=[].concat(schema.applicantLocationRequirements||[]).map(p=>typeof p==='string'?p:p.name).filter(Boolean);
  const remote=/TELECOMMUTE|REMOTE/i.test(String(schema.jobLocationType||''));
  const pay=schema.baseSalary,v=pay?.value;
  const number=n=>(typeof n==='number'||(typeof n==='string'&&/^\d+(?:\.\d+)?$/.test(n)))&&Number.isFinite(Number(n))?Number(n):null;
  const salary=v?{text:[pay.currency,v.minValue??v.value,v.maxValue?'– '+v.maxValue:'',v.unitText].filter(x=>x!=null&&x!=='').join(' '),min:number(v.minValue??v.value),max:number(v.maxValue??v.value??v.minValue),currency:pay.currency||'',period:/YEAR/i.test(v.unitText)?'year':/HOUR/i.test(v.unitText)?'hour':''}:null;
  return {title:schema.title,company:schema.hiringOrganization?.name,description:schema.description,location:remote&&eligibility.length?`Remote · ${eligibility.join(', ')} only`:[...locations,...eligibility].join(' · '),jobLocations:locations,applicantEligibility:eligibility,employment:schema.employmentType,arrangement:schema.jobLocationType,salary,postedAt:iso(schema.datePosted)};
}

function closureEvidence(body, schema, checkedAt, official=false) {
  const main=body.split(/\n(?:related jobs|similar jobs|other vacancies|recommended jobs)\b/i)[0];
  const closure=main.match(/[^\n.!?]*(?:(?:this|the)\s+(?:job|position|role|vacancy)(?:\s+you are trying to apply for)?\s+(?:(?:has been|was|is)\s+)?(?:filled|closed|removed|no longer available)|(?:we(?:'re| are)\s+)?no longer accepting applications|applications?\s+(?:are|is)\s+closed|this job posting has expired)[^\n.!?]*/i);
  if (closure) return closure[0].trim().slice(0,500);
  const deadline=dateInLine(main,'application deadline|closing date|applications close|apply by|end date');
  let raw=schema?.validThrough||deadline?.raw;
  let extended=false;
  // An explicit extension on the live employer page supersedes stale metadata.
  // A syndicated board or a vague "reposted" timestamp cannot establish one.
  const extension=official?dateInLine(main,'(?:application )?deadline extended to|(?:application )?closing date extended to'):null;
  if(extension?.date&&(!raw||Date.parse(extension.raw)>Date.parse(raw))){raw=extension.raw;extended=true;}
  if (raw) {
    let end=Date.parse(String(raw).replace(/(\d)(?:st|nd|rd|th)\b/g,'$1'));
    if (Number.isFinite(end) && !/T\d|\d:\d/.test(raw)) end+=86400000-1;
    if (Number.isFinite(end) && end<Date.parse(checkedAt)) return extended?extension.evidence:schema?.validThrough?`Publisher application expiry: ${raw}`:deadline.evidence;
  }
  return '';
}

/** Fetch errors and unclear pages remain unverified; search-engine timestamps never become posting dates. */
export function verifyEvidence(job, page = {}, nowISO = new Date().toISOString()) {
  const checkedAt=iso(nowISO)||new Date().toISOString();
  const url=canonicalJobURL(page.url)||job.url;
  const sourceURL=url;
  const schema=structuredPosting(page,job);
  const content=plain(page.content||schema?.description||'').slice(0,65000);
  const closed=closureEvidence(content,schema,checkedAt,sourceKind(url)==='employer');
  const classification=classifyHit({url,title:page.title||job.title,content});
  const isDirectory=classification==='directory' || (!schema && /(?:^|\n)(?:\d[\d,+]*\s+.*\bjobs?\b|search results|job search results)\s*(?:\n|$)/i.test(content.slice(0,3000)));
  if (!content || /^(?:access denied|just a moment|sign in to continue|checking your browser|page not found)\b/i.test(content) || /^(?:access denied|just a moment|sign in|log in|checking your browser)\b/i.test(plain(page.title))) {
    return {...job,verification:{status:'unverified',checkedAt,sourceURL,evidence:'The live page could not be read. Availability has not been confirmed.'}};
  }
  if (isDirectory && !closed) return {...job,isDirectory:true,isJob:false,verification:{status:'unverified',checkedAt,sourceURL,evidence:'This page lists multiple jobs rather than one vacancy.'}};
  if (nonVacancy(content) && !closed) return {...job,isDirectory:false,isJob:false,verification:{status:'unverified',checkedAt,sourceURL,evidence:'The publisher explicitly says this is not an individual job opening.'}};
  const fields=textFields(content,page.title||job.title);
  const structured=schemaFields(schema);
  const raw={...job,...fields};
  for (const key of ['title','company','location','arrangement','employment']) {
    raw[key]=known(structured[key])?structured[key]:known(fields[key])?fields[key]:job[key];
  }
  raw.description=structured.description?plain(structured.description):content;
  raw.salary=structured.salary||fields.salary||job.salary;
  raw.postedAt=structured.postedAt||fields.postedAt||job.postedAt||null;
  // A closure page may redirect to a shared careers homepage. Preserve the vacancy's identity.
  raw.url=closed?job.url:url;
  if (closed && !schema) raw.title=job.title;
  const updated=normalize(raw);
  const individual=classification==='job'||!!schema;
  const hasSections=/\b(?:responsibilities|requirements|qualifications|job description|about the (?:job|role)|what you(?:'ll| will) do|duties|role overview)\b/i.test(content);
  const apply=/\b(?:apply(?: now| for this job)?|start application|submit application|job requisition(?: id)?)\b/i.test(content);
  const available=individual && content.length>=180 && (schema || (hasSections && apply));
  const status=closed?'closed':available?'available':'unverified';
  const evidence=closed||(available?'An individual job description and application evidence were found on the live page. This does not guarantee the employer is still hiring.':'The page was read, but an individual vacancy with application evidence could not be confirmed.');
  const fieldEvidence={...job.fieldEvidence,...fields.fieldEvidence};
  if (schema) for (const field of ['title','company','location','salary','postedAt']) if (structured[field]) fieldEvidence[field]='Publisher JobPosting structured data';
  if (structured.jobLocations?.length) fieldEvidence.jobLocation=structured.jobLocations.join(' · ');
  if (structured.applicantEligibility?.length) fieldEvidence.applicantEligibility=structured.applicantEligibility.join(', ');
  const additionalSources=classification==='job'||schema?[{url,title:page.title||job.title,kind:sourceKind(url)}]:[];
  return {...job,...updated,id:job.id,sources:mergeSources(job.sources,additionalSources),fieldEvidence,verification:{status,checkedAt,sourceURL,evidence},isDirectory:false,isJob:closed?job.isJob!==false:individual,requisitionId:requisition(updated.url)||job.requisitionId||'',provenance:schema?'Publisher JobPosting structured data':'Live page text via Keenable'};
}

function mergeSources(...lists) {
  const map=new Map();
  for (const source of lists.flatMap(x=>x||[])) {
    const url=canonicalJobURL(source.url);
    if (url && !map.has(url)) map.set(url,{...source,url,title:plain(source.title||'').slice(0,220),kind:source.kind||sourceKind(url)});
  }
  return [...map.values()];
}
const sourceRank=url=>({'employer':3,'public-page':2,'job-board':1}[sourceKind(url)]||0);
const locationKey=value=>clean(value).replace(/\bunited states of america\b|\busa\b|\bu s a\b|\bu s\b|\bus\b/g,'united states').replace(/\bnyc\b/g,'new york').replace(/\bny\b/g,'new york').replace(/\bca\b/g,'california').replace(/\bil\b/g,'illinois').replace(/\bma\b/g,'massachusetts').replace(/\bga\b/g,'georgia').replace(/\btx\b/g,'texas').replace(/\s+/g,' ').trim();

// Syndicated descriptions can have different publisher headers and reordered sections.
// Require substantial exact text, identical explicit location, and compatible company names.
function sharedDescription(a,b) {
  const fragments=value=>new Set(plain(value||'').split(/[\n•]+|(?<=[.!?])\s+/).map(clean).filter(s=>s.length>=90));
  const first=fragments(a),second=fragments(b);
  const shared=[...first].filter(s=>second.has(s));
  return shared.length>=4 && shared.reduce((n,s)=>n+s.length,0)>=600;
}
function compatibleCompanies(a,b) {
  if (!known(a)||!known(b)) return true;
  const first=clean(a).replace(/\s/g,''),second=clean(b).replace(/\s/g,'');
  return first===second || (Math.min(first.length,second.length)>=6 && (first.startsWith(second)||second.startsWith(first)));
}

function equivalent(a,b) {
  const urlsA=new Set([a.url,...(a.sources||[]).map(s=>s.url)].map(canonicalJobURL).filter(Boolean));
  if ([b.url,...(b.sources||[]).map(s=>s.url)].map(canonicalJobURL).some(url=>urlsA.has(url))) return true;
  const ar=a.requisitionId||requisition(a.url),br=b.requisitionId||requisition(b.url);
  if (ar && br) {
    if (ar===br) return true;
    if (ar.split(':').slice(0,-1).join(':')===br.split(':').slice(0,-1).join(':')) return false;
  }
  if (!known(a.location)||!known(b.location)||clean(a.title)!==clean(b.title)||locationKey(a.location)!==locationKey(b.location)) return false;
  if (known(a.company)&&known(b.company)&&clean(a.company)===clean(b.company)) return true;
  return compatibleCompanies(a.company,b.company)&&sharedDescription(a.description,b.description);
}

export function dedupeEvidence(jobs = []) {
  const unique=[];
  for (const job of jobs) {
    if (!job?.title || !canonicalJobURL(job.url) || job.isJob===false) continue;
    const index=unique.findIndex(old=>equivalent(old,job));
    if (index<0) {unique.push({...job,sources:mergeSources(job.sources?.length?job.sources:[{url:job.url,title:job.title,kind:sourceKind(job.url)}]),duplicateCount:job.duplicateCount||0});continue;}
    const old=unique[index];
    const pair=[old,job];
    const quality=j=>(['available','closed'].includes(j.verification?.status)?10:0)+sourceRank(j.verification?.sourceURL||j.url);
    const best=quality(job)>quality(old)?job:old;
    const verified=pair.filter(j=>['available','closed'].includes(j.verification?.status)).sort((a,b)=>sourceRank(b.verification.sourceURL||b.url)-sourceRank(a.verification.sourceURL||a.url)||(Date.parse(b.verification.checkedAt)||0)-(Date.parse(a.verification.checkedAt)||0));
    const primary=sourceRank(job.url)>sourceRank(old.url)?job:old;
    const companySource=known(best.company)?best:pair.find(j=>known(j.company));
    unique[index]={...best,...(companySource?{company:companySource.company,fieldEvidence:{...best.fieldEvidence,...(companySource.fieldEvidence?.company?{company:companySource.fieldEvidence.company}:{})}}:{}),id:primary.id,url:primary.url,sources:mergeSources(old.sources,job.sources?.length?job.sources:[{url:job.url,title:job.title,kind:sourceKind(job.url)}]),verification:verified[0]?.verification||best.verification,duplicateCount:(old.duplicateCount||0)+(job.duplicateCount||0)+1};
  }
  return unique;
}
