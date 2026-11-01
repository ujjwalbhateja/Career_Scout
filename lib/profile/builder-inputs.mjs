import {addJDAnalysis,ProfileError} from './domain.mjs';
import {primaryJDSegments} from './jd-content.mjs';
import {normalizeRequirementAssessment} from './experience-review.mjs';

// Only literal bullets inside explicit employer duty/skill headings are added.
// This is requirement coverage, never factual-profile extraction or approval.
export async function supplementBuilderRequirements(state,document){
  const proposals=[];let section=null;
  const existing=state.requirements.filter(r=>r.documentId===document.id);
  for(const segment of primaryJDSegments(document.segments)){
    for(const raw of segment.text.split('\n')){
      const heading=raw.trim().replace(/^[#*\s]+|[*:\s]+$/g,'');
      if(/^(?:(?:roles? and |key |main )?responsibilities(?: include)?|(?:your|the) role|what you(?:'ll| will) do)$/i.test(heading)){section='task';continue;}
      if(/^(?:skills(?: and attributes)?|qualifications|requirements|what you['’]ll bring|who you are)$/i.test(heading)){section='skill';continue;}
      const bullet=/^\s*[-*•]\s+(.+)$/.exec(raw);
      if(!bullet){if(/^\s*#{1,6}\s|^\s*\*\*.+\*\*\s*$/.test(raw))section=null;continue;}
      const quote=bullet[1].trim();
      if(!section||quote.length<15||quote.length>600||/\b(?:salary|compensation|bonus|benefits|equal opportunity|apply now|cookie)\b/i.test(quote))continue;
      if(existing.some(r=>r.evidence.some(e=>e.segmentId===segment.id&&e.quote===quote))||proposals.some(r=>r.text===quote))continue;
      // A quoted subspan does not account for the rest of the full bullet.
      if(existing.some(r=>r.text===quote))continue;
      const category=/\b(?:degree|bachelor|master['’]s|CFA|certification)\b/i.test(quote)?'qualification':/\b\d+\s*(?:\+|[-–]\s*\d+)?\s*years?\b/i.test(quote)?'experience':section;
      proposals.push({category,text:quote,importance:/\b(?:preferred|advantage|a plus)\b/i.test(quote)?'preferred':'required',evidence:[{documentId:document.id,segmentId:segment.id,quote}]});
    }
  }
  if(!proposals.length)return 0;
  if(existing.length+proposals.length>100)throw new ProfileError('This JD has too many requirements. Split it into smaller role descriptions.',413);
  const isolated=structuredClone(state);isolated.requirements=[];
  await addJDAnalysis(isolated,document.id,{roleName:document.roleName||document.title,sector:document.sector||'',requirements:proposals});
  state.requirements.push(...isolated.requirements.map(r=>({...r,extractionBasis:'literal_employer_bullet'})));
  return proposals.length;
}

export function normalizeBuilderAssessment(requirement,assessment,approvedFacts){
  const allowed=new Set(approvedFacts.map(f=>f.id));
  if(Array.isArray(assessment?.factIds)&&assessment.factIds.some(id=>!allowed.has(id))){
    return normalizeRequirementAssessment(requirement,{factIds:[],evidenceStatus:'not_established',missingScope:'',proposedStatement:'',explanation:'The proposed support could not be linked to approved facts. Review the complete original requirement; no support has been assumed.'},approvedFacts);
  }
  // A model can notice resume-stated information which has no approval receipt.
  // It cannot narrow away any requirement on that basis. Review the full source.
  if(['supported','partial','not_established','missing'].includes(assessment?.evidenceStatus)&&Array.isArray(assessment.factIds)&&assessment.factIds.length===0){
    return normalizeRequirementAssessment(requirement,{...assessment,evidenceStatus:'not_established',missingScope:'',proposedStatement:'',explanation:'No approved fact establishes partial support. Review this complete requirement against your actual experience; source-stated information may still be pending confirmation.'},approvedFacts);
  }
  try{return normalizeRequirementAssessment(requirement,assessment,approvedFacts);}
  catch(error){
    if(error?.code==='invalid_requirement_assessment'&&/outside the quoted JD source/.test(error.message)){
      // Discard the ungrounded suggestion entirely. The projection then uses
      // original employer quotes and asks about the whole unconfirmed requirement.
      // IDs were checked above; no unapproved reference is retained.
      return normalizeRequirementAssessment(requirement,{...assessment,missingScope:'',proposedStatement:'',evidenceStatus:'not_established',explanation:'Review the complete original requirement; the proposed narrowed wording could not be matched to its source.'},approvedFacts);
    }
    if(error?.code==='invalid_requirement_assessment')throw new ProfileError(error.message,502);throw error;
  }
}
