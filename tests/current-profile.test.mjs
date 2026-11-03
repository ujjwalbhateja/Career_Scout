import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile,addDocument,proposeFacts,decideFacts,addJDAnalysis,buildProfiles,canonicalJSON} from '../lib/profile/domain.mjs';
import {buildRoleQuestionnaires} from '../lib/profile/builder-expansion.mjs';
import {ProfileService,pythonProfileLoader} from '../lib/profile/service.mjs';
import {currentProfilePacket} from '../lib/profile/current-profile.mjs';
import {previewProfileScout,createScoutHandoffReceipt,persistScoutHandoff} from '../lib/workflow/scout-handoff.mjs';
import {normalizeScoutContext,planScoutQueries} from '../lib/workflow/scout-policy.mjs';
import {applicationRequest} from '../lib/workflow/pipeline-client.mjs';

async function fixture({questions=true}={}){
  const state=emptyProfile(),source='Professional Experience\nPortfolio Analyst\nPrepared monthly client reports using Excel.\nSkills: Excel\nContact: private@example.test';
  addDocument(state,{id:'cv',kind:'resume',title:'Synthetic resume',hash:'cv',segments:[{id:'cv.1',text:source}]});
  const proposals=[['employment','job_title','Portfolio Analyst'],['skills','tools_technologies','Excel'],['personal','email','private@example.test']];
  await proposeFacts(state,proposals.map(([category,field,statement])=>({category,field,statement,scope:'Resume',evidence:[{documentId:'cv',segmentId:'cv.1',quote:statement}]})));
  if(questions){
    // Existing prior approval; the other resume records remain pending.
    decideFacts(state,[{id:state.facts[1].id,version:1,decision:'approved'}],'owner');
    const reqs=[['Prepared stress reports','task'],['SQL','skill'],['Led acquisitions','task'],['Managed global operations','task']];
    addDocument(state,{id:'jd',kind:'jd',title:'Risk Analyst',selected:true,hash:'jd',segments:[{id:'jd.1',text:'Risk Analyst\n'+reqs.map(r=>r[0]).join('; ')}]});
    await addJDAnalysis(state,'jd',{roleName:'Risk Analyst',requirements:reqs.map(([text,category])=>({text,category,importance:'required',evidence:[{documentId:'jd',segmentId:'jd.1',quote:text}]}))});
    await buildProfiles(state,{questions:[],mappings:state.requirements.map(r=>({requirementId:r.id,factIds:[],evidenceStatus:'not_established',explanation:'This specific experience is not established.'}))},'analysis');
  }
  let record={revision:1,state},writes=0,failWrite=false,failReload=false,wrote=false;
  const service=new ProfileService({},'owner');
  service.memory.load=async()=>{if(wrote&&failReload)throw Error('storage read unavailable');return structuredClone(record);};
  service.memory.save=async(revision,state)=>{assert.equal(revision,record.revision);if(failWrite)throw Error('storage write unavailable');record={revision:revision+1,state:structuredClone(state)};writes++;wrote=true;return structuredClone(record);};
  const request=(statement,decision,extra={})=>{
    const row=buildRoleQuestionnaires(record.state).flatMap(g=>[...g.experience,...g.skills]).find(r=>r.proposedStatement===statement);assert.ok(row,statement);
    return {action:'reviewBuilder',revision:record.revision,submissionId:crypto.randomUUID(),rows:[{rowId:row.id,fingerprint:row.fingerprint,decision,...extra}]};
  };
  return {service,request,get record(){return record;},get writes(){return writes;},set failWrite(v){failWrite=v;},set failReload(v){failReload=v;}};
}

test('resume-only current profile requires no repeated approval, model analysis or Final Profile snapshot',async()=>{
  const f=await fixture({questions:false}),before=canonicalJSON(f.record.state),loaded=await f.service.read();
  assert.equal(loaded.currentProfile.ready,true);assert.equal(f.record.state.documents[0].analysis,'pending');
  const preview=await previewProfileScout(f.service,{version:'current'});
  assert.equal(preview.plan.scoutContext.approvedFactIds.length,0);assert.ok(preview.plan.scoutContext.resumeFactIds.length>0);
  assert.ok(preview.plan.scoutContext.skills.some(x=>x.term==='Excel'));
  assert.ok(preview.plan.scoutContext.responsibilities.some(x=>x.term.includes('monthly client reports')));
  assert.ok(preview.plan.scoutContext.titles.some(x=>x.term==='Portfolio Analyst'));
  assert.doesNotMatch(JSON.stringify(preview),/private@example/);
  assert.ok(planScoutQueries(preview.plan.scoutContext).queries.length>0);
  assert.equal(canonicalJSON(f.record.state),before);assert.equal(f.writes,0);assert.equal(f.record.state.snapshots.length,0);
});

test('explicit work-visa preferences survive storage, same-version handoff and Python conversion without changing facts',async()=>{
  const f=await fixture({questions:false}),originalFacts=structuredClone(f.record.state.facts);
  await f.service.action({action:'preferences',revision:f.record.revision,search:{onWorkVisa:true,location:'United States'}});
  const preview=await previewProfileScout(f.service,{version:'current'});
  assert.equal(preview.plan.criteria.onWorkVisa,true);
  assert.equal(preview.handoff.summary.preferences.onWorkVisa,true);
  const packet=await pythonProfileLoader(f.service)(preview.plan.selection.version);
  assert.equal(packet.preferences.on_work_visa,true);
  const overridden=await previewProfileScout(f.service,preview.plan.selection,{onWorkVisa:false});
  assert.equal(overridden.plan.criteria.onWorkVisa,false);
  assert.equal(overridden.plan.selection.version,preview.plan.selection.version);
  assert.notEqual(overridden.handoff.planHash,preview.handoff.planHash);
  assert.deepEqual(overridden.plan.scoutContext,preview.plan.scoutContext);
  // Older preference forms cannot silently reset the user's stored selection.
  await f.service.action({action:'preferences',revision:f.record.revision,search:{location:'New York'}});
  assert.equal(f.record.state.preferences.search.onWorkVisa,true);
  assert.deepEqual(f.record.state.facts,originalFacts);
  assert.equal(f.record.state.snapshots.length,0);
});

test('Builder approval flows through database reload, Master and Scout without finalization; original resume records are unchanged',async()=>{
  const f=await fixture(),originalFacts=structuredClone(f.record.state.facts),originalSnapshots=structuredClone(f.record.state.snapshots);
  let saved;
  for(const [statement,decision,extra] of [['Prepared stress reports','approve'],['SQL','approve'],['Led acquisitions','reject'],['Managed global operations','somewhat',{text:'Assisted regional operations'}]]){
    saved=await f.service.action(f.request(statement,decision,extra));assert.equal(saved.result.storageVerified,true);
  }
  const read=await f.service.read(),version=read.currentProfile.version;
  assert.equal(read.currentProfile.verification.questionnaireFactCount,2);
  for(const original of originalFacts)assert.deepEqual(read.state.facts.find(f=>f.id===original.id),original);
  assert.deepEqual(read.state.snapshots,originalSnapshots);
  assert.equal(read.state.scoutHandoffs?.length||0,0);
  const preview=await previewProfileScout(f.service,{version});
  assert.equal(preview.plan.profileReceipt.contentHash,read.currentProfile.verification.contentHash);
  assert.ok(preview.plan.scoutContext.skills.some(x=>x.term==='SQL'));
  assert.ok(preview.plan.scoutContext.responsibilities.some(x=>x.term==='Prepared stress reports'));
  assert.doesNotMatch(JSON.stringify(preview.plan),/Led acquisitions|Managed global operations|Assisted regional operations/);
  const receipt=await createScoutHandoffReceipt(preview.plan,preview.audit,{stage:'dispatched'});
  await persistScoutHandoff(f.service,receipt);await f.service.saveScoutHistory(version,[]);
  assert.equal((await f.service.read()).currentProfile.version,version,'receipt/history writes do not change professional content');
  const python=await pythonProfileLoader(f.service)(version);
  assert.equal(python.source_ref,preview.plan.profileReceipt.contentHash);
  assert.ok(python.facts.some(f=>f.text.includes('SQL')&&f.approval_ref));
  assert.ok(python.facts.some(f=>f.confirmation==='source_stated'&&f.source_kind==='resume'&&!f.approval_ref));
  assert.equal(applicationRequest({profileSelection:{roleId:'master-profile',version}}).saved_profile_version,version);
});

test('Somewhat stays draft until exact revised wording is separately approved',async()=>{
  const f=await fixture(),before=(await f.service.read()).currentProfile.version;
  await f.service.action(f.request('Managed global operations','somewhat',{text:'Assisted regional operations'}));
  assert.equal((await f.service.read()).currentProfile.version,before);
  const row=buildRoleQuestionnaires(f.record.state).flatMap(g=>g.experience).find(r=>r.proposedStatement==='Managed global operations');
  const saved=await f.service.action(f.request('Managed global operations','approve_revision',{text:row.revisionText,draftVersion:row.draftVersion}));
  assert.notEqual(saved.currentProfile.version,before);
  const packet=await currentProfilePacket(f.record,'owner');
  assert.ok(packet.facts.records.some(f=>f.statement==='Assisted regional operations'));
  assert.ok(!packet.facts.records.some(f=>f.statement==='Managed global operations'));
});

test('failed writes and lost reloads retain retry identity and never duplicate approved facts',async()=>{
  for(const failure of ['write','reload']){
    const f=await fixture(),request=f.request('SQL','approve');
    f.failWrite=failure==='write';f.failReload=failure==='reload';
    await assert.rejects(f.service.action(request));
    assert.equal(f.record.state.facts.filter(f=>f.statement==='SQL').length,failure==='write'?0:1);
    f.failWrite=false;f.failReload=false;
    const saved=await f.service.action(request),writes=f.writes;
    assert.equal(saved.result.storageVerified,true);assert.equal(saved.currentProfile.ready,true);
    const again=await f.service.action(request);assert.equal(again.result.storageVerified,true);
    assert.equal(f.writes,writes);assert.equal(f.record.state.facts.filter(f=>f.statement==='SQL').length,1);
  }
});

test('a write acknowledgement without durable decisions cannot claim a successful approval',async()=>{
  const f=await fixture();f.service.memory.save=async(revision,state)=>({revision:revision+1,state});
  await assert.rejects(f.service.action(f.request('SQL','approve')),/Could not confirm/);
  assert.ok(!f.record.state.facts.some(f=>f.statement==='SQL'));
});

test('new approvals and removed source evidence invalidate an older dispatch without consulting snapshots',async()=>{
  const f=await fixture(),old=await previewProfileScout(f.service,{version:'current'});
  const receipt=await createScoutHandoffReceipt(old.plan,old.audit,{stage:'dispatched'});
  await f.service.action(f.request('SQL','approve'));
  await assert.rejects(persistScoutHandoff(f.service,receipt),/stored profile changed/);
  const latest=await previewProfileScout(f.service,{version:'current'});assert.notEqual(latest.plan.selection.version,old.plan.selection.version);
  const fact=f.record.state.facts.find(f=>f.statement==='SQL');
  f.record.state.documents.find(d=>d.id===fact.evidence[0].documentId).deleted=true;
  const after=await previewProfileScout(f.service,{version:'current'});assert.ok(!after.plan.scoutContext.skills.some(t=>t.term==='SQL'));
  assert.ok(f.record.state.facts.some(f=>f.statement==='SQL'),'history is preserved');
});

test('rejected/conflicting/unavailable resume evidence, foreign approvals and JD requirements never become eligible claims',async()=>{
  const f=await fixture({questions:false}),s=f.record.state,excel=s.facts.find(f=>f.statement==='Excel');
  excel.approval='rejected';
  s.facts.find(f=>f.field==='job_title').conflict=true;
  s.documents[0].segments.push({id:'cv.2',text:'Python'});
  await proposeFacts(s,[{category:'skills',field:'programming_languages',scope:'Resume',statement:'Python',evidence:[{documentId:'cv',segmentId:'cv.2',quote:'Python'}]}]);
  addDocument(s,{id:'answer',kind:'answer',hash:'answer',segments:[{id:'answer.1',text:'Foreign tool'}]});
  const [foreign]=await proposeFacts(s,[{category:'skills',field:'tools',scope:'Answer',statement:'Foreign tool',evidence:[{documentId:'answer',segmentId:'answer.1',quote:'Foreign tool'}]}],'user_answer');
  decideFacts(s,[{id:foreign.id,version:foreign.version,decision:'approved'}],'another-owner');
  addDocument(s,{id:'jd',kind:'jd',selected:true,title:'JD',hash:'jd',segments:[{id:'jd.1',text:'Invented requirement tool'}]});
  s.facts.push({...structuredClone(excel),id:'jd-fact',approval:'pending',statement:'Invented requirement tool',evidence:[{documentId:'jd',segmentId:'jd.1',quote:'Invented requirement tool'}]});
  const packet=await currentProfilePacket(f.record,'owner');
  assert.ok(!packet.facts.records.some(f=>[excel.id,'jd-fact',foreign.id].includes(f.id)));
  assert.ok(!packet.searchProfile.titles.some(t=>t.term==='Portfolio Analyst'));
  await assert.rejects(persistScoutHandoff(f.service,{profileVersion:packet.facts.version,snapshotId:'current-profile',profileReceipt:{profileVersion:packet.facts.version,snapshotId:'current-profile',contentHash:'0'.repeat(64)}}));
});

test('source references cannot be forged during Scout narrowing',async()=>{
  const f=await fixture({questions:false}),preview=await previewProfileScout(f.service,{version:'current'});
  const context=normalizeScoutContext(preview.plan.scoutContext);context.resumeFactIds.push('fabricated');
  await assert.rejects(createScoutHandoffReceipt(preview.plan,preview.audit,{context}),/unsupported resume/);
});

test('JSONB key ordering and background metadata do not change the current professional version',async()=>{
  const f=await fixture({questions:false}),first=await currentProfilePacket(f.record,'owner');
  const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().reverse().map(k=>[k,reorder(v[k])])):v;
  const stored=reorder(f.record);stored.revision++;stored.state.runs.push({id:'index',status:'complete'});
  assert.equal((await currentProfilePacket(stored,'owner')).facts.version,first.facts.version);
});
