// Estimated semantic coverage controls questions, never facts or approvals.
import {ProfileError,norm} from './domain.mjs';
export const QUESTIONNAIRE_POLICY={version:2,skipThreshold:75,focusedThreshold:50,evidenceReviewVersion:1};
const protectedGap=scope=>/\b(?:investment authority|fiduciary|mandatory|required|must|essential)\b/i.test(scope);
const namedTool=scope=>/\b(?:Python|SQL|VBA|Excel|Bloomberg|Power BI|Tableau|Java|CFA|CPA)\b/i.test(scope);
export function questionPolicy(requirement,coverage,records){
  if(!coverage.components)return null; // Existing comparisons require a fresh assessment to acquire a score.
  const fail=()=>{throw new ProfileError('Profile Builder returned invalid coverage components. Refine the comparison before using the questionnaire threshold.',502);};
  if(!Array.isArray(coverage.components)||!coverage.components.length||coverage.components.length>20||!['material','incidental'].includes(coverage.relevance))return fail();
  const seen=new Set(),components=coverage.components.map(c=>{
    if(typeof c.scope!=='string'||c.scope.trim().length<2||!requirement.evidence.some(e=>e.quote.includes(c.scope))||![1,3].includes(c.weight)||typeof c.critical!=='boolean'||!Array.isArray(c.sourceIds))return fail();
    const key=norm(c.scope);if(seen.has(key))return fail();seen.add(key);
    let sourceIds=[...new Set(c.sourceIds)];if(sourceIds.some(id=>!records.some(r=>r.id===id)))return fail();
    // Ordinary investor/client reporting does not establish a prospective audience.
    // Keep that qualifier unconfirmed unless the cited source actually supports it.
    const prospective=/\b(?:prospective|potential|future)\b/i.test(c.scope)&&/\b(?:investors?|clients?|customers?|audience|LPs)\b/i.test(c.scope);
    if(prospective)sourceIds=sourceIds.filter(id=>{
      const statement=records.find(r=>r.id===id).statement;
      const futureAudience=/\b(?:prospective|potential|future)\b|\bnew (?:investors?|clients?|customers?|LPs)\b|\bfund\s?rais\w*\b|\bcapital raising\b|\broadshows?\b/i.test(statement);
      const investor=/\binvestors?\b|\bLPs\b|\bfund\s?rais\w*\b|\bcapital raising\b|\broadshows?\b/i.test(statement);
      return futureAudience&&(!/investor/i.test(requirement.text)||investor);
    });
    // Applied work cannot be counted as covered by a list of tool names alone.
    if(sourceIds.length&&sourceIds.every(id=>records.find(r=>r.id===id).category==='skills')&&(requirement.category==='task'||/\b(?:years?|manage|build|develop|lead|implement)\b/i.test(c.scope)))return fail();
    const required=requirement.importance==='required';
    const allAssets=required&&/all (?:primary )?asset classes/i.test(requirement.text)&&/\b(?:equities|rates|credit|FX|commodities)\b/i.test(c.scope);
    const credentialOrTenure=required&&/\b(?:licen[cs]e|certification|certified)\b|\b\d+\s*(?:[-–+]\s*\d+)?\s*(?:years?|months?)\b/i.test(c.scope);
    return {scope:c.scope,weight:c.weight,sourceIds,matched:sourceIds.length>0,critical:c.critical||protectedGap(c.scope)||allAssets||credentialOrTenure||(required&&namedTool(c.scope))};
  });
  // Nested spans cannot count the same duty twice to inflate a percentage.
  if(components.some((c,i)=>components.some((other,j)=>i!==j&&norm(c.scope).includes(norm(other.scope)))))return fail();
  const totalWeight=components.reduce((n,c)=>n+c.weight,0),matchedWeight=components.filter(c=>c.matched).reduce((n,c)=>n+c.weight,0);
  const missing=components.filter(c=>!c.matched),criticalGap=missing.some(c=>c.critical),materialGap=missing.some(c=>c.weight===3||c.critical);
  const coveragePercent=Math.floor(100*matchedWeight/totalWeight);
  let disposition='ask';
  if(!missing.length)disposition='covered';
  else if(coveragePercent>=75&&!materialGap)disposition='skip_minor';
  else if(coveragePercent<50&&coverage.relevance==='incidental'&&!criticalGap)disposition='defer_incidental';
  return {policyVersion:1,coveragePercent,matchedWeight,totalWeight,components,criticalGap,materialGap,relevance:coverage.relevance,disposition};
}
