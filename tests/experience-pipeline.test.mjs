import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile,addDocument,proposeFacts,decideFacts,addJDAnalysis,buildProfiles,savedPacket,finalizationReadiness} from '../lib/profile/domain.mjs';
import {buildExperienceReviewRows} from '../lib/profile/experience-review.mjs';
import {ProfileService,pythonProfileLoader} from '../lib/profile/service.mjs';
import {buildExperienceBank} from '../lib/profile/experience-bank.mjs';
import {experienceReviewReceiptMatches} from '../lib/profile/client-state.mjs';
import {buildConsolidatedProfile} from '../lib/profile/consolidated.mjs';

async function setup(){
  const state=emptyProfile();
  addDocument(state,{id:'resume-test',kind:'resume',title:'Synthetic resume',hash:'resume-hash',segments:[{id:'resume-p1',text:'I prepare monthly client reports.',locator:'paragraph 1'}]});
  await proposeFacts(state,[{category:'experience_claims',field:'duties',scope:'Employer unspecified',statement:'I prepare monthly client reports.',evidence:[{documentId:'resume-test',segmentId:'resume-p1',quote:'I prepare monthly client reports.'}]}]);
  decideFacts(state,state.facts.map(f=>({id:f.id,version:f.version,decision:'approved'})),'synthetic-owner');
  const statements=['Manage client renewal forecasts','Build acquisition models','Prepare consolidated operating budgets'];
  addDocument(state,{id:'jd-test',kind:'jd',selected:true,title:'Financial Services Analyst',hash:'jd-hash',segments:statements.map((text,i)=>({id:'jd-p'+i,text,locator:'requirement '+i}))});
  await addJDAnalysis(state,'jd-test',{roleName:'Financial Services Analyst',sector:'',requirements:statements.map((text,i)=>({category:'task',text,importance:'required',evidence:[{documentId:'jd-test',segmentId:'jd-p'+i,quote:text}]}))});
  await buildProfiles(state,{mappings:state.requirements.map(r=>({requirementId:r.id,factIds:[],explanation:'This work is not established by the approved resume.'})),questions:[]},'analysis');
  let record={revision:1,state:structuredClone(state)},saves=0;
  const service=new ProfileService({},'synthetic-owner');
  service.memory.load=async()=>structuredClone(record);
  service.memory.save=async(revision,next)=>{assert.equal(revision,record.revision);saves++;record={revision:revision+1,state:structuredClone(next)};return structuredClone(record);};
  return {service,current:()=>structuredClone(record),saves:()=>saves};
}

test('inline decisions persist once, replay safely, and feed the saved Master/Scout source profile',async()=>{
  const f=await setup(),initial=f.current(),rows=buildExperienceReviewRows(initial.state);
  const row=statement=>rows.find(r=>r.proposedStatement===statement);
  const request={action:'reviewExperience',revision:1,submissionId:'synthetic-table-submit-1',rows:[
    {questionId:row('Manage client renewal forecasts').id,proposalFingerprint:row('Manage client renewal forecasts').fingerprint,decision:'approve'},
    {questionId:row('Build acquisition models').id,proposalFingerprint:row('Build acquisition models').fingerprint,decision:'decline'},
    {questionId:row('Prepare consolidated operating budgets').id,proposalFingerprint:row('Prepare consolidated operating budgets').fingerprint,decision:'somewhat',text:'Prepare departmental operating budgets'}
  ]};
  const saved=await f.service.action(request);
  assert.equal(saved.result.kind,'experience_review_saved');assert.equal(f.saves(),1);
  assert.equal(experienceReviewReceiptMatches(saved,request),true);
  const added=saved.state.facts.filter(fact=>fact.origin==='user_answer');
  assert.deepEqual(added.map(fact=>fact.statement).sort(),['Manage client renewal forecasts','Prepare departmental operating budgets'].sort());
  assert.ok(added.every(fact=>fact.approval==='approved'&&fact.confirmation==='user_confirmed'));
  assert.ok(added.every(fact=>fact.evidence.every(ref=>saved.state.documents.find(d=>d.id===ref.documentId)?.kind==='answer')));
  const bank=buildExperienceBank(saved.state);assert.equal(bank.counts.approvedExperienceClaims,3);
  assert.equal(bank.experienceGained.unscoped.filter(item=>added.some(fact=>fact.id===item.id)).length,2,'JD additions do not acquire an invented employer');
  const replay=await f.service.action(request);assert.equal(f.saves(),1);assert.equal(replay.result.reviewId,saved.result.reviewId);
  assert.equal(replay.state.facts.length,saved.state.facts.length);
  const tampered=structuredClone(saved);tampered.state.facts.find(fact=>fact.id===added[0].id).statement='A different statement';
  assert.equal(experienceReviewReceiptMatches(tampered,request),false);
  await assert.rejects(f.service.action({...request,rows:[{...request.rows[0],decision:'decline'}]}),/different experience review/);
  assert.equal(f.saves(),1);

  const current=f.current(),approved=current.state.facts.find(fact=>fact.statement==='Manage client renewal forecasts'),partial=current.state.facts.find(fact=>fact.statement==='Prepare departmental operating budgets');
  await buildProfiles(current.state,{mappings:current.state.requirements.map(requirement=>({requirementId:requirement.id,factIds:requirement.text.startsWith('Manage')?[approved.id]:requirement.text.startsWith('Prepare')?[partial.id]:[],evidenceStatus:requirement.text.startsWith('Manage')?'supported':requirement.text.startsWith('Prepare')?'partial':'missing',missingScope:requirement.text.startsWith('Prepare')?'consolidated operating budgets':'',explanation:'The user has confirmed the exact saved scope; other work stays a gap.'})),questions:[]},'analysis');
  await f.service.memory.save(current.revision,current.state);
  const ready=finalizationReadiness(f.current().state);assert.equal(ready.ready,true,JSON.stringify(ready.blockers));
  const snapshot=await f.service.action({action:'finalize',revision:f.current().revision});
  const packet=savedPacket(snapshot.state);
  assert.equal(packet.snapshot.consolidated.experienceBank.counts.approvedExperienceClaims,3);
  assert.ok(packet.facts.records.some(fact=>fact.id===approved.id));
  assert.ok(!packet.facts.records.some(fact=>fact.statement==='Build acquisition models'));
  const python=await pythonProfileLoader(f.service)(packet.facts.version);
  assert.ok(python.facts.some(fact=>fact.id===approved.id));assert.equal(python.version,packet.facts.version);assert.ok(python.search_profile.responsibilities.length);
  assert.deepEqual(python.roles,[]);
});

test('related fact references do not turn an explicit missing scope into satisfied consolidated requirements',async()=>{
  const f=await setup(),{state}=f.current();
  await buildProfiles(state,{mappings:state.requirements.map(requirement=>({requirementId:requirement.id,factIds:[state.facts[0].id],evidenceStatus:'not_established',explanation:'Client reporting is related but does not establish this different task.'})),questions:[]},'analysis');
  const profile=buildConsolidatedProfile(state);
  assert.equal(profile.counts.supportedRequirements,0);assert.equal(profile.counts.missingRequirements,3);
  assert.ok(profile.requirements.all.every(requirement=>requirement.status==='missing'));
  assert.deepEqual(profile.experienceBank.coverage.documents,[],'raw extraction diagnostics are not part of the consolidated master profile');
});
