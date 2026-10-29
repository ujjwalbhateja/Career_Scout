import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile,addDocument,proposeFacts,decideFacts} from '../lib/profile/domain.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
import {factKey,factDecision,latestRecord,decisionBasesMatch,decisionReceiptMatches,indexingActive,profileWorkPending} from '../lib/profile/client-state.mjs';
async function fixture(){const s=emptyProfile();addDocument(s,{id:'resume',kind:'resume',title:'Synthetic source',hash:'fixture',segments:[{id:'p1',text:'Prepared portfolio reports for institutional clients.'}]});await proposeFacts(s,[{category:'experience_claims',field:'reporting',scope:'Example Employer',statement:'Prepared portfolio reports',evidence:[{documentId:'resume',segmentId:'p1',quote:'Prepared portfolio reports'}]}]);return s;}

test('late rejected-state reads cannot replace a newer approved record',async()=>{
  const rejected=await fixture();decideFacts(rejected,[{id:rejected.facts[0].id,version:1,decision:'rejected'}],'fixture');
  const approved=structuredClone(rejected),decision=factDecision(approved.facts[0],'approved');decideFacts(approved,[decision],'fixture');
  const current={revision:8,state:approved};assert.equal(latestRecord(current,{revision:6,state:rejected}),current);assert.equal(current.state.facts[0].approval,'approved');assert.equal(decisionReceiptMatches(current,[decision]),true);
});

test('metadata-only revision changes preserve the reviewed fact basis, but a different decision does not',async()=>{
  const s=await fixture(),decision=factDecision(s.facts[0],'approved');s.runs.push({id:'sync',action:'sync',status:'complete',startedAt:new Date().toISOString()});
  assert.equal(decisionBasesMatch(s,[decision]),true);decideFacts(s,[factDecision(s.facts[0],'rejected')],'other-fixture-tab');
  assert.equal(decisionBasesMatch(s,[decision]),false);const before=structuredClone(s);
  assert.throws(()=>decideFacts(s,[decision],'fixture'),/previous decision changed|decision changed/);assert.deepEqual(s,before);
});

test('stale selected versions and contradictory duplicate decisions never create approvals',async()=>{
  const s=await fixture(),fact=s.facts[0],decision=factDecision(fact,'approved'),before=structuredClone(s);
  assert.notEqual(factKey(fact),factKey({...fact,version:2}));
  assert.equal(decisionBasesMatch({...s,facts:[{...fact,version:2}]},[decision]),false);
  assert.throws(()=>decideFacts(s,[decision,{...decision,decision:'rejected'}],'fixture'),/only once/);assert.deepEqual(s,before);
});

test('the service returns the exact persisted decision receipt and reload retains it',async()=>{
  let stored={revision:4,state:await fixture()};const service=new ProfileService({},'fixture-owner');
  service.memory.load=async()=>structuredClone(stored);
  service.memory.save=async(revision,state)=>{assert.equal(revision,stored.revision);stored={revision:revision+1,state:structuredClone(state)};return structuredClone(stored);};
  const decision=factDecision(stored.state.facts[0],'approved');
  const result=await service.action({action:'decideFacts',revision:4,decisions:[decision]});
  assert.equal(result.result.kind,'fact_decisions');assert.equal(result.result.decisions[0].decision,'approved');assert.ok(result.result.decisions[0].approvalRef);
  assert.equal(decisionReceiptMatches(result,[decision]),true);assert.equal(decisionReceiptMatches(await service.read(),[decision]),true);
});

test('indexing leases and queued work refresh until complete, without changing decisions',async()=>{
  const s=await fixture(),at=Date.now();s.runs.push({id:'sync',action:'sync',status:'running',startedAt:new Date(at).toISOString()});s.memoryIntent={runId:'sync',expiresAt:new Date(at+5000).toISOString()};
  assert.equal(indexingActive(s,at),true);assert.equal(profileWorkPending(s,true,at),true);
  s.runs[0].status='complete';assert.equal(indexingActive(s,at),false);assert.equal(profileWorkPending(s,true,at),false);
  s.outbox.push({kind:'reindex',status:'pending'});assert.equal(profileWorkPending(s,true,at),true);assert.equal(profileWorkPending(s,false,at),false);assert.equal(s.facts[0].approval,'pending');
});
