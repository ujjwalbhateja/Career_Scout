import test from 'node:test';
import assert from 'node:assert/strict';
import {createCareerWorkflow} from '../lib/workflow/graph.mjs';
import {AGENT_IDS,COMMUNICATION_ROUTES,assertCommunication,routingPath,draftFingerprint,validationIssues,validatedPackage} from '../lib/workflow/policy.mjs';

function fixture(){
  const calls=[],saves=[];
  const facts={verified:true,version:'fixture-v1',approvalRef:'fixture-user-approval',evidenceRefs:['fixture-project']};
  const job={id:'fixture-job',title:'Portfolio Analyst',company:'Test Employer',applicationUrl:'https://example.com/jobs/fixture',description:'Fixture job description. Analyze investment portfolio performance with Python, supported evidence and clear reporting responsibilities.'};
  const request={packageDate:'2026-10-25',searchRequirements:{roles:'Portfolio Analyst'},profileInput:{existingResume:'Test fixture resume only',profileInformation:{fixture:true},capabilityAnswers:[{evidence:'fixture-project'}],selectedJobDescriptions:Array.from({length:10},(_,index)=>({id:'jd-'+index,text:job.description}))}};
  const handlers={
    fact:async input=>{calls.push({agent:'fact',input});return facts;},
    profileBuilder:async input=>{calls.push({agent:'builder',input});return [{id:'role-1',roleName:'Portfolio Analyst',approvalRef:'fixture-role-approval',supportedTasks:[{task:'Analyze performance',evidenceRefs:['fixture-project']}]}];},
    scout:async input=>{calls.push({agent:'scout',input});return [job];},
    matcher:async input=>{calls.push({agent:'matcher',input});return {selectedJobId:job.id,suitable:true,supported:['Fixture requirement'],gaps:[]};},
    tailor:async input=>{calls.push({agent:'tailor',input});return {jobId:job.id,profileVersion:facts.version,content:'Supported fixture draft '+calls.filter(call=>call.agent==='tailor').length};},
    critic:async input=>{calls.push({agent:'critic',input});return {reviewer:'critic',jobId:job.id,profileVersion:facts.version,draftHash:input.draftHash,profileFacts:{passed:true,issues:[]},jobAlignment:{passed:true,issues:[]},unresolvedIssues:[]};},
    savePackage:async packet=>{saves.push(packet);return {saved:true,jobId:packet.jobId,profileVersion:packet.profileVersion,draftHash:packet.validation.draftHash,folder:packet.folder};}
  };
  return {calls,saves,handlers,request,facts,job};
}
test('only the declared coordinator routes are permitted',()=>{
  for(const from of AGENT_IDS)for(const to of AGENT_IDS){const allowed=COMMUNICATION_ROUTES.some(edge=>edge[0]===from&&edge[1]===to);if(allowed)assert.doesNotThrow(()=>assertCommunication(from,to));else assert.throws(()=>assertCommunication(from,to),/denied/);}
  assert.deepEqual(routingPath('scout','profile-builder'),['scout','master','profile','profile-builder']);
  assert.deepEqual(routingPath('profile-builder','scout'),['profile-builder','profile','master','scout']);
  assert.deepEqual(routingPath('critic','tailor'),['critic','master','tailor']);
});
test('actual LangGraph invokes the nested Profile graph and saves only validated associated packages',async()=>{
  const f=fixture(),result=await createCareerWorkflow(f.handlers).invoke({request:f.request});
  assert.equal(result.outcome,'ready');assert.equal(result.packet.status,'Ready to Apply');assert.equal(f.saves.length,1);
  assert.match(result.packet.folder,/^2026-10-25\/test-employer-portfolio-analyst-fixture-job$/);
  assert.deepEqual(f.calls.map(call=>call.agent),['fact','builder','scout','matcher','tailor','critic']);
  for(const event of result.audit)assert.doesNotThrow(()=>assertCommunication(event.from,event.to));
  assert.ok(result.audit.some(event=>event.from==='profile'&&event.to==='fact'));
  assert.ok(!result.audit.some(event=>event.from==='master'&&['fact','profile-builder','memory'].includes(event.to)));
  assert.deepEqual(Object.keys(f.calls.find(call=>call.agent==='scout').input).sort(),['roleProfiles','searchRequirements']);
});
test('Critic revisions are routed through Master, bounded and reviewed again',async()=>{
  const f=fixture(),clean=f.handlers.critic;let reviews=0;
  f.handlers.critic=async input=>{const result=await clean(input);if(reviews++===0)result.jobAlignment={passed:false,issues:['Unsupported claim']};return result;};
  const result=await createCareerWorkflow(f.handlers).invoke({request:f.request});
  assert.equal(result.revisions,1);assert.equal(f.calls.filter(call=>call.agent==='tailor').length,2);
  assert.ok(f.calls.filter(call=>call.agent==='tailor')[1].input.revisionFeedback.length>0);
  assert.equal(f.saves.length,1);assert.equal(result.outcome,'ready');
  assert.ok(result.audit.some(event=>event.from==='master'&&event.to==='tailor'&&event.kind==='revision-request'));
});
test('failed reviews stop at the revision limit without saving',async()=>{
  const f=fixture(),clean=f.handlers.critic;
  f.handlers.critic=async input=>({...await clean(input),profileFacts:{passed:false,issues:['Date mismatch']}});
  const result=await createCareerWorkflow(f.handlers,{maxRevisions:1}).invoke({request:f.request});
  assert.equal(result.outcome,'needs_review');assert.equal(f.saves.length,0);assert.equal(result.packet,undefined);
  assert.equal(f.calls.filter(call=>call.agent==='tailor').length,2);
});
test('unapproved facts stop before Scout, and JDs alone cannot approve experience',async()=>{
  const f=fixture();f.handlers.fact=async()=>({verified:false,questions:['Confirm employment dates']});
  const result=await createCareerWorkflow(f.handlers).invoke({request:f.request});
  assert.equal(result.outcome,'needs_input');assert.equal(f.saves.length,0);assert.ok(!f.calls.some(call=>call.agent==='scout'));
});
test('Profile intake enforces 10–15 distinct user-selected JDs before calling agents',async()=>{
  for(const count of [0,9,16]){const f=fixture();f.request.profileInput.selectedJobDescriptions=f.request.profileInput.selectedJobDescriptions.slice(0,count);if(count===16)f.request.profileInput.selectedJobDescriptions=Array.from({length:16},(_,i)=>({id:String(i),text:f.job.description}));await assert.rejects(createCareerWorkflow(f.handlers).invoke({request:f.request}),/10–15/);assert.equal(f.calls.length,0);}
});
test('wrong jobs, profile versions and failed storage receipts cannot become Ready to Apply',async()=>{
  for(const change of [f=>{f.handlers.matcher=async()=>({selectedJobId:'other-job',suitable:true});},f=>{f.handlers.tailor=async()=>({jobId:f.job.id,profileVersion:'unapproved-version',content:'Fixture'});},f=>{f.handlers.savePackage=async()=>({saved:true,jobId:'other-job',folder:'x'});},f=>{f.handlers.savePackage=async packet=>({saved:true,jobId:packet.jobId,profileVersion:packet.profileVersion,draftHash:packet.validation.draftHash,folder:'wrong-folder'});}]){
    const f=fixture();change(f);await assert.rejects(createCareerWorkflow(f.handlers).invoke({request:f.request}));
  }
});
test('stale critic reviews and unresolved issues fail the package gate',async()=>{
  const f=fixture(),draft={jobId:f.job.id,profileVersion:f.facts.version,content:'Original fixture'};
  const review={reviewer:'critic',jobId:f.job.id,profileVersion:f.facts.version,draftHash:await draftFingerprint(draft),profileFacts:{passed:true,issues:[]},jobAlignment:{passed:true,issues:[]},unresolvedIssues:[]};
  assert.deepEqual(await validationIssues({job:f.job,draft,profile:f.facts,review}),[]);
  for(const changed of [{...draft,content:'Changed after review'},{...draft,jobId:'different'}])assert.ok((await validationIssues({job:f.job,draft:changed,profile:f.facts,review})).length);
  await assert.rejects(validatedPackage({job:f.job,draft,profile:f.facts,review:{...review,unresolvedIssues:['Missing evidence']},assessment:{},date:'2026-10-25'}),/not Ready to Apply/);
});
test('missing adapters fail explicitly instead of inventing agent outputs',()=>{
  assert.throws(()=>createCareerWorkflow({}),/Configure the fact adapter/);
  assert.throws(()=>createCareerWorkflow(fixture().handlers,{maxRevisions:99}),/bounded/);
});
