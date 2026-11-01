// Discovery coverage is separate from fact approval. This module never writes facts.
import {buildProfessionalExperience} from './professional-experience.mjs';
import {canonicalJSON,norm,ProfileError} from './domain.mjs';
import {questionPolicy} from './builder-question-policy.mjs';

const list=v=>Array.isArray(v)?v:[];
const negative=s=>/\b(?:never|not|no|cannot|unable|lack)\b|\b(?:haven't|don't|didn't)\b/i.test(s);
function validRefs(state,refs){return refs.length>0&&refs.every(ref=>{
  const d=state.documents.find(d=>d.id===ref.documentId&&!d.deleted&&['resume','answer'].includes(d.kind));
  return d&&(ref.documentVersion==null||ref.documentVersion===d.version)&&d.segments.some(p=>p.id===ref.segmentId&&typeof ref.quote==='string'&&p.text.includes(ref.quote));
});}
export function builderSourceRecords(state){
  const blocked=state.facts.filter(f=>f.lifecycle==='active'&&(f.conflict||['rejected','withdrawn'].includes(f.approval)));
  const eligible=(statement,refs)=>!negative(statement)&&validRefs(state,refs)&&!blocked.some(f=>norm(statement).includes(norm(f.statement))||list(f.evidence).some(e=>refs.some(r=>r.documentId===e.documentId&&r.segmentId===e.segmentId&&r.quote.includes(e.quote))));
  const work=buildProfessionalExperience(state).rows.flatMap(r=>r.items).filter(i=>eligible(i.statement,i.sourceRefs)).map(i=>({id:i.id,category:'experience_claims',statement:i.statement,sourceRefs:i.sourceRefs,sourceStatus:i.sourceStatus}));
  const skills=state.facts.filter(f=>f.lifecycle==='active'&&f.category==='skills'&&['approved','pending'].includes(f.approval)&&!f.conflict&&eligible(f.statement,list(f.evidence))).map(f=>({id:'skill:'+f.id+':'+f.version,category:'skills',statement:f.statement,sourceRefs:f.evidence,sourceStatus:f.approval==='approved'?'user_confirmed':'resume_stated'}));
  const qualifications=state.facts.filter(f=>f.lifecycle==='active'&&['education','certifications'].includes(f.category)&&['approved','pending'].includes(f.approval)&&!f.conflict&&eligible(f.statement,list(f.evidence))).map(f=>({id:'qualification:'+f.id+':'+f.version,category:f.category,statement:f.statement,sourceRefs:f.evidence,sourceStatus:f.approval==='approved'?'user_confirmed':'resume_stated'}));
  return [...work,...skills,...qualifications];
}
const signature=r=>canonicalJSON(r);
const requirementSignature=r=>canonicalJSON({id:r.id,text:r.text,evidence:r.evidence});
export function normalizeSourceComparison(requirement,assessment,records){
  const raw=assessment?.profileCoverage;
  if(!raw)return null; // Older saved comparisons remain readable; no invented match.
  const policy=questionPolicy(requirement,raw,records);
  const matched=policy?.components.filter(c=>c.matched)||[],missing=policy?.components.filter(c=>!c.matched)||[];
  const c=policy?{...raw,status:!missing.length?'covered':matched.length?'partial':'missing',sourceIds:[...new Set(matched.flatMap(c=>c.sourceIds))],missingScopes:missing.map(c=>c.scope)}:raw;
  const fail=reason=>{throw new ProfileError('Profile Builder could not safely compare the saved profile: '+reason+'. No comparison was saved.',502);};
  if(!['covered','partial','missing'].includes(c.status)||!Array.isArray(c.sourceIds)||!Array.isArray(c.missingScopes))return fail('invalid coverage structure');
  const refs=[...new Set(c.sourceIds)].map(id=>records.find(r=>r.id===id));
  if(refs.some(r=>!r)||c.status!=='missing'&&!refs.length||c.status==='covered'&&c.missingScopes.length||c.status==='partial'&&!c.missingScopes.length)return fail('inconsistent source references or remaining scope');
  // Missing uses the original employer quote, never optional model wording.
  const spans=c.status==='missing'?[]:[...new Set(c.missingScopes)];
  if(spans.some(t=>typeof t!=='string'||t.trim().length<2||!list(requirement.evidence).some(e=>e.quote.includes(t))))return fail('the remaining scope is not an exact job-description passage');
  if(c.status==='partial'&&spans.some(t=>[requirement.text,...list(requirement.evidence).map(e=>e.quote)].some(full=>norm(t).replace(/[.!?]+$/,'')===norm(full).replace(/[.!?]+$/,''))))return fail('a partial match repeated the whole requirement');
  // A skill name cannot establish a project, responsibility, or tenure.
  if(c.status==='covered'&&refs.every(r=>r.category==='skills')&&(requirement.category==='task'||/\b(?:years?|managed|manage|built|build|develop|lead|implement)\b/i.test(requirement.text)))return fail('listed skills alone cannot establish applied work or tenure');
  const area=typeof assessment.atsArea==='string'?assessment.atsArea.trim():'';
  const meaningful=area.toLowerCase().match(/[a-z][a-z0-9+#-]{2,}/g)||[];
  const usableArea=area.length>=4&&area.length<=90&&!/[\n<>]/.test(area)&&meaningful.some(w=>!['and','the','experience','skills','professional','work'].includes(w)&&requirement.text.toLowerCase().includes(w));
  return {requirementId:requirement.id,requirementSignature:requirementSignature(requirement),status:c.status,sourceRefs:refs.map(r=>({id:r.id,signature:signature(r)})),missingScopes:spans,explanation:String(c.explanation||'').slice(0,1400),area:usableArea?area:builderArea(requirement.text),...(policy?{questionPolicy:policy}:{})};
}
export function currentSourceComparison(requirement,comparison,records){
  if(!comparison||comparison.requirementSignature!==requirementSignature(requirement))return null;
  const refs=list(comparison.sourceRefs).map(ref=>records.find(r=>r.id===ref.id&&signature(r)===ref.signature));
  if(refs.some(r=>!r)||!['missing','unresolved'].includes(comparison.status)&&!refs.length)return null;
  return {...comparison,records:refs};
}
export function unresolvedSourceComparison(requirement){
  return {requirementId:requirement.id,requirementSignature:requirementSignature(requirement),status:'unresolved',sourceRefs:[],missingScopes:[],area:builderArea(requirement.text),explanation:'The comparison could not safely separate existing experience from additional scope. This requirement is retained for comparison review; no claim or approval question has been created.'};
}
export function builderArea(text){
  const rules=[
    [/risk report/i,'Risk Reporting & Process Improvement'],
    [/quantitative research/i,'Quantitative Risk Research'],
    [/review.*models|alpha generating/i,'Risk & Portfolio Model Review'],
    [/underlying details|surface level|attention to detail/i,'Analytical Reasoning & Attention to Detail'],
    [/financial analysis/i,'Financial Analysis & Sector Experience'],
    [/asset classes|cross.asset/i,'Cross-Asset Analysis'],
    [/risk metrics|beta|volatility|greeks|\bVaR\b/i,'Financial Instruments & Risk Metrics'],
    [/stress|scenario/i,'Stress Testing & Scenario Analysis'],
    [/liquidity/i,'Liquidity Risk Management'],
    [/credit|covenant|loan/i,'Credit Analysis & Portfolio Monitoring'],
    [/\bIRR\b|\bMOIC\b|\bNPV\b|cash flow|financial model/i,'Financial Modeling & Investment Returns'],
    [/due diligence|DDQ/i,'Investor Due Diligence'],
    [/investor|reporting package/i,'Investor Reporting'],
    [/SQL|Python|Power Query|automation/i,'Data Analysis & Automation'],
    [/Excel/i,'Excel & Financial Analysis'],
    [/risk/i,'Portfolio Risk Analytics'],
    [/portfolio/i,'Portfolio Analytics & Reporting'],
    [/project|implementation|cross.functional/i,'Project Management & Process Improvement'],
    [/communicat|interpersonal/i,'Stakeholder Communication'],
    [/team|collaborat/i,'Team Collaboration'],
    [/report/i,'Financial Reporting'],
  ];
  return rules.find(([pattern])=>pattern.test(text))?.[1]||text.trim().split(/\s+/).slice(0,7).join(' ').replace(/[.,;:]$/,'');
}
