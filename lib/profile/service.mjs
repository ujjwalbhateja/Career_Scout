import {Annotation,StateGraph,START,END} from '@langchain/langgraph';
import {auditRoute} from '../workflow/policy.mjs';
import {ProfileError,LIMITS,clean,id,now,digest,emptyProfile,addDocument,proposeFacts,decideFacts,correctFact,resolveConflict,addAnswer,addJDAnalysis,buildProfiles,approveRole,finalize,savedPacket,removeDocument,enqueue,approvedFacts} from './domain.mjs';
import {ProfileMemory,analyzeWithModel,providerStatus} from './providers.mjs';
import {extractDocument} from './extraction.mjs';
import {readJDLink} from './link-intake.mjs';

// The child receives a scoped payload; it cannot access memory or another child.
async function childTask(kind,payload,adapter){
  const State=Annotation.Root({payload:Annotation(),result:Annotation(),phase:Annotation(),audit:Annotation({reducer:(a,b)=>[...a,...b],default:()=>[]})});
  const graph=new StateGraph(State)
    .addNode('profile',s=>s.phase?{}:{audit:[auditRoute('profile',kind,'scoped-profile-task')]})
    .addNode(kind,async s=>({result:await adapter(structuredClone(s.payload)),phase:'returned',audit:[auditRoute(kind,'profile','profile-task-result')]}))
    .addEdge(START,'profile').addConditionalEdges('profile',s=>s.phase?'end':'child',{child:kind,end:END}).addEdge(kind,'profile').compile();
  return graph.invoke({payload});
}
function inputDocument(d){return {documentId:d.id,kind:d.kind,title:d.title,segments:d.segments};}
const factContext=s=>approvedFacts(s).filter(f=>!['personal','preferences'].includes(f.category)).map(f=>({id:f.id,version:f.version,category:f.category,field:f.field,scope:f.scope,statement:f.statement}));
function builderContext(s){
  const documents=s.documents.filter(d=>d.selected&&d.kind==='jd'&&!d.deleted);
  return {selectedJDs:documents.map(d=>({id:d.id,roleName:d.roleName||d.title,sector:d.sector})),requirements:s.requirements.filter(r=>documents.some(d=>d.id===r.documentId)).map(r=>({id:r.id,text:r.text,category:r.category,importance:r.importance})),approvedFacts:factContext(s),answerHistory:s.questions.map(q=>({capability:q.capability,scope:q.scope,status:q.status,answer:s.answers.filter(a=>a.questionId===q.id).at(-1)?.text||''})),disclosurePreferences:s.preferences.disclosure||[]};
}
function saveSearchPreferences(s,input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ProfileError('Enter valid search preferences.');
  s.preferences.search={goals:clean(input.goals,1500),location:clean(input.location,600),arrangement:['any','remote','hybrid','on-site'].includes(input.arrangement)?input.arrangement:'any',employment:['any','full-time','part-time','contract','internship'].includes(input.employment)?input.employment:'any',seniority:['any','intern','junior','mid','senior','lead','manager','director'].includes(input.seniority)?input.seniority:'any',preferSponsorship:input.preferSponsorship===true};
}
function assertRevision(record,revision){if(!Number.isInteger(revision)||record.revision!==revision)throw new ProfileError('Your profile changed. Reload before continuing.',409);}
export class ProfileService{
  constructor(env,owner){this.env=env;this.owner=owner;this.memory=new ProfileMemory(env,owner);}
  async read(){return {...await this.memory.load(),providers:providerStatus(this.env),limits:LIMITS};}
  async drainBackground(){
    if(!providerStatus(this.env).pinecone)return;
    const record=await this.memory.load();
    if(record.state.deletion||!record.state.outbox.some(e=>e.kind==='reindex'&&e.status==='pending'))return;
    await this.action({action:'sync',revision:record.revision,background:true});
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
    const path=await this.memory.upload(document,bytes,parsed.mime);
    record.state.documents.at(-1).objectPath=path;
    try{return await this.memory.save(record.revision,record.state);}
    catch(e){await this.memory.removeFiles([path]).catch(()=>{});throw e;}
  }
  async action(body){
    let record=await this.memory.load();assertRevision(record,body.revision);
    const s=record.state,action=body.action;
    if(s.deletion&&!['deleteProfile','export'].includes(action))throw new ProfileError('Deletion is pending. Retry deletion to finish.',409);
    const lease=s.memoryIntent,leaseRun=lease&&s.runs.find(r=>r.id===lease.runId);
    if(lease&&Date.parse(lease.expiresAt)>Date.now()&&leaseRun?.status!=='complete'&&!['export','retrieve'].includes(action))throw new ProfileError('Semantic indexing is finishing or recovering. Retry after its five-minute safety window.',409);
    let result=null;
    if(['prepare','buildProfiles','finalize'].includes(action)&&body.search)saveSearchPreferences(s,body.search);
    if(action==='importJD'){
      if(s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted).length>=15)throw new ProfileError('Use at most 15 optional JDs.');
      const document=await readJDLink(clean(body.url,3000));addDocument(s,document);
    }else if(action==='prepare'){
      const documents=s.documents.filter(d=>!d.deleted&&d.analysis!=='complete'&&(d.kind==='resume'||d.kind==='answer'||(d.kind==='jd'&&d.selected)));
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
    }else if(action==='selectJD'){
      const d=s.documents.find(d=>d.id===body.id&&d.kind==='jd'&&!d.deleted);if(!d)throw new ProfileError('JD not found.',404);
      if(body.selected&&s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted).length>=15&&!d.selected)throw new ProfileError('Select at most 15 onboarding JDs.');
      d.selected=body.selected===true;
    }else if(action==='analyze'||action==='buildProfiles'||action==='assessJD'){
      return this.analysis(record,body);
    }else if(action==='decideFacts'){
      decideFacts(s,body.decisions,this.owner);
      result={kind:'fact_decisions',decisions:body.decisions.map(d=>{const f=s.facts.find(f=>f.id===d.id&&f.version===d.version&&f.lifecycle==='active');return {id:f.id,version:f.version,decision:f.approval,approvalRef:f.approvalRef};})};
    }
    else if(action==='correctFact')await correctFact(s,body);
    else if(action==='resolveConflict')resolveConflict(s,body.id);
    else if(action==='answer'){
      const answer=await addAnswer(s,body);
      if(body.analyze===true&&answer.status==='answered'){
        const saved=await this.memory.save(record.revision,s);
        return this.analysis(saved,{action:'analyze',id:answer.documentId});
      }
    }
    else if(action==='approveRole')approveRole(s,body.id,this.owner);
    else if(action==='finalize')result=finalize(s,this.owner);
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
      s.preferences.disclosure=Array.isArray(body.disclosure)?body.disclosure.map(x=>clean(x,300)).slice(0,30):s.preferences.disclosure||[];
      if(body.search)saveSearchPreferences(s,body.search);
    }else if(action==='export')return {...record,result:{schemaVersion:1,exportedAt:now(),profile:s,originalFiles:s.documents.filter(d=>d.objectPath&&!d.deleted).map(d=>({id:d.id,filename:d.filename,downloadPath:'/api/profile?download='+encodeURIComponent(d.id)}))}};
    else if(action==='deleteProfile'){
      if(body.confirmation!=='DELETE MY PROFILE')throw new ProfileError('Type DELETE MY PROFILE to confirm deletion.');
      if(!s.deletion){s.deletion={status:'pending',requestedAt:now()};record=await this.memory.save(record.revision,s);}
      await this.memory.purge(record.state,record.revision);
      return {revision:record.revision+1,state:emptyProfile(),deleted:true};
    }else throw new ProfileError('Unknown Profile action.');
    const saved=await this.memory.save(record.revision,s);
    return {...saved,result};
  }
  async analysis(record,body){
    const s=record.state;
    if(!providerStatus(this.env).model)throw new ProfileError('An analysis model must be configured before this step.',503);
    const d=s.documents.find(d=>d.id===body.id&&!d.deleted);
    if(body.action==='analyze'&&!d)throw new ProfileError('Document not found.',404);
    if(body.action==='assessJD'&&(!d||d.kind!=='jd'))throw new ProfileError('Select a saved JD.',400);
    if(body.action==='buildProfiles'){
      if(!['resume','jd','guided'].includes(body.mode||'jd'))throw new ProfileError('Choose resume or JD role building.');
      const selected=s.documents.filter(d=>d.selected&&d.kind==='jd'&&!d.deleted);
      if(body.mode!=='resume'&&(selected.length<(body.mode==='guided'?1:10)||selected.length>15))throw new ProfileError(body.mode==='guided'?'Add at least one JD or build from your resume alone.':'Select 10–15 onboarding JDs, or choose resume-only building.');
      if(body.mode!=='resume'&&selected.some(d=>d.analysis!=='complete'))throw new ProfileError('Analyze all selected JDs first.');
      if(!factContext(s).length)throw new ProfileError('Approve your experience, education or skills first.');
    }
    const running=s.runs.find(r=>r.status==='running'&&Date.now()-Date.parse(r.startedAt)<120000);
    if(running)throw new ProfileError('An analysis is running. Wait, then reload.',409);
    for(const stale of s.runs.filter(r=>r.status==='running')){stale.status='interrupted';stale.finishedAt=now();}
    await this.memory.reserve();
    const run={id:id('run'),action:body.action,documentId:d?.id||null,status:'running',startedAt:now(),audit:[auditRoute('master','profile','profile-operation')]};
    s.runs.push(run);record=await this.memory.save(record.revision,s);
    try{
      if(body.action==='analyze'){
        if(d.kind==='jd'){
          const child=await childTask('profile-builder',inputDocument(d),input=>analyzeWithModel(this.env,'jd',input));
          run.audit.push(...child.audit);await addJDAnalysis(s,d.id,child.result);
        }else{
          const child=await childTask('fact',inputDocument(d),input=>analyzeWithModel(this.env,'facts',input));
          run.audit.push(...child.audit);await proposeFacts(s,child.result.facts,d.kind==='answer'?'user_answer':'resume');d.analysis='complete';
          const covered=new Set(s.facts.flatMap(f=>f.evidence.filter(e=>e.documentId===d.id).map(e=>e.segmentId)));
          d.coverage={sourcePassages:d.segments.length,referencedPassages:covered.size,unreferencedPassages:d.segments.filter(p=>!covered.has(p.id)).map(p=>p.id)};
          enqueue(s,'reindex');
        }
      }else if(body.action==='buildProfiles'){
        const resumeOnly=body.mode==='resume';
        const full=builderContext(s),context=resumeOnly?{mode:'resume',approvedFacts:factContext(s),answerHistory:full.answerHistory,disclosurePreferences:full.disclosurePreferences,searchGoals:s.preferences.search?.goals||''}:{...full,searchGoals:s.preferences.search?.goals||''};
        const child=await childTask('profile-builder',context,input=>analyzeWithModel(this.env,resumeOnly?'resume_builder':'builder',input));
        run.audit.push(...child.audit);await buildProfiles(s,child.result,resumeOnly?'resume':body.mode==='guided'?'guided':'jd');
      }else{
        const packet=savedPacket(s),requirements=s.requirements.filter(r=>r.documentId===d.id);
        if(!requirements.length)throw new ProfileError('Analyze this JD first.');
        const snapshotFacts=packet.facts.records.filter(f=>!['personal','preferences'].includes(f.category));
        const context={requirements:requirements.map(r=>({id:r.id,text:r.text,importance:r.importance})),approvedFacts:snapshotFacts.map(f=>({id:f.id,version:f.version,category:f.category,scope:f.scope,statement:f.statement})),roleProfiles:packet.roleProfiles.map(p=>({id:p.id,roleName:p.roleName}))};
        const child=await childTask('profile-builder',context,input=>analyzeWithModel(this.env,'assessment',input));run.audit.push(...child.audit);
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
    if(requireCurrent&&version!=='current'&&record.state.snapshots.at(-1)?.version!==version)throw new ProfileError('The active profile changed. Return to Profile and choose your role again.',409);
    return {...savedPacket(record.state,version==='current'?undefined:version),searchPreferences:record.state.preferences.search||{}};
  };
}
