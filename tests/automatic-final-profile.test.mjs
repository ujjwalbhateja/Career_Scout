import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile,addDocument,proposeFacts,decideFacts,addJDAnalysis,buildProfiles,savedPacket,canonicalJSON} from '../lib/profile/domain.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
import {finalProfileSavePlan} from '../lib/profile/final-profile-save.mjs';
import {finalProfileSaveReceiptMatches} from '../lib/profile/client-state.mjs';
import {buildRoleQuestionnaires,applyBuilderReview} from '../lib/profile/builder-expansion.mjs';
import {previewProfileScout,createScoutHandoffReceipt,persistScoutHandoff} from '../lib/workflow/scout-handoff.mjs';

async function setup(t){
  const s=emptyProfile();addDocument(s,{id:'cv',kind:'resume',title:'Synthetic resume',hash:'cv',segments:[{id:'cv.1',text:'Professional Experience\nPrepared client reports using Excel.'}]});s.documents[0].analysis='complete';
  await proposeFacts(s,[{category:'experience_claims',field:'duties',scope:'Example employer',statement:'Prepared client reports',evidence:[{documentId:'cv',segmentId:'cv.1',quote:'Prepared client reports'}]}]);decideFacts(s,[{id:s.facts[0].id,version:1,decision:'approved'}],'owner');
  let record={revision:1,state:s};const service=new ProfileService({GEMINI_API_KEY:'fixture-only'},'owner');
  const calls=[],writes=[];let failure=false,bad=false,race=false,failSave=false;
  service.memory.load=async()=>structuredClone(record);service.memory.reserve=async()=>{};
  service.memory.save=async(revision,state)=>{assert.equal(revision,record.revision,'atomic revision guard');if(failSave&&state.snapshots.length>record.state.snapshots.length)throw Error('storage unavailable');record={revision:revision+1,state:structuredClone(state)};writes.push(record.revision);return structuredClone(record);};
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const body=JSON.parse(options.body),input=JSON.parse(body.contents[0].parts[0].text);calls.push(input);
    if(failure)return Response.json({error:{message:'provider unavailable'}},{status:503});
    if(race){race=false;record.revision++;record.state.preferences.disclosure=['Concurrent user change'];}
    let output;
    if(input.documentId){const text='Prepare client reports';output={roleName:'Reporting Analyst',sector:'',requirements:[{text,category:'task',importance:'required',evidence:[{documentId:input.documentId,segmentId:input.segments[0].id,quote:text}]}]};}
    else output={assessments:Object.fromEntries(input.requirements.map(r=>[r.id,{factIds:bad?[]:[input.approvedFacts[0].id],evidenceStatus:bad?'not_established':'supported',explanation:bad?'No established evidence.':'Approved reporting work supports this requirement.',atsArea:'Client Reporting',profileCoverage:{relevance:'material',components:[{scope:bad?'Invented requirement':r.text,weight:3,sourceIds:bad?[]:[input.sourceRecords[0].id],critical:false}],explanation:'Reporting compared with saved source evidence.'},...(input.evidenceValidation?{evidenceReview:{consideredSourceIds:input.sourceRecords.map(r=>r.id),reason:'Reviewed the saved source and approved work evidence independently.'}}:{})}]))};
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]});
  });
  async function addJD(id,{analyzed=true}={}){
    const text='Prepare client reports';addDocument(record.state,{id,kind:'jd',title:'Reporting Analyst',hash:id,selected:true,segments:[{id:id+'.1',text:'Reporting Analyst '+id+'\n'+text}]});
    if(analyzed)await addJDAnalysis(record.state,id,{roleName:'Reporting Analyst',requirements:[{text,category:'task',importance:'required',evidence:[{documentId:id,segmentId:id+'.1',quote:text}]}]});
  }
  const act=(body={})=>service.action({action:'saveFinalProfile',revision:record.revision,...body});
  return {service,calls,writes,addJD,act,get record(){return record;},set failure(v){failure=v;},set bad(v){bad=v;},set race(v){race=v;},set failSave(v){failSave=v;}};
}

test('save refreshes stale comparisons, checks the snapshot receipt, and repeats without model calls or new approvals',async t=>{
  const f=await setup(t);await f.addJD('jd1');const facts=canonicalJSON(f.record.state.facts),approvals=canonicalJSON(f.record.state.approvals);
  const first=await f.act();assert.equal(first.result.kind,'consolidated_profile_saved');assert.deepEqual(first.result.refreshedDocumentIds,['jd1']);assert.equal(f.calls.length,1);assert.ok(finalProfileSaveReceiptMatches(first));
  assert.equal(canonicalJSON(first.state.facts),facts);assert.equal(canonicalJSON(first.state.approvals.filter(a=>a.kind==='fact')),approvals);
  const calls=f.calls.length,writes=f.writes.length,again=await f.act();assert.equal(again.result.id,first.result.id);assert.equal(f.calls.length,calls);assert.equal(f.writes.length,writes);assert.equal(again.state.snapshots.length,1);assert.equal(again.state.approvals.length,first.state.approvals.length);
  const tampered=structuredClone(first);tampered.result.version='invented';assert.equal(finalProfileSaveReceiptMatches(tampered),false);
  const unbound=structuredClone(first);unbound.state.approvals=unbound.state.approvals.filter(a=>a.kind!=='snapshot');assert.equal(finalProfileSaveReceiptMatches(unbound),false);
});

test('only a newly added JD is extracted and compared; current older comparisons are reused in a full validated snapshot',async t=>{
  const f=await setup(t);await f.addJD('old');await f.act();const n=f.calls.length,oldReview=canonicalJSON(f.record.state.builderReviews);
  await f.addJD('new',{analyzed:false});const result=await f.act();
  assert.equal(result.result.kind,'consolidated_profile_saved');assert.deepEqual(result.result.refreshedDocumentIds,['new']);
  assert.equal(f.calls[n].documentId,'new');assert.ok(f.calls.slice(n+1).every(c=>c.requirements.every(r=>r.documentId==='new')));
  assert.equal(canonicalJSON(result.state.builderReviews.slice(0,1)),oldReview);assert.deepEqual([...savedPacket(result.state).snapshot.reviewScope.documentIds].sort(),['new','old']);
  assert.ok(result.state.builderReviews.at(-1).reusedReviewIds.length===2);assert.ok(finalProfileSaveReceiptMatches(result));
});

test('changed facts invalidate every dependent comparison; unchanged JD inputs alone do not permit reuse',async t=>{
  const f=await setup(t);await f.addJD('a');await f.addJD('b');await f.act();const n=f.calls.length;
  await proposeFacts(f.record.state,[{category:'skills',field:'tools_technologies',scope:'Skills',statement:'Excel',evidence:[{documentId:'cv',segmentId:'cv.1',quote:'Excel'}]}]);const added=f.record.state.facts.at(-1);decideFacts(f.record.state,[{id:added.id,version:1,decision:'approved'}],'owner');
  const result=await f.act();assert.deepEqual(result.result.refreshedDocumentIds,['a','b']);assert.ok(f.calls.length>n);assert.equal(result.state.snapshots.length,2);
});

test('manual blockers stop before model requests and no new snapshot or approval is saved',async t=>{
  for(const kind of ['conflict','pending_answer','source_coverage','required_question','answer_details','answer_extraction','no_approvals','deletion','indexing'])await t.test(kind,async t=>{
    const f=await setup(t);await f.addJD('a');const s=f.record.state;
    if(kind==='conflict')s.facts[0].conflict=true;
    if(kind==='pending_answer'){s.facts.push({...structuredClone(s.facts[0]),id:'pending',origin:'user_answer',approval:'pending'});}
    if(kind==='source_coverage')s.documents[0].analysis='incomplete';
    if(kind==='required_question')s.questions.push({id:'q',key:'q',status:'unresolved',required:true,question:'Provide details'});
    if(kind==='answer_details'){s.questions.push({id:'q',key:'q'});s.answers.push({id:'a',questionId:'q',key:'q',status:'needs_details',at:new Date().toISOString()});}
    if(kind==='answer_extraction'){s.questions.push({id:'q',key:'q'});s.answers.push({id:'a',questionId:'q',key:'q',status:'answered',documentId:'unextracted',at:new Date().toISOString()});}
    if(kind==='no_approvals')s.facts[0].approval='pending';
    if(kind==='deletion')s.deletion={status:'pending'};
    if(kind==='indexing'){s.runs.push({id:'sync',status:'running'});s.memoryIntent={runId:'sync',expiresAt:new Date(Date.now()+60000).toISOString()};}
    const before=canonicalJSON(s);
    if(['deletion','indexing'].includes(kind))await assert.rejects(f.act());
    else{const r=await f.act();assert.equal(r.result.kind,'final_profile_needs_review');assert.ok(finalProfileSaveReceiptMatches(r));}
    assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);assert.equal(canonicalJSON(f.record.state),before);
  });
});

test('unresolved model comparisons hold the save and never manufacture an approval',async t=>{
  const f=await setup(t);await f.addJD('a');f.bad=true;const facts=canonicalJSON(f.record.state.facts),approvals=canonicalJSON(f.record.state.approvals);
  const r=await f.act();assert.equal(r.result.kind,'final_profile_needs_review');assert.ok(r.result.blockers.some(b=>b.code==='comparison_unresolved'));assert.equal(r.state.snapshots.length,0);assert.equal(canonicalJSON(r.state.facts),facts);assert.equal(canonicalJSON(r.state.approvals),approvals);
  const calls=f.calls.length;await f.act();assert.equal(f.calls.length,calls,'no automatic loop on an unresolved completed review');
});

test('provider failure, concurrent changes, stale client revision and storage failure never report a successful save',async t=>{
  for(const kind of ['provider','concurrency','revision','storage'])await t.test(kind,async t=>{
    const f=await setup(t);await f.addJD('a');if(kind==='provider')f.failure=true;if(kind==='concurrency')f.race=true;if(kind==='storage')f.failSave=true;
    const facts=canonicalJSON(f.record.state.facts),approvals=canonicalJSON(f.record.state.approvals);
    await assert.rejects(f.act(kind==='revision'?{revision:0}:{}));assert.equal(f.record.state.snapshots.length,0);assert.equal(canonicalJSON(f.record.state.facts),facts);assert.equal(canonicalJSON(f.record.state.approvals),approvals);
    if(kind==='concurrency')assert.deepEqual(f.record.state.preferences.disclosure,['Concurrent user change']);
  });
});

test('resume-only save needs no model and does not start Scout',async t=>{
  const f=await setup(t);f.service.env={};const r=await f.act();assert.ok(finalProfileSaveReceiptMatches(r));assert.equal(f.calls.length,0);assert.equal(r.state.scoutHandoffs?.length||0,0);
});

test('prompt changes and tampered source coverage make comparisons stale instead of bypassing checks',async t=>{
  const f=await setup(t);await f.addJD('a');await f.act();
  assert.deepEqual((await finalProfileSavePlan(f.record.state,null)).staleDocumentIds,[]);
  assert.deepEqual((await finalProfileSavePlan(f.record.state,'changed-prompt')).staleDocumentIds,['a']);
  f.record.state.builderReviews.at(-1).sourceComparisons=[];
  assert.deepEqual((await finalProfileSavePlan(f.record.state,null)).staleDocumentIds,['a']);
});

test('unapproved drafts and rejected claims remain excluded, and missing model access cannot bypass a stale comparison',async t=>{
  const f=await setup(t);await f.addJD('a');
  f.record.state.builderExpansion={decisions:[{id:'draft',rowId:'draft-row',documentId:'a',category:'experience_claims',status:'awaiting_approval',originalStatement:'Managed an invented trading desk',revisionText:'Assisted an invented trading desk',version:1},{id:'reject',rowId:'reject-row',documentId:'a',category:'skills',status:'rejected',originalStatement:'Invented proprietary tool',version:1}],submissions:[]};
  const before=canonicalJSON(f.record.state.builderExpansion);f.service.env={};await assert.rejects(f.act(),/Connect the analysis model/);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
  f.service.env={GEMINI_API_KEY:'fixture-only'};const r=await f.act();assert.ok(finalProfileSaveReceiptMatches(r));assert.equal(canonicalJSON(r.state.builderExpansion),before);
  assert.ok(!JSON.stringify(r.state.snapshots.at(-1).consolidated).includes('invented trading desk'));assert.ok(!JSON.stringify(r.state.snapshots.at(-1).consolidated).includes('Invented proprietary tool'));
});

test('incomplete resume analysis and pending resume facts stop before model calls without altering approvals',async t=>{
  for(const kind of ['analysis','pending_facts'])await t.test(kind,async t=>{
    const f=await setup(t);await f.addJD('a');
    if(kind==='analysis')f.record.state.documents[0].analysis='pending';
    else await proposeFacts(f.record.state,[{category:'skills',field:'tools_technologies',scope:'Skills',statement:'Excel',evidence:[{documentId:'cv',segmentId:'cv.1',quote:'Excel'}]}]);
    const before=canonicalJSON(f.record.state),r=await f.act();
    assert.equal(r.result.kind,'final_profile_needs_review');
    assert.ok(r.result.blockers.some(b=>b.code===(kind==='analysis'?'resume_analysis_pending':'resume_facts_pending')));
    assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);assert.equal(canonicalJSON(f.record.state),before);
  });
});

test('explicit Builder approvals survive storage, reach Master and Scout with one version, and exclude drafts and rejections',async t=>{
  const f=await setup(t),s=f.record.state;
  const statements=[['Prepared risk reports','task','approve'],['Python','skill','approve'],['Led acquisitions','task','reject'],['Managed global operations','task','somewhat']];
  addDocument(s,{id:'discovery',kind:'jd',selected:true,title:'Risk Analyst',hash:'discovery',segments:[{id:'discovery.1',text:'Risk Analyst\n'+statements.map(r=>r[0]).join('; ')}]});
  await addJDAnalysis(s,'discovery',{roleName:'Risk Analyst',requirements:statements.map(([text,category])=>({text,category,importance:'required',evidence:[{documentId:'discovery',segmentId:'discovery.1',quote:text}]}))});
  await buildProfiles(s,{questions:[],mappings:s.requirements.map(r=>({requirementId:r.id,factIds:[],evidenceStatus:'not_established',explanation:'This specific scope is not established.'}))},'analysis');
  for(const q of s.questions)q.required=false;
  for(const [statement,,decision] of statements){
    const row=buildRoleQuestionnaires(s).flatMap(g=>[...g.experience,...g.skills]).find(r=>r.proposedStatement===statement);
    assert.ok(row);await applyBuilderReview(s,{submissionId:crypto.randomUUID(),revision:1,rows:[{rowId:row.id,fingerprint:row.fingerprint,decision,...(decision==='somewhat'?{text:'Assisted local operations'}:{})}]},'owner',{revision:1});
  }
  // A previous discovery role can be deselected; its approved experience must persist.
  s.documents.find(d=>d.id==='discovery').selected=false;
  await f.addJD('current');const facts=canonicalJSON(s.facts),decisions=canonicalJSON(s.builderExpansion);
  const saved=await f.act(),v=saved.result.verification;
  assert.ok(finalProfileSaveReceiptMatches(saved));assert.equal(v.questionnaireFactCount,2);
  assert.equal(canonicalJSON(saved.state.facts),facts);assert.equal(canonicalJSON(saved.state.builderExpansion),decisions);
  assert.equal(saved.state.scoutHandoffs?.length||0,0,'saving never dispatches Scout');
  const loaded=await f.service.read();assert.equal(loaded.finalProfileStatus.includedAdditions,2);assert.equal(loaded.finalProfileStatus.verification.contentHash,v.contentHash);
  const preview=await previewProfileScout(f.service,{version:v.profileVersion});
  assert.equal(preview.plan.profileReceipt.contentHash,v.contentHash);assert.equal(preview.plan.selection.version,v.profileVersion);
  assert.ok(preview.plan.scoutContext.skills.some(t=>t.term==='Python'));
  assert.ok(preview.plan.scoutContext.responsibilities.some(t=>t.term==='Prepared risk reports'));
  assert.doesNotMatch(JSON.stringify(preview.plan),/Led acquisitions|Managed global operations|Assisted local operations/);
  const dispatched=await createScoutHandoffReceipt(preview.plan,preview.audit,{stage:'dispatched'});
  const receipt=await persistScoutHandoff(f.service,dispatched);
  assert.equal(receipt.persistence.saved,true);assert.equal(receipt.profileReceipt.contentHash,v.contentHash);
  assert.equal(f.record.state.scoutHandoffs.at(-1).profileVersion,v.profileVersion);
  const writes=f.writes.length,calls=f.calls.length,again=await f.act();
  assert.equal(again.result.version,v.profileVersion);assert.equal(again.result.verification.contentHash,v.contentHash);
  assert.equal(f.writes.length,writes);assert.equal(f.calls.length,calls);
  const forged=structuredClone(dispatched);forged.profileReceipt.contentHash='a'.repeat(64);
  await assert.rejects(persistScoutHandoff(f.service,forged),/profile changed/);
});

test('write acknowledgements without durable data, missing claims and changed projections never report success',async t=>{
  for(const kind of ['no_write','missing_fact','changed_projection','old_revision'])await t.test(kind,async t=>{
    const f=await setup(t),save=f.service.memory.save;
    f.service.memory.save=async(revision,state)=>{
      if(kind==='no_write')return {revision:revision+1,state};
      const result=await save(revision,state);
      if(kind==='missing_fact')f.record.state.snapshots.at(-1).factRefs=[];
      if(kind==='changed_projection')f.record.state.snapshots.at(-1).searchProfile.skills=[];
      if(kind==='old_revision')f.record.revision=revision;
      if(kind==='changed_projection')f.record.state.snapshots.at(-1).searchProfile.label='Unverified content';
      return result;
    };
    await assert.rejects(f.act(),/could not be verified/);
  });
});

test('lost reload after a successful write can be retried without new version, approvals or model work',async t=>{
  const f=await setup(t),load=f.service.memory.load,save=f.service.memory.save;let written=false,fail=true;
  f.service.memory.save=async(...args)=>{const r=await save(...args);written=true;return r;};
  f.service.memory.load=async()=>{if(written&&fail)throw Error('reload unavailable');return load();};
  await assert.rejects(f.act(),/storage reload failed/);assert.equal(f.record.state.snapshots.length,1);
  const before=canonicalJSON(f.record.state),writes=f.writes.length;fail=false;
  const r=await f.act();assert.ok(finalProfileSaveReceiptMatches(r));assert.equal(f.writes.length,writes);
  assert.equal(canonicalJSON(f.record.state),before);assert.equal(f.calls.length,0);
});

test('new approved facts or withdrawn sources between Master preview and Scout persistence invalidate the old handoff',async t=>{
  for(const kind of ['new_fact','withdrawn_source'])await t.test(kind,async t=>{
    const f=await setup(t),saved=await f.act(),preview=await previewProfileScout(f.service,{version:saved.result.version});
    const receipt=await createScoutHandoffReceipt(preview.plan,preview.audit,{stage:'dispatched'});
    if(kind==='withdrawn_source')f.record.state.documents[0].deleted=true;
    else{await proposeFacts(f.record.state,[{category:'skills',field:'tools_technologies',scope:'Skills',statement:'Excel',evidence:[{documentId:'cv',segmentId:'cv.1',quote:'Excel'}]}]);const added=f.record.state.facts.at(-1);decideFacts(f.record.state,[{id:added.id,version:added.version,decision:'approved'}],'owner');}
    await assert.rejects(persistScoutHandoff(f.service,receipt));
    await assert.rejects(previewProfileScout(f.service,{version:saved.result.version}));
    assert.equal(f.record.state.scoutHandoffs?.length||0,0);
  });
});

test('legacy snapshots cannot bypass current-profile validation by omitting the new integrity marker',async t=>{
  const f=await setup(t),saved=await f.act(),snapshot=f.record.state.snapshots.at(-1);
  delete snapshot.saveIntegrityVersion;delete snapshot.consolidated;
  await assert.rejects(previewProfileScout(f.service,{version:saved.result.version}),/consolidated Final Profile/);
  const state=await f.service.read();assert.equal(state.finalProfileStatus.verification,null);
  assert.equal(f.record.state.scoutHandoffs?.length||0,0);
});

test('a newer approved addition after the write prevents a stale successful save receipt',async t=>{
  const f=await setup(t),save=f.service.memory.save;
  f.service.memory.save=async(...args)=>{
    const result=await save(...args),s=f.record.state;
    await proposeFacts(s,[{category:'skills',field:'tools_technologies',scope:'Skills',statement:'Excel',evidence:[{documentId:'cv',segmentId:'cv.1',quote:'Excel'}]}]);
    const added=s.facts.at(-1);decideFacts(s,[{id:added.id,version:added.version,decision:'approved'}],'owner');f.record.revision++;
    return result;
  };
  await assert.rejects(f.act());assert.equal(f.record.state.facts.at(-1).statement,'Excel');
  assert.equal(f.record.state.scoutHandoffs?.length||0,0);
});
