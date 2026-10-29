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
export async function proposeFacts(s,proposals,origin='resume'){
  if(!Array.isArray(proposals)||proposals.length>200)throw new ProfileError('Fact extraction returned an invalid batch.',502);
  const added=[];
  for(const p of proposals){
    if(!CATEGORIES.includes(p.category))throw new ProfileError('Fact extraction returned an unknown category.',502);
    const statement=clean(p.statement,1800),scope=clean(p.scope,300),field=clean(p.field,100);
    if(!statement||!field)throw new ProfileError('An extracted fact is incomplete.',502);
    const refs=evidence(s,p.evidence);
    if(refs.some(r=>s.documents.find(d=>d.id===r.documentId)?.kind==='jd'))throw new ProfileError('A job description cannot establish user experience.',502);
    const fingerprint=await digest(JSON.stringify([p.category,norm(field),norm(scope),norm(statement)]));
    const existing=currentFacts(s).find(f=>f.fingerprint===fingerprint);
    if(existing){for(const ref of refs)if(!existing.evidence.some(e=>e.documentId===ref.documentId&&e.segmentId===ref.segmentId&&e.quote===ref.quote))existing.evidence.push(ref);continue;}
    if(s.facts.length>=LIMITS.facts)throw new ProfileError('Fact history limit reached. Export before continuing.',409);
    // Different values for the same exact scoped field need a user's decision.
    // Free-form experience statements are separate assertions, not contradictions.
    const conflict= !['experience_claims','skills','preferences'].includes(p.category)
      ?currentFacts(s).filter(f=>f.category===p.category&&norm(f.field)===norm(field)&&norm(f.scope)===norm(scope)).map(f=>f.id):[];
    const fact={id:id('fact'),version:1,category:p.category,field,scope,statement,rawValue:refs.map(r=>r.quote).join('\n'),fingerprint,evidence:refs,origin,confirmation:origin==='user_answer'?'user_stated':'resume_stated',approval:'pending',approvalRef:null,lifecycle:'active',conflict:conflict.length>0,conflictIds:conflict,createdAt:now()};
    for(const prior of currentFacts(s).filter(f=>conflict.includes(f.id))){prior.conflict=true;prior.conflictIds=[...new Set([...(prior.conflictIds||[]),fact.id])];invalidate(s,prior.id);}
    s.facts.push(fact);added.push(fact);
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
  }
  enqueue(s,'reindex');return s;
}
function invalidate(s,factId){
  for(const profile of s.roleProfiles)if(profile.factRefs.some(r=>r.id===factId)&&profile.status==='approved')profile.status='needs_review';
  for(const snapshot of s.snapshots)if(snapshot.factRefs.some(r=>r.id===factId))snapshot.stale=true;
}
export async function correctFact(s,body){
  const old=s.facts.find(f=>f.id===body.id&&f.version===body.version&&f.lifecycle==='active');
  if(!old)throw new ProfileError('A fact changed. Reload first.',409);
  const text=clean(body.statement,1800);if(!text)throw new ProfileError('Enter the corrected statement.');
  if(norm(text)===norm(old.statement))return old;
  old.lifecycle='superseded';invalidate(s,old.id);
  for(const f of s.facts){f.conflictIds=(f.conflictIds||[]).filter(x=>x!==old.id);f.conflict=f.conflictIds.some(x=>s.facts.some(g=>g.id===x&&g.lifecycle==='active'&&!['rejected','withdrawn'].includes(g.approval)));}
  const document=answerDocument(text,'Correction for '+old.field);addDocument(s,document);
  const fact={...structuredClone(old),version:old.version+1,statement:text,rawValue:text,fingerprint:await digest(JSON.stringify([old.category,norm(old.field),norm(old.scope),norm(text)])),evidence:[{documentId:document.id,documentVersion:1,segmentId:document.segments[0].id,quote:text}],origin:'user_answer',confirmation:'user_stated',approval:'pending',approvalRef:null,lifecycle:'active',conflict:false,conflictIds:[],createdAt:now()};
  s.facts.push(fact);enqueue(s,'reindex');return fact;
}
export function resolveConflict(s,keepId){
  const chosen=s.facts.find(f=>f.id===keepId&&f.lifecycle==='active');if(!chosen)throw new ProfileError('Fact not found.',404);
  const ids=[chosen.id,...chosen.conflictIds];
  for(const f of s.facts.filter(f=>ids.includes(f.id)&&f.lifecycle==='active')){if(f.id!==keepId){f.lifecycle='superseded';invalidate(s,f.id);}f.conflict=false;f.conflictIds=[];}
  enqueue(s,'reindex');
}
export function answerDocument(text,title){const documentId=id('answer');return {id:documentId,kind:'answer',title,hash:'answer-'+documentId,segments:[{id:documentId+'.p1',text,locator:'user answer'}],selected:false,objectPath:null};}
export async function addAnswer(s,body){
  const q=s.questions.find(q=>q.id===body.questionId);if(!q)throw new ProfileError('Question not found.',404);
  if(!['answered','declined','deferred'].includes(body.decision))throw new ProfileError('Invalid answer decision.');
  const answer={id:id('answer'),questionId:q.id,key:q.key,scope:q.scope,status:body.decision,text:clean(body.text,5000),at:now()};
  if(answer.status==='answered'&&!answer.text)throw new ProfileError('Enter your answer.');
  if(q.status==='declined'&&body.reopen!==true)throw new ProfileError('Explicitly reopen a declined question before answering it.',409);
  q.status=answer.status;s.answers.push(answer);
  if(answer.status==='answered'){const document=answerDocument(answer.text,q.question);document.id=answer.id;document.segments[0].id=answer.id+'.p1';addDocument(s,document);answer.documentId=document.id;}
  enqueue(s,'reindex');return answer;
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
export async function buildProfiles(s,result){
  const selected=s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted);
  if(selected.length<LIMITS.jdMin||selected.length>LIMITS.jdMax)throw new ProfileError('Select 10–15 distinct JDs for initial role-profile building.');
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
    const profile={id:id('role'),version:1,roleName:clean(p.roleName,140),summary:clean(p.summary,1800),keywords:(p.keywords||[]).map(x=>clean(x,80)).slice(0,30),factRefs:refs,mappings,jdIds:selected.map(d=>d.id),status:'proposed',approvalRef:null,createdAt:now()};
    if(!profile.roleName||!refs.length)throw new ProfileError('A role profile needs a name and supporting approved facts.',502);
    s.roleProfiles.push(profile);created.push(profile);
  }
  for(const q of (result.questions||[]).slice(0,30)){
    const requirement=requirements.find(r=>r.id===q.requirementId);
    if(!requirement)throw new ProfileError('A proposed question must identify an existing unmet requirement.',502);
    if(created.some(p=>p.mappings.some(m=>m.requirementId===requirement.id&&m.factRefs.length)))continue;
    const question=clean(q.question,1000),scope=clean(q.scope,300),topic=canonicalTopic(q.capability),key=await digest(JSON.stringify([topic,norm(scope)]));
    const prior=s.questions.find(x=>x.key===key||(canonicalTopic(x.capability)===topic&&(x.status==='declined'||norm(x.scope)===norm(scope))));
    const suppressed=(s.preferences.disclosure||[]).some(text=>topicOverlap(text,q.capability+' '+question));
    if(!question||!q.capability||prior||suppressed||s.answers.some(a=>a.key===key))continue;
    if(s.questions.length>=LIMITS.questions)break;
    s.questions.push({id:id('question'),key,topic,requirementId:requirement.id,capability:clean(q.capability,200),scope,question,status:'unresolved',required:q.required===true,createdAt:now()});
  }
  return created;
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
export function approveRole(s,profileId,actor){
  const p=s.roleProfiles.find(p=>p.id===profileId);if(!p)throw new ProfileError('Role profile not found.',404);
  if(p.status==='approved')return;
  if(!p.factRefs.length||p.factRefs.some(r=>!approvedFacts(s).some(f=>f.id===r.id&&f.version===r.version)))throw new ProfileError('Supporting facts changed. Rebuild this role profile.',409);
  const selected=s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted).map(d=>d.id).sort();
  if(p.jdIds.length<10||JSON.stringify([...p.jdIds].sort())!==JSON.stringify(selected))throw new ProfileError('The selected JD set changed. Rebuild the proposed profile.',409);
  const a={id:id('approval'),kind:'role',recordId:p.id,recordVersion:p.version,actor,decision:'approved',at:now()};s.approvals.push(a);p.status='approved';p.approvalRef=a.id;
  enqueue(s,'reindex');
}
export function finalize(s,actor){
  const selected=s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted),selectedIds=selected.map(d=>d.id).sort();
  const profiles=s.roleProfiles.filter(p=>p.status==='approved'&&JSON.stringify([...p.jdIds].sort())===JSON.stringify(selectedIds)&&p.factRefs.every(r=>approvedFacts(s).some(f=>f.id===r.id&&f.version===r.version)));
  if(!profiles.length)throw new ProfileError('Approve at least one supported role profile first.');
  const facts=approvedFacts(s);if(!facts.length)throw new ProfileError('Approve profile facts first.');
  if(selected.length<10||selected.length>15)throw new ProfileError('Initial finalization requires 10–15 selected JDs.');
  const last=s.snapshots.at(-1),factRefs=facts.map(f=>({id:f.id,version:f.version})),profileRefs=profiles.map(p=>({id:p.id,version:p.version}));
  if(last&&!last.stale&&JSON.stringify(last.factRefs)===JSON.stringify(factRefs)&&JSON.stringify(last.profileRefs)===JSON.stringify(profileRefs))return last;
  const snapshot={id:id('snapshot'),version:'profile-'+(s.snapshots.length+1),factRefs,profileRefs,approvalRef:id('approval'),actor,createdAt:now(),stale:false};
  s.approvals.push({id:snapshot.approvalRef,kind:'snapshot',recordId:snapshot.id,recordVersion:snapshot.version,actor,decision:'approved',at:snapshot.createdAt});
  s.snapshots.push(snapshot);enqueue(s,'reindex');return snapshot;
}
export function savedPacket(s,version){
  if(s.deletion)throw new ProfileError('Profile deletion is pending.',409);
  const snapshot=version?s.snapshots.find(x=>x.version===version):s.snapshots.at(-1);
  if(!snapshot||snapshot.stale)throw new ProfileError('Finalize a current approved profile before applying.',409);
  const facts=snapshot.factRefs.map(r=>approvedFacts(s).find(f=>f.id===r.id&&f.version===r.version));
  if(facts.some(f=>!f))throw new ProfileError('An approved fact changed. Review the affected profile.',409);
  const profiles=snapshot.profileRefs.map(r=>s.roleProfiles.find(p=>p.id===r.id&&p.version===r.version&&p.status==='approved'));
  if(profiles.some(p=>!p))throw new ProfileError('A role profile needs review.',409);
  return {facts:{approvalStatus:'approved',version:snapshot.version,approvalRef:snapshot.approvalRef,evidenceRefs:[...new Set(facts.flatMap(f=>f.evidence.map(e=>e.segmentId)))],records:facts},roleProfiles:profiles.map(p=>({...p,supportedTasks:p.mappings.filter(m=>m.factRefs.length)})),snapshot};
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
  enqueue(s,'reindex');if(doc.objectPath)enqueue(s,'delete-file:'+doc.objectPath);
}
