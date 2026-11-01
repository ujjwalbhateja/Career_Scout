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
async function active(){const s=await fixture();finalize(s,'synthetic-owner');return s;}
const selection=s=>({roleId:'master-profile',version:s.snapshots.at(-1).version});

test('approved professional facts save a searchable master profile without role proposals or approvals',async()=>{
  const s=await fixture();finalize(s,'synthetic-owner');
  assert.equal(s.roleProfiles.length,0);assert.equal(s.approvals.filter(a=>a.kind==='role').length,0);
  const packet=savedPacket(s);assert.equal(packet.searchProfile.id,'master-profile');assert.equal(packet.searchProfile.basis,'validated_source_data');
  assert.equal(packet.searchProfile.titles.length,0);assert.ok(packet.searchProfile.responsibilities.length>0);
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
test('Master scopes the saved professional profile into Scout with preferences and no fabricated title',async()=>{
  const s=await active();let calls=0;
  const result=await dispatchProfileScout(service(s),selection(s),{location:'Boston',preferSponsorship:true,roles:'Unapproved title',resume:'must stay outside Scout',facts:['untrusted']},async plan=>{
    calls++;assert.equal(plan.criteria.roles,'');assert.equal(plan.selection.roleId,'master-profile');assert.equal(plan.criteria.location,'Boston');assert.equal(plan.criteria.preferSponsorship,true);assert.equal(plan.criteria.mode,'exact');assert.equal(plan.criteria.relatedKeywords,'');
    assert.ok(plan.scoutContext.responsibilities.length>0);assert.deepEqual(plan.scoutContext.titles,[]);assert.ok(!JSON.stringify(plan).includes('Unapproved title'));assert.equal(plan.facts,undefined);assert.equal(plan.criteria.resume,undefined);assert.equal(plan.criteria.facts,undefined);return {jobs:[]};
  });
  assert.equal(calls,1);for(const route of result.audit)assertCommunication(route.from,route.to);
  assert.deepEqual(result.audit.map(x=>x.from+'>'+x.to),['user>master','master>profile','profile>memory','memory>profile','profile>master','master>scout','scout>master']);
});
test('Master rejects unactivated, stale, deleted and old saved profile versions before Scout',async()=>{
  const changes=[s=>s.snapshots=[],s=>s.snapshots[0].stale=true,s=>s.deletion={status:'pending'},s=>s.snapshots.push({...s.snapshots[0],version:'profile-2'})];
  for(const change of changes){const s=await active(),chosen=selection(s);change(s);await assert.rejects(dispatchProfileScout(service(s),chosen,{},async()=>assert.fail('Scout must not run')));}
});
test('supporting fact correction, withdrawal and resume deletion invalidate search; unrelated JDs do not',async()=>{
  for(const change of [s=>correctFact(s,{id:s.facts[0].id,version:1,statement:'New reporting scope'}),s=>decideFacts(s,[{id:s.facts[0].id,version:1,decision:'withdrawn'}],'owner'),s=>removeDocument(s,'resume')]){
    const s=await active(),chosen=selection(s);await change(s);await assert.rejects(dispatchProfileScout(service(s),chosen,{},async()=>assert.fail()));
  }
  const s=await active();addDocument(s,{id:'jd',kind:'jd',title:'Optional JD',hash:'jd',selected:false,segments:[{id:'jd.p1',text}]});assert.equal(savedPacket(s).searchProfile.id,'master-profile');
});
test('Builder comparison with no selected JDs makes no invented role or model-generated title',async t=>{
  const s=await fixture();let record={revision:1,state:s},calls=0;
  const svc=new ProfileService({GEMINI_API_KEY:'synthetic-test-key'},'synthetic-owner');svc.memory.load=async()=>structuredClone(record);svc.memory.reserve=async()=>{};svc.memory.save=async(revision,state)=>{assert.equal(revision,record.revision);record={revision:revision+1,state:structuredClone(state)};return structuredClone(record);};
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;assert.fail('No model call should generate a role when there are no JD requirements.');
  });
  const result=await svc.action({action:'buildProfiles',mode:'resume',revision:1});assert.equal(calls,0);assert.equal(result.state.roleProfiles.length,0);assert.equal(result.state.snapshots.length,0);assert.equal(result.state.runs.at(-1).status,'complete');assert.equal(result.state.facts[0].approval,'approved');
});
