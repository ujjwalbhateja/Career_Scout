import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile,addDocument,proposeFacts,decideFacts,finalize,savedPacket} from '../lib/profile/domain.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
import {previewProfileScout,dispatchProfileScout,createScoutHandoffReceipt,persistScoutHandoff} from '../lib/workflow/scout-handoff.mjs';
import {createProfileGraph,createCareerWorkflow} from '../lib/workflow/graph.mjs';

async function fixture(){
  const state=emptyProfile(),statements=[['experience_claims','duties','Managed NAV oversight and client reporting.'],['skills','tools','Python and Excel'],['employment','industry','Fund administration'],['personal','email','synthetic-person@example.com'],['employment','job_title','Fund Operations Analyst']];
  addDocument(state,{id:'resume',kind:'resume',title:'Synthetic private resume',hash:'synthetic',segments:statements.map(([, ,statement],i)=>({id:`source.${i}`,text:statement}))});
  await proposeFacts(state,statements.map(([category,field,statement],i)=>({category,field,scope:'Synthetic employer',statement,evidence:[{documentId:'resume',segmentId:`source.${i}`,quote:statement}]})));
  decideFacts(state,state.facts.map(f=>({id:f.id,version:1,decision:'approved'})),'synthetic-owner');
  state.preferences.search={location:'Boston',arrangement:'hybrid'};
  state.documents[0].analysis='complete';new ProfileService({},'synthetic-owner').finalProfileResult(state);
  const service=new ProfileService({},'synthetic-owner');let reads=0,saves=0;
  service.memory.load=async()=>{reads++;return {revision:1,state:structuredClone(state)};};
  service.memory.save=async()=>{saves++;throw new Error('Preview must remain read-only');};
  return {state,service,counts:()=>({reads,saves}),selection:{roleId:'master-profile',version:state.snapshots.at(-1).version}};
}

test('preview loads the saved snapshot through Master/Profile/Memory without dispatch or persistence',async()=>{
  const {state,service,counts,selection}=await fixture();
  const preview=await previewProfileScout(service,selection,{roles:'Unapproved role',resume:'Never send this',location:'New York'});
  assert.equal(preview.handoff.stage,'preview');assert.equal(preview.handoff.profileVersion,selection.version);assert.equal(preview.handoff.roleId,selection.roleId);
  assert.equal(preview.handoff.snapshotSavedAt,state.snapshots[0].createdAt);
  assert.equal(preview.handoff.summary.approvedFactCount,5);assert.equal(preview.handoff.summary.professionalFactCount,4);
  assert.deepEqual(preview.handoff.summary.titles,['Fund Operations Analyst']);assert.ok(preview.handoff.summary.responsibilities.some(t=>t.includes('NAV oversight')));
  assert.ok(preview.handoff.summary.specialistSkills.includes('Python'));assert.ok(preview.handoff.summary.industries.includes('Fund administration'));
  assert.equal(preview.handoff.summary.preferences.location,'New York');
  assert.deepEqual(preview.audit.map(a=>`${a.from}>${a.to}`),['user>master','master>profile','profile>memory','memory>profile','profile>master']);
  assert.deepEqual(counts(),{reads:1,saves:0});
  assert.equal(preview.plan.facts,undefined);assert.equal(preview.plan.consolidatedProfile,undefined);
  assert.ok(!JSON.stringify(preview).includes('synthetic-person@example.com'));assert.ok(!JSON.stringify(preview).includes('Never send this'));
});

test('profile-level handoff ignores generated legacy role labels, keywords and selection metadata',async()=>{
  const {state,service,selection}=await fixture();
  state.roleProfiles.push({id:'legacy-ai-role',roleName:'Invented Chief Visionary',keywords:['Imaginary Quantum Experience'],summary:'Generated role',status:'approved',approvalRef:'irrelevant-old-approval',supportedTasks:[]});
  const preview=await previewProfileScout(service,{...selection,roleId:'legacy-ai-role'},{});
  assert.equal(preview.plan.selection.roleId,'master-profile');assert.equal(preview.plan.basis,'validated_source_data');
  assert.ok(!JSON.stringify(preview).includes('Invented Chief Visionary'));assert.ok(!JSON.stringify(preview).includes('Imaginary Quantum Experience'));
  assert.ok(preview.handoff.summary.titles.includes('Fund Operations Analyst'));
});

test('actual handoff receipts summarize the exact narrowed context and change fingerprint when execution changes',async()=>{
  const {service,selection}=await fixture(),preview=await previewProfileScout(service,selection,{}),context=structuredClone(preview.plan.scoutContext);
  context.skills=context.skills.filter(t=>t.term==='Python');
  const receipt=await createScoutHandoffReceipt(preview.plan,preview.audit,{stage:'dispatched',context});
  assert.deepEqual(receipt.summary.specialistSkills,['Python']);assert.equal(receipt.stage,'dispatched');assert.match(receipt.planHash,/^[a-f0-9]{64}$/);
  assert.notEqual(receipt.planHash,preview.handoff.planHash);
  const same=await createScoutHandoffReceipt(preview.plan,preview.audit,{stage:'dispatched',context});assert.equal(same.planHash,receipt.planHash);
  const completed=await createScoutHandoffReceipt(preview.plan,preview.audit,{id:receipt.id,stage:'completed',context,result:{jobs:[{}],groups:[{id:'review',jobs:[{}]}],usage:{searchRequests:3},scoutPolicy:{historySaved:true}}});
  assert.equal(completed.id,receipt.id);assert.equal(completed.planHash,receipt.planHash);assert.equal(completed.result.jobs,1);assert.equal(completed.result.historySaved,true);
});

test('receipt generation rejects added experience, fact identifiers and changed mandatory conditions',async()=>{
  const {service,selection}=await fixture(),preview=await previewProfileScout(service,selection,{});
  for(const edit of [c=>c.skills.push({term:'Unapproved platform',factIds:[c.approvedFactIds[0]]}),c=>c.approvedFactIds.push('foreign-fact'),c=>c.requiresSponsorship=true,c=>c.roleName='Unapproved role']){
    const context=structuredClone(preview.plan.scoutContext);edit(context);
    await assert.rejects(createScoutHandoffReceipt(preview.plan,preview.audit,{stage:'dispatched',context}),/approved|context/);
  }
});

test('legacy injected dispatch still records actual authorized Scout routes, unlike preview',async()=>{
  const {service,selection}=await fixture();let calls=0;
  const dispatched=await dispatchProfileScout(service,selection,{},async()=>{calls++;return {jobs:[]};});
  assert.equal(calls,1);assert.equal(dispatched.handoff.stage,'completed');assert.equal(dispatched.handoff.result.jobs,0);
  assert.deepEqual(dispatched.audit.slice(-2).map(a=>`${a.from}>${a.to}`),['master>scout','scout>master']);
});

test('a streaming Scout response is dispatched without claiming completion before the stream is read',async()=>{
  const {service,selection}=await fixture();
  const dispatched=await dispatchProfileScout(service,selection,{},async()=>new Response('pending stream'));
  assert.equal(dispatched.handoff.stage,'dispatched');
  assert.equal(dispatched.audit.at(-1).from,'master');assert.equal(dispatched.audit.at(-1).to,'scout');
});

test('visible persistence receipts require a saved acknowledgment bound to this owner-scoped version and receipt',async()=>{
  const {service,selection}=await fixture(),preview=await previewProfileScout(service,selection,{}),receipt=await createScoutHandoffReceipt(preview.plan,preview.audit,{stage:'dispatched'});
  let saves=0;
  const store={saveScoutHandoff:async(version,input)=>{saves++;assert.equal(version,selection.version);assert.equal(input.id,receipt.id);return {saved:true,id:input.id,profileVersion:version,savedAt:'2026-10-30T20:00:00.000Z'};}};
  const saved=await persistScoutHandoff(store,receipt);assert.equal(saved.persistence.saved,true);assert.equal(saves,1);
  await assert.rejects(persistScoutHandoff(store,preview.handoff),/preview/);assert.equal(saves,1);
  for(const invalid of [{saved:false},{saved:true,id:'different',profileVersion:selection.version,savedAt:receipt.at},{saved:true,id:receipt.id,profileVersion:'profile-2',savedAt:receipt.at},{saved:true,id:receipt.id,profileVersion:selection.version,savedAt:'unknown'}])await assert.rejects(persistScoutHandoff({saveScoutHandoff:async()=>invalid},receipt),/did not confirm/);
});

test('Profile graph rejects an adapter returning a different requested saved version',async()=>{
  const {state}=await fixture(),packet=savedPacket(state);
  await assert.rejects(createProfileGraph({loadApprovedProfile:async()=>({...packet,facts:{...packet.facts,version:'profile-2'},snapshot:{...packet.snapshot,version:'profile-2'}})}).invoke({request:{savedProfileVersion:'profile-1'}}),/different profile version/);
  await assert.rejects(createProfileGraph({loadApprovedProfile:async()=>({...packet,snapshot:{...packet.snapshot,version:'profile-2'}})}).invoke({request:{savedProfileVersion:'profile-1'}}),/snapshot does not match/);
  await assert.rejects(createProfileGraph({loadApprovedProfile:async()=>({...packet,consolidatedProfile:{version:'profile-2',binding:{valid:true}}})}).invoke({request:{savedProfileVersion:'profile-1'}}),/consolidated saved profile/);
});

test('Master can discover from a validated source profile with no generated role or role-approval prerequisite',async()=>{
  const {state}=await fixture(),packet=savedPacket(state);let calls=0;
  const handlers={loadApprovedProfile:async()=>({...packet,roleProfiles:[]}),scout:async input=>{calls++;assert.equal(input.profileVersion,packet.facts.version);assert.equal(input.roleProfiles,undefined);assert.equal(input.searchContext.profileId,'master-profile');assert.deepEqual(input.searchContext.titles.map(t=>t.term),['Fund Operations Analyst']);assert.equal(input.searchRequirements.resume,undefined);assert.equal(input.searchRequirements.roles,undefined);assert.equal(input.searchRequirements.location,'Boston');return [];},matcher:async()=>{},tailor:async()=>{},critic:async()=>{},savePackage:async()=>{}};
  const output=await createCareerWorkflow(handlers).invoke({request:{profileInput:{savedProfileVersion:packet.facts.version},searchRequirements:{roles:'Invented Chief Visionary',resume:'Private source must stay outside Scout',location:'Boston'}}});
  assert.equal(calls,1);assert.equal(output.outcome,'no_jobs');assert.deepEqual(output.roleProfiles,[]);
});
