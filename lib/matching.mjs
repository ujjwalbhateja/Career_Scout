// Portable, deterministic search relevance. This module does not score resume fit.
const words = value => String(value ?? '').replace(/<[^>]*>/g, ' ').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu, ' ').trim();
const list = value => (Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/)).map(s => String(s).trim().slice(0, 160)).filter(Boolean).slice(0, 12);
const singulars = {analysts:'analyst',engineers:'engineer',developers:'developer',managers:'manager',specialists:'specialist',scientists:'scientist',nurses:'nurse',accountants:'accountant',administrators:'administrator',designers:'designer',programmers:'programmer',consultants:'consultant',technicians:'technician',architects:'architect',researchers:'researcher'};
const tokens = value => words(value).split(' ').filter(Boolean).map(t => singulars[t] || t);
const tokenPhrase = value => tokens(value).join(' ');
const phraseIn = (hay, needle) => !!needle && (` ${hay} `).includes(` ${needle} `);

const ROLE_FAMILIES = [
  {roots:['portfolio analyst','portfolio analytics','portfolio insights analyst','portfolio analytics analyst','portfolio analytics specialist'],related:['portfolio analyst','portfolio analytics','portfolio insights analyst','portfolio performance analyst','portfolio analytics specialist','investment performance analyst','risk and portfolio analytics'],broad:['portfolio manager','investment analyst','investment risk analyst'],financial:true},
  {roots:['data engineer','data engineering','analytics engineer','etl developer'],related:['data engineer','analytics engineer','data platform engineer','data pipeline engineer','ETL developer'],broad:['data architect','data scientist','database engineer']},
  {roots:['software engineer','software developer','software engineering','application developer'],related:['software engineer','software developer','application developer','backend engineer','frontend engineer','full stack engineer'],broad:['platform engineer','systems engineer','software architect']},
  {roots:['data analyst','reporting analyst','business intelligence analyst'],related:['data analyst','analytics analyst','reporting analyst','business intelligence analyst'],broad:['data scientist','analytics engineer','business analyst']},
  {roots:['nurse','registered nurse','rn','clinical nurse','staff nurse'],related:['registered nurse','clinical nurse','staff nurse','RN'],broad:['nurse practitioner','nursing manager']},
  {roots:['business analyst','business systems analyst'],related:['business analyst','business systems analyst','business process analyst'],broad:['product analyst','operations analyst','strategy analyst']},
  {roots:['product manager','product management','product owner'],related:['product manager','technical product manager','product owner'],broad:['program manager','product analyst']},
  {roots:['accountant','accounting analyst','staff accountant'],related:['accountant','accounting analyst','staff accountant','financial accountant'],broad:['financial analyst','accounting manager']},
  {roots:['marketing manager','digital marketing manager'],related:['marketing manager','digital marketing manager','growth marketing manager'],broad:['marketing specialist','marketing analyst']},
];

function families(criteria) {
  const roles = list(criteria.roles).map(tokenPhrase);
  return ROLE_FAMILIES.filter(f => f.roots.some(root => roles.some(role => role === tokenPhrase(root) || role.replace(/^(senior|junior|lead|staff|principal) /, '') === tokenPhrase(root))));
}

/** Curated suggestions, not model-generated synonyms. UI may edit or remove them. */
export function suggestRoleKeywords(criteria = {}) {
  if (criteria.mode === 'exact') return [];
  const seen = new Set(list(criteria.roles).map(tokenPhrase));
  const result = [];
  for (const family of families(criteria)) {
    for (const kind of criteria.mode === 'broad' ? ['related', 'broad'] : ['related']) {
      for (const term of family[kind]) {
        const key = tokenPhrase(term);
        if (!seen.has(key)) { seen.add(key); result.push({term, kind}); }
      }
    }
  }
  return result.slice(0, 12);
}

/** An explicit relatedKeywords string (even empty) replaces automatic suggestions. */
export function expandRoles(criteria = {}) {
  const result = list(criteria.roles).map(term => ({term, kind:'exact'}));
  if (criteria.mode !== 'exact') {
    const suggestions = suggestRoleKeywords(criteria);
    const supplied = criteria.relatedKeywords === undefined ? suggestions : list(criteria.relatedKeywords).map(term => ({term, kind:suggestions.find(s => tokenPhrase(s.term) === tokenPhrase(term))?.kind || 'related'}));
    result.push(...supplied);
  }
  const seen = new Set();
  return result.filter(item => {const key = tokenPhrase(item.term); if (!key || seen.has(key)) return false; seen.add(key); return true;}).slice(0, 12);
}

const COUNTRY_ALIASES = [
  ['united states',['united states of america','united states','usa','us']],
  ['united kingdom',['united kingdom','great britain','uk','england','scotland','wales','northern ireland']],
  ['canada',['canada']],['australia',['australia']],['germany',['germany','deutschland']],
  ['france',['france']],['india',['india']],['ireland',['ireland']],['netherlands',['netherlands','holland']],
  ['singapore',['singapore']],['spain',['spain']],['italy',['italy']],['poland',['poland']],
  ['mexico',['mexico']],['brazil',['brazil']],['new zealand',['new zealand']],['japan',['japan']],
  ['south africa',['south africa']],['china',['china']],['philippines',['philippines']],
  ['united arab emirates',['united arab emirates','uae']],['switzerland',['switzerland']],
];
const STATES = {AL:'alabama',AK:'alaska',AZ:'arizona',AR:'arkansas',CA:'california',CO:'colorado',CT:'connecticut',DE:'delaware',DC:'district of columbia',FL:'florida',GA:'georgia',HI:'hawaii',ID:'idaho',IL:'illinois',IN:'indiana',IA:'iowa',KS:'kansas',KY:'kentucky',LA:'louisiana',ME:'maine',MD:'maryland',MA:'massachusetts',MI:'michigan',MN:'minnesota',MS:'mississippi',MO:'missouri',MT:'montana',NE:'nebraska',NV:'nevada',NH:'new hampshire',NJ:'new jersey',NM:'new mexico',NY:'new york',NC:'north carolina',ND:'north dakota',OH:'ohio',OK:'oklahoma',OR:'oregon',PA:'pennsylvania',RI:'rhode island',SC:'south carolina',SD:'south dakota',TN:'tennessee',TX:'texas',UT:'utah',VT:'vermont',VA:'virginia',WA:'washington',WV:'west virginia',WI:'wisconsin',WY:'wyoming'};
const CITY_STATES = {'new york':'new york','new york city':'new york','chicago':'illinois','boston':'massachusetts','atlanta':'georgia','san francisco':'california','los angeles':'california','san diego':'california','seattle':'washington','austin':'texas','dallas':'texas','houston':'texas','miami':'florida','denver':'colorado','pittsburgh':'pennsylvania','philadelphia':'pennsylvania','baltimore':'maryland','stamford':'connecticut','charlotte':'north carolina','washington dc':'district of columbia'};
const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function locationText(value) {
  let raw = String(value ?? '').replace(/\bU\.?\s*S\.?\s*A\.?(?=\W|$)/gi,'USA').replace(/\bU\.\s*S\.?(?=\W|$)/gi,'US').replace(/\bU\.\s*K\.?(?=\W|$)/gi,'UK');
  let normal = words(raw).replace(/\bnyc\b|\bnew york city\b/g,'new york').replace(/\bsf\b/g,'san francisco');
  for (const [canonical,aliases] of COUNTRY_ALIASES) for (const alias of aliases) normal = normal.replace(new RegExp(`\\b${escapeRegex(alias)}\\b`,'g'), canonical);
  const countries = COUNTRY_ALIASES.map(([c]) => c).filter(c => phraseIn(normal,c));
  // Bare ambiguous two-letter values (CA, IN, etc.) are deliberately not geocoded.
  const stateCode = raw.match(/(?:,\s*|\s+)([A-Z]{2})(?=\s*(?:,|$|\d{5}\b))/)?.[1];
  const foreignCity = /\b(toronto|vancouver|montreal|ottawa|london|sydney|melbourne|mumbai|delhi|paris|berlin)\b/.test(normal);
  const explicitForeign = countries.some(c => c !== 'united states');
  let state = !explicitForeign && !foreignCity && stateCode && STATES[stateCode] ? STATES[stateCode] : '';
  if (!state && !explicitForeign && !foreignCity) state = Object.values(STATES).find(s => s !== 'georgia' && phraseIn(normal,s)) || '';
  if (!state && !explicitForeign && !foreignCity) state = Object.entries(CITY_STATES).find(([city]) => phraseIn(normal,city))?.[1] || '';
  if (state) {if (!countries.includes('united states')) countries.push('united states'); if (stateCode) normal = normal.replace(new RegExp(`\\b${stateCode.toLowerCase()}\\b`,'g'),state);}
  return {normal,countries,state};
}

function requests(value) {
  // Keep city/state/country qualifiers together, while allowing city alternatives.
  const chunks = String(value ?? '').split(/[;\n]/).flatMap(chunk => {
    const parts = chunk.split(',').map(s=>s.trim()).filter(Boolean), result=[];
    for (const part of parts) {
      const p=locationText(part);
      const qualifier = !!STATES[part.toUpperCase()] || COUNTRY_ALIASES.some(([c])=>p.normal===c);
      const previous=result.at(-1);
      const previousIsCountry=previous && COUNTRY_ALIASES.some(([c])=>locationText(previous).normal===c);
      if (previous && qualifier && !previousIsCountry) result[result.length-1] += ', '+part;
      else result.push(part);
    }
    return result;
  });
  return chunks.slice(0,10);
}

function oneLocation(location, arrangement, requested) {
  const loc=locationText(location), want=locationText(requested);
  if (!want.normal) return {match:true,unknown:false,reason:'No location filter'};
  if (!loc.normal || /^(not stated|unknown|not disclosed|remote|hybrid|on site|various|multiple locations)$/.test(loc.normal)) return {match:true,unknown:true,reason:'Location eligibility not stated'};
  const remote=arrangement==='remote'||/\bremote\b/.test(loc.normal);
  const world=/\b(worldwide|anywhere|global)\b/.test(loc.normal);
  const countryExcluded = country => {
    const c=escapeRegex(country);
    return new RegExp(`\\b(?:except|excluding|excludes|outside|not available in|not eligible in|not hiring in)\\s+(?:for\\s+|the\\s+)?(?:[a-z ]{0,35}\\s+)?${c}\\b|\\bnot (?:in )?${c}\\b|\\b${c}\\s+(?:excluded|not eligible|not supported)\\b`).test(loc.normal);
  };
  if (want.countries.some(countryExcluded)) return {match:false,unknown:false,reason:'Requested location explicitly excluded'};
  const eligibleCountries = loc.countries.filter(c=>!countryExcluded(c));
  if (want.countries.includes('united states') && /\b(europe|european union|eu|eea|uk|apac|asia|latam)\s+only\b/.test(loc.normal)) return {match:false,unknown:false,reason:'Remote hiring restricted to another region'};
  const countryOnly=COUNTRY_ALIASES.some(([c])=>want.normal===c);
  const compatibleCountry=want.countries.some(c=>eligibleCountries.includes(c));
  if (want.countries.length && eligibleCountries.length && !compatibleCountry) return {match:false,unknown:false,reason:'Listed country does not match'};
  if (countryOnly && compatibleCountry) return {match:true,unknown:false,reason:'Country matched'};
  let specific=want.normal;
  for (const [country] of COUNTRY_ALIASES) specific=specific.replace(new RegExp(`\\b${escapeRegex(country)}\\b`,'g'),'').trim();
  // Repeated state/city names, e.g. New York, NY, do not need to appear twice.
  const wantedTokens=[...new Set(specific.split(' ').filter(Boolean))];
  const locationTokens=new Set(loc.normal.split(' '));
  if (specific && wantedTokens.every(t=>locationTokens.has(t))) return {match:true,unknown:false,reason:'Location matched'};
  if (remote && world && !eligibleCountries.length && !/\b(only|restricted|except|excluding|excludes)\b/.test(loc.normal)) return {match:true,unknown:true,reason:'Worldwide remote listed; verify hiring eligibility'};
  if (remote && compatibleCountry) return {match:true,unknown:true,reason:'Remote country matched; verify local eligibility'};
  if (remote && world && /\b(only|restricted|except|excluding|excludes)\b/.test(loc.normal)) return {match:true,unknown:true,reason:'Remote geographic restrictions need review'};
  if (want.countries.includes('united states') && /\b(north america|americas)\b/.test(loc.normal)) return {match:true,unknown:true,reason:'Broad region listed; US hiring eligibility unconfirmed'};
  if (/\b(remote|global)\b/.test(loc.normal) && !loc.countries.length && !loc.state && !/\b(europe|asia|africa|latam|apac|emea)\b/.test(loc.normal)) return {match:true,unknown:true,reason:'Remote hiring eligibility not stated'};
  return {match:false,unknown:false,reason:'Listed location does not match'};
}

/** Unknown eligibility stays visible by default; callers may exclude unknowns. */
export function locationAssessment(location, arrangement, requested) {
  const alternatives=requests(requested);
  if (!alternatives.length) return {match:true,unknown:false,reason:'No location filter'};
  const results=alternatives.map(want=>oneLocation(location,arrangement,want));
  return results.find(r=>r.match&&!r.unknown)||results.find(r=>r.match)||results[0];
}

function oneEdit(a,b) {
  if (a.length<6||b.length<6||Math.abs(a.length-b.length)>1||!/^\p{L}+$/u.test(a)||!/^\p{L}+$/u.test(b)) return false;
  let i=0,j=0,edits=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}
  return edits+(i<a.length||j<b.length?1:0)<=1;
}
function titleMatch(title,query,allowTypo) {
  const target=tokens(title), need=tokens(query), hay=target.join(' '), wanted=need.join(' ');
  if(phraseIn(hay,wanted))return {phrase:true,typo:false};
  if(need.length&&target.some((_,i)=>{const window=target.slice(i,i+need.length);return need.every(t=>window.includes(t));}))return {phrase:false,typo:false};
  if(!allowTypo||need.length<2)return null;
  let errors=0,exact=0;
  for(const term of need){if(target.includes(term)){exact++;continue;}if(target.some(t=>oneEdit(term,t)))errors++;else return null;}
  return errors===1&&exact>0?{phrase:false,typo:true}:null;
}

export function rankJob(job,criteria={}) {
  const reasons=[],unknowns=[],conflicts=[];
  const expansions=expandRoles(criteria), title=String(job.title||'').slice(0,500), description=String(job.description||'').slice(0,80000);
  const descriptionWords=tokenPhrase(description), full=tokenPhrase(title+' '+description);
  const financeFamily=families(criteria).some(f=>f.financial);
  let score=0,matchKind='none',best=null;
  for(const expansion of expansions){
    // Financial role expansion should not drift into IT/property portfolio management.
    const financeExpansion=expansion.kind!=='exact'&&financeFamily;
    if(financeExpansion&&/\b(it|technical|technology|project|property|real estate)\b/.test(words(title))&&!list(criteria.relatedKeywords).some(t=>tokenPhrase(t)===tokenPhrase(expansion.term)))continue;
    const hit=titleMatch(title,expansion.term,criteria.mode!=='exact');
    if(hit){const base={exact:1000,related:700,broad:500}[expansion.kind]-(hit.phrase?0:30)-(hit.typo?80:0);if(!best||base>best.score)best={score:base,kind:expansion.kind,reason:hit.typo?`Title spelling variation: ${expansion.term}`:expansion.kind==='exact'?(hit.phrase?'Exact role phrase in title':'Role keywords in title'):`${expansion.kind==='broad'?'Broader':'Related'} title: ${expansion.term}`};}
    else if(criteria.searchDescriptions!==false&&phraseIn(descriptionWords,tokenPhrase(expansion.term))){const base={exact:180,related:120,broad:80}[expansion.kind];if(!best||base>best.score)best={score:base,kind:'description',reason:`Description mentions: ${expansion.term}`};}
  }
  if(expansions.length&&!best)conflicts.push('Role keywords');
  if(best){score=best.score;matchKind=best.kind;reasons.push(best.reason);}
  for(const term of list(criteria.requiredKeywords))if(!phraseIn(full,tokenPhrase(term)))conflicts.push(`Required keyword: ${term}`);else reasons.push(`Required keyword: ${term}`);
  for(const term of list(criteria.excludedKeywords))if(phraseIn(full,tokenPhrase(term)))conflicts.push(`Excluded keyword: ${term}`);
  for(const key of ['seniority','arrangement','employment'])if(criteria[key]&&criteria[key]!=='any'){
    if(!job[key]||job[key]==='unknown')unknowns.push(`${key} not stated`);
    else if(job[key]!==criteria[key])conflicts.push(key);
    else{reasons.push(`${key}: ${job[key]}`);score+=3;}
  }
  if(criteria.location){const place=locationAssessment(job.location,job.arrangement,criteria.location);if(!place.match)conflicts.push('location');else if(place.unknown)unknowns.push(place.reason);else{reasons.push(place.reason);score+=5;}}
  if(Number(criteria.minSalary)>0){
    const salary=job.salary||{};
    if(salary.max==null||!Number.isFinite(Number(salary.max))||!salary.currency||!salary.period)unknowns.push('Pay amount, currency, or period incomplete');
    else if(salary.currency!==criteria.currency||salary.period!==criteria.period)unknowns.push('Pay uses a different currency or period');
    else if(Number(salary.max)<Number(criteria.minSalary))conflicts.push('compensation');
    else{reasons.push('Published pay range reaches your minimum');score+=2;if(salary.min!=null&&Number(salary.min)<Number(criteria.minSalary))unknowns.push('Only part of pay range meets your minimum');}
  }
  if(Number(criteria.maxAge)>0){const posted=Date.parse(job.postedAt);if(!Number.isFinite(posted))unknowns.push('Posting date not stated');else if(Date.now()-posted>Number(criteria.maxAge)*86400000)conflicts.push('posting age');}
  if(criteria.preferSponsorship&&job.sponsorship?.status==='yes'){score+=3;reasons.push('Explicit sponsorship available');}
  if(criteria.onWorkVisa===true&&job.sponsorship?.status==='no')conflicts.push('Visa sponsorship explicitly unavailable');
  const match=conflicts.length===0&&(criteria.includeUnknown!==false||unknowns.length===0);
  // This preference excludes explicit refusals only, even with strict filters
  // for other missing details. Unstated or conflicting sponsorship is reviewable.
  if(criteria.onWorkVisa===true&&!['yes','no'].includes(job.sponsorship?.status))unknowns.push('Visa sponsorship is not confirmed.');
  return {match,reasons,unknowns,conflicts,score,matchKind};
}
