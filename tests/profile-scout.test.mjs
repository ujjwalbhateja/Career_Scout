import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile,addDocument,proposeFacts,decideFacts,buildProfiles,approveRole,finalize,correctFact,removeDocument,savedPacket} from '../lib/profile/domain.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
import {dispatchProfileScout} from '../lib/workflow/scout-handoff.mjs';
import {assertCommunication,requireProfileIntake} from '../lib/workflow/policy.mjs';
const text='At Synthetic Employer, supported institutional clients and maintained client reporting records.';
async function fixture(){
  const s=emptyProfile();addDocument(s,{id:'resume',kind:'resume',title:'Synthetic resume',hash:'synthetic',segments:[{id:'resume.p1',text}]});
  await proposeFacts(s,[{category:'experience_claims',field:'reporting',scope:'Synthetic Employer',statement:'Maintained client reporting records',evidence:[{documentId:'resume',segmentId:'resume.p1',quote:'maintained client reporting records'}]}]);
  decideFacts(s,[{id:s.facts[0].id,version:1,decision:'approved'}],'synthetic-owner');return s;
}
const proposal=s=>({profiles:[{roleName:'Client Reporting Analyst',summary:'Reporting support hypothesis',keywords:['reporting'],factIds:[s.facts[0].id]}]});
function service(s){const service=new ProfileService({},'synthetic-owner');service.memory.load=async()=>({revision:1,state:structuredClone(s)});return service;}
async function active(){const s=await fixture();await buildProfiles(s,proposal(s),'resume');approveRole(s,s.roleProfiles[0].id,'owner');finalize(s,'owner');return s;}
const selection=s=>({roleId:s.roleProfiles[0].id,version:s.snapshots.at(-1).version});

test('resume-only proposal requires separate fact, role and snapshot approvals without any JDs',async()=>{
  const s=await fixture();await buildProfiles(s,proposal(s),'resume');
  assert.equal(s.roleProfiles[0].status,'proposed');assert.deepEqual(s.roleProfiles[0].jdIds,[]);assert.deepEqual(s.roleProfiles[0].mappings,[]);assert.equal(s.questions.length,0);
  assert.throws(()=>finalize(s,'owner'),/Approve at least/);approveRole(s,s.roleProfiles[0].id,'owner');finalize(s,'owner');assert.equal(savedPacket(s).roleProfiles[0].basis,'resume');
});
test('resume-only builder rejects unknown, pending and personal-only supporting facts atomically',async()=>{
  for(const change of [s=>s.facts[0].approval='pending',s=>s.facts[0].category='personal',s=>s.facts[0].id='other']){
    const s=await fixture(),input=proposal(s);change(s);await assert.rejects(buildProfiles(s,input,'resume'),/Approve|not approved/);assert.equal(s.roleProfiles.length,0);
  }
  const s=await fixture(),input=proposal(s);input.profiles.push({...input.profiles[0],factIds:['unknown']});await assert.rejects(buildProfiles(s,input,'resume'));assert.equal(s.roleProfiles.length,0);
});
test('default JD mode still enforces analyzed 10–15 intake while resume mode is explicit',async()=>{
  const s=await fixture();await assert.rejects(buildProfiles(s,proposal(s)),/10–15/);await assert.rejects(buildProfiles(s,proposal(s),'unknown'),/Choose/);
  requireProfileIntake({mode:'resume',existingResume:text});assert.throws(()=>requireProfileIntake({mode:'resume'}),/readable/);assert.throws(()=>requireProfileIntake({}),/10–15/);
});
test('Master scopes an approved resume role into Scout with preferences and no factual records',async()=>{
  const s=await active();let calls=0;
  const result=await dispatchProfileScout(service(s),selection(s),{location:'Boston',preferSponsorship:true,roles:'Unapproved title',resume:'must stay outside Scout',facts:['untrusted']},async plan=>{
    calls++;assert.equal(plan.criteria.roles,'Client Reporting Analyst');assert.equal(plan.criteria.location,'Boston');assert.equal(plan.criteria.preferSponsorship,true);assert.equal(plan.criteria.mode,'exact');assert.equal(plan.criteria.relatedKeywords,'');
    assert.equal(JSON.stringify(plan).includes('maintained client reporting records'),false);assert.equal(plan.facts,undefined);assert.equal(plan.criteria.resume,undefined);assert.equal(plan.criteria.facts,undefined);return {jobs:[]};
  });
  assert.equal(calls,1);for(const route of result.audit)assertCommunication(route.from,route.to);
  assert.deepEqual(result.audit.map(x=>x.from+'>'+x.to),['user>master','master>profile','profile>memory','memory>profile','profile>master','master>scout','scout>master']);
});
test('Master rejects unactivated, stale, changed, deleted, foreign and old snapshot selections before Scout',async()=>{
  const changes=[s=>s.snapshots=[],s=>s.snapshots[0].stale=true,s=>s.roleProfiles[0].status='proposed',s=>s.deletion={status:'pending'},s=>s.roleProfiles[0].id='different-owner-role',s=>s.snapshots.push({...s.snapshots[0],version:'profile-2'})];
  for(const change of changes){const s=await active(),chosen=selection(s);change(s);await assert.rejects(dispatchProfileScout(service(s),chosen,{},async()=>assert.fail('Scout must not run')));}
});
test('supporting fact correction, withdrawal and resume deletion invalidate search; unrelated JDs do not',async()=>{
  for(const change of [s=>correctFact(s,{id:s.facts[0].id,version:1,statement:'New reporting scope'}),s=>decideFacts(s,[{id:s.facts[0].id,version:1,decision:'withdrawn'}],'owner'),s=>removeDocument(s,'resume')]){
    const s=await active(),chosen=selection(s);await change(s);await assert.rejects(dispatchProfileScout(service(s),chosen,{},async()=>assert.fail()));
  }
  const s=await fixture();await buildProfiles(s,proposal(s),'resume');addDocument(s,{id:'jd',kind:'jd',title:'Optional JD',hash:'jd',selected:true,segments:[{id:'jd.p1',text}]});approveRole(s,s.roleProfiles[0].id,'owner');finalize(s,'owner');assert.equal(savedPacket(s).roleProfiles.length,1);
});
test('service sends only approved nonpersonal facts to Gemini resume builder and keeps output proposed',async t=>{
  const s=await fixture();let record={revision:1,state:s},calls=0;
  const svc=new ProfileService({GEMINI_API_KEY:'synthetic-test-key'},'synthetic-owner');svc.memory.load=async()=>structuredClone(record);svc.memory.reserve=async()=>{};svc.memory.save=async(revision,state)=>{assert.equal(revision,record.revision);record={revision:revision+1,state:structuredClone(state)};return structuredClone(record);};
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;assert.match(url,/generativelanguage.googleapis.com/);const body=JSON.parse(options.body),input=JSON.parse(body.contents[0].parts[0].text);
    assert.equal(input.mode,'resume');assert.equal(input.selectedJDs,undefined);assert.equal(input.requirements,undefined);assert.equal(input.approvedFacts.length,1);assert.ok(body.generationConfig.responseSchema.properties.profiles.items.properties.factIds);
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(proposal(s))}]}}]});
  });
  const result=await svc.action({action:'buildProfiles',mode:'resume',revision:1});assert.equal(calls,1);assert.equal(result.state.roleProfiles[0].status,'proposed');assert.equal(result.state.snapshots.length,0);assert.equal(result.state.runs.at(-1).status,'complete');
});
