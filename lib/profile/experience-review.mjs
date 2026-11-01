// Pure projection. JD clauses are review proposals, never evidence of experience.
// Only the domain's explicit review decision may create a user-confirmed fact.
import {primaryJDSegments} from './jd-content.mjs';
const list=value=>Array.isArray(value)?value:[];
const clean=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim():'';
const normal=value=>clean(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#]+/gu,' ').trim();
const phrase=(value,needle)=>!!normal(needle)&&(` ${normal(value)} `).includes(` ${normal(needle)} `);
const unique=values=>[...new Set(values.filter(Boolean))];
const canonical=value=>JSON.stringify(sort(value));
function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;}
function invalid(message){return Object.assign(new Error(message),{status:502,code:'invalid_requirement_assessment'});}
function literal(source,value){const text=clean(value);if(!text)return '';const at=String(source||'').toLowerCase().indexOf(text.toLowerCase());return at<0?'':String(source).slice(at,at+text.length);}
function token(value){let hash=2166136261;for(const char of normal(value)){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,'0');}
const professional=fact=>fact&&fact.lifecycle==='active'&&fact.approval==='approved'&&!fact.conflict&&!['personal','preferences'].includes(fact.category);
const noise=/\b(?:ignore (?:all |previous )?instructions|system prompt|you are (?:an? )?(?:ai|assistant)|similar jobs|recommended jobs|ai[- ]generated summary|powered by ai|cookie preferences|sign up for (?:job )?alerts)\b/i;
const credential=/\b(?:degree|bachelor|master(?:'s)?|doctorate|ph\.?d|b\.?sc|m\.?sc|diploma|certification|certified|licen[cs]e|credential|cfa|cpa|acca|pmp|mba)\b/i;
const vague=/^(?:(?:relevant|appropriate|related|strong|good|excellent|sufficient|prior|professional|demonstrated|required|essential)\s+)*(?:experience|skills?|knowledge|qualifications?|communication|education|ability|competenc(?:e|y|ies)|background)(?:\s+(?:required|preferred|needed))?$/i;
const negative=value=>/\b(?:never|no|not|without|cannot|unable|lack(?:ing)?)\b|\b(?:can't|don't|didn't|haven't|hasn't)\b/i.test(String(value||'').replace(/\bnot only\b/gi,''));

/** Preserve literal clauses. A shared metric/seniority prefix is never copied to another clause. */
export function splitRequirementAtoms(value){
  const source=String(value||'').trim();if(!source)return [];
  const protectedPhrases=/\b(?:research and development|profit and loss|mergers and acquisitions|health and safety|cash and cash equivalents|learning and development)\b/gi;
  const sharedNouns=/\b(?:market|credit|liquidity|operational|financial|investment|legal|regulatory)\s+and\s+(?:[\p{L}-]+\s+){0,2}(?:risk|reporting|management|analysis|controls|oversight|compliance)\b/giu;
  let protectedText=source.replace(protectedPhrases,part=>part.replace(/ and /gi,' \u0001 ')).replace(sharedNouns,part=>part.replace(/ and /gi,' \u0001 '));
  // A leading tenure or proficiency qualifier may govern both conjuncts. Keep
  // that compound visible rather than silently attaching it to only one half.
  if(/\b(?:advanced|expert|minimum|at least|\d+\s*\+?\s*years?|five years|three years)\b[^;\n]*\s+and\s+/i.test(protectedText))protectedText=protectedText.replace(/ and /gi,' \u0001 ');
  const parts=protectedText.split(/\n+|\s*[;•]\s*|\s+(?:and|&)\s+|(?<=[.!?])\s+/i).map(part=>part.replace(/\u0001/g,'and').replace(/^\s*[-*]\s*/,'').trim().replace(/[.!?]+$/,''));
  return unique(parts.map(clean).filter(part=>part&&part.length<=600&&!noise.test(part))).slice(0,20);
}

/** Optional model fields must remain exact bounded JD source spans. */
export function normalizeRequirementAssessment(requirement,assessment,approvedFacts=[]){
  if(!assessment||typeof assessment!=='object'||Array.isArray(assessment)||!Array.isArray(assessment.factIds))throw invalid('Profile Builder returned an invalid requirement assessment.');
  const approved=new Map(approvedFacts.filter(f=>!['personal','preferences'].includes(f.category)&&(!f.approval||f.approval==='approved')&&!f.conflict).map(f=>[f.id,f]));
  const factIds=unique(assessment.factIds);if(factIds.some(id=>typeof id!=='string'||!approved.has(id)))throw invalid('A requirement assessment referenced a fact outside the approved Section 2 profile.');
  const source=list(requirement.evidence).map(e=>e.quote).filter(Boolean);if(!source.length)source.push(requirement.text||'');
  const exact=name=>{
    if(assessment[name]===undefined||assessment[name]===null||assessment[name]==='')return '';
    if(typeof assessment[name]!=='string'||clean(assessment[name]).length>600)throw invalid('Profile Builder returned an invalid '+name+'.');
    const match=source.map(text=>literal(text,assessment[name])).find(Boolean);if(!match)throw invalid('Profile Builder proposed a '+name+' outside the quoted JD source.');
    return clean(match);
  };
  let evidenceStatus=assessment.evidenceStatus||assessment.coverage||assessment.assessment||'';
  if(evidenceStatus==='candidate_support')evidenceStatus='candidate_support';
  else if(evidenceStatus==='not_established')evidenceStatus='missing';
  else if(evidenceStatus&&!['supported','partial','missing','unassessed'].includes(evidenceStatus))throw invalid('Profile Builder returned an unknown evidence status.');
  const missingScope=exact('missingScope'),proposedStatement=exact('proposedStatement');
  if(evidenceStatus==='supported'&&(!factIds.length||missingScope))throw invalid('A supported requirement needs approved evidence and no missing scope.');
  if(evidenceStatus==='partial'&&!factIds.length)throw invalid('A partial requirement needs approved evidence for its supported portion.');
  return {requirementId:requirement.id,factIds,evidenceStatus:evidenceStatus||(factIds.length?'candidate_support':'missing'),explanation:clean(assessment.explanation).slice(0,1400),missingScope,proposedStatement};
}

function approvedSection2(state){
  return list(state.facts).filter(professional).filter(fact=>{
    if(!list(fact.evidence).length)return false;
    if(list(state.approvals).length&&!list(state.approvals).some(a=>a.id===fact.approvalRef&&a.kind==='fact'&&a.recordId===fact.id&&a.recordVersion===fact.version&&a.decision==='approved'))return false;
    return fact.evidence.every(ref=>{const doc=list(state.documents).find(d=>d.id===ref.documentId&&!d.deleted&&['resume','answer'].includes(d.kind));const segment=list(doc?.segments).find(p=>p.id===ref.segmentId);return segment&&typeof ref.quote==='string'&&segment.text.includes(ref.quote)&&(ref.documentVersion==null||doc.version==null||ref.documentVersion===doc.version);});
  });
}
function currentSources(state,requirement,primaryByDocument){
  const document=list(state.documents).find(d=>d.id===requirement.documentId&&d.kind==='jd'&&d.selected&&!d.deleted);if(!document)return [];
  return list(requirement.evidence).flatMap(ref=>{
    const segment=primaryByDocument?.get(document.id)?.get(ref.segmentId)||(!primaryByDocument?list(document.segments).find(p=>p.id===ref.segmentId):null);
    if(ref.documentId!==document.id||!segment||!ref.quote||!segment.text.includes(ref.quote)||(ref.documentVersion!=null&&document.version!=null&&ref.documentVersion!==document.version))return [];
    return [{requirementId:requirement.id,documentId:document.id,documentVersion:document.version||1,documentHash:document.hash||null,segmentId:segment.id,quote:ref.quote}];
  });
}
function minimalCapability(statement){
  return clean(statement).replace(/^(?:(?:working |practical |demonstrated )?knowledge (?:of|in)|(?:experience|expertise|proficiency|proficient|skills?)\s+(?:in|with|of)|ability to)\s+/i,'').replace(/\s+(?:skills?|experience|knowledge|proficiency)\s*$/i,'').trim();
}
function evidenceEligible(fact,requirement){
  if(!fact||negative(fact.statement))return false;
  const appliedWork=/\b(?:build|develop|implement|automate|manage|lead|reconcile|projects?|pipelines?|years?|months?)\b/i.test(requirement.text||'');
  if(fact.category==='skills'&&appliedWork&&!/\b(?:built|developed|implemented|automated|managed|led|reconciled|prepared|performed|used)\b/i.test(fact.statement))return false;
  if(requirement.category==='qualification'||credential.test(requirement.text||'')){
    if(fact.category==='skills')return false;
    if(!['education','certifications'].includes(fact.category)&&!/\b(?:earned|awarded|completed|graduated|hold|obtained|certified|passed)\b/i.test(fact.statement))return false;
    if(/\b(?:pursuing|studying|candidate|expected|planned|preparing|in progress)\b/i.test(fact.statement))return false;
  }
  return true;
}
function supportedAtom(atom,requirement,facts){
  const candidate=minimalCapability(atom),quantified=/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\+\s*)?(?:years?|months?|people|clients?|projects?)\b|\b(?:advanced|expert|expertise|leadership|lead|manage|managed|global|strategic|enterprise|degree|certifi|licen[cs])|[%$£€]/i.test(candidate);
  return facts.filter(fact=>{
    if(negative(fact.statement))return false;
    const exact=phrase(fact.statement,atom)||phrase(fact.statement,candidate);
    if(!exact)return false;
    if(requirement.category==='qualification'||credential.test(candidate)){
      if(fact.category==='skills')return false;
      if(!['education','certifications'].includes(fact.category)&&! /\b(?:earned|awarded|completed|graduated|hold|obtained|certified|passed)\b/i.test(fact.statement))return false;
      if(/\b(?:pursuing|studying|candidate|expected|planned|preparing|in progress)\b/i.test(fact.statement))return false;
      return true;
    }
    if(fact.category==='skills')return !quantified&&(requirement.category==='skill'||/^(?:proficien|skills?|knowledge|experience with|expertise in)/i.test(atom)||normal(candidate).split(' ').length<=3);
    return true;
  });
}
function classify(statement,requirement){
  const qualification=credential.test(statement)||requirement.category==='qualification';
  const applied=/^(?:(?:ability to|experience (?:in|with))\s+)?(?:build|built|develop|developed|design|designed|implement|implemented|automate|automated|prepare|prepared|manage|managed|lead|led|reconcile|reconciled|analyze|analyse|analyzed|analysed|deliver|delivered|use|used)\s+\S+/i.test(statement);
  const explicitTool=/^(?:(?:advanced|intermediate|basic|strong|working|practical|proficiency|proficient|knowledge|experience|skills?|in|with|of)\s+)*(?:python|sql|excel|power query|power bi|tableau|r|sas|vba|javascript|typescript|java|c\+\+|c#|sap|salesforce)(?:\s+(?:skills?|knowledge|proficiency|programming))?$/i.test(clean(statement));
  const skill=!qualification&&!applied&&(requirement.category==='skill'||explicitTool);
  const genericCredential=qualification&&/^(?:(?:a|an|the|relevant|recognized|recognised|professional|appropriate|required|equivalent|some|any|bachelor|bachelors|master|masters|undergraduate|graduate|degree|qualification|qualifications|certificate|certification|license|licence)\s*)+$/i.test(normal(statement));
  const generic=vague.test(clean(statement))||genericCredential||(!/\p{L}/u.test(statement))||/\b(?:or equivalent|relevant qualification|appropriate qualification)\b/i.test(statement);
  const alternative=/\s+or\s+/i.test(statement),fragment=!skill&&!qualification&&normal(statement).split(' ').length<2;
  const sharedQualifier=/\b(?:advanced|expert|minimum|at least|\d+\s*\+?\s*years?|five years|three years)\b.*\s+and\s+/i.test(statement);
  const kind=generic||alternative||fragment||sharedQualifier?'ambiguous':qualification?'qualification':skill?'skill':'experience';
  return {kind,destinationSection:qualification||skill?'facts':'cumulativeExperience',supportsSomewhat:true,requiresDetails:generic||alternative||fragment||sharedQualifier,category:qualification?( /\b(?:degree|bachelor|master|doctorate|ph\.?d|diploma|mba)\b/i.test(statement)?'education':'certifications'):skill?'skills':'experience_claims',field:qualification?'qualification':skill?'skill':'capability'};
}
function latestDecision(state,row){
  const sameProposal=item=>{
    const fingerprint=item.proposalFingerprint||item.fingerprint;if(!fingerprint)return false;
    try{
      const previous=JSON.parse(fingerprint),scopeMatches=normal(previous.scope)===normal(row.scope),kindMatches=previous.kind===row.kind;
      if(scopeMatches&&kindMatches&&normal(previous.proposedStatement)===normal(row.proposedStatement))return true;
      const somewhat=(item.experienceDecision||item.decision)==='somewhat';
      const oldRequirementIds=list(item.requirementIds).length?item.requirementIds:list(item.originatingRequirements);
      const oldTexts=list(item.originalRequirementTexts).length?item.originalRequirementTexts:[...list(state.requirements),...list(state.archivedRequirements)].filter(r=>oldRequirementIds.includes(r.id)).map(r=>r.text);
      // A previously narrowed claim leaves the literal remainder unestablished;
      // show that saved review history without approving the remainder itself.
      const compatibleKind=kindMatches||(previous.kind==='ambiguous'&&previous.destinationSection===row.destinationSection);
      return somewhat&&scopeMatches&&compatibleKind&&!!literal(previous.proposedStatement,row.proposedStatement)&&oldTexts.some(text=>row.originalRequirementTexts.some(current=>normal(current)===normal(text)));
    }catch{return fingerprint===row.fingerprint;}
  };
  const records=[...list(state.experienceReviews).flatMap(review=>list(review.rows).map(item=>({...item,at:item.at||review.at}))),...list(state.answers)].filter(item=>item&&sameProposal(item));
  const latest=records.at(-1);
  if(!latest){
    // Legacy negative decisions are reused only for the exact literal capability,
    // never a broad topic token or a fragment of a compound qualification.
    const legacy=list(state.questions).findLast(q=>['declined','not_experienced'].includes(q.status)&&normal(q.capability)===normal(row.proposedStatement));
    return legacy?{decision:'declined',answerId:null,at:legacy.updatedAt||null,legacy:true}:null;
  }
  const statement=clean(latest.statement||latest.text);
  if(latest.status==='needs_details')return {decision:'needs_details',statement,answerId:latest.answerId||latest.id,at:latest.at||null};
  const decision=latest.experienceDecision||latest.decision;
  return ['approve','approved','decline','declined','somewhat'].includes(decision)?{decision:decision==='approve'?'approved':decision==='decline'?'declined':decision,statement,answerId:latest.answerId||latest.id,at:latest.at||null}:null;
}
function canonicalTopic(value){
  return normal(value).replace(/\b(?:projects?|pipelines?|automations?|implementations?|dashboards?|build|built|developed)\b/g,'implementation').replace(/\b(?:institutions?|institutional|customers?)\b/g,'client').replace(/\brelationships\b/g,'relationship').replace(/\b(?:experience|details|examples|technical|with|using|and|the|a|your)\b/g,'').split(/\W+/).filter(Boolean).filter((word,index,all)=>all.indexOf(word)===index).sort().join(' ');
}
function disclosureSuppressed(state,statement){
  const topic=new Set(canonicalTopic(statement).split(' ').filter(Boolean));
  return list(state.preferences?.disclosure).some(value=>{const protectedWords=canonicalTopic(value).split(' ').filter(Boolean);return protectedWords.length>0&&protectedWords.filter(word=>topic.has(word)).length/protectedWords.length>=.6;});
}

/** Project only missing/partial selected-JD capabilities against ALL approved Section 2 facts.
 * No state is changed, no model is called, and no JD clause is saved as a fact.
 */
export function buildExperienceReviewRows(state,{splitCompounds=true}={}){
  const documents=list(state.documents).filter(d=>d.kind==='jd'&&d.selected&&!d.deleted),selected=new Set(documents.map(d=>d.id));
  const primaryByDocument=new Map(documents.map(document=>[document.id,new Map(primaryJDSegments(document.segments).map(segment=>[segment.id,segment]))]));
  const requirements=list(state.requirements).filter(r=>selected.has(r.documentId)&&r.category!=='location');
  const selectedKey=canonical([...selected].sort()),review=[...list(state.builderReviews)].reverse().find(r=>canonical([...list(r.jdIds)].sort())===selectedKey);
  const facts=approvedSection2(state),byFact=new Map(facts.map(f=>[f.id,f])),mappings=list(review?.mappings).length?review.mappings:list(state.roleProfiles).filter(p=>list(review?.profileIds).includes(p.id)).flatMap(p=>list(p.mappings));
  const groups=new Map();
  for(const requirement of requirements){
    const sources=currentSources(state,requirement,primaryByDocument);if(!sources.length||noise.test(requirement.text||''))continue;
    const mapping=mappings.find(m=>m.requirementId===requirement.id),validRefs=list(mapping?.factRefs).filter(ref=>byFact.get(ref.id)?.version===ref.version&&evidenceEligible(byFact.get(ref.id),requirement));
    const status=mapping?.evidenceStatus||mapping?.coverage||mapping?.assessment||'';
    if(status==='supported'&&validRefs.length===list(mapping.factRefs).length&&validRefs.length&&!mapping.missingScope)continue;
    const exactProposal=clean(mapping?.missingScope||mapping?.proposedStatement);
    let sourceText=exactProposal?sources.map(s=>literal(s.quote,exactProposal)).find(Boolean):sources.map(s=>literal(s.quote,requirement.text)).find(Boolean);
    if(!sourceText)sourceText=sources.map(s=>s.quote).sort((a,b)=>a.length-b.length)[0];
    const atoms=splitCompounds?splitRequirementAtoms(sourceText):[clean(sourceText).replace(/[.!?]+$/,'')];if(!atoms.length)continue;
    const questions=list(state.questions).filter(q=>!String(q.id).includes('::part-')&&(list(q.requirementIds).includes(requirement.id)||q.requirementId===requirement.id));
    for(const [index,statement] of atoms.entries()){
      if(disclosureSuppressed(state,statement))continue;
      if(supportedAtom(statement,requirement,facts).length)continue;
      const key=normal(minimalCapability(statement)),group=groups.get(key)||{proposedStatement:statement,requirements:[],sources:[],questions:[],approvedFactRefs:[],coverage:validRefs.length?'partial':'missing',comparisonExplanations:[],compound:false,part:index};
      group.requirements.push(requirement);group.sources.push(...sources.flatMap(source=>{const quote=literal(source.quote,statement);return quote?[{...source,quote}]:[];}));group.questions.push(...questions);group.approvedFactRefs.push(...validRefs);group.compound||=atoms.length>1;group.comparisonExplanations.push(clean(mapping?.explanation));
      if(validRefs.length)group.coverage='partial';groups.set(key,group);
    }
  }
  const parentUses=new Map();for(const group of groups.values()){const parent=unique(group.questions.map(q=>q.id)).sort()[0];if(parent)parentUses.set(parent,(parentUses.get(parent)||0)+1);}
  const rows=[];
  for(const group of groups.values()){
    const requirementIds=unique(group.requirements.map(r=>r.id)).sort(),documentIds=unique(group.requirements.map(r=>r.documentId)).sort(),parents=unique(group.questions.map(q=>q.id)).sort(),primary=parents[0]||'experience-'+requirementIds[0];
    const id=group.compound||!parents.length||parentUses.get(primary)>1?primary+'::part-'+token(group.proposedStatement):primary;
    const sourceQuotes=[...new Map(group.sources.map(source=>[canonical(source),source])).values()].sort((a,b)=>canonical(a).localeCompare(canonical(b)));
    const approvedFactRefs=[...new Map(group.approvedFactRefs.map(ref=>[ref.id+':'+ref.version,{id:ref.id,version:ref.version}])).values()].sort((a,b)=>a.id.localeCompare(b.id));
    const row={id,questionId:id,fingerprint:'',parentQuestionIds:parents,questionIds:parents,proposedStatement:group.proposedStatement,capability:minimalCapability(group.proposedStatement),scope:'Self-confirmed capability',requirementIds,documentIds,sourceQuotes,approvedFactRefs,coverage:group.coverage,missingScope:group.proposedStatement,comparisonExplanation:unique(group.comparisonExplanations).join(' ').slice(0,1400)||'This capability is not established by the approved cumulative professional profile.',status:'pending',priority:group.requirements.some(r=>r.importance==='required')?'required':'preferred',jdCount:documentIds.length,originalRequirementTexts:unique(group.requirements.map(r=>r.text)),...classify(group.proposedStatement,group.requirements[0])};
    row.fingerprint=canonical({schemaVersion:1,questionId:row.questionId,proposedStatement:row.proposedStatement,scope:row.scope,requirementIds:row.requirementIds,sourceRefs:row.sourceQuotes.map(({quote,...metadata})=>metadata),approvedFacts:approvedFactRefs.map(ref=>({...ref,approvalRef:byFact.get(ref.id)?.approvalRef||null})),kind:row.kind,destinationSection:row.destinationSection});
    const decision=latestDecision(state,row);if(decision){row.status=decision.decision;row.decision=decision;}
    rows.push(row);
  }
  return rows.sort((a,b)=>Number(b.priority==='required')-Number(a.priority==='required')||b.jdCount-a.jdCount||normal(a.proposedStatement).localeCompare(normal(b.proposedStatement)));
}
