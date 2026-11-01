// Candidate retrieval directs a second evidence review; it NEVER establishes a match.
const list=v=>Array.isArray(v)?v:[];
const normal=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const stop=new Set('a an the and or to of in on for with by at as is are has have had user profile experience experienced working work skills strong good ability relevant specific currently current required requirements knowledge including'.split(' '));
function terms(text){
  return [...new Set(normal(text).split(' ').filter(t=>t.length>2&&!stop.has(t)).map(t=>{
    if(/^(?:collaborat|coordinat|partner)/.test(t))return 'collaborate';
    if(/^(?:report|dashboard)/.test(t))return 'report';
    if(/^(?:communicat|articulat)/.test(t))return 'communicate';
    if(/^(?:develop|built|build)/.test(t))return 'build';
    return t.replace(/(?:ing|ed|s)$/,'');
  }))];
}
export function evidenceCandidates(requirement,records){
  const query=new Set(terms(requirement.text));
  return records.map(record=>{
    const overlap=terms(record.statement).filter(t=>query.has(t));
    return {sourceId:record.id,statement:record.statement,matchedTerms:overlap};
  }).filter(r=>r.matchedTerms.length>=2).sort((a,b)=>b.matchedTerms.length-a.matchedTerms.length||a.sourceId.localeCompare(b.sourceId)).slice(0,6);
}
export function evidenceValidationIssues(requirement,assessment,records,{reviewRequired=false}={}){
  const c=assessment?.profileCoverage,components=list(c?.components);
  if(!components.length)return reviewRequired?['Return a component-based evidence assessment before scoring.']:[];
  const candidates=evidenceCandidates(requirement,records),issues=[];
  const matchedIds=new Set(components.flatMap(part=>list(part.sourceIds)));
  const explanation=String(c.explanation||'');
  const acknowledges=/\b(?:has|have)\b.{0,90}\bexperience\b|\bexperience\b.{0,80}\b(?:documented|recorded|exists)\b|\bprofile\b.{0,30}\b(?:records|shows|includes)\b|\b(?:while|although)\b.{0,90}\b(?:reporting|analytics|collaborat)/i.test(explanation)&&!/^\s*(?:no|neither|not)\b/i.test(explanation);
  if(candidates.length&&!matchedIds.size&&acknowledges)issues.push('The explanation acknowledges relevant recorded experience but no component cites it. Split the supported capability from any remaining qualifier and attach the correct source references.');
  const whole=components.length===1&&list(components[0].sourceIds).length===0&&[requirement.text,...list(requirement.evidence).map(e=>e.quote)].some(t=>normal(t)===normal(components[0].scope));
  if(candidates.length&&whole&&/\b(?:and|with|for|including|as well as)\b/i.test(requirement.text)&&terms(requirement.text).length>=5)issues.push('A compound responsibility with relevant source candidates was scored as one wholly unmatched item. Separate duties, deliverables and audience/qualifiers; compare each against all relevant passages.');
  if(candidates.length&&!matchedIds.size&&/specific (?:phrasing|wording)|exact (?:phrasing|wording)/i.test(explanation))issues.push('Different wording is not evidence of missing experience. Review the meaning of the source passages.');
  if(components.some(part=>/\b(?:prospective|potential|future)\b/i.test(part.scope)&&/\b(?:develop|build|prepare|deliver|materials|reports)\b/i.test(part.scope)))issues.push('Separate the prospective or potential audience from the deliverable. Evidence of reporting and separate client pitching must not automatically establish reporting for that specific audience.');
  if(reviewRequired){
    const review=assessment.evidenceReview,known=new Set(records.map(r=>r.id));
    if(!review||!Array.isArray(review.consideredSourceIds)||typeof review.reason!=='string'||review.reason.trim().length<15)issues.push('The independent evidence review must provide considered source IDs and a substantive rationale.');
    else{
      if(review.consideredSourceIds.some(id=>!known.has(id)))issues.push('The evidence review cited a source outside the supplied profile.');
      // Explicitly cited component evidence was necessarily considered, even if
      // the model omitted it from the duplicate review-ID list.
      const considered=new Set([...review.consideredSourceIds,...matchedIds]);
      if(candidates.length&&!candidates.some(candidate=>considered.has(candidate.sourceId)))issues.push('The independent review did not account for any supplied candidate passages. Candidates are review leads, not automatic matches.');
    }
  }
  return issues;
}
