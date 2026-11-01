import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJSON,emptyProfile,finalizationReadiness,savedPacket} from '../lib/profile/domain.mjs';
import {ProfileService,approvedProfileLoader,pythonProfileLoader} from '../lib/profile/service.mjs';
import {createScoutHandoffReceipt,persistScoutHandoff,previewProfileScout} from '../lib/workflow/scout-handoff.mjs';
import {auditRoute} from '../lib/workflow/policy.mjs';

const privateEmail='synthetic-private@example.test';
const resume='At Synthetic Employer, I prepared client reports.\nMy explicitly listed tool is Excel.\nMy email is '+privateEmail+'.';
const example='At Synthetic Employer, I used SQL to reconcile cash records.';
const jobDescription='Treasury Analyst\nResponsibilities include preparing client reports. SQL is required for cash reconciliation work.';
const search={goals:'Private goal: client reporting and cash reconciliation',location:'Boston',arrangement:'hybrid',employment:'full-time',seniority:'mid',preferSponsorship:false};

const reorderKeys=value=>Array.isArray(value)?value.map(reorderKeys):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().reverse().map(key=>[key,reorderKeys(value[key])])):value;
function fixture(t,{jsonb=false}={}){
  const records=new Map(),calls=[],modelCalls=[],conflictOnce=new Set();
  const roundTrip=value=>jsonb?reorderKeys(value):value;
  const current=owner=>roundTrip(structuredClone(records.get(owner)||{revision:0,state:emptyProfile()}));
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    const endpoint=new URL(url),body=JSON.parse(options.body||'{}');
    if(endpoint.hostname==='generativelanguage.googleapis.com'){
      const input=JSON.parse(body.contents[0].parts[0].text),system=body.systemInstruction.parts[0].text;
      const stage=system.match(/CURRENT RUNTIME STAGE: ([a-z_]+)/)?.[1];modelCalls.push({stage,kind:input.kind});
      let output;
      if(stage==='facts'){
        const fact=(category,field,statement,quote)=>{
          const segment=input.segments.find(part=>part.text.includes(quote));assert.ok(segment,'each synthetic proposal must quote a real supplied source');
          return {category,field,scope:category==='personal'?'personal':'Synthetic Employer',statement,evidence:[{documentId:input.documentId,segmentId:segment.id,quote}]};
        };
        output={facts:input.kind==='resume'?[
          fact('experience_claims','duties','Prepared client reports.','I prepared client reports.'),
          fact('skills','tools_technologies','Excel','Excel'),
          fact('personal','email',privateEmail,privateEmail)
        ]:[
          fact('skills','tools_technologies','SQL','SQL'),
          fact('experience_claims','responsibilities','Used SQL to reconcile cash records.','I used SQL to reconcile cash records.')
        ]};
      }else if(stage==='jd'){
        const segment=input.segments.find(part=>part.text.includes('preparing client reports'));
        output={roleName:'Treasury Analyst',sector:'',requirements:[{category:'task',text:'Prepare client reports',importance:'required',evidence:[{documentId:input.documentId,segmentId:segment.id,quote:'preparing client reports'}]},{category:'skill',text:'SQL',importance:'required',evidence:[{documentId:input.documentId,segmentId:segment.id,quote:'SQL is required'}]}]};
      }else{
        assert.equal(stage,'gap_assessment','the live profile flow must not generate role proposals');
        assert.ok(input.approvedFacts.every(fact=>fact.category!=='personal'),'Builder receives scoped professional facts');
        output={assessments:Object.fromEntries(input.requirements.map(requirement=>{const facts=input.approvedFacts.filter(fact=>requirement.category==='task'?fact.field==='duties':fact.category==='skills'&&fact.statement==='SQL');return [requirement.id,{factIds:facts.map(fact=>fact.id),explanation:facts.length?'The approved source establishes this work or tool.':'No approved evidence establishes SQL experience.'}];}))};
      }
      return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]});
    }
    assert.equal(endpoint.hostname,'synthetic-project.supabase.co','the test must never make a real provider request');
    const operation=endpoint.pathname.split('/').at(-1).replace('career_profile_',''),owner=body.p_owner;
    assert.equal(typeof owner,'string');calls.push({operation,owner,revision:body.p_revision});
    const saved=current(owner);
    if(operation==='load')return Response.json(saved);
    if(operation==='reserve')return Response.json({reserved:true});
    assert.equal(operation,'save');
    if(conflictOnce.delete(owner)||body.p_revision!==saved.revision)return Response.json({code:'40001'},{status:409});
    records.set(owner,roundTrip({revision:saved.revision+1,state:structuredClone(body.p_state)}));return Response.json(current(owner));
  });
  const service=owner=>new ProfileService({GEMINI_API_KEY:'fixture-gemini-key',SUPABASE_URL:'https://synthetic-project.supabase.co',SUPABASE_SECRET_KEY:'fixture-server-key'},owner,{factPrompt:'SYNTHETIC FACT POLICY',builderPrompt:'SYNTHETIC BUILDER POLICY'});
  const action=(instance,body)=>instance.action({revision:current(instance.owner).revision,...body});
  return {current,calls,modelCalls,service,action,conflictOnce};
}

async function completeProfile(f,owner='synthetic-owner-a'){
  const service=f.service(owner),action=body=>f.action(service,body);
  let record=await action({action:'paste',kind:'resume',title:'Synthetic resume',text:resume});
  assert.ok(record.state.facts.some(fact=>fact.category==='personal'&&fact.field==='email'&&fact.approval==='pending'),'literal Section 1 fields are proposed before model extraction');
  record=await action({action:'analyze',id:record.state.documents[0].id});
  assert.equal(record.state.facts.length,3);assert.equal(record.state.approvals.length,0);
  record=await action({action:'decideFacts',decisions:record.state.facts.map(fact=>({id:fact.id,version:fact.version,decision:'approved'}))});
  const originalApprovals=structuredClone(record.state.approvals);
  await action({action:'preferences',search,disclosure:['Do not send my private career goal to a search provider']});
  await action({action:'paste',kind:'jd',title:'Selected Treasury Analyst opening',text:jobDescription,selected:true});
  record=await action({action:'buildProfiles',mode:'analysis'});
  const question=record.state.questions.at(-1);assert.equal(record.state.roleProfiles.length,0);assert.equal(record.state.builderReviews.at(-1).mappings.length,2);
  record=await action({action:'answer',questionId:question.id,decision:'answered',capabilityDecision:'yes',text:example,submissionId:'synthetic-submit-'+owner,analyze:false});
  assert.equal(record.result.kind,'answer_saved');assert.equal(record.result.analysisStatus,'pending');
  const answerId=record.result.answerId;
  record=await action({action:'analyzeAnswer',id:answerId});
  assert.equal(record.result.analysisStatus,'complete');
  const answerFacts=record.state.facts.filter(fact=>fact.origin==='user_answer');assert.equal(answerFacts.length,2);
  assert.ok(answerFacts.every(fact=>fact.approval==='pending'&&fact.confirmation==='user_stated'));
  record=await action({action:'decideFacts',decisions:answerFacts.map(fact=>({id:fact.id,version:fact.version,decision:'approved'}))});
  record=await action({action:'buildProfiles',mode:'analysis'});assert.equal(record.state.roleProfiles.length,0);assert.equal(record.state.builderReviews.at(-1).supported,2);
  const beforeFinalize=f.current(owner),saveCount=f.calls.filter(call=>call.operation==='save'&&call.owner===owner).length;
  record=await action({action:'finalize',search});
  assert.equal(f.calls.filter(call=>call.operation==='save'&&call.owner===owner).length,saveCount+1,'the snapshot and consolidated artifact share one authoritative save');
  assert.deepEqual(record.state.approvals.slice(0,originalApprovals.length),originalApprovals);
  assert.equal(record.state.approvals.filter(approval=>approval.kind==='fact').length,5);
  assert.equal(record.state.approvals.filter(approval=>approval.kind==='role').length,0);
  assert.equal(record.state.approvals.length,beforeFinalize.state.approvals.length+1,'finalization adds only the explicit snapshot approval');
  return {service,record,snapshot:record.state.snapshots.at(-1),answerId,answerFacts,originalApprovals,selection:{roleId:'master-profile',version:record.state.snapshots.at(-1).version}};
}

test('approved questionnaire facts reach the authoritative consolidated profile, both loaders and read-only Master preview',async t=>{
  const f=fixture(t),flow=await completeProfile(f),{service,snapshot,selection,answerId,answerFacts}=flow;
  const consolidated=snapshot.consolidated;assert.equal(flow.record.result.kind,'consolidated_profile_saved');
  assert.equal(consolidated.version,selection.version);assert.equal(consolidated.mode,'snapshot');assert.equal(consolidated.binding.valid,true);
  assert.equal(consolidated.binding.snapshotId,snapshot.id);assert.equal(consolidated.binding.approvalRef,snapshot.approvalRef);
  assert.deepEqual(consolidated.counts,{approvedFacts:5,professionalFacts:4,approvedRoles:0,sourcedTitles:1,supportedRequirements:2,missingRequirements:0,conflictingRequirements:0,unverifiedRequirements:0});
  assert.match(consolidated.asOf,/^\d{4}-\d{2}-\d{2}$/);assert.equal(consolidated.asOf,snapshot.profileAsOf);
  const claims=[...Object.values(consolidated.sections).flat(),...consolidated.otherApprovedFacts];
  for(const fact of answerFacts){const claim=claims.find(item=>item.id===fact.id);assert.ok(claim);assert.equal(claim.approvalReceiptStatus,'matched_approval');assert.equal(claim.sourceStatus,'matched_source');assert.equal(claim.confirmation,'user_confirmed');assert.equal(claim.independentlyVerified,false);assert.ok(claim.evidence.some(ref=>ref.documentId===answerId));}
  assert.ok(!JSON.stringify(consolidated.sections).includes(privateEmail));
  const reviewed=consolidated.review.answers.find(item=>item.id===answerId);assert.equal(reviewed.text,example);assert.equal(reviewed.stage,'approved_facts');assert.equal(reviewed.factRefs.length,2);
  assert.ok(consolidated.searchTerms.skills.some(term=>term.term==='SQL'&&term.factRefs.some(ref=>answerFacts.some(fact=>fact.id===ref.id))));
  assert.deepEqual(consolidated.roles,[]);assert.deepEqual(consolidated.targetTitles.map(title=>title.term),['Treasury Analyst']);
  assert.equal(consolidated.targetTitles[0].userExperience,false,'a selected JD title is a research target, never experience');
  const loaded=await approvedProfileLoader(service,{requireCurrent:true})({version:selection.version}),python=await pythonProfileLoader(service)(selection.version);
  assert.equal(loaded.facts.version,selection.version);assert.deepEqual(loaded.consolidatedProfile,consolidated);assert.equal(python.version,selection.version);
  assert.equal(loaded.facts.records.length,5);assert.equal(python.facts.length,5);
  assert.deepEqual(python.roles,[]);assert.ok(python.search_profile.skills.some(term=>term.term==='SQL'));assert.ok(!JSON.stringify(python.search_profile).includes(privateEmail));
  const before=f.current(service.owner),writes=f.calls.filter(call=>call.operation==='save').length,models=f.modelCalls.length;
  const preview=await previewProfileScout(service,selection,{resume:'MUST NOT LEAVE PROFILE',roles:'Unapproved role'});
  assert.equal(preview.handoff.stage,'preview');assert.equal(preview.handoff.summary.approvedFactCount,5);assert.equal(preview.handoff.summary.professionalFactCount,4);
  assert.ok(preview.handoff.summary.specialistSkills.includes('SQL'));assert.deepEqual(preview.handoff.summary.titles,['Treasury Analyst']);
  assert.equal(preview.handoff.summary.questionnaireFactCount,2);assert.equal(preview.handoff.summary.resumeFactCount,2);
  assert.deepEqual(preview.audit.map(event=>event.from+'>'+event.to),['user>master','master>profile','profile>memory','memory>profile','profile>master']);
  assert.equal(preview.plan.consolidatedProfile,undefined);assert.equal(preview.plan.facts,undefined);
  assert.ok(!JSON.stringify(preview).includes(privateEmail));assert.ok(!JSON.stringify(preview).includes(search.goals));assert.ok(!JSON.stringify(preview).includes('MUST NOT LEAVE PROFILE'));
  assert.deepEqual(f.current(service.owner),before);assert.equal(f.calls.filter(call=>call.operation==='save').length,writes);assert.equal(f.modelCalls.length,models);
  const repeated=await f.action(service,{action:'finalize',search});
  assert.equal(repeated.state.snapshots.length,1);assert.equal(repeated.state.approvals.length,before.state.approvals.length);
  assert.deepEqual(repeated.state.snapshots[0].consolidated,consolidated,'saving an unchanged version preserves its asOf and source-bound artifact');
});

test('executed handoffs persist through real owner-scoped Profile memory and upsert one receipt on completion',async t=>{
  const f=fixture(t),a=await completeProfile(f,'synthetic-owner-a'),b=await completeProfile(f,'synthetic-owner-b');
  const preview=await previewProfileScout(a.service,a.selection,{}),audit=[...preview.audit,auditRoute('master','scout','approved-role-search-request')];
  const dispatch=await createScoutHandoffReceipt(preview.plan,audit,{stage:'dispatched',at:'2026-10-30T20:00:00.000Z'});
  const before=f.current(a.service.owner),otherBefore=f.current(b.service.owner);
  const persisted=await persistScoutHandoff(a.service,dispatch);
  assert.equal(persisted.persistence.saved,true);assert.equal(persisted.id,dispatch.id);assert.ok(Number.isFinite(Date.parse(persisted.persistence.savedAt)));
  let stored=f.current(a.service.owner);assert.equal(stored.state.scoutHandoffs.length,1);assert.equal(stored.state.scoutHandoffs[0].stage,'dispatched');
  assert.deepEqual(stored.state.approvals,before.state.approvals);assert.deepEqual(stored.state.snapshots,before.state.snapshots);
  await assert.rejects(b.service.saveScoutHandoff(a.selection.version,dispatch),error=>error.status===409);
  assert.deepEqual(f.current(b.service.owner),otherBefore,'a matching version label never grants access to another owner snapshot');
  const completed=await createScoutHandoffReceipt(preview.plan,[...audit,auditRoute('scout','master','search-output')],{id:dispatch.id,stage:'completed',at:'2026-10-30T20:01:00.000Z',result:{jobs:[{id:'job1'},{id:'job2'}],groups:[{id:'recent',jobs:[{}]},{id:'review',jobs:[{}]}],usage:{searchRequests:3},scoutPolicy:{historySaved:true}}});
  const savedCompletion=await persistScoutHandoff(a.service,completed);stored=f.current(a.service.owner);
  assert.equal(savedCompletion.planHash,dispatch.planHash);assert.equal(stored.state.scoutHandoffs.length,1);assert.equal(stored.state.scoutHandoffs[0].id,dispatch.id);
  assert.equal(stored.state.scoutHandoffs[0].stage,'completed');assert.equal(stored.state.scoutHandoffs[0].result.jobs,2);assert.equal(stored.state.scoutHandoffs[0].result.historySaved,true);
  assert.deepEqual(stored.state.approvals,before.state.approvals);assert.deepEqual(stored.state.snapshots,before.state.snapshots);
  const currentSearch={...search,goals:'A newly reviewed synthetic career goal'};
  await f.action(a.service,{action:'preferences',search:currentSearch});const newer=await f.action(a.service,{action:'finalize',search:currentSearch});
  assert.notEqual(newer.state.snapshots.at(-1).version,a.selection.version);
  const writes=f.calls.filter(call=>call.operation==='save').length;
  await assert.rejects(persistScoutHandoff(a.service,completed),error=>error.status===409);
  await assert.rejects(previewProfileScout(a.service,a.selection,{}),error=>error.status===409);
  await assert.rejects(pythonProfileLoader(a.service)(a.selection.version),error=>error.status===409);
  assert.equal(f.calls.filter(call=>call.operation==='save').length,writes);assert.equal(f.current(a.service.owner).state.scoutHandoffs.length,1);
});

test('a handoff retries a revision conflict once without duplicate receipts or new approvals',async t=>{
  const f=fixture(t),flow=await completeProfile(f),preview=await previewProfileScout(flow.service,flow.selection,{});
  const receipt=await createScoutHandoffReceipt(preview.plan,[...preview.audit,auditRoute('master','scout','approved-role-search-request')],{stage:'dispatched'});
  const before=f.current(flow.service.owner),writes=f.calls.filter(call=>call.operation==='save').length;
  f.conflictOnce.add(flow.service.owner);const saved=await persistScoutHandoff(flow.service,receipt),after=f.current(flow.service.owner);
  assert.equal(saved.persistence.saved,true);assert.equal(f.calls.filter(call=>call.operation==='save').length,writes+2);
  assert.equal(after.revision,before.revision+1);assert.equal(after.state.scoutHandoffs.length,1);assert.deepEqual(after.state.approvals,before.state.approvals);
});

test('the saved profile keeps its New York asOf across UTC midnight and later unchanged saves',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-31T01:05:00.000Z')});
  const f=fixture(t),flow=await completeProfile(f);
  assert.equal(flow.snapshot.createdAt,'2026-10-31T01:05:00.000Z');
  assert.equal(flow.snapshot.profileAsOf,'2026-10-30');assert.equal(flow.snapshot.consolidated.asOf,'2026-10-30');
  t.mock.timers.setTime(Date.parse('2026-11-02T12:00:00.000Z'));
  const later=await f.action(flow.service,{action:'finalize',search}),snapshot=later.state.snapshots.at(-1);
  assert.equal(snapshot.id,flow.snapshot.id);assert.equal(later.state.snapshots.length,1);
  assert.equal(snapshot.profileAsOf,'2026-10-30');assert.equal(snapshot.consolidated.asOf,'2026-10-30');
  assert.deepEqual(snapshot.consolidated,flow.snapshot.consolidated);
});

test('recursive JSONB key reordering preserves validated comparison inputs, saved packets and unchanged finalization',async t=>{
  const f=fixture(t,{jsonb:true}),flow=await completeProfile(f),stored=f.current(flow.service.owner);
  const review=stored.state.builderReviews.at(-1);
  assert.notDeepEqual(Object.keys(review.inputAnswerRefs[0]),['id','questionId','status','documentId'],'the fixture must reorder nested answer-reference keys');
  assert.equal(finalizationReadiness(stored.state).ready,true);
  assert.equal(savedPacket(stored.state).snapshot.id,flow.snapshot.id);
  const initialApprovals=structuredClone(stored.state.approvals),modelCount=f.modelCalls.length;
  let current=f.current(flow.service.owner);
  const oldStyleFingerprint=JSON.stringify(reorderKeys(JSON.parse(current.state.snapshots[0].reviewFingerprint)));
  current.state.snapshots[0].reviewFingerprint=oldStyleFingerprint;
  await flow.service.memory.save(current.revision,current.state);
  current=f.current(flow.service.owner);
  assert.equal(savedPacket(current.state).snapshot.id,flow.snapshot.id,'pre-canonical fingerprint strings remain compatible when their structured contents match');
  const repeated=await f.action(flow.service,{action:'finalize',search});
  assert.equal(repeated.state.snapshots.length,1);assert.equal(repeated.state.snapshots[0].id,flow.snapshot.id);
  assert.deepEqual(repeated.state.approvals,initialApprovals);assert.equal(f.modelCalls.length,modelCount);
  assert.equal(savedPacket(repeated.state).facts.version,flow.selection.version);
  const loaded=await approvedProfileLoader(flow.service,{requireCurrent:true})({version:flow.selection.version});
  assert.deepEqual(loaded.consolidatedProfile,flow.snapshot.consolidated);
  const preview=await previewProfileScout(flow.service,flow.selection,{}),audit=[...preview.audit,auditRoute('master','scout','approved-role-search-request')];
  const dispatched=await createScoutHandoffReceipt(preview.plan,audit,{stage:'dispatched'});
  await persistScoutHandoff(flow.service,dispatched);
  const completed=await createScoutHandoffReceipt(preview.plan,[...audit,auditRoute('scout','master','search-output')],{id:dispatched.id,stage:'completed',result:{jobs:[{id:'synthetic-job'}],groups:[]}});
  await persistScoutHandoff(flow.service,completed);
  const afterHandoff=f.current(flow.service.owner);
  assert.equal(afterHandoff.state.scoutHandoffs.length,1);assert.equal(afterHandoff.state.scoutHandoffs[0].id,dispatched.id);
  assert.equal(afterHandoff.state.scoutHandoffs[0].stage,'completed');assert.equal(afterHandoff.state.scoutHandoffs[0].result.jobs,1);
  assert.ok(afterHandoff.state.scoutHandoffs[0].summary.specialistSkills.includes('SQL'));
  assert.deepEqual(afterHandoff.state.scoutHandoffs[0].audit.map(event=>event.from+'>'+event.to),[...preview.audit.map(event=>event.from+'>'+event.to),'master>scout','scout>master']);
  assert.deepEqual(afterHandoff.state.approvals,initialApprovals);assert.deepEqual(savedPacket(afterHandoff.state).snapshot.consolidated,flow.snapshot.consolidated);
  assert.equal(canonicalJSON({outer:{second:2,first:1},ordered:[1,2]}),canonicalJSON({ordered:[1,2],outer:{first:1,second:2}}));
  assert.notEqual(canonicalJSON({ordered:[1,2]}),canonicalJSON({ordered:[2,1]}),'canonicalization must preserve meaningful array order');
});
