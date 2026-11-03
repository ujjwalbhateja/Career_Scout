import {Annotation,StateGraph,START,END} from '@langchain/langgraph';
import {auditRoute} from '../workflow/policy.mjs';
import {ProfileError,LIMITS,clean,norm,id,now,digest,emptyProfile,addDocument,proposeFacts,decideFacts,correctFact,resolveConflict,addAnswer,replayedAnswer,addJDAnalysis,buildProfiles,finalize,savedPacket,removeDocument,enqueue,approvedFacts,chunks,invalidateProfileSnapshots,canonicalJSON} from './domain.mjs';
import {ProfileMemory,analyzeWithModel,providerStatus} from './providers.mjs';
import {extractDocument} from './extraction.mjs';
import {groundFactProposals} from './fact-grounding.mjs';
import {readJDLink,primaryJDSegments} from './link-intake.mjs';
import {buildFactReview} from './fact-review.mjs';
import {buildConsolidatedProfile} from './consolidated.mjs';
import {buildValidatedSearchProfile} from './search-profile.mjs';
import {normalizeScoutContext} from '../workflow/scout-policy.mjs';
import {applyExperienceReview,replayedExperienceReview} from './domain.mjs';
import {normalizeBuilderAssessment,supplementBuilderRequirements} from './builder-inputs.mjs';
import {applyBuilderReview,replayBuilderReview,builderReviewReceiptMatches} from './builder-expansion.mjs';
import {currentProfilePacket,currentProfileSummary,currentProfileVersion} from './current-profile.mjs';
import {confirmedRecord} from './source-records.mjs';
import {buildProfessionalExperience} from './professional-experience.mjs';
import {buildExperienceBank} from './experience-bank.mjs';
import {builderSourceRecords,normalizeSourceComparison,unresolvedSourceComparison} from './builder-source-coverage.mjs';
import {QUESTIONNAIRE_POLICY} from './builder-question-policy.mjs';
import {evidenceCandidates,evidenceValidationIssues} from './builder-evidence-validation.mjs';
import {comparisonSaveBasis,finalProfileSavePlan} from './final-profile-save.mjs';
import {finalProfileInputBlockers,finalProfileVerification,finalProfileStatus,assertFinalProfileIntegrity} from './final-profile-integrity.mjs';

// The child receives a scoped payload; it cannot access memory or another child.
async function childTask(kind,payload,adapter){
  const State=Annotation.Root({payload:Annotation(),result:Annotation(),phase:Annotation(),audit:Annotation({reducer:(a,b)=>[...a,...b],default:()=>[]})});
  const graph=new StateGraph(State)
    .addNode('profile',s=>s.phase?{}:{audit:[auditRoute('profile',kind,'scoped-profile-task')]})
    .addNode(kind,async s=>({result:await adapter(structuredClone(s.payload)),phase:'returned',audit:[auditRoute(kind,'profile','profile-task-result')]}))
    .addEdge(START,'profile').addConditionalEdges('profile',s=>s.phase?'end':'child',{child:kind,end:END}).addEdge(kind,'profile').compile();
  return graph.invoke({payload});
}
function inputDocument(d){return {documentId:d.id,kind:d.kind,title:d.title,segments:d.kind==='jd'?primaryJDSegments(d.segments):d.segments};}
function needsPrimaryJDReview(d){return d.kind==='jd'&&d.sourceFilteringVersion!==1&&canonicalJSON(primaryJDSegments(d.segments))!==canonicalJSON(d.segments);}
function needsFactReview(d){return ['resume','answer'].includes(d.kind)&&(d.analysis==='incomplete'||d.coverage?.unreviewedPassages?.length>0||!Array.isArray(d.coverage?.unreviewedPassages)&&!Array.isArray(d.coverage?.passageReview)&&d.coverage?.unreferencedPassages?.length>0);}
const factContext=s=>approvedFacts(s).filter(f=>!['personal','preferences'].includes(f.category)).map(f=>({id:f.id,version:f.version,category:f.category,field:f.field,scope:f.scope,statement:f.statement}));
function builderContext(s){
  const documents=s.documents.filter(d=>d.selected&&d.kind==='jd'&&!d.deleted);
  const professionalExperience=buildFactReview({...s,facts:approvedFacts(s)},{asOf:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}).professionalExperience;
  const {personal,...factualProfile}=buildFactReview(s);
  return {factualProfile,professionalWorkExperience:buildProfessionalExperience(s),builderDecisions:s.builderExpansion?.decisions?.map(d=>({category:d.category,statement:d.statement,originalStatement:d.originalStatement,status:d.status,revisionText:d.revisionText}))||[],selectedJDs:documents.map(d=>({id:d.id,roleName:typeof d.roleName==='string'&&d.roleName&&d.segments.some(part=>part.text.includes(d.roleName))?d.roleName:'',sector:typeof d.sector==='string'&&d.sector&&d.segments.some(part=>part.text.includes(d.sector))?d.sector:''})),requirements:s.requirements.filter(r=>documents.some(d=>d.id===r.documentId)).map(r=>({id:r.id,documentId:r.documentId,text:r.text,category:r.category,importance:r.importance,evidence:r.evidence})),approvedFacts:factContext(s),experienceBank:buildExperienceBank({...s,facts:approvedFacts(s)}).experienceGained,professionalExperience,pendingFacts:s.facts.filter(f=>f.lifecycle==='active'&&f.approval==='pending').map(f=>({category:f.category,scope:f.scope,statement:f.statement})),answerHistory:s.questions.map(q=>({capability:q.capability,scope:q.scope,status:q.status,answer:s.answers.filter(a=>a.questionId===q.id).at(-1)?.text||''})),disclosurePreferences:s.preferences.disclosure||[]};
}
function builderDocuments(s,body){
  const selected=s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted);
  if(body.documentIds===undefined)return selected;
  if(!Array.isArray(body.documentIds)||!body.documentIds.length||body.documentIds.length>15||new Set(body.documentIds).size!==body.documentIds.length||body.documentIds.some(id=>typeof id!=='string'||!selected.some(d=>d.id===id)))throw new ProfileError('Choose valid selected job descriptions to analyze.');
  return selected.filter(d=>body.documentIds.includes(d.id));
}
function saveSearchPreferences(s,input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ProfileError('Enter valid search preferences.');
  const before=canonicalJSON(s.preferences.search||{});
  s.preferences.search={goals:clean(input.goals,1500),location:clean(input.location,600),arrangement:['any','remote','hybrid','on-site'].includes(input.arrangement)?input.arrangement:'any',employment:['any','full-time','part-time','contract','internship'].includes(input.employment)?input.employment:'any',seniority:['any','intern','junior','mid','senior','lead','manager','director'].includes(input.seniority)?input.seniority:'any',preferSponsorship:input.preferSponsorship===true};
  if(before!==canonicalJSON(s.preferences.search))invalidateProfileSnapshots(s);
}
function assertRevision(record,revision){if(!Number.isInteger(revision)||record.revision!==revision)throw new ProfileError('Your profile changed. Reload before continuing.',409);}
export class ProfileService{
  /** @param {any} env @param {string} owner @param {{builderPrompt?:string|(()=>Promise<string>),factPrompt?:string|(()=>Promise<string>)}} [options] */
  constructor(env,owner,{builderPrompt='',factPrompt=''}={}){this.env=env;this.owner=owner;this.memory=new ProfileMemory(env,owner);this.builderPrompt=builderPrompt;this.factPrompt=factPrompt;}
  answerReceipt(record,answer,{analysisStatus,message}={}){
    const document=record.state.documents.find(d=>d.id===answer.documentId&&!d.deleted);
    const status=analysisStatus||(answer.status==='needs_details'?'needs_details':answer.status==='answered'?(document?.analysis==='complete'?'complete':'pending'):'not_required');
    return {...record,result:{kind:'answer_saved',answerId:answer.id,questionId:answer.questionId,submissionId:answer.submissionId||null,decision:answer.status,analysisStatus:status,message:message||(answer.requiresConsistencyReview?'Your No response is saved. Linked facts need consistency review before they can be used. Review them in Facts.':status==='needs_details'?'Your Yes confirmation is saved. Add an example to establish the experience.':status==='complete'?'Your answer is saved. Review the extracted facts before approving them.':status==='pending'?'Your answer is saved. Extract facts from this saved answer when ready.':'Your response is saved. No experience facts were added.')}};
  }
  async analyzeAnswer(record,answer){
    const document=record.state.documents.find(d=>d.id===answer.documentId&&!d.deleted&&d.kind==='answer');
    if(!document||answer.status!=='answered')return this.answerReceipt(record,answer);
    if(document.analysis==='complete')return this.answerReceipt(record,answer);
    try{return this.answerReceipt(await this.analysis(record,{action:'analyze',id:document.id}),answer);}
    catch(error){
      const current=await this.memory.load();
      return this.answerReceipt(current,answer,{analysisStatus:'failed',message:'Your answer is saved. Fact extraction did not finish. '+(error instanceof ProfileError?error.message:'Try extracting facts from the saved answer again.')});
    }
  }
  async read(){const record=await this.memory.load();return {...record,currentProfile:await currentProfileSummary(record,this.owner),finalProfileStatus:await finalProfileStatus(record),providers:providerStatus(this.env),limits:LIMITS};}
  async verifiedBuilderSave(written,result,body){
    let saved;
    try{saved=await this.memory.load();}catch{throw new ProfileError('Could not confirm your profile update. Your selection is kept; retry the same submission.',503);}
    if(saved.revision<written.revision||!builderReviewReceiptMatches({...saved,result},body))throw new ProfileError('Could not confirm your saved decision against the latest profile. Reload and retry the same submission.',409);
    for(const row of result.rows)for(const ref of row.factRefs){
      const intended=written.state.facts.find(f=>f.id===ref.id&&f.version===ref.version),actual=saved.state.facts.find(f=>f.id===ref.id&&f.version===ref.version);
      if(!actual||canonicalJSON(intended)!==canonicalJSON(actual)||!confirmedRecord(saved.state,actual,this.owner))throw new ProfileError('The saved statement or its approval could not be confirmed. Reload before retrying.',409);
    }
    return {...saved,currentProfile:await currentProfileSummary(saved,this.owner),result:{...result,storageVerified:true,message:'Profile updated and saved.'}};
  }
  async saveScoutHandoff(version,receipt){
    for(let attempt=0;attempt<2;attempt++){
      const record=await this.memory.load();
      const current=currentProfileVersion(version);
      if(!current&&record.state.snapshots.at(-1)?.version!==version)throw new ProfileError('The saved profile changed before dispatch. Reload the current profile.',409);
      const packet=current?await currentProfilePacket(record,this.owner,version):savedPacket(record.state,version);
      {
        const verified=current?packet.profileSummary.saveVerification:await finalProfileVerification(record,packet.snapshot),received=receipt.profileReceipt;
        if(!received||received.profileVersion!==verified.profileVersion||received.snapshotId!==verified.snapshotId||received.contentHash!==verified.contentHash)throw new ProfileError('The profile changed between Master loading it and Scout receiving it. Reload the handoff.',409);
      }
      if(receipt.profileVersion!==version||receipt.snapshotId!==packet.snapshot.id||packet.searchProfile?.id!==receipt.roleId||packet.searchProfile?.label!==receipt.roleName||typeof receipt.id!=='string'||receipt.id.length>100||!['dispatched','completed','failed'].includes(receipt.stage)||!/^[a-f0-9]{64}$/.test(receipt.planHash||''))throw new ProfileError('The Scout handoff does not match this saved profile.',409);
      const savedAt=now();
      record.state.scoutHandoffs=[...(record.state.scoutHandoffs||[]).filter(item=>item.id!==receipt.id),{...structuredClone(receipt),persistence:{saved:true,savedAt}}].slice(-30);
      try{await this.memory.save(record.revision,record.state);return {saved:true,id:receipt.id,profileVersion:version,savedAt};}
      catch(error){if(attempt||!(error instanceof ProfileError)||error.status!==409)throw error;}
    }
  }
  async saveScoutHistory(version,seen){
    const record=await this.memory.load();
    if(currentProfileVersion(version))await currentProfilePacket(record,this.owner,version);
    else{if(record.state.snapshots.at(-1)?.version!==version)throw new ProfileError('The active profile changed during discovery. Review the profile before searching again.',409);savedPacket(record.state,version);}
    record.state.scoutSeen=seen.slice(-1000);
    return this.memory.save(record.revision,record.state);
  }
  async drainBackground(){
    if(!providerStatus(this.env).pinecone)return;
    const record=await this.memory.load();
    if(record.state.deletion||!record.state.outbox.some(e=>e.kind==='reindex'&&e.status==='pending'))return;
    await this.action({action:'sync',revision:record.revision,background:true});
  }
  async stageSection1(s,document){
    const {extractSectionOneFacts,SECTION_ONE_PARSER_VERSION}=await import('./section-one.mjs');
    const sourceFingerprint=await digest(canonicalJSON({id:document.id,version:document.version,hash:document.hash||null,segments:document.segments}));
    const previous=document.section1Analysis;
    const fields={personal:['full_name','email','mobile','phone','address'],employment:['company_name','job_title','start_date','end_date','location'],education:['institution_name','qualification','start_date','end_date','location'],certifications:['name','certification_name','date','issue_date'],skills:['programming_languages','tools_technologies','other_skills']};
    const sourceFact=fact=>fact&&fact.lifecycle==='active'&&fields[fact.category]?.includes(fact.field)&&fact.evidence?.length>0&&fact.evidence.some(ref=>typeof ref.quote==='string'&&ref.quote.includes(fact.statement))&&fact.evidence.every(ref=>ref.documentId===document.id&&document.segments.some(segment=>segment.id===ref.segmentId&&typeof ref.quote==='string'&&segment.text.includes(ref.quote)));
    const validReceipt=previous?.parserVersion===SECTION_ONE_PARSER_VERSION&&previous.sourceHash===sourceFingerprint&&previous.sourceVersion===document.version&&previous.status==='complete'&&Array.isArray(previous.factIds)&&Array.isArray(previous.addedFactIds)&&new Set(previous.factIds).size===previous.factIds.length&&previous.factIds.every(factId=>typeof factId==='string'&&sourceFact(s.facts.find(fact=>fact.id===factId)))&&previous.addedFactIds.every(factId=>previous.factIds.includes(factId));
    if(validReceipt)return {kind:'section1_extracted',documentId:document.id,parserVersion:SECTION_ONE_PARSER_VERSION,sourceHash:sourceFingerprint,addedCount:0,addedFactIds:[],retiredCount:0,retiredFactIds:[],factIds:previous.factIds,unchanged:true,alreadyCurrent:true,unresolved:previous.unresolved||[],message:'Section 1 has already been extracted from this saved resume. Review its factual proposals.'};
    const originals={facts:structuredClone(s.facts),roleProfiles:structuredClone(s.roleProfiles),snapshots:structuredClone(s.snapshots)};
    const startedAt=now(),child=await childTask('fact',{document:structuredClone(document),knownFacts:structuredClone(s.facts)},input=>extractSectionOneFacts(input.document,{knownFacts:input.knownFacts}));
    if(!child.result||!Array.isArray(child.result.facts))throw new ProfileError('Section 1 extraction returned an invalid proposal batch.',502);
    const proposals=child.result.facts;
    if(proposals.some(fact=>!fields[fact.category]?.includes(fact.field)||typeof fact.statement!=='string'||fact.statement.length>1800||!Array.isArray(fact.evidence)||fact.evidence.some(ref=>ref.documentId!==document.id)))throw new ProfileError('Section 1 proposals must contain factual fields cited in the selected resume.',502);
    for(let start=0;start<proposals.length;start+=200)await proposeFacts(s,proposals.slice(start,start+200),'resume');
    const added=s.facts.slice(originals.facts.length);
    // A source-only extraction may add pending values. It cannot change an old
    // approval, append evidence to an approved assertion, or decide a conflict.
    s.facts=[...originals.facts,...added];s.roleProfiles=originals.roleProfiles;s.snapshots=originals.snapshots;
    for(const fact of added){fact.extractionStage='section1';fact.section1ParserVersion=SECTION_ONE_PARSER_VERSION;}
    if(added.length)invalidateProfileSnapshots(s,'New Section 1 factual proposals need review before saving the current profile.');
    const fingerprints=new Set(await Promise.all(proposals.map(fact=>digest(JSON.stringify([fact.category,norm(clean(fact.field,100)),norm(clean(fact.scope,300)),norm(clean(fact.statement,1800))])))));
    const previousAdded=Array.isArray(previous?.addedFactIds)?previous.addedFactIds:[],previousFacts=Array.isArray(previous?.factIds)?previous.factIds:[],owned=new Set([...previousAdded,...previousFacts]),retiredFactIds=[];
    for(const fact of s.facts){
      if(!owned.has(fact.id)||fact.lifecycle!=='active'||['approved','rejected','withdrawn'].includes(fact.approval)||!fields[fact.category]?.includes(fact.field)||fingerprints.has(fact.fingerprint)||!(fact.extractionStage==='section1'||previousAdded.includes(fact.id)))continue;
      fact.lifecycle='superseded';fact.supersededReason='section1_parser_update';fact.supersededByParserVersion=SECTION_ONE_PARSER_VERSION;fact.supersededAt=now();retiredFactIds.push(fact.id);
    }
    const factIds=s.facts.filter(fact=>sourceFact(fact)&&fingerprints.has(fact.fingerprint)).map(fact=>fact.id);
    const receipt={parserVersion:SECTION_ONE_PARSER_VERSION,sourceHash:sourceFingerprint,sourceFingerprint,sourceVersion:document.version,documentVersion:document.version,status:'complete',completedAt:now(),factIds,addedFactIds:added.map(fact=>fact.id),retiredFactIds,unresolved:structuredClone(child.result.unresolved||[]),coverage:structuredClone(child.result.coverage||null)};
    document.section1Analysis=receipt;
    s.runs.push({id:id('run'),action:'extractSection1',documentId:document.id,status:'complete',startedAt,finishedAt:receipt.completedAt,parserVersion:SECTION_ONE_PARSER_VERSION,addedFacts:added.length,audit:[auditRoute('master','profile','section1-factual-records'),...child.audit,auditRoute('profile','master','section1-factual-records-result')]});
    return {kind:'section1_extracted',documentId:document.id,parserVersion:SECTION_ONE_PARSER_VERSION,sourceHash:sourceFingerprint,addedCount:added.length,addedFactIds:receipt.addedFactIds,retiredCount:retiredFactIds.length,retiredFactIds,factIds:receipt.factIds,unchanged:false,alreadyCurrent:false,unresolved:receipt.unresolved,message:'Section 1 source values extracted. Review '+added.length+' new factual proposal'+(added.length===1?'':'s')+'.'};
  }
  async extractSection1(record,body){
    const s=structuredClone(record.state),resumes=s.documents.filter(document=>document.kind==='resume'&&!document.deleted);
    const document=body.id?resumes.find(item=>item.id===body.id):resumes.at(-1);
    if(!document)throw new ProfileError('Select a saved resume to extract Section 1 factual records.',404);
    const result=await this.stageSection1(s,document);
    if(result.alreadyCurrent)return {...record,result};
    return {...await this.memory.save(record.revision,s),result};
  }
  async upload(file,body){
    let record=await this.memory.load();assertRevision(record,Number(body.revision));
    if(!['resume','jd'].includes(body.kind))throw new ProfileError('Choose resume or JD.');
    if(body.kind==='jd'&&body.selected===true&&record.state.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted).length>=15)throw new ProfileError('Select at most 15 onboarding JDs.');
    const documentId=id('doc'),bytes=new Uint8Array(await file.arrayBuffer());
    const parsed=await extractDocument(bytes,{name:file.name,mime:file.type,documentId});
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const document={id:documentId,kind:body.kind,title:clean(body.title,180)||parsed.filename,filename:parsed.filename,mime:parsed.mime,hash,segments:parsed.segments,selected:body.selected===true,objectPath:null};
    addDocument(record.state,document);
    if(body.kind==='resume')await this.stageSection1(record.state,record.state.documents.at(-1));
    const path=await this.memory.upload(document,bytes,parsed.mime);
    record.state.documents.at(-1).objectPath=path;
    try{return await this.memory.save(record.revision,record.state);}
    catch(e){await this.memory.removeFiles([path]).catch(()=>{});throw e;}
  }
  async action(body){
    let record=await this.memory.load();
    if(body.action==='answer'&&!record.state.deletion){const replay=await replayedAnswer(record.state,body);if(replay)return this.answerReceipt(record,replay);}
    if(body.action==='reviewBuilder'&&!record.state.deletion){const replay=await replayBuilderReview(record.state,body);if(replay)return this.verifiedBuilderSave(record,replay,body);}
    if(body.action==='reviewExperience'&&!record.state.deletion){const replay=await replayedExperienceReview(record.state,body);if(replay)return {...record,result:replay};}
    assertRevision(record,body.revision);
    const s=record.state,action=body.action;
    if(s.deletion&&!['deleteProfile','export'].includes(action))throw new ProfileError('Deletion is pending. Retry deletion to finish.',409);
    const lease=s.memoryIntent,leaseRun=lease&&s.runs.find(r=>r.id===lease.runId);
    if(lease&&Date.parse(lease.expiresAt)>Date.now()&&leaseRun?.status!=='complete'&&!['export','retrieve'].includes(action))throw new ProfileError('Semantic indexing is finishing or recovering. Retry after its five-minute safety window.',409);
    if(action==='extractSection1')return this.extractSection1(record,body);
    if(action==='saveFinalProfile')return this.saveFinalProfile(record,body);
    let result=null;
    if(['prepare','buildProfiles','finalize'].includes(action)&&body.search)saveSearchPreferences(s,body.search);
    if(action==='importJD'){
      if(s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted).length>=15)throw new ProfileError('Use at most 15 optional JDs.');
      const document=await readJDLink(clean(body.url,3000));addDocument(s,document);
    }else if(action==='prepare'){
      const documents=s.documents.filter(d=>!d.deleted&&(d.analysis!=='complete'||needsFactReview(d))&&(d.kind==='resume'||d.kind==='answer'||(d.kind==='jd'&&d.selected)));
      if(!s.documents.some(d=>d.kind==='resume'&&!d.deleted))throw new ProfileError('Add your resume first.');
      if(body.search)record=await this.memory.save(record.revision,s);
      for(const document of documents)record=await this.analysis(record,{action:'analyze',id:document.id});
      return record;
    }else if(action==='paste'){
      if(!['resume','jd'].includes(body.kind))throw new ProfileError('Choose resume or JD.');
      const text=clean(body.text,LIMITS.textChars+1);if(text.length<80||text.length>LIMITS.textChars)throw new ProfileError('Paste between 80 and 60,000 characters.');
      const documentId=id('doc'),segments=text.split(/\n+/).map(t=>t.trim()).filter(Boolean).map((text,i)=>({id:documentId+'.p'+(i+1),text,locator:'pasted paragraph '+(i+1)}));
      if(segments.length>LIMITS.segments)throw new ProfileError('Too many document paragraphs.');
      if(body.selected&&s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted).length>=15)throw new ProfileError('Select at most 15 onboarding JDs.');
      addDocument(s,{id:documentId,kind:body.kind,title:clean(body.title,180)||'Pasted '+body.kind,filename:null,mime:'text/plain',hash:await digest(text),segments,selected:body.selected===true,objectPath:null});
      if(body.kind==='resume')result=await this.stageSection1(s,s.documents.at(-1));
    }else if(action==='selectJD'){
      const d=s.documents.find(d=>d.id===body.id&&d.kind==='jd'&&!d.deleted);if(!d)throw new ProfileError('JD not found.',404);
      if(body.selected&&s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted).length>=15&&!d.selected)throw new ProfileError('Select at most 15 onboarding JDs.');
      d.selected=body.selected===true;
    }else if(action==='buildProfiles'){
      const selected=builderDocuments(s,body);
      if(!factContext(s).length)throw new ProfileError('Review and approve your resume experience, education or skills before Profile Builder compares the JDs.');
      for(const document of selected.filter(d=>d.analysis!=='complete'||needsPrimaryJDReview(d)))record=await this.analysis(record,{action:'analyze',id:document.id});
      return this.analysis(record,{...body,mode:body.mode==='expansion'?'expansion':'analysis'});
    }else if(action==='analyze'||action==='assessJD'){
      return this.analysis(record,body);
    }else if(action==='decideFacts'){
      decideFacts(s,body.decisions,this.owner);
      result={kind:'fact_decisions',decisions:body.decisions.map(d=>{const f=s.facts.find(f=>f.id===d.id&&f.version===d.version&&f.lifecycle==='active');return {id:f.id,version:f.version,decision:f.approval,approvalRef:f.approvalRef};})};
    }
    else if(action==='reviewBuilder')result=await applyBuilderReview(s,body,this.owner,{revision:record.revision});
    else if(action==='reviewExperience')result=await applyExperienceReview(s,body,this.owner,{revision:record.revision});
    else if(action==='correctFact')await correctFact(s,body);
    else if(action==='resolveConflict')resolveConflict(s,body.id);
    else if(action==='answer'){
      const answer=await addAnswer(s,body);
      const saved=await this.memory.save(record.revision,s);
      return body.analyze===true?this.analyzeAnswer(saved,answer):this.answerReceipt(saved,answer);
    }
    else if(action==='analyzeAnswer'){
      const answer=s.answers.find(a=>a.id===body.id);if(!answer)throw new ProfileError('Saved answer not found.',404);
      return this.analyzeAnswer(record,answer);
    }
    else if(action==='approveRole')throw new ProfileError('Generated role suggestions are retired. Review factual claims and save the consolidated master profile instead.',409);
    else if(action==='finalize'){
      result=this.finalProfileResult(s);
    }
    else if(action==='retrieve'){
      const query=clean(body.query,1500);if(query.length<3)throw new ProfileError('Enter a retrieval question.');
      result=await this.memory.retrieve(s,query,body.kind||'approved_fact');
      return {...record,result};
    }else if(action==='packet'){return {...record,result:savedPacket(s,body.version)};}
    else if(action==='sync'){
      if(!providerStatus(this.env).pinecone)throw new ProfileError('Configure Pinecone and GEMINI_API_KEY, and enable semantic search first. Database keyword retrieval remains available.',503);
      await this.memory.reserve();
      const run={id:id('run'),action:'sync',status:'running',startedAt:now()};
      s.runs.push(run);s.memoryIntent={runId:run.id,namespace:await this.memory.vectorNamespace(),indexHost:this.env.PINECONE_INDEX_HOST,attemptedAt:now(),expiresAt:new Date(Date.now()+300000).toISOString()};
      s.indexLocations=[...new Map([...(s.indexLocations||[]),{host:this.env.PINECONE_INDEX_HOST,namespace:s.memoryIntent.namespace}].map(x=>[x.host,x])).values()];
      record=await this.memory.save(record.revision,s);
      this.memory.operationSignal=AbortSignal.timeout(body.background===true?20000:150000);
      try{
        result=await this.memory.sync(s,body.background===true?20:160);run.status='complete';run.finishedAt=now();
        if(!result.remaining)for(const event of s.outbox.filter(e=>e.kind==='reindex'&&e.status==='pending')){event.status='complete';event.attempts++;event.completedAt=now();}
      }catch{throw new ProfileError('Indexing did not finish. Your facts remain saved; retry after the safety window.',503);}
    }else if(action==='removeDocument'){
      removeDocument(s,body.id);
    }else if(action==='cleanup'){
      for(const event of s.outbox.filter(e=>e.kind.startsWith('delete-file:')&&e.status==='pending')){await this.memory.removeFiles([event.kind.slice(12)]);event.status='complete';event.attempts++;}
    }else if(action==='preferences'){
      const before=JSON.stringify(s.preferences.disclosure||[]);
      s.preferences.disclosure=Array.isArray(body.disclosure)?body.disclosure.map(x=>clean(x,300)).slice(0,30):s.preferences.disclosure||[];
      if(before!==JSON.stringify(s.preferences.disclosure))invalidateProfileSnapshots(s,'Disclosure preferences changed. Save the current consolidated profile again.');
      if(body.search)saveSearchPreferences(s,body.search);
    }else if(action==='export')return {...record,result:{schemaVersion:1,exportedAt:now(),profile:s,originalFiles:s.documents.filter(d=>d.objectPath&&!d.deleted).map(d=>({id:d.id,filename:d.filename,downloadPath:'/api/profile?download='+encodeURIComponent(d.id)}))}};
    else if(action==='deleteProfile'){
      if(body.confirmation!=='DELETE MY PROFILE')throw new ProfileError('Type DELETE MY PROFILE to confirm deletion.');
      if(!s.deletion){s.deletion={status:'pending',requestedAt:now()};record=await this.memory.save(record.revision,s);}
      await this.memory.purge(record.state,record.revision);
      return {revision:record.revision+1,state:emptyProfile(),deleted:true};
    }else throw new ProfileError('Unknown Profile action.');
    const saved=await this.memory.save(record.revision,s);
    if(action==='reviewBuilder')return this.verifiedBuilderSave(saved,result,body);
    return {...saved,result};
  }
  finalProfileResult(s){
    const blocked=finalProfileInputBlockers(s);if(blocked.length)throw new ProfileError(blocked[0].message,409);
    const snapshot=finalize(s,this.owner);
    snapshot.profileAsOf=snapshot.consolidated?.asOf||snapshot.profileAsOf||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(snapshot.createdAt));
    snapshot.searchProfile=buildValidatedSearchProfile(s,{snapshot,asOf:snapshot.profileAsOf});
    snapshot.consolidated=buildConsolidatedProfile(s,{snapshot,asOf:snapshot.profileAsOf});
    if(!snapshot.consolidated.binding.valid)throw new ProfileError('The consolidated profile has source or approval references that need review. Return to Facts before saving.',409);
    snapshot.saveIntegrityVersion=1;
    assertFinalProfileIntegrity(s,snapshot);
    return {...snapshot,kind:'consolidated_profile_saved',message:'Your consolidated profile is saved as '+snapshot.version+'. Review the search handoff, then send it to Master and Scout.'};
  }
  async saveFinalProfile(record,body){
    const policy=typeof this.builderPrompt==='function'?await this.builderPrompt():this.builderPrompt;
    const promptHash=policy?await digest(policy):null;
    const fresh=async()=>{const current=await this.memory.load();assertRevision(current,record.revision);if(current.state.deletion)throw new ProfileError('Profile deletion is pending.',409);return current;};
    const held=(blockers)=>({...record,result:{kind:'final_profile_needs_review',saved:false,blockers,message:'Final Profile was not saved. Review the listed items; your existing facts and decisions remain saved.'}});
    if(record.state.runs.some(r=>r.status==='running'&&Date.now()-Date.parse(r.startedAt)<120000))throw new ProfileError('An analysis is running. Wait, then reload.',409);
    let plan=await finalProfileSavePlan(record.state,promptHash);
    if(plan.manualBlockers.length)return held(plan.manualBlockers);
    // Existing unresolved comparisons need attention, not a silent retry loop.
    if(plan.comparisonBlockers.length)return held(plan.comparisonBlockers);
    const refreshed=[];
    if(plan.staleDocumentIds.length){
      if(!providerStatus(this.env).model)throw new ProfileError('A comparison needs updating. Connect the analysis model before saving the Final Profile.',503);
      for(const id of plan.staleDocumentIds){
        const document=record.state.documents.find(d=>d.id===id);
        if(document.analysis!=='complete'||needsPrimaryJDReview(document)){
          record=await fresh();
          try{record=await this.analysis(record,{action:'analyze',id});}
          catch(e){throw new ProfileError('Final Profile stopped during job-description analysis: '+(e instanceof ProfileError?e.message:'Analysis failed. Your approvals remain saved; retry when available.'),e instanceof ProfileError?e.status:503);}
        }
      }
      record=await fresh();
      plan=await finalProfileSavePlan(record.state,promptHash);
      if(plan.manualBlockers.length)return held(plan.manualBlockers);
      if(plan.staleDocumentIds.length){
        refreshed.push(...plan.staleDocumentIds);
        try{record=await this.analysis(record,{action:'buildProfiles',mode:'expansion',documentIds:plan.staleDocumentIds});}
        catch(e){throw new ProfileError('Final Profile stopped during comparison updates: '+(e instanceof ProfileError?e.message:'Comparison failed. Your approvals remain saved; retry when available.'),e instanceof ProfileError?e.status:503);}
      }
      record=await fresh();plan=await finalProfileSavePlan(record.state,promptHash);
      if(plan.staleDocumentIds.length)throw new ProfileError('The comparison inputs changed or checks remain incomplete. Reload and review before saving.',409);
      if(plan.manualBlockers.length||plan.comparisonBlockers.length)return held([...plan.manualBlockers,...plan.comparisonBlockers]);
    }
    record=await fresh();
    const draft=structuredClone(record.state),before=canonicalJSON(draft);
    // Assemble independently validated batches under the existing full-selection
    // gate. Reused mappings keep their original source/fact/answer bindings.
    if(plan.readiness.blockers.some(b=>b.code==='builder_comparison_required')){
      const ids=new Set(draft.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted).map(d=>d.id));
      const requirements=draft.requirements.filter(r=>ids.has(r.documentId));
      const mappings=requirements.map(r=>{const review=plan.reviews.findLast(v=>v.jdIds.includes(r.documentId));const m=review.mappings.find(m=>m.requirementId===r.id);return {...m,factIds:m.factRefs.map(f=>f.id)};});
      await buildProfiles(draft,{profiles:[],mappings,questions:[]},'analysis');
      const review=draft.builderReviews.at(-1);
      review.sourceComparisons=requirements.map(r=>plan.reviews.findLast(v=>v.jdIds.includes(r.documentId)).sourceComparisons.find(c=>c.requirementId===r.id));
      review.comparisonSaveBasis=plan.basis;review.reusedReviewIds=plan.reviews.map(r=>r.id);
      if(promptHash)review.prompt={source:'agents/profile_builder/prompt.md',hash:promptHash};
    }
    if(body.search)saveSearchPreferences(draft,body.search);
    const finalPlan=await finalProfileSavePlan(draft,promptHash);
    if(finalPlan.staleDocumentIds.length)throw new ProfileError('Comparison validation changed before saving. Reload and review the profile.',409);
    if(!finalPlan.readiness.ready||finalPlan.comparisonBlockers.length)return held([...finalPlan.readiness.blockers,...finalPlan.comparisonBlockers]);
    const result={...this.finalProfileResult(draft),refreshedDocumentIds:refreshed};
    // A lost response can be retried: unchanged inputs reuse the saved version.
    let expectedRevision=record.revision;
    if(canonicalJSON(draft)!==before){
      try{const written=await this.memory.save(record.revision,draft);expectedRevision=Math.max(record.revision+1,written.revision);}
      catch(e){throw new ProfileError('Final Profile stopped during storage: '+(e instanceof ProfileError?e.message:'Save failed. Your previous approvals remain saved; reload before retrying.'),e instanceof ProfileError?e.status:503);}
    }
    // A write acknowledgement is not proof of durable contents. Read again and
    // compare the exact snapshot before returning a successful save receipt.
    let saved;
    try{saved=await this.memory.load();}catch{throw new ProfileError('Final Profile save could not be verified because storage reload failed. Your approvals remain saved. Reload and retry; do not start research yet.',503);}
    const stored=saved.state.snapshots.at(-1);
    if(!Number.isInteger(expectedRevision)||saved.revision<expectedRevision||canonicalJSON(stored)!==canonicalJSON(draft.snapshots.at(-1)))throw new ProfileError('Final Profile save could not be verified: storage returned different or newer contents. Reload before continuing.',409);
    const verification=await finalProfileVerification(saved,stored);
    return {...saved,finalProfileStatus:await finalProfileStatus(saved),result:{...result,verification,message:`Final Profile ${stored.version} saved, reloaded and verified. ${verification.questionnaireFactCount} approved questionnaire additions are included. Review the handoff before starting research.`}};
  }
  async analysis(record,body){
    const s=record.state;
    if(!providerStatus(this.env).model)throw new ProfileError('An analysis model must be configured before this step.',503);
    const d=s.documents.find(d=>d.id===body.id&&!d.deleted);
    if(body.action==='analyze'&&!d)throw new ProfileError('Document not found.',404);
    if(body.action==='assessJD'&&(!d||d.kind!=='jd'))throw new ProfileError('Select a saved JD.',400);
    if(body.action==='buildProfiles'){
      const selected=builderDocuments(s,body);
      if(selected.some(d=>d.analysis!=='complete'))throw new ProfileError('Analyze all selected JDs first.');
      if(!factContext(s).length)throw new ProfileError('Approve your experience, education or skills first.');
      if(s.requirements.filter(r=>selected.some(d=>d.id===r.documentId)).length>200)throw new ProfileError('Select fewer JDs to complete this comparison. A comparison is limited to 200 requirements per run.');
    }
    const usesBuilder=d?.kind==='jd'||body.action==='buildProfiles'||body.action==='assessJD';
    const policy=usesBuilder?this.builderPrompt:this.factPrompt;
    const builderPrompt=typeof policy==='function'?await policy():policy;
    const running=s.runs.find(r=>r.status==='running'&&Date.now()-Date.parse(r.startedAt)<120000);
    if(running)throw new ProfileError('An analysis is running. Wait, then reload.',409);
    for(const stale of s.runs.filter(r=>r.status==='running')){stale.status='interrupted';stale.finishedAt=now();}
    await this.memory.reserve();
    const run={id:id('run'),action:body.action,documentId:d?.id||null,status:'running',startedAt:now(),audit:[auditRoute('master','profile','profile-operation')]};
    if(builderPrompt)run.prompt={source:'agents/'+(usesBuilder?'profile_builder':'fact')+'/prompt.md',hash:await digest(builderPrompt)};
    s.runs.push(run);record=await this.memory.save(record.revision,s);
    try{
      if(body.action==='analyze'){
        if(d.kind==='jd'){
          const child=await childTask('profile-builder',inputDocument(d),input=>analyzeWithModel(this.env,'jd',input,{agentPrompt:builderPrompt}));
          run.audit.push(...child.audit);
          const prior=s.requirements.filter(requirement=>requirement.documentId===d.id);
          if(prior.length){s.archivedRequirements||=[];s.archivedRequirements.push(...prior.map(requirement=>({...requirement,archivedAt:now(),reason:'Employer JD reanalysis'})));s.requirements=s.requirements.filter(requirement=>requirement.documentId!==d.id);invalidateProfileSnapshots(s,'The employer JD analysis changed. Refresh the comparison and save the profile again.');}
          await addJDAnalysis(s,d.id,child.result);d.sourceFilteringVersion=1;d.analysisPromptHash=run.prompt?.hash||null;
        }else{
          const previousIndex=await digest(JSON.stringify(chunks(s)));
          const child=await childTask('fact',{...inputDocument(d),approvedFacts:factContext(s)},input=>analyzeWithModel(this.env,'facts',input,{agentPrompt:builderPrompt}));
          const proposals=groundFactProposals(d,child.result.facts);
          run.audit.push(...child.audit);await proposeFacts(s,proposals,d.kind==='answer'?'user_answer':'resume',child.result.conflicts||[]);d.analysis='complete';
          const covered=new Set(s.facts.filter(f=>f.lifecycle==='active').flatMap(f=>f.evidence.filter(e=>e.documentId===d.id).map(e=>e.segmentId)));
          const reviewed=(child.result.passageReview||[]).map(part=>{
            if(!d.segments.some(segment=>segment.id===part.segmentId)||!clean(part.reason,500))throw new ProfileError('Fact Agent returned an invalid passage review. No partial extraction was saved.',502);
            return {segmentId:part.segmentId,reason:clean(part.reason,500)};
          });
          const accounted=new Set([...covered,...reviewed.map(part=>part.segmentId)]);
          d.coverage={sourcePassages:d.segments.length,referencedPassages:covered.size,unreferencedPassages:d.segments.filter(p=>!covered.has(p.id)).map(p=>p.id),passageReview:reviewed,unreviewedPassages:d.segments.filter(p=>!accounted.has(p.id)).map(p=>p.id),promptHash:run.prompt?.hash||null};
          if(d.coverage.unreviewedPassages.length)d.analysis='incomplete';
          if(await digest(JSON.stringify(chunks(s)))!==previousIndex)enqueue(s,'reindex');
        }
      }else if(body.action==='buildProfiles'){
        const selected=builderDocuments(s,body),selectedIds=new Set(selected.map(d=>d.id));
        for(const document of selected)await supplementBuilderRequirements(s,document);
        const scoped={...s,documents:s.documents.map(d=>({...d,selected:selectedIds.has(d.id)}))};
        const full={...builderContext(scoped),sourceRecords:builderSourceRecords(s)},mappings=[],sourceComparisons=[],coverageCorrections=[];
        const comparisonContext={questionnairePolicy:QUESTIONNAIRE_POLICY,selectedJDs:full.selectedJDs,approvedFacts:full.approvedFacts,sourceRecords:full.sourceRecords,builderDecisions:full.builderDecisions,answerHistory:full.answerHistory,disclosurePreferences:full.disclosurePreferences};
        // Compare every JD requirement directly with approved facts. This stage
        // returns evidence assessments and questions; it creates no job roles.
        // Bounded schema size: each requirement now has a separate source-coverage record.
        for(let start=0;start<full.requirements.length;start+=8){
          if(start)await this.memory.reserve();
          const batch=full.requirements.slice(start,start+8);
          // Send each saved work/skill statement once rather than several expanded
          // factual projections with repeated evidence and approval histories.
          const context={...comparisonContext,requirements:batch};
          const child=await childTask('profile-builder',context,input=>analyzeWithModel(this.env,'gap_assessment',input,{agentPrompt:builderPrompt}));
          run.audit.push(...child.audit);
          const assessments=child.result.assessments;
          if(!assessments||typeof assessments!=='object'||Array.isArray(assessments)||Object.keys(assessments).length!==batch.length||batch.some(r=>!Array.isArray(assessments[r.id]?.factIds)||typeof assessments[r.id]?.explanation!=='string'))throw new ProfileError('Profile Builder did not complete every JD requirement assessment. Try the comparison again.',502);
          for(const requirement of batch){
            mappings.push({requirementId:requirement.id,...normalizeBuilderAssessment(requirement,assessments[requirement.id],full.approvedFacts)});
            try{
              const comparison=normalizeSourceComparison(requirement,assessments[requirement.id],full.sourceRecords);
              const issues=evidenceValidationIssues(requirement,assessments[requirement.id],full.sourceRecords);
              if(comparison?.questionPolicy?.disposition==='ask'||issues.length){
                coverageCorrections.push({requirement,previousAssessment:assessments[requirement.id],validationIssue:issues.join(' ')||'Independently check the proposed question against the whole saved profile before displaying it. Combine relevant passages and retain only material unestablished scope.'});
              }else if(comparison)sourceComparisons.push(comparison);
            }catch(error){
              if(!(error instanceof ProfileError)||error.status!==502)throw error;
              coverageCorrections.push({requirement,previousAssessment:assessments[requirement.id],validationIssue:error.message});
            }
          }
        }
        // Every scored proposed question receives a separate evidence review.
        // Invalid structures use the same bounded pass; provider errors are not retried.
        for(let start=0;start<coverageCorrections.length;start+=2){
          await this.memory.reserve();const batch=coverageCorrections.slice(start,start+2);
          // Do not anchor the independent reviewer to the rejected score or
          // component assignments. Supply only the source and validation issue.
          const child=await childTask('profile-builder',{...comparisonContext,requirements:batch.map(c=>c.requirement),sourceCoverageCorrections:batch.map(c=>({requirementId:c.requirement.id,validationIssue:c.validationIssue})),evidenceValidation:{version:1,candidates:batch.map(c=>({requirementId:c.requirement.id,passages:evidenceCandidates(c.requirement,full.sourceRecords)}))}},input=>analyzeWithModel(this.env,'gap_assessment',input,{agentPrompt:builderPrompt}));
          run.audit.push(...child.audit);
          for(const {requirement} of batch){
            const corrected=child.result.assessments?.[requirement.id];
            try{
              const issues=evidenceValidationIssues(requirement,corrected,full.sourceRecords,{reviewRequired:!!corrected?.profileCoverage?.components});
              if(issues.length){run.evidenceReviewIssues||=[];run.evidenceReviewIssues.push({requirementId:requirement.id,issues});throw new ProfileError('The comparison evidence review remains inconsistent.',502);}
              const comparison=normalizeSourceComparison(requirement,corrected,full.sourceRecords);
              if(comparison&&corrected.evidenceReview)comparison.evidenceReview={version:1,consideredSourceIds:[...new Set([...corrected.evidenceReview.consideredSourceIds,...corrected.profileCoverage.components.flatMap(c=>c.sourceIds)])],reason:corrected.evidenceReview.reason};
              sourceComparisons.push(comparison||unresolvedSourceComparison(requirement));
            }catch(error){
              if(!(error instanceof ProfileError)||error.status!==502)throw error;
              if(!run.evidenceReviewIssues?.some(item=>item.requirementId===requirement.id)){run.evidenceReviewIssues||=[];run.evidenceReviewIssues.push({requirementId:requirement.id,issues:[error.message]});}
              // Preserve unresolved coverage visibly, without repeating a whole
              // requirement as an approvable claim or implying it is satisfied.
              sourceComparisons.push(unresolvedSourceComparison(requirement));
            }
          }
        }
        await buildProfiles(scoped,{profiles:[],mappings,questions:[]},'analysis');
        // Keep selected-source settings intact; persist only this batch's review
        // alongside prior reviews, drafts and decision history.
        Object.assign(s,{...scoped,documents:s.documents});
        if(s.builderReviews?.at(-1))s.builderReviews.at(-1).sourceComparisons=sourceComparisons;
        run.evidenceReview={version:1,requirementsReviewed:coverageCorrections.length,unresolved:sourceComparisons.filter(c=>c.status==='unresolved').length};
        if(body.mode==='expansion'){
          const selectedIds=new Set(full.requirements.map(r=>r.id));
          for(const question of s.questions)if((question.requirementIds||[question.requirementId]).some(id=>selectedIds.has(id)))question.required=false;
        }
        run.profileIds=[];run.builderReviewId=s.builderReviews?.at(-1)?.id||null;
        if(s.builderReviews?.at(-1)&&run.prompt)s.builderReviews.at(-1).prompt=run.prompt;
        if(s.builderReviews?.at(-1))s.builderReviews.at(-1).comparisonSaveBasis=await comparisonSaveBasis(s,[...selectedIds],run.prompt?.hash||null);
      }else{
        const packet=savedPacket(s),requirements=s.requirements.filter(r=>r.documentId===d.id);
        if(!requirements.length)throw new ProfileError('Analyze this JD first.');
        const snapshotFacts=packet.facts.records.filter(f=>!['personal','preferences'].includes(f.category));
        const context={requirements:requirements.map(r=>({id:r.id,text:r.text,importance:r.importance})),approvedFacts:snapshotFacts.map(f=>({id:f.id,version:f.version,category:f.category,scope:f.scope,statement:f.statement})),roleProfiles:packet.roleProfiles.map(p=>({id:p.id,roleName:p.roleName}))};
        const child=await childTask('profile-builder',context,input=>analyzeWithModel(this.env,'assessment',input,{agentPrompt:builderPrompt}));run.audit.push(...child.audit);
        if(!Array.isArray(child.result.mappings)||child.result.mappings.length!==requirements.length)throw new ProfileError('Assessment omitted JD requirements. Nothing was accepted.',502);
        const seen=new Set();
        d.assessment={profileVersion:packet.facts.version,at:now(),mappings:child.result.mappings.map(m=>{
          if(seen.has(m.requirementId)||!requirements.some(r=>r.id===m.requirementId))throw new ProfileError('Assessment contains invalid requirement references.',502);seen.add(m.requirementId);
          const refs=[...new Set(m.factIds||[])].map(x=>{const f=snapshotFacts.find(f=>f.id===x);if(!f)throw new ProfileError('Assessment referenced a fact outside the approved snapshot.',502);return {id:f.id,version:f.version};});
          return {requirementId:m.requirementId,factRefs:refs,assessment:refs.length?'candidate_support':'not_established',explanation:clean(m.explanation,1400)};
        })};
      }
      run.status='complete';run.finishedAt=now();run.audit.push(auditRoute('profile','master','profile-operation-result'));
      return await this.memory.save(record.revision,s);
    }catch(error){
      // Reload to avoid overwriting a concurrent approval; never save partial proposals.
      try{const current=await this.memory.load(),failed=current.state.runs.find(r=>r.id===run.id);if(failed){failed.status='failed';failed.finishedAt=now();failed.message=error instanceof ProfileError?error.message:'Analysis failed.';await this.memory.save(current.revision,current.state);}}catch{}
      throw error;
    }
  }
}
// Inject this into Master's existing graph. The owner is captured by the trusted
// Profile boundary, not supplied by another agent or browser payload.
export function approvedProfileLoader(service,{requireCurrent=false}={}){
  return async ({version})=>{
    const record=await service.memory.load();
    if(version==='current'||currentProfileVersion(version))return currentProfilePacket(record,service.owner,version);
    if(requireCurrent&&version!=='current'&&record.state.snapshots.at(-1)?.version!==version)throw new ProfileError('The active profile changed. Return to Profile and save the current master profile again.',409);
    const packet=savedPacket(record.state,version==='current'?undefined:version);
    const verification=requireCurrent||packet.snapshot.saveIntegrityVersion===1?await finalProfileVerification(record,packet.snapshot):null;
    return {...packet,consolidatedProfile:packet.snapshot.consolidated||buildConsolidatedProfile(record.state,{snapshot:packet.snapshot}),profileSummary:{saveVerification:verification,unresolvedQuestionCount:record.state.questions.filter(q=>['unresolved','needs_details','deferred'].includes(q.status)).length,pendingFactCount:record.state.facts.filter(f=>f.lifecycle==='active'&&f.approval==='pending').length},searchPreferences:packet.snapshot.searchPreferences||record.state.preferences.search||{},searchHistory:record.state.scoutSeen||[]};
  };
}

// Profile-owned conversion to the Python contract. Do not expose this loader to
// Scout: its full facts are for Master/Matcher/Tailor/Critic only.
export function pythonProfileLoader(service){
  return async version=>{
    const record=await service.memory.load(),{state}=record;
    if(currentProfileVersion(version)){
      const packet=await currentProfilePacket(record,service.owner,version),p=packet.searchPreferences;
      return {version,source_ref:packet.facts.sourceRef,current:true,facts:packet.facts.records.map(f=>({id:f.id,text:[f.category,f.scope,f.statement].filter(Boolean).join(' | '),version:f.version,...(f.confirmation==='source_stated'?{confirmation:'source_stated',source_kind:'resume'}:{approval_ref:f.approvalRef,confirmation:f.confirmation==='independently_verified'?'independently_verified':'user_confirmed'}),evidence:f.evidence.map(e=>({source_id:e.segmentId,quote:e.quote}))})),roles:[],search_profile:{...normalizeScoutContext(packet.searchProfile.context),previousSeen:state.scoutSeen||[]},preferences:{location:p.location||'',arrangement:p.arrangement==='on-site'?'onsite':p.arrangement||'any',employment:p.employment||'',seniority:p.seniority||'',prefer_sponsorship:p.preferSponsorship===true}};
    }
    if(state.snapshots.at(-1)?.version!==version)throw new ProfileError('The active profile changed. Activate and select your current profile again.',409);
    const packet=savedPacket(state,version);
    assertFinalProfileIntegrity(state,packet.snapshot);
    const approval=(ref,kind,recordId,recordVersion)=>state.approvals.some(a=>a.id===ref&&a.kind===kind&&a.recordId===recordId&&a.recordVersion===recordVersion&&a.actor===service.owner&&a.decision==='approved');
    if(!approval(packet.snapshot.approvalRef,'snapshot',packet.snapshot.id,packet.snapshot.version))throw new ProfileError('The profile snapshot approval is not valid for this account.',409);
    const facts=packet.facts.records.map(f=>{
      if(!approval(f.approvalRef,'fact',f.id,f.version))throw new ProfileError('A fact approval changed. Review your profile again.',409);
      for(const e of f.evidence){const document=state.documents.find(d=>d.id===e.documentId&&!d.deleted);const segment=document?.segments.find(p=>p.id===e.segmentId);if(!segment||!segment.text.includes(e.quote))throw new ProfileError('Approved evidence is no longer available.',409);}
      return {id:f.id,text:[f.category,f.scope,f.statement].filter(Boolean).join(' | '),version:f.version,approval_ref:f.approvalRef,confirmation:f.confirmation==='independently_verified'?'independently_verified':'user_confirmed',evidence:f.evidence.map(e=>({source_id:e.segmentId,quote:e.quote}))};
    });
    // Search uses the saved master profile, never a generated role proposal.
    const searchProfile=packet.searchProfile||packet.snapshot.searchProfile;
    if(!searchProfile||searchProfile.basis!=='validated_source_data')throw new ProfileError('Build and save the source-backed master profile before research.',409);
    const searchContext={...normalizeScoutContext(searchProfile.context),previousSeen:state.scoutSeen||[]};
    const p=packet.snapshot.searchPreferences||state.preferences.search||{};
    return {version:packet.facts.version,approval_ref:packet.facts.approvalRef,current:true,facts,roles:[],search_profile:searchContext,preferences:{location:p.location||'',arrangement:p.arrangement==='on-site'?'onsite':p.arrangement||'any',employment:p.employment||'',seniority:p.seniority||'',prefer_sponsorship:p.preferSponsorship===true}};
  };
}
