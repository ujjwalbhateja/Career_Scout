import {buildValidatedSearchProfile} from './search-profile.mjs';
import {buildExperienceReviewRows} from './experience-review.mjs';
import {primaryJDSegments} from './jd-content.mjs';
// Profile owns this state. Fact and Builder return proposals; only explicit user
// decisions can approve claims. Pinecone results are never authoritative records.
export const PROFILE_SCHEMA = 1;
export const CATEGORIES = ['personal','employment','education','skills','experience_claims','quantitative_claims','client_relationships','certifications','preferences'];
export const LIMITS = {fileBytes:2_000_000,textChars:60_000,segments:800,documents:80,facts:1200,questions:200,jdMin:10,jdMax:15};
export class ProfileError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export const clean = (v,max=1000)=>String(v??'').trim().slice(0,max);
export const id = prefix=>prefix+'_'+crypto.randomUUID();
export const now = ()=>new Date().toISOString();
export const norm = v=>clean(v,6000).toLowerCase().replace(/\s+/g,' ');
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export function emptyProfile(){return {schemaVersion:PROFILE_SCHEMA,documents:[],facts:[],requirements:[],roleProfiles:[],questions:[],answers:[],approvals:[],snapshots:[],outbox:[],runs:[],preferences:{},deletion:null};}
export function assertState(s){
  if(s?.schemaVersion!==PROFILE_SCHEMA)throw new ProfileError('Profile schema is incompatible. Export it before migration.',409);
  for(const name of ['documents','facts','requirements','roleProfiles','questions','answers','approvals','snapshots','outbox','runs'])if(!Array.isArray(s[name]))throw new ProfileError('Stored profile is invalid.',409);
  return s;
}
export const currentFacts=s=>s.facts.filter(f=>f.lifecycle==='active');
export const approvedFacts=s=>currentFacts(s).filter(f=>f.approval==='approved'&&!f.conflict);
const canonicalValue=value=>Array.isArray(value)?value.map(canonicalValue):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalValue(value[key])])):value;
export const canonicalJSON=value=>JSON.stringify(canonicalValue(value));
const professionalFacts=s=>approvedFacts(s).filter(f=>!['personal','preferences'].includes(f.category));
const orderedRefs=refs=>[...refs].map(r=>({id:r.id,version:r.version,...(r.approvalRef?{approvalRef:r.approvalRef}:{})})).sort((a,b)=>a.id.localeCompare(b.id)||String(a.version).localeCompare(String(b.version)));
const sameRefs=(a,b)=>canonicalJSON(orderedRefs(a))===canonicalJSON(orderedRefs(b));
function latestAnswers(s){const latest=new Map();for(const answer of s.answers)latest.set(answer.questionId,answer);return [...latest.values()];}
function answerRefs(s){return latestAnswers(s).map(a=>{
  const ref={id:a.id,questionId:a.questionId,status:a.status,...(a.documentId?{documentId:a.documentId}:{})};
  if(a.experienceDecision){
    const document=s.documents.find(d=>d.id===a.documentId&&!d.deleted),segment=document?.segments.find(part=>part.id===a.sourceSegmentId);
    Object.assign(ref,{experienceRowId:a.experienceRowId||a.questionId,experienceDecision:a.experienceDecision,sourceSegmentId:a.sourceSegmentId||null,proposalFingerprint:a.proposalFingerprint||null,confirmedFactRefs:orderedRefs(a.confirmedFactRefs||[]),text:a.text||'',sourceText:segment?.text||null});
  }
  return ref;
}).sort((a,b)=>a.questionId.localeCompare(b.questionId));}
function roleAlternativeTitles(value){
  const seen=new Set(),titles=[];
  for(const title of Array.isArray(value)?value:[]){if(typeof title!=='string')continue;const text=clean(title,140),key=norm(text);if(!text||seen.has(key))continue;seen.add(key);titles.push(text);if(titles.length===8)break;}
  return titles;
}
function roleFactBasis(s,profile){
  if(Array.isArray(profile.inputFactRefs))return profile.inputFactRefs;
  const review=s.builderReviews?.findLast(r=>r.profileIds?.includes(profile.id));
  return review?.factRefs?.filter(ref=>s.facts.some(f=>f.id===ref.id&&f.version===ref.version&&!['personal','preferences'].includes(f.category)))||null;
}
function roleNeedsRebuild(s,profile){
  if(profile.requiresRebuild)return true;
  const basis=roleFactBasis(s,profile),facts=professionalFacts(s);
  if(basis){
    if(!sameRefs(basis.map(({id,version})=>({id,version})),facts.map(({id,version})=>({id,version}))))return true;
    if(basis.some(ref=>ref.approvalRef&&facts.find(f=>f.id===ref.id&&f.version===ref.version)?.approvalRef!==ref.approvalRef))return true;
  }
  if(Array.isArray(profile.inputAnswerRefs))return canonicalJSON(profile.inputAnswerRefs) !== canonicalJSON(answerRefs(s));
  const builtAt=Date.parse(profile.createdAt);
  if(!Number.isFinite(builtAt))return false;
  if(latestAnswers(s).some(a=>Number.isFinite(Date.parse(a.at))&&Date.parse(a.at)>builtAt))return true;
  return !basis&&facts.some(f=>{const approval=s.approvals.find(a=>a.id===f.approvalRef);return Number.isFinite(Date.parse(approval?.at))&&Date.parse(approval.at)>builtAt;});
}
function invalidateRoleInputs(s){
  for(const profile of s.roleProfiles){profile.requiresRebuild=true;if(profile.status==='approved')profile.status='needs_review';}
}
export function invalidateProfileSnapshots(s,reason='Profile inputs changed. Review and save the current profile again.'){
  for(const snapshot of s.snapshots){snapshot.stale=true;snapshot.staleReason=reason;}
}
export function evidence(s,refs){
  if(!Array.isArray(refs)||!refs.length||refs.length>8)throw new ProfileError('Every assertion needs source evidence.');
  return refs.map(ref=>{
    const document=s.documents.find(d=>d.id===ref.documentId&&!d.deleted);
    const segment=document?.segments.find(p=>p.id===ref.segmentId);
    const quote=clean(ref.quote,6000);
    if(!segment||!quote||!segment.text.includes(quote))throw new ProfileError('An assertion does not match its source passage.');
    return {documentId:document.id,documentVersion:document.version,segmentId:segment.id,quote};
  });
}
export function addDocument(s,document){
  if(s.deletion)throw new ProfileError('Profile deletion is in progress.',409);
  if(s.documents.filter(d=>!d.deleted).length>=LIMITS.documents)throw new ProfileError('Document limit reached. Export or remove unused documents.',409);
  const text=norm(document.segments?.map(p=>p.text).join('\n'));
  const duplicate=s.documents.find(d=>!d.deleted&&d.kind===document.kind&&(d.hash===document.hash||(document.kind!=='answer'&&text&&norm(d.segments?.map(p=>p.text).join('\n'))===text)));
  if(duplicate)throw new ProfileError('This document is already saved as '+duplicate.title+'.',409);
  s.documents.push({...document,id:document.id||id('doc'),version:1,selected:document.kind==='jd'&&document.selected===true,createdAt:now(),analysis:'pending'});
  return s.documents.at(-1);
}
export async function proposeFacts(s,proposals,origin='resume',reportedConflicts=[]){
  if(!Array.isArray(proposals)||proposals.length>200)throw new ProfileError('Fact extraction returned an invalid batch.',502);
  const originalFacts=currentFacts(s);
  if(!Array.isArray(reportedConflicts)||reportedConflicts.length>50||reportedConflicts.some(c=>!Number.isInteger(c.proposedFactIndex)||c.proposedFactIndex<0||c.proposedFactIndex>=proposals.length||!originalFacts.some(f=>f.id===c.existingFactId&&f.approval==='approved')||!clean(c.reason,1000)))throw new ProfileError('Fact consistency review referenced invalid records.',502);
  const added=[],resolved=[];
  for(const p of proposals){
    if(!CATEGORIES.includes(p.category))throw new ProfileError('Fact extraction returned an unknown category.',502);
    const statement=clean(p.statement,1800),scope=clean(p.scope,300),field=clean(p.field,100);
    if(!statement||!field)throw new ProfileError('An extracted fact is incomplete.',502);
    const refs=evidence(s,p.evidence);
    if(refs.some(r=>s.documents.find(d=>d.id===r.documentId)?.kind==='jd'))throw new ProfileError('A job description cannot establish user experience.',502);
    const fingerprint=await digest(JSON.stringify([p.category,norm(field),norm(scope),norm(statement)]));
    const existing=currentFacts(s).find(f=>f.fingerprint===fingerprint);
    if(existing){for(const ref of refs)if(!existing.evidence.some(e=>e.documentId===ref.documentId&&e.segmentId===ref.segmentId&&e.quote===ref.quote))existing.evidence.push(ref);resolved.push(existing);continue;}
    if(s.facts.length>=LIMITS.facts)throw new ProfileError('Fact history limit reached. Export before continuing.',409);
    // Different values for the same exact scoped field need a user's decision.
    // Free-form experience statements are separate assertions, not contradictions.
    const conflict= !['experience_claims','skills','preferences'].includes(p.category)
      ?currentFacts(s).filter(f=>f.category===p.category&&norm(f.field)===norm(field)&&norm(f.scope)===norm(scope)).map(f=>f.id):[];
    const fact={id:id('fact'),version:1,category:p.category,field,scope,statement,rawValue:refs.map(r=>r.quote).join('\n'),fingerprint,evidence:refs,origin,confirmation:origin==='user_answer'?'user_stated':'resume_stated',approval:'pending',approvalRef:null,lifecycle:'active',conflict:conflict.length>0,conflictIds:conflict,createdAt:now()};
    for(const name of ['experienceArea','employerRole','recordScope'])if(typeof p[name]==='string'&&clean(p[name],200))fact[name]=clean(p[name],200);
    for(const prior of currentFacts(s).filter(f=>conflict.includes(f.id))){prior.conflict=true;prior.conflictIds=[...new Set([...(prior.conflictIds||[]),fact.id])];invalidate(s,prior.id);}
    s.facts.push(fact);added.push(fact);resolved.push(fact);
  }
  for(const review of reportedConflicts){
    const prior=originalFacts.find(f=>f.id===review.existingFactId),proposed=resolved[review.proposedFactIndex];
    if(prior.id===proposed.id)continue;
    for(const [fact,other] of [[prior,proposed],[proposed,prior]]){fact.conflict=true;fact.conflictIds=[...new Set([...(fact.conflictIds||[]),other.id])];fact.consistencyNotes=[...(fact.consistencyNotes||[]),clean(review.reason,1000)];invalidate(s,fact.id);}
  }
  return added;
}
export function decideFacts(s,decisions,actor){
  if(!Array.isArray(decisions)||!decisions.length||decisions.length>150)throw new ProfileError('Select between 1 and 150 fact decisions.');
  const seen=new Set();
  // Validate the whole batch before changing any record. Older clients remain
  // protected by the aggregate revision; new clients bind the prior decision too.
  for(const d of decisions){
    if(seen.has(d.id))throw new ProfileError('Select each fact only once.');seen.add(d.id);
    const f=s.facts.find(f=>f.id===d.id&&f.version===d.version&&f.lifecycle==='active');
    if(!f)throw new ProfileError('A fact changed. Reload before approving.',409);
    if(!['approved','rejected','withdrawn'].includes(d.decision))throw new ProfileError('Invalid approval decision.');
    if('expectedFingerprint' in d&&(d.expectedFingerprint!==f.fingerprint||d.expectedApproval!==f.approval||d.expectedApprovalRef!==(f.approvalRef??null)))throw new ProfileError('A selected fact or its decision changed. Reload and review it before saving.',409);
    if(f.conflict&&d.decision==='approved')throw new ProfileError('Resolve conflicting records before approving this fact.',409);
  }
  for(const d of decisions){
    const f=s.facts.find(f=>f.id===d.id&&f.version===d.version&&f.lifecycle==='active');
    if(!f)throw new ProfileError('A fact changed. Reload before approving.',409);
    if(!['approved','rejected','withdrawn'].includes(d.decision))throw new ProfileError('Invalid approval decision.');
    if(f.approval===d.decision)continue;
    if(f.conflict&&d.decision==='approved')throw new ProfileError('Resolve conflicting records before approving this fact.',409);
    const approval={id:id('approval'),kind:'fact',recordId:f.id,recordVersion:f.version,decision:d.decision,actor,at:now()};
    s.approvals.push(approval);f.approval=d.decision;f.approvalRef=approval.id;
    if(d.decision==='approved')f.confirmation='user_confirmed';
    if(d.decision!=='approved')invalidate(s,f.id);
    else if(!['personal','preferences'].includes(f.category))invalidateRoleInputs(s);
    invalidateProfileSnapshots(s,'A fact decision changed. Review and save the current profile again.');
  }
  refreshAnswerConsistency(s);enqueue(s,'reindex');return s;
}
function invalidate(s,factId){
  for(const profile of s.roleProfiles)if(profile.factRefs.some(r=>r.id===factId)&&profile.status==='approved')profile.status='needs_review';
  for(const snapshot of s.snapshots)if(snapshot.factRefs.some(r=>r.id===factId))snapshot.stale=true;
}
function refreshAnswerConsistency(s){
  for(const answer of s.answers.filter(a=>a.consistencyFactRefs?.length)){
    const unresolved=answer.consistencyFactRefs.some(ref=>s.facts.some(f=>f.id===ref.id&&f.version===ref.version&&f.lifecycle==='active'&&f.approval==='approved'&&f.conflict&&f.consistencyAnswerIds?.includes(answer.id)));
    if(answer.requiresConsistencyReview&&!unresolved)answer.consistencyResolvedAt=now();
    answer.requiresConsistencyReview=unresolved;
  }
}
export async function correctFact(s,body){
  const old=s.facts.find(f=>f.id===body.id&&f.version===body.version&&f.lifecycle==='active');
  if(!old)throw new ProfileError('A fact changed. Reload first.',409);
  const text=clean(body.statement,1800);if(!text)throw new ProfileError('Enter the corrected statement.');
  if(norm(text)===norm(old.statement))return old;
  old.lifecycle='superseded';invalidate(s,old.id);
  for(const f of s.facts){f.conflictIds=(f.conflictIds||[]).filter(x=>x!==old.id);f.conflict=f.conflictIds.some(x=>s.facts.some(g=>g.id===x&&g.lifecycle==='active'&&!['rejected','withdrawn'].includes(g.approval)))||(f.consistencyAnswerIds||[]).some(answerId=>s.answers.some(a=>a.id===answerId&&a.requiresConsistencyReview));}
  const document=answerDocument(text,'Correction for '+old.field);addDocument(s,document);
  const fact={...structuredClone(old),version:old.version+1,statement:text,rawValue:text,fingerprint:await digest(JSON.stringify([old.category,norm(old.field),norm(old.scope),norm(text)])),evidence:[{documentId:document.id,documentVersion:1,segmentId:document.segments[0].id,quote:text}],origin:'user_answer',confirmation:'user_stated',approval:'pending',approvalRef:null,lifecycle:'active',conflict:false,conflictIds:[],consistencyAnswerIds:[],createdAt:now()};
  s.facts.push(fact);refreshAnswerConsistency(s);enqueue(s,'reindex');return fact;
}
export function resolveConflict(s,keepId){
  const chosen=s.facts.find(f=>f.id===keepId&&f.lifecycle==='active');if(!chosen)throw new ProfileError('Fact not found.',404);
  const ids=[chosen.id,...chosen.conflictIds];
  for(const f of s.facts.filter(f=>ids.includes(f.id)&&f.lifecycle==='active')){if(f.id!==keepId){f.lifecycle='superseded';invalidate(s,f.id);}f.conflict=false;f.conflictIds=[];f.consistencyAnswerIds=[];}
  refreshAnswerConsistency(s);enqueue(s,'reindex');
}
export function answerDocument(text,title){const documentId=id('answer');return {id:documentId,kind:'answer',title,hash:'answer-'+documentId,segments:[{id:documentId+'.p1',text,locator:'user answer'}],selected:false,objectPath:null};}
export async function replayedAnswer(s,body){
  if(typeof body.text==='string'&&body.text.length>5000)throw new ProfileError('Keep your answer within 5,000 characters.');
  if(!body.submissionId)return null;
  if(typeof body.submissionId!=='string'||!/^[-a-zA-Z0-9_]{8,80}$/.test(body.submissionId))throw new ProfileError('Invalid answer submission ID.');
  const existing=s.answers.find(a=>a.submissionId===body.submissionId);
  if(!existing)return null;
  const hash=await digest(JSON.stringify([body.questionId,body.decision,body.capabilityDecision||'',clean(body.text,5000),body.reopen===true]));
  if(existing.submissionHash!==hash)throw new ProfileError('This submission ID belongs to a different answer.',409);
  return existing;
}
export async function addAnswer(s,body){
  const q=s.questions.find(q=>q.id===body.questionId);if(!q)throw new ProfileError('Question not found.',404);
  const replay=await replayedAnswer(s,body);if(replay)return replay;
  if(!['answered','declined','deferred','not_experienced'].includes(body.decision))throw new ProfileError('Invalid answer decision.');
  if(body.capabilityDecision&&!['yes','no','unsure'].includes(body.capabilityDecision))throw new ProfileError('Choose Yes, No or Not sure.');
  if(body.capabilityDecision==='yes'&&body.decision!=='answered')throw new ProfileError('Choose an answer for this confirmation.');
  if(body.capabilityDecision==='no'&&body.decision!=='not_experienced')throw new ProfileError('A No response cannot create experience facts.');
  const answer={id:id('answer'),questionId:q.id,key:q.key,scope:q.scope,status:body.decision,text:clean(body.text,5000),at:now()};
  if(body.capabilityDecision)answer.capabilityDecision=body.capabilityDecision;
  if(body.capabilityDecision==='yes'&&(!answer.text||/^(?:yes|y|confirmed|i can|i have|yes i can|yes i have)[.!\s]*$/i.test(answer.text)))answer.status='needs_details';
  if(body.submissionId){answer.submissionId=body.submissionId;answer.submissionHash=await digest(JSON.stringify([body.questionId,body.decision,body.capabilityDecision||'',answer.text,body.reopen===true]));}
  if(answer.status==='not_experienced'){
    const previousDocuments=new Set(s.answers.filter(a=>a.questionId===q.id&&a.documentId).map(a=>a.documentId));
    answer.consistencyFactRefs=currentFacts(s).filter(f=>f.approval==='approved'&&f.evidence.some(e=>previousDocuments.has(e.documentId))).map(f=>({id:f.id,version:f.version}));
    if(answer.consistencyFactRefs.length)answer.requiresConsistencyReview=true;
  }
  if(answer.status==='answered'&&!answer.text)throw new ProfileError('Enter your answer.');
  if(q.status==='declined'&&body.reopen!==true)throw new ProfileError('Explicitly reopen a declined question before answering it.',409);
  q.status=answer.status;s.answers.push(answer);
  if(answer.requiresConsistencyReview){
    let indexedRemoval=false;
    for(const ref of answer.consistencyFactRefs){
      const fact=s.facts.find(f=>f.id===ref.id&&f.version===ref.version);
      indexedRemoval||=!fact.conflict&&!['personal','preferences'].includes(fact.category);
      fact.conflict=true;fact.consistencyAnswerIds=[...new Set([...(fact.consistencyAnswerIds||[]),answer.id])];
      fact.consistencyNotes=[...(fact.consistencyNotes||[]),'A later No response to the same question contradicts this approved claim. Review the fact and the saved response.'];
      invalidate(s,fact.id);
    }
    if(indexedRemoval)enqueue(s,'reindex');
  }
  if(answer.status==='answered'){const document=answerDocument(answer.text,q.question);document.id=answer.id;document.segments[0].id=answer.id+'.p1';addDocument(s,document);answer.documentId=document.id;}
  invalidateRoleInputs(s);invalidateProfileSnapshots(s,'Questionnaire responses changed. Review and save the current profile again.');
  // Answers are not indexed evidence. A No that contradicts an approved fact
  // removes that fact from eligible evidence until the user resolves it.
  return answer;
}
function normalizedExperienceSubmission(body){
  if(typeof body.submissionId!=='string'||!/^[-a-zA-Z0-9_]{8,80}$/.test(body.submissionId))throw new ProfileError('Use a valid experience-review submission ID.');
  if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>200)throw new ProfileError('Select between 1 and 200 experience-review rows.');
  const seen=new Set(),rows=body.rows.map(row=>{
    if(!row||typeof row.questionId!=='string'||!row.questionId||row.questionId.length>500||typeof row.proposalFingerprint!=='string'||!row.proposalFingerprint||row.proposalFingerprint.length>100000||!['approve','decline','somewhat'].includes(row.decision))throw new ProfileError('An experience-review row is invalid.');
    if(seen.has(row.questionId))throw new ProfileError('Submit each experience-review row only once.');seen.add(row.questionId);
    if(row.text!=null&&typeof row.text!=='string'||typeof row.text==='string'&&row.text.length>1800)throw new ProfileError('Keep each exact experience statement within 1,800 characters.');
    return {questionId:row.questionId,proposalFingerprint:row.proposalFingerprint,decision:row.decision,text:typeof row.text==='string'?row.text.trim():'',reopen:row.reopen===true};
  });
  return {submissionId:body.submissionId,reopen:body.reopen===true,rows};
}
export async function replayedExperienceReview(s,body){
  const submission=normalizedExperienceSubmission(body),existing=(s.experienceReviews||[]).find(review=>review.submissionId===submission.submissionId);
  if(!existing)return null;
  if(existing.submissionHash!==await digest(canonicalJSON(submission)))throw new ProfileError('This submission ID belongs to a different experience review.',409);
  return structuredClone(existing.result);
}
const experienceClaimKey=value=>norm(value).replace(/[.!?]+$/,'');
function opposingExperience(a,b){
  const expanded=value=>norm(value).replace(/\b(?:don't|didn't|haven't|hasn't|cannot|can't)\b/g,'not').replace(/[^\p{L}\p{N}+# ]/gu,' ');
  const negative=value=>/\b(?:not|never|no)\b/.test(expanded(value));
  const assertion=value=>expanded(value).replace(/\b(?:i|we|do|did|have|has|had|not|never|no)\b/g,'').replace(/\s+/g,' ').trim();
  return negative(a)!==negative(b)&&assertion(a)&&assertion(a)===assertion(b);
}
function specificReviewStatement(value){return /[\p{L}\p{N}]/u.test(value)&&!/^(?:yes|no|confirmed|i can|i have|not sure|unknown|not provided|missing)[.!\s]*$/i.test(value)&&!/\bor\b/i.test(value);}
function performedReviewWork(value){return /^(?:(?:I|We)\s+)?(?:prepared|built|developed|performed|managed|led|supported|delivered|conducted|analysed|analyzed|reconciled|produced|reviewed|implemented|maintained|coordinated|executed|designed|assisted|wrote|created|tested|reported|used)\s+\S+/i.test(value);}
function credentialNameSpecific(value){
  if(!specificReviewStatement(value)||performedReviewWork(value)||/\b(?:equivalent|relevant|appropriate|professional|some|any)\s+(?:experience|background|knowledge|skills|work)\b/i.test(value))return false;
  const name=norm(value).replace(/[’']s\b/g,'').replace(/[.!?]+$/,'');
  return !/^(?:(?:i|have|hold|earned|completed|passed|a|an|the|relevant|professional|appropriate|required|equivalent|some|any|recognized|recognised|bachelor|bachelors|master|masters|undergraduate|graduate|degree|qualification|qualifications|certificate|certification|license|licence)\s*)+$/.test(name);
}
/** Apply explicit visible-row decisions without model rewriting or JD fact evidence. */
export async function applyExperienceReview(s,body,actor,{revision}={}){
  const replay=await replayedExperienceReview(s,body);if(replay)return replay;
  if(s.deletion)throw new ProfileError('Profile deletion is in progress.',409);
  const expected=body.expectedRevision??body.revision;
  if(Number.isInteger(revision)&&(!Number.isInteger(expected)||expected!==revision))throw new ProfileError('Your profile changed. Reload the experience review before submitting.',409);
  if(typeof actor!=='string'||!actor.trim())throw new ProfileError('An authenticated user must confirm experience.',403);
  const submission=normalizedExperienceSubmission(body),visible=buildExperienceReviewRows(s);
  const projected=Array.isArray(visible)?visible:visible.rows;
  if(!Array.isArray(projected))throw new ProfileError('The experience-review table is unavailable.',503);
  const selected=submission.rows.map(decision=>{
    const row=projected.find(item=>item.id===decision.questionId||item.questionId===decision.questionId);
    if(!row||row.fingerprint!==decision.proposalFingerprint)throw new ProfileError('An experience-review proposal changed. Reload the table before confirming it.',409);
    const previous=(s.experienceReviews||[]).flatMap(review=>review.rows||[]).findLast(item=>(item.experienceRowId||item.questionId)===(row.id||row.questionId));
    const declined=row.status==='declined'||previous?.status==='declined'||(row.parentQuestionIds||row.questionIds||[]).some(key=>s.questions.some(q=>q.id===key&&q.status==='declined'));
    if(declined&&decision.decision!=='decline'&&body.reopen!==true&&decision.reopen!==true)throw new ProfileError('Explicitly reopen a declined experience row before confirming it.',409);
    const proposed=typeof row.proposedStatement==='string'?row.proposedStatement.trim():'';
    if(!proposed||proposed.length>1800)throw new ProfileError('This proposal needs a bounded exact statement before confirmation.',409);
    if(decision.decision==='approve'&&decision.text&&decision.text!==proposed)throw new ProfileError('Approve confirms the exact visible proposal. Choose Somewhat to submit an edited subset.',409);
    if(decision.decision==='somewhat'&&(!decision.text||experienceClaimKey(decision.text)===experienceClaimKey(proposed)))throw new ProfileError('For Somewhat, edit the statement to the exact subset you have performed.');
    const requirementIds=[...new Set(row.requirementIds||[])];
    if(requirementIds.some(key=>!s.requirements.some(r=>r.id===key&&s.documents.some(d=>d.id===r.documentId&&!d.deleted&&d.kind==='jd'))))throw new ProfileError('A source job requirement changed. Reload the review.',409);
    return {decision,row,proposed,requirementIds};
  });
  const draft=structuredClone(s),reviewId=id('experience_review'),at=now(),outcomes=[];
  let document=null;
  for(const {decision,row,proposed,requirementIds} of selected){
    const rowId=row.id||row.questionId,text=decision.decision==='somewhat'?decision.text:proposed;
    const skillRow=row.kind==='skill'||row.category==='skills'&&row.destinationSection==='facts',qualificationRow=!skillRow&&(row.kind==='qualification'||row.destinationSection==='facts');
    const performedWorkAlternative=(qualificationRow||skillRow)&&decision.decision==='somewhat'&&performedReviewWork(text)&&specificReviewStatement(text),qualification=qualificationRow&&!performedWorkAlternative,skill=skillRow&&!performedWorkAlternative;
    const needsDetails=decision.decision!=='decline'&&(qualification?!credentialNameSpecific(text):row.kind==='ambiguous'||row.requiresDetails===true?decision.decision!=='somewhat'||!specificReviewStatement(text):!specificReviewStatement(text));
    const status=decision.decision==='decline'?'declined':needsDetails?'needs_details':'answered';
    let question=draft.questions.find(q=>q.id===rowId);
    if(!question){question={id:rowId,key:await digest(canonicalJSON(['experience_review',rowId])),question:proposed,capability:clean(row.capability||proposed,200),scope:clean(row.scope||'Self-confirmed capability',300),requirementId:requirementIds[0]||null,requirementIds,required:false,status:'unresolved',experienceRow:true,parentQuestionIds:[...new Set(row.parentQuestionIds||row.questionIds||[])],createdAt:at};draft.questions.push(question);}
    const proposalMetadata={proposedStatement:proposed,scope:question.scope,kind:row.kind||'experience',originalRequirementTexts:[...new Set((row.originalRequirementTexts||[]).map(value=>clean(value,1800)).filter(Boolean))].slice(0,30)};
    const answer={id:id('answer'),questionId:question.id,key:question.key,scope:question.scope,status,text:decision.decision==='decline'?'':text,at,experienceRowId:rowId,experienceDecision:decision.decision,proposalFingerprint:row.fingerprint,submissionId:submission.submissionId,originatingRequirements:requirementIds,...proposalMetadata};
    const outcome={questionId:rowId,experienceRowId:rowId,parentQuestionIds:[...new Set(row.parentQuestionIds||row.questionIds||[])],proposalFingerprint:row.fingerprint,decision:decision.decision,status:needsDetails?'needs_details':decision.decision==='decline'?'declined':decision.decision==='somewhat'?'somewhat':'approved',destinationSection:qualification||skill?'facts':'cumulativeExperience',statement:decision.decision==='decline'?null:text,requirementIds,factRefs:[],answerId:answer.id,...proposalMetadata};
    if(status==='answered'){
      const same=currentFacts(draft).filter(f=>(qualification?['education','certifications'].includes(f.category):skill?f.category==='skills':!['personal','preferences'].includes(f.category))&&experienceClaimKey(f.statement)===experienceClaimKey(text));
      const relevant=currentFacts(draft).filter(f=>!['personal','preferences'].includes(f.category)&&(same.includes(f)||opposingExperience(f.statement,text)||(f.originatingRequirements||[]).some(key=>requirementIds.includes(typeof key==='string'?key:key.id))));
      if(relevant.some(f=>f.conflict||opposingExperience(f.statement,text))||same.some(f=>['rejected','withdrawn'].includes(f.approval)))throw new ProfileError('This statement conflicts with an existing fact or saved decision. Resolve it before confirming the review.',409);
      const reused=same.find(f=>f.approval==='approved'&&!f.conflict);
      if(!document){const documentId=id('experience_source');document={id:documentId,kind:'answer',title:'User-confirmed experience review',hash:await digest(canonicalJSON(submission)),segments:[],selected:false,objectPath:null};addDocument(draft,document);document=draft.documents.at(-1);document.analysis='complete';document.confirmationActor=actor;document.experienceReviewId=reviewId;}
      const segment={id:document.id+'.p'+(document.segments.length+1),text,locator:'User confirmation for experience row '+rowId};document.segments.push(segment);answer.documentId=document.id;answer.sourceSegmentId=segment.id;outcome.sourceSegmentId=segment.id;
      if(reused){outcome.factRefs=[{id:reused.id,version:reused.version,approvalRef:reused.approvalRef}];outcome.reused=true;}
      else{
        const category=skill?'skills':qualification?/\b(?:bachelor|master|doctor|phd|b\.?sc|m\.?sc|mba|degree|diploma)\b/i.test(text)?'education':['education','certifications'].includes(row.category)?row.category:'certifications':'experience_claims',field=skill?['programming_languages','tools_technologies','other_skills'].includes(row.field)?row.field:'other_skills':qualification?'user_confirmed_qualification':'experience_review';
        const proposal={category,field,scope:qualification?'Self-confirmed qualification: '+text.slice(0,200):question.scope,statement:text,evidence:[{documentId:document.id,segmentId:segment.id,quote:text}]};
        const pending=same.find(f=>f.approval==='pending'&&norm(f.scope)===norm(question.scope)&&f.category===category);
        let fact=pending;
        if(fact)fact.evidence.push({documentId:document.id,documentVersion:document.version,segmentId:segment.id,quote:text});
        else{const added=await proposeFacts(draft,[proposal],'user_answer');fact=added[0];if(!fact)throw new ProfileError('A prior experience decision needs review before this statement can be saved.',409);}
        fact.originatingRequirements=[...new Set([...(fact.originatingRequirements||[]),...requirementIds])];fact.experienceReviewId=reviewId;fact.experienceRowId=rowId;fact.experienceDecision=decision.decision;
        decideFacts(draft,[{id:fact.id,version:fact.version,decision:'approved'}],actor);outcome.factRefs=[{id:fact.id,version:fact.version,approvalRef:fact.approvalRef}];
      }
      answer.confirmedFactRefs=structuredClone(outcome.factRefs);
    }
    question.status=status;question.experienceDecision=decision.decision;draft.answers.push(answer);outcomes.push(outcome);
  }
  const allPast=[...(draft.experienceReviews||[]).flatMap(review=>review.rows||[]),...outcomes],latestOutcome=rowId=>allPast.findLast(item=>(item.experienceRowId||item.questionId)===rowId);
  const parentIds=new Set(selected.flatMap(({row})=>row.parentQuestionIds||row.questionIds||[]));
  for(const parentId of parentIds){
    const parent=draft.questions.find(q=>q.id===parentId);if(!parent)continue;
    const siblings=projected.filter(row=>(row.parentQuestionIds||row.questionIds||[]).includes(parentId));
    const siblingIds=new Set([...siblings.map(row=>row.id||row.questionId),...allPast.filter(item=>item.parentQuestionIds?.includes(parentId)).map(item=>item.experienceRowId||item.questionId)]);
    const decisions=[...siblingIds].map(latestOutcome);
    parent.status=decisions.some(item=>!item)?'unresolved':decisions.some(item=>item.status==='needs_details')?'needs_details':decisions.every(item=>item.status==='declined')?'declined':'answered';
  }
  invalidateRoleInputs(draft);invalidateProfileSnapshots(draft,'Your inline experience decisions changed. Refresh the requirement comparison and save the consolidated profile.');
  const result={kind:'experience_review_saved',saved:true,reviewId,submissionId:submission.submissionId,rows:outcomes,approvedCount:outcomes.filter(row=>['approved','somewhat'].includes(row.status)).length,declinedCount:outcomes.filter(row=>row.status==='declined').length,needsDetailsCount:outcomes.filter(row=>row.status==='needs_details').length,reusedCount:outcomes.filter(row=>row.reused).length,requiresComparisonRefresh:selected.some(item=>item.requirementIds.length>0)};
  draft.experienceReviews||=[];draft.experienceReviews.push({id:reviewId,submissionId:submission.submissionId,submissionHash:await digest(canonicalJSON(submission)),actor,at,rows:structuredClone(outcomes),result:structuredClone(result)});
  Object.assign(s,draft);return result;
}
export async function addJDAnalysis(s,documentId,result){
  const doc=s.documents.find(d=>d.id===documentId&&d.kind==='jd'&&!d.deleted);if(!doc)throw new ProfileError('Job description not found.',404);
  if(!Array.isArray(result.requirements)||result.requirements.length>100)throw new ProfileError('Invalid JD analysis.',502);
  if(s.requirements.some(r=>r.documentId===doc.id))return;
  for(const r of result.requirements){
    if(!['skill','task','qualification','experience','sector','location'].includes(r.category))throw new ProfileError('Invalid JD requirement category.',502);
    const refs=evidence(s,r.evidence);if(refs.some(x=>x.documentId!==doc.id))throw new ProfileError('A JD requirement points outside its document.',502);
    s.requirements.push({id:id('req'),documentId:doc.id,category:r.category,text:clean(r.text,1600),importance:r.importance==='preferred'?'preferred':'required',evidence:refs,createdAt:now()});
  }
  doc.roleName=clean(result.roleName,140)||doc.title;doc.sector=clean(result.sector,140);doc.analysis='complete';enqueue(s,'reindex');
}
export async function buildProfiles(s,result,mode='jd'){
  if(mode==='analysis')return buildProfileAnalysis(s,result);
  if(!['resume','jd','guided'].includes(mode))throw new ProfileError('Choose profile analysis or legacy resume/JD role building.');
  if(mode==='resume'){
    const facts=approvedFacts(s).filter(f=>!['personal','preferences'].includes(f.category));
    if(!facts.length)throw new ProfileError('Approve resume experience, education or skills first.');
    if(!Array.isArray(result.profiles)||!result.profiles.length||result.profiles.length>12)throw new ProfileError('Builder returned no valid role profiles.',502);
    const created=result.profiles.map(p=>{
      if(!Array.isArray(p.factIds)||!p.factIds.length)throw new ProfileError('A resume role needs supporting approved facts.',502);
      const refs=[...new Set(p.factIds)].map(factId=>{const f=facts.find(f=>f.id===factId);if(!f)throw new ProfileError('Builder referenced a fact that is not approved.',502);return {id:f.id,version:f.version};});
      const profile={id:id('role'),version:1,basis:'resume',roleName:clean(p.roleName,140),alternativeTitles:roleAlternativeTitles(p.alternativeTitles),summary:clean(p.summary,1800),keywords:(p.keywords||[]).map(x=>clean(x,80)).slice(0,30),factRefs:refs,inputFactRefs:orderedRefs(professionalFacts(s)),inputAnswerRefs:answerRefs(s),mappings:[],jdIds:[],status:'proposed',approvalRef:null,createdAt:now()};
      if(!profile.roleName)throw new ProfileError('A role profile needs a name.',502);
      return profile;
    });
    s.roleProfiles.push(...created);await addBuilderQuestions(s,result.questions||[],[],created,true);
    s.builderReviews||=[];
    s.builderReviews.push({id:id('builder_review'),createdAt:now(),jdIds:[],factRefs:approvedFacts(s).map(f=>({id:f.id,version:f.version})),profileIds:created.map(p=>p.id),requirements:0,supported:0,missing:0,questionIds:s.questions.filter(q=>!q.requirementId&&!q.coveredByApprovedFacts).map(q=>q.id),unaskedRequirements:0});
    return created;
  }
  const selected=s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted);
  if(selected.length<(mode==='guided'?1:LIMITS.jdMin)||selected.length>LIMITS.jdMax)throw new ProfileError('Select 10–15 distinct JDs for initial role-profile building.');
  if(selected.some(d=>d.analysis!=='complete'))throw new ProfileError('Analyze each selected JD first.');
  if(!Array.isArray(result.profiles)||!result.profiles.length||result.profiles.length>12)throw new ProfileError('Builder returned no valid role profiles.',502);
  const facts=approvedFacts(s),requirements=s.requirements.filter(r=>selected.some(d=>d.id===r.documentId));
  const covered=new Set();
  for(const profile of result.profiles){
    const seen=new Set();
    for(const mapping of profile.mappings||[]){
      if(seen.has(mapping.requirementId))throw new ProfileError('Builder duplicated a requirement mapping.',502);
      seen.add(mapping.requirementId);covered.add(mapping.requirementId);
    }
  }
  if(requirements.some(r=>!covered.has(r.id)))throw new ProfileError('Builder omitted JD requirements. No partial role profiles were accepted.',502);
  const created=[];
  for(const p of result.profiles){
    const mappings=[];
    for(const m of p.mappings||[]){
      const req=requirements.find(r=>r.id===m.requirementId);if(!req)throw new ProfileError('Builder referenced an unknown requirement.',502);
      const refs=(m.factIds||[]).map(factId=>{const f=facts.find(f=>f.id===factId);if(!f)throw new ProfileError('Builder referenced a fact that is not approved.',502);return {id:f.id,version:f.version};});
      mappings.push({requirementId:req.id,factRefs:refs,assessment:refs.length?'candidate_support':'not_established',explanation:clean(m.explanation,1200)});
    }
    const refs=Array.from(new Map(mappings.flatMap(m=>m.factRefs).map(r=>[r.id+':'+r.version,r])).values());
    const profile={id:id('role'),version:1,basis:mode==='guided'?'guided':'jd',roleName:clean(p.roleName,140),alternativeTitles:roleAlternativeTitles(p.alternativeTitles),summary:clean(p.summary,1800),keywords:(p.keywords||[]).map(x=>clean(x,80)).slice(0,30),factRefs:refs,inputFactRefs:orderedRefs(professionalFacts(s)),inputAnswerRefs:answerRefs(s),mappings,jdIds:selected.map(d=>d.id),status:'proposed',approvalRef:null,createdAt:now()};
    if(!profile.roleName)throw new ProfileError('A role profile needs a name.',502);
    // An unsupported JD role is useful for gap questions, but it cannot be
    // approved or activated: approveRole still requires approved fact refs.
    profile.classification=!refs.length?'not_currently_supported':mappings.some(m=>!m.factRefs.length&&requirements.find(r=>r.id===m.requirementId)?.importance==='required')?'potential_match':'strong_match';
    s.roleProfiles.push(profile);created.push(profile);
  }
  await addBuilderQuestions(s,result.questions||[],requirements,created);
  const supported=new Set(created.flatMap(p=>p.mappings.filter(m=>m.factRefs.length).map(m=>m.requirementId)));
  const gaps=requirements.filter(r=>!supported.has(r.id)&&r.category!=='location');
  const askedRequirements=()=>new Set(s.questions.flatMap(q=>q.requirementIds||[q.requirementId]).filter(Boolean));
  // The model cannot silently omit the interview when evidence is missing.
  // Group identical capabilities across JDs and preserve previous decisions.
  const groups=new Map();
  for(const requirement of gaps.filter(r=>!askedRequirements().has(r.id))){
    const key=canonicalTopic(requirement.text);const group=groups.get(key)||[];group.push(requirement);groups.set(key,group);
  }
  let remaining=30;
  for(const group of [...groups.values()].sort((a,b)=>(b.some(r=>r.importance==='required')-a.some(r=>r.importance==='required'))||b.length-a.length)){
    if(!remaining--)break;
    const requirement=group[0];
    await addBuilderQuestions(s,[{requirementId:requirement.id,requirementIds:group.map(r=>r.id),capability:requirement.text,scope:'Across selected job descriptions',question:'Do you have experience or qualifications that meet this requirement: '+requirement.text+'? If yes, describe where, when and what you did.',required:group.some(r=>r.importance==='required'),generatedFromGap:true}],requirements,created);
  }
  const selectedIds=selected.map(d=>d.id),requirementIds=new Set(requirements.map(r=>r.id));
  const relevant=s.questions.filter(q=>(q.requirementIds||[q.requirementId]).some(key=>requirementIds.has(key)));
  for(const question of relevant)question.coveredByApprovedFacts=(question.requirementIds||[question.requirementId]).filter(key=>requirementIds.has(key)).every(key=>supported.has(key));
  const interview=relevant.filter(q=>!q.coveredByApprovedFacts);
  for(const question of interview){
    const refs=requirements.filter(r=>(question.requirementIds||[question.requirementId]).includes(r.id));
    question.priority=refs.some(r=>r.importance==='required')?'required':'preferred';
    question.jdCount=new Set(refs.map(r=>r.documentId)).size;
  }
  s.builderReviews||=[];
  for(const profile of created)if(profile.classification==='potential_match'&&profile.mappings.some(m=>!m.factRefs.length&&s.questions.some(q=>q.status==='not_experienced'&&(q.requirementIds||[q.requirementId]).includes(m.requirementId))))profile.classification='development_opportunity';
  s.builderReviews.push({id:id('builder_review'),createdAt:now(),jdIds:selectedIds,factRefs:facts.map(f=>({id:f.id,version:f.version})),profileIds:created.map(p=>p.id),requirements:requirements.length,supported:supported.size,missing:gaps.length,questionIds:interview.map(q=>q.id),unaskedRequirements:gaps.filter(r=>!askedRequirements().has(r.id)).length});
  return created;
}
function selectedDocuments(s){return s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted);}
function documentRefs(documents){return documents.map(d=>({id:d.id,version:d.version,hash:d.hash||null,analysis:d.analysis})).sort((a,b)=>a.id.localeCompare(b.id));}
function reviewInputsCurrent(s,review){
  if(!review||canonicalJSON([...(review.jdIds||[])].sort())!==canonicalJSON(selectedDocuments(s).map(d=>d.id).sort()))return false;
  const basis=review.inputFactRefs||review.factRefs?.filter(ref=>s.facts.some(f=>f.id===ref.id&&f.version===ref.version&&!['personal','preferences'].includes(f.category)));
  if(!basis||!sameRefs(basis.map(({id,version})=>({id,version})),professionalFacts(s).map(({id,version})=>({id,version}))))return false;
  if(basis.some(ref=>ref.approvalRef&&professionalFacts(s).find(f=>f.id===ref.id&&f.version===ref.version)?.approvalRef!==ref.approvalRef))return false;
  if(review.documentRefs&&canonicalJSON(review.documentRefs)!==canonicalJSON(documentRefs(selectedDocuments(s))))return false;
  if(review.inputAnswerRefs)return canonicalJSON(review.inputAnswerRefs)===canonicalJSON(answerRefs(s));
  const reviewedAt=Date.parse(review.createdAt);return latestAnswers(s).every(a=>Number.isFinite(reviewedAt)&&Number.isFinite(Date.parse(a.at))&&Date.parse(a.at)<=reviewedAt);
}
function currentBuilderReview(s,scope){
  const scoped=scope?.documentIds?{...s,documents:s.documents.map(d=>({...d,selected:d.kind==='jd'&&scope.documentIds.includes(d.id)}))}:s;
  return [...(s.builderReviews||[])].reverse().find(review=>reviewInputsCurrent(scoped,review));
}
export function builderReviewCurrentForDocument(s,review,documentId){
  if(!review?.jdIds?.includes(documentId))return false;
  const scoped={...s,documents:s.documents.map(d=>({...d,selected:d.kind==='jd'&&review.jdIds.includes(d.id)}))};
  return reviewInputsCurrent(scoped,review);
}
function reviewMappings(s,review){
  if(Array.isArray(review?.mappings))return review.mappings;
  const roleIds=new Set(review?.profileIds||[]),byRequirement=new Map();
  for(const role of s.roleProfiles.filter(p=>roleIds.has(p.id)))for(const mapping of role.mappings||[]){
    const prior=byRequirement.get(mapping.requirementId);
    if(!prior)byRequirement.set(mapping.requirementId,structuredClone(mapping));
    else prior.factRefs=[...new Map([...prior.factRefs,...mapping.factRefs].map(ref=>[ref.id+':'+ref.version,ref])).values()];
  }
  return [...byRequirement.values()];
}
function mappingSupported(mapping){return mapping.factRefs?.length>0&&mapping.evidenceStatus!=='partial'&&mapping.evidenceStatus!=='not_established'&&mapping.assessment!=='partial_support'&&mapping.assessment!=='not_established';}
async function buildProfileAnalysis(s,result){
  const selected=selectedDocuments(s),facts=professionalFacts(s);
  if(selected.length>LIMITS.jdMax)throw new ProfileError('Use at most 15 selected job descriptions.');
  if(selected.some(d=>d.analysis!=='complete'))throw new ProfileError('Analyze each selected JD before comparing its requirements.');
  if(!facts.length)throw new ProfileError('Approve your professional experience, education or skills first.');
  const requirements=s.requirements.filter(r=>selected.some(d=>d.id===r.documentId));
  const proposed=Array.isArray(result.mappings)?result.mappings:result.assessments&&typeof result.assessments==='object'&&!Array.isArray(result.assessments)?Object.entries(result.assessments).map(([requirementId,value])=>({requirementId,...value})):[];
  if(!Array.isArray(result.questions)||proposed.length!==requirements.length)throw new ProfileError('Profile Builder must assess every selected JD requirement. No partial comparison was accepted.',502);
  const seen=new Set(),mappings=proposed.map(mapping=>{
    if(seen.has(mapping.requirementId)||!requirements.some(r=>r.id===mapping.requirementId)||!Array.isArray(mapping.factIds))throw new ProfileError('Profile Builder returned invalid or duplicate requirement mappings.',502);
    seen.add(mapping.requirementId);
    const refs=[...new Set(mapping.factIds)].map(factId=>{const fact=facts.find(f=>f.id===factId);if(!fact)throw new ProfileError('A requirement assessment referenced a fact outside the approved professional profile.',502);return {id:fact.id,version:fact.version};});
    const requirement=requirements.find(r=>r.id===mapping.requirementId),source=[requirement.text,...requirement.evidence.map(ref=>ref.quote)];
    const metadata={};for(const name of ['missingScope','proposedStatement'])if(typeof mapping[name]==='string'&&mapping[name].trim()){const value=mapping[name].trim();if(value.length>1800||!source.some(text=>text.includes(value)))throw new ProfileError('A proposed experience statement must match its job-description requirement.',502);metadata[name]=value;}
    const incoming=mapping.evidenceStatus||mapping.assessment||'';
    if(incoming&&!['supported','partial','partial_support','not_established','missing','unassessed','candidate_support'].includes(incoming))throw new ProfileError('Profile Builder returned an unknown evidence status.',502);
    const evidenceStatus=['not_established','missing','unassessed'].includes(incoming)?'not_established':['partial','partial_support'].includes(incoming)?'partial':metadata.missingScope?refs.length?'partial':'not_established':refs.length?'supported':'not_established';
    if(incoming==='supported'&&(!refs.length||metadata.missingScope))throw new ProfileError('A supported requirement needs approved evidence and no missing scope.',502);
    if(evidenceStatus==='partial'&&(!refs.length||!metadata.missingScope))throw new ProfileError('A partial requirement must identify its exact unsupported scope before review.',502);
    return {requirementId:mapping.requirementId,factRefs:refs,evidenceStatus,assessment:refs.length&&evidenceStatus==='supported'?'candidate_support':refs.length&&evidenceStatus==='partial'?'partial_support':'not_established',...metadata,explanation:clean(mapping.explanation,1400)};
  });
  // This carrier is only an argument to the existing question filter. It is
  // never persisted as a generated role, title or user qualification.
  const carrier=[{mappings}];await addBuilderQuestions(s,result.questions,requirements,carrier,!selected.length);
  const supported=new Set(mappings.filter(mappingSupported).map(m=>m.requirementId)),gaps=requirements.filter(r=>!supported.has(r.id)&&r.category!=='location');
  const asked=()=>new Set(s.questions.flatMap(q=>q.requirementIds||[q.requirementId]).filter(Boolean));
  const groups=new Map();for(const requirement of gaps.filter(r=>!asked().has(r.id))){const key=canonicalTopic(requirement.text),group=groups.get(key)||[];group.push(requirement);groups.set(key,group);}
  for(const group of [...groups.values()].sort((a,b)=>Number(b.some(r=>r.importance==='required'))-Number(a.some(r=>r.importance==='required'))||b.length-a.length).slice(0,30)){
    const requirement=group[0];await addBuilderQuestions(s,[{requirementId:requirement.id,requirementIds:group.map(r=>r.id),capability:requirement.text,scope:'Across selected job descriptions',question:'Do you have experience or qualifications that meet this requirement: '+requirement.text+'? If yes, describe where, when and what you did.',required:group.some(r=>r.importance==='required'),generatedFromGap:true}],requirements,carrier);
  }
  const relevant=s.questions.filter(q=>!q.requirementId&&!(q.requirementIds?.length)||(q.requirementIds||[q.requirementId]).some(key=>requirements.some(r=>r.id===key)));
  for(const question of relevant){
    const refs=requirements.filter(r=>(question.requirementIds||[question.requirementId]).includes(r.id));
    question.coveredByApprovedFacts=refs.length>0&&refs.every(r=>supported.has(r.id));question.priority=refs.some(r=>r.importance==='required')?'required':'preferred';question.jdCount=new Set(refs.map(r=>r.documentId)).size;
  }
  s.builderReviews||=[];s.builderReviews.push({id:id('builder_review'),basis:'analysis',createdAt:now(),jdIds:selected.map(d=>d.id),documentRefs:documentRefs(selected),factRefs:approvedFacts(s).map(f=>({id:f.id,version:f.version})),inputFactRefs:orderedRefs(facts),inputAnswerRefs:answerRefs(s),profileIds:[],mappings,requirements:requirements.length,supported:supported.size,missing:gaps.length,questionIds:relevant.filter(q=>!q.coveredByApprovedFacts).map(q=>q.id),unaskedRequirements:gaps.filter(r=>!asked().has(r.id)).length});
  invalidateProfileSnapshots(s,'The validated requirement comparison changed. Review and save the consolidated profile again.');return [];
}
async function addBuilderQuestions(s,questions,requirements,created,resumeOnly=false){
  for(const q of questions.slice(0,30)){
    const ids=[...new Set([q.requirementId,...(q.requirementIds||[])].filter(Boolean))];
    if(!resumeOnly&&ids.some(key=>!requirements.some(r=>r.id===key)))throw new ProfileError('A question referenced an unknown JD requirement.',502);
    const missing=ids.filter(key=>!created.some(p=>p.mappings.some(m=>m.requirementId===key&&mappingSupported(m))));
    const requirement=requirements.find(r=>r.id===(missing[0]||q.requirementId));
    if(!resumeOnly&&!requirement)throw new ProfileError('A proposed question must identify an existing unmet requirement.',502);
    if(!resumeOnly&&!missing.length)continue;
    const question=clean(q.question,1000),scope=clean(q.scope,300),topic=canonicalTopic(clean(q.capability,200)),key=await digest(JSON.stringify([topic,norm(scope)]));
    const prior=s.questions.find(x=>x.key===key||(canonicalTopic(x.capability)===topic&&(x.status==='declined'||norm(x.scope)===norm(scope))));
    const suppressed=(s.preferences.disclosure||[]).some(text=>topicOverlap(text,q.capability+' '+question));
    if(prior){prior.requirementIds=[...new Set([...(prior.requirementIds||[prior.requirementId]),...missing].filter(Boolean))];continue;}
    if(!question||!q.capability||suppressed||s.answers.some(a=>a.key===key))continue;
    const existingRequirements=new Set(s.questions.flatMap(x=>x.requirementIds||[x.requirementId]).filter(Boolean));
    const newMissing=missing.filter(key=>!existingRequirements.has(key));
    if(!resumeOnly&&!newMissing.length)continue;
    if(s.questions.length>=LIMITS.questions)break;
    s.questions.push({id:id('question'),key,topic,requirementId:newMissing[0]||requirement?.id||null,requirementIds:newMissing,capability:clean(q.capability,200),scope,question,status:'unresolved',required:!resumeOnly&&q.required===true,generatedFromGap:q.generatedFromGap===true,createdAt:now()});
  }
}
function canonicalTopic(text){
  return norm(text).replace(/\b(?:projects?|pipelines?|automations?|implementations?|dashboards?|build|built|developed)\b/g,'implementation')
    .replace(/\b(?:institutions?|institutional|customers?)\b/g,'client').replace(/\b(?:experience|details|examples|technical|with|using|and|the|a|your)\b/g,'')
    .split(/\W+/).filter(Boolean).filter((word,i,all)=>all.indexOf(word)===i).sort().join(' ');
}
function topicOverlap(a,b){
  const left=canonicalTopic(a).split(' ').filter(Boolean),right=new Set(canonicalTopic(b).split(' ').filter(Boolean));
  return left.length>0&&left.filter(word=>right.has(word)).length/left.length>=.6;
}
function approvedRolesForSelection(s){
  const selected=s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted),selectedIds=selected.map(d=>d.id).sort();
  return s.roleProfiles.filter(p=>p.status==='approved'&&!roleNeedsRebuild(s,p)&&(p.basis==='resume'||(selected.length>=(p.basis==='guided'?1:10)&&selected.length<=15&&JSON.stringify([...p.jdIds].sort())===JSON.stringify(selectedIds)))&&p.factRefs.every(r=>approvedFacts(s).some(f=>f.id===r.id&&f.version===r.version)));
}
function frozenReviewScope(s){
  const selected=new Set(s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted).map(d=>d.id));
  const requirementIds=s.requirements.filter(r=>selected.has(r.documentId)).map(r=>r.id).sort();
  const questionIds=s.questions.filter(q=>!(q.requirementIds?.length||q.requirementId)||(q.requirementIds||[q.requirementId]).some(key=>requirementIds.includes(key))).map(q=>q.id).sort();
  return {documentIds:[...selected].sort(),requirementIds,questionIds,answerRefs:answerRefs(s).filter(a=>questionIds.includes(a.questionId)),assessments:reviewMappings(s,currentBuilderReview(s)).filter(mapping=>requirementIds.includes(mapping.requirementId)).sort((a,b)=>a.requirementId.localeCompare(b.requirementId))};
}
function searchPreferences(s){
  const p=s.preferences.search||{};
  return {goals:clean(p.goals,1500),location:clean(p.location,600),arrangement:p.arrangement||'any',employment:p.employment||'any',seniority:p.seniority||'any',preferSponsorship:p.preferSponsorship===true};
}
function disclosurePreferences(s){return [...new Set((s.preferences.disclosure||[]).map(value=>clean(value,300)).filter(Boolean))].sort();}
function reviewFingerprint(s,scope,validatedSearchProfile){
  const basis={factApprovals:orderedRefs(approvedFacts(s)),answers:answerRefs(s),searchPreferences:searchPreferences(s),disclosurePreferences:disclosurePreferences(s),reviewScope:scope};
  if(validatedSearchProfile){
    basis.validatedSearchProfile={...validatedSearchProfile,version:null,asOf:null};
    basis.documents=(scope.documentIds||[]).map(documentId=>{const doc=s.documents.find(d=>d.id===documentId&&!d.deleted);return doc?{id:doc.id,version:doc.version,hash:doc.hash||null,roleName:doc.roleName||null,analysis:doc.analysis}:null;});
    basis.requirements=(scope.requirementIds||[]).map(requirementId=>s.requirements.find(r=>r.id===requirementId)||null);
    basis.assessments=reviewMappings(s,currentBuilderReview(s,scope)).filter(mapping=>(scope.requirementIds||[]).includes(mapping.requirementId)).sort((a,b)=>a.requirementId.localeCompare(b.requirementId));
  }else basis.roleApprovals=orderedRefs(s.roleProfiles.filter(p=>p.status==='approved'));
  return canonicalJSON(basis);
}
function matchingReviewFingerprint(stored,current){try{return typeof stored==='string'&&canonicalJSON(JSON.parse(stored))===current;}catch{return false;}}
export function finalizationReadiness(s){
  const blockers=[],latest=latestAnswers(s);
  for(const document of s.documents.filter(d=>!d.deleted&&['resume','answer'].includes(d.kind))){
    const coverage=document.coverage,knownOmissions=document.analysis==='incomplete'||coverage?.unreviewedPassages?.length>0||coverage&&!Object.hasOwn(coverage,'unreviewedPassages')&&!Object.hasOwn(coverage,'passageReview')&&coverage.unreferencedPassages?.length>0;
    if(knownOmissions)blockers.push({code:'source_review_incomplete',message:'Re-read this source with Fact Agent so every passage is extracted or explicitly accounted for before saving the complete profile.',documentId:document.id});
  }
  for(const answer of latest){
    if(answer.status==='needs_details')blockers.push({code:'answer_details_required',message:'Add details to your saved Yes response, or explicitly defer or decline it.',questionId:answer.questionId});
    if(answer.status==='answered'){
      const document=s.documents.find(d=>d.id===answer.documentId&&!d.deleted&&d.kind==='answer');
      if(!document||document.analysis!=='complete')blockers.push({code:'answer_extraction_pending',message:'Extract facts from your saved questionnaire answer before saving the complete profile.',questionId:answer.questionId,...(answer.documentId?{documentId:answer.documentId}:{})});
    }
  }
  const pending=currentFacts(s).filter(f=>f.origin==='user_answer'&&f.approval==='pending');
  if(pending.length)blockers.push({code:'answer_facts_pending',message:'Review the facts extracted from your answers. Approve, reject or correct each pending fact before saving the complete profile.',factIds:pending.map(f=>f.id)});
  const conflicts=currentFacts(s).filter(f=>f.conflict&&!['rejected','withdrawn'].includes(f.approval));
  if(conflicts.length)blockers.push({code:'facts_conflicting',message:'Resolve conflicting facts and questionnaire responses before saving the complete profile.',factIds:conflicts.map(f=>f.id)});
  const scope=frozenReviewScope(s),reviewRows=buildExperienceReviewRows(s);
  for(const question of s.questions.filter(q=>scope.questionIds.includes(q.id)&&q.required&&q.status==='unresolved')){
    const requirementIds=(question.requirementIds?.length?question.requirementIds:[question.requirementId]).filter(Boolean);
    const pendingVisible=requirementIds.length?reviewRows.some(row=>['pending','unresolved','needs_details'].includes(row.status||'pending')&&(row.priority==='required'||!row.priority)&&((row.parentQuestionIds||row.questionIds||[]).includes(question.id)||(row.requirementIds||[]).some(key=>requirementIds.includes(key)))):!question.coveredByApprovedFacts;
    if(pendingVisible)blockers.push({code:'question_response_required',message:requirementIds.length?'Review this required item in the experience table, or explicitly decline it to preserve the gap.':'Answer this required question, or explicitly defer or decline it to preserve the gap.',questionId:question.id});
  }
  const selected=selectedDocuments(s),review=currentBuilderReview(s),requirements=s.requirements.filter(r=>selected.some(d=>d.id===r.documentId));
  for(const document of selected.filter(d=>d.analysis!=='complete'||d.sourceFilteringVersion!==1&&canonicalJSON(primaryJDSegments(d.segments))!==canonicalJSON(d.segments)))blockers.push({code:'selected_jd_analysis_pending',message:'Analyze each selected job description from its original employer content before saving the validated profile.',documentId:document.id});
  if(requirements.length&&(!review||review.unassessedRequirementIds?.length||requirements.some(r=>!reviewMappings(s,review).some(mapping=>mapping.requirementId===r.id))))blockers.push({code:'builder_comparison_required',message:'Compare all selected JD requirements with the current approved facts and questionnaire responses before saving the consolidated profile.'});
  const profiles=approvedRolesForSelection(s);
  if(!approvedFacts(s).length)blockers.push({code:'facts_approval_required',message:'Approve profile facts first.'});
  return {ready:blockers.length===0,blockers,pendingAnswerCount:latest.filter(a=>a.status==='needs_details'||a.status==='answered'&&s.documents.find(d=>d.id===a.documentId&&!d.deleted)?.analysis!=='complete').length,pendingFactCount:pending.length,currentRoleCount:profiles.length};
}
export function approveRole(s,profileId,actor){
  const p=s.roleProfiles.find(p=>p.id===profileId);if(!p)throw new ProfileError('Role profile not found.',404);
  if(roleNeedsRebuild(s,p))throw new ProfileError('Profile facts or questionnaire responses changed. Rebuild this role profile before approving it.',409);
  if(p.status==='approved')return;
  if(!p.factRefs.length||p.factRefs.some(r=>!approvedFacts(s).some(f=>f.id===r.id&&f.version===r.version)))throw new ProfileError('Supporting facts changed. Rebuild this role profile.',409);
  const selected=s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted).map(d=>d.id).sort();
  if(p.basis!=='resume'&&(p.jdIds.length<(p.basis==='guided'?1:10)||JSON.stringify([...p.jdIds].sort())!==JSON.stringify(selected)))throw new ProfileError('The selected JD set changed. Rebuild the proposed profile.',409);
  const a={id:id('approval'),kind:'role',recordId:p.id,recordVersion:p.version,actor,decision:'approved',at:now()};s.approvals.push(a);p.status='approved';p.approvalRef=a.id;
  for(const snapshot of s.snapshots.filter(item=>!item.searchProfile)){snapshot.stale=true;snapshot.staleReason='Legacy role approvals changed. Review and save the current profile again.';}
  enqueue(s,'reindex');
}
export function finalize(s,actor){
  const readiness=finalizationReadiness(s);if(!readiness.ready)throw new ProfileError(readiness.blockers[0].message,409);
  const profiles=approvedRolesForSelection(s),facts=approvedFacts(s);
  const last=s.snapshots.at(-1),factRefs=orderedRefs(facts.map(f=>({id:f.id,version:f.version}))),profileRefs=orderedRefs(profiles.map(p=>({id:p.id,version:p.version}))),scope=frozenReviewScope(s),searchProfile=buildValidatedSearchProfile(s,{snapshot:{factRefs,reviewScope:scope}}),fingerprint=reviewFingerprint(s,scope,searchProfile);
  if(last&&!last.stale&&sameRefs(last.factRefs,factRefs)&&(last.searchProfile||sameRefs(last.profileRefs,profileRefs))&&matchingReviewFingerprint(last.reviewFingerprint,fingerprint))return last;
  const snapshot={id:id('snapshot'),version:'profile-'+(s.snapshots.length+1),profileBasis:'validated_source_data',factRefs,profileRefs,searchPreferences:searchPreferences(s),disclosurePreferences:disclosurePreferences(s),reviewScope:scope,reviewFingerprint:fingerprint,approvalRef:id('approval'),actor,createdAt:now(),stale:false};
  snapshot.searchProfile={...searchProfile,version:snapshot.version};
  s.approvals.push({id:snapshot.approvalRef,kind:'snapshot',recordId:snapshot.id,recordVersion:snapshot.version,actor,decision:'approved',at:snapshot.createdAt});
  s.snapshots.push(snapshot);enqueue(s,'reindex');return snapshot;
}
export function savedPacket(s,version){
  if(s.deletion)throw new ProfileError('Profile deletion is pending.',409);
  const snapshot=version?s.snapshots.find(x=>x.version===version):s.snapshots.at(-1);
  if(!snapshot||snapshot.stale)throw new ProfileError('Finalize a current approved profile before applying.',409);
  if(snapshot.reviewFingerprint){
    const searchProfile=snapshot.searchProfile?buildValidatedSearchProfile(s,{snapshot}):null;
    if(!matchingReviewFingerprint(snapshot.reviewFingerprint,reviewFingerprint(s,snapshot.reviewScope,searchProfile)))throw new ProfileError('The approved profile no longer includes the current facts, answers, validated search sources or preferences. Review and save it again.',409);
  }else{
    const latest=latestAnswers(s),savedAt=Date.parse(snapshot.createdAt),extraRoles=s.roleProfiles.filter(p=>p.status==='approved'&&!snapshot.profileRefs.some(ref=>ref.id===p.id&&ref.version===p.version));
    if(!sameRefs(snapshot.factRefs,approvedFacts(s).map(f=>({id:f.id,version:f.version})))||canonicalJSON(searchPreferences(s))!==canonicalJSON(searchPreferences({preferences:{}}))||disclosurePreferences(s).length||latest.some(a=>!Number.isFinite(savedAt)||!Number.isFinite(Date.parse(a.at))||Date.parse(a.at)>savedAt)||extraRoles.some(p=>{const approval=s.approvals.find(a=>a.id===p.approvalRef);return !Number.isFinite(savedAt)||!Number.isFinite(Date.parse(approval?.at))||Date.parse(approval.at)>savedAt;}))throw new ProfileError('Review and save this legacy profile to include the current facts, answers, roles and preferences.',409);
  }
  const unfinished=finalizationReadiness(s).blockers.find(b=>['answer_details_required','answer_extraction_pending','answer_facts_pending','facts_conflicting'].includes(b.code));
  if(unfinished)throw new ProfileError(unfinished.message,409);
  const facts=snapshot.factRefs.map(r=>approvedFacts(s).find(f=>f.id===r.id&&f.version===r.version));
  if(facts.some(f=>!f))throw new ProfileError('An approved fact changed. Review the affected profile.',409);
  const profiles=snapshot.profileRefs.map(r=>s.roleProfiles.find(p=>p.id===r.id&&p.version===r.version&&p.status==='approved'));
  if(!snapshot.searchProfile&&profiles.some(p=>!p))throw new ProfileError('A legacy role profile needs review.',409);
  return {facts:{approvalStatus:'approved',version:snapshot.version,approvalRef:snapshot.approvalRef,evidenceRefs:[...new Set(facts.flatMap(f=>f.evidence.map(e=>e.segmentId)))],records:facts},roleProfiles:profiles.filter(Boolean).map(p=>({...p,supportedTasks:(p.mappings||[]).filter(m=>m.factRefs.length)})),searchProfile:snapshot.searchProfile||null,snapshot};
}
export function enqueue(s,kind){
  if(!s.outbox.some(e=>e.kind===kind&&e.status==='pending'))s.outbox.push({id:id('event'),kind,status:'pending',attempts:0,createdAt:now()});
}
export function chunks(s){
  // Only approved claims and separately labelled JD requirements are embedded.
  // Raw documents remain fully available to extraction, without contact indexing.
  const out=[];
  for(const f of approvedFacts(s).filter(f=>!['personal','preferences'].includes(f.category))){
    out.push({id:f.id+'.v'+f.version,text:clean(f.scope+' | '+f.statement,7000),record_type:'approved_fact',record_id:f.id,record_version:f.version,document_id:f.evidence[0]?.documentId||'',approval_ref:f.approvalRef,source_ids:f.evidence.slice(0,8).map(e=>e.segmentId)});
  }
  for(const r of s.requirements.filter(r=>s.documents.some(d=>d.id===r.documentId&&!d.deleted))){
    const d=s.documents.find(d=>d.id===r.documentId);
    out.push({id:r.id,text:clean((d.roleName||d.title)+' | '+r.importance+' | '+r.text,7000),record_type:'jd_requirement',record_id:r.id,record_version:1,document_id:d.id,approval_ref:'not_user_experience',source_ids:r.evidence.map(e=>e.segmentId)});
  }
  return out;
}
export function hybridResults(s,query,semanticHits=[],kind='approved_fact'){
  const candidates=chunks(s).filter(c=>c.record_type===kind),terms=norm(query).match(/[a-z0-9+#.]{2,}/g)||[];
  const lexical=candidates.map(c=>{const tokens=new Set(norm(c.text).match(/[a-z0-9+#.]{2,}/g)||[]);return {c,score:terms.reduce((n,t)=>n+(tokens.has(t)?1:0),0)};}).filter(x=>x.score).sort((a,b)=>b.score-a.score).slice(0,20).map(x=>x.c.id);
  const valid=new Map(candidates.map(c=>[c.id,c])),scores=new Map();
  for(const list of [lexical,semanticHits.map(h=>h._id||h.id)])list.forEach((key,i)=>{if(valid.has(key))scores.set(key,(scores.get(key)||0)+1/(60+i+1));});
  return [...scores].sort((a,b)=>b[1]-a[1]).slice(0,12).map(([key,score])=>({...valid.get(key),retrievalScore:score,meaning:'Related evidence; not a qualification or ATS score'}));
}
export function removeDocument(s,documentId){
  const doc=s.documents.find(d=>d.id===documentId&&!d.deleted);if(!doc)throw new ProfileError('Document not found.',404);
  doc.deleted=true;doc.selected=false;
  for(const f of currentFacts(s).filter(f=>f.evidence.some(e=>e.documentId===doc.id))){
    f.withdrawnEvidence=[...(f.withdrawnEvidence||[]),...f.evidence.filter(e=>e.documentId===doc.id)];
    f.evidence=f.evidence.filter(e=>e.documentId!==doc.id);
    if(!f.evidence.length){f.lifecycle='withdrawn';invalidate(s,f.id);}
  }
  for(const p of s.roleProfiles.filter(p=>p.jdIds.includes(doc.id))){
    p.status='needs_review';
    for(const snapshot of s.snapshots)if(snapshot.profileRefs.some(r=>r.id===p.id))snapshot.stale=true;
  }
  refreshAnswerConsistency(s);enqueue(s,'reindex');if(doc.objectPath)enqueue(s,'delete-file:'+doc.objectPath);
}
