import test from 'node:test';
import assert from 'node:assert/strict';
import {ProfileService} from '../lib/profile/service.mjs';
import {addAnswer,addDocument,approvedFacts,chunks,correctFact,decideFacts,emptyProfile,proposeFacts,removeDocument,replayedAnswer,resolveConflict} from '../lib/profile/domain.mjs';

function stateWithQuestion(status='unresolved'){
  const state=emptyProfile();
  state.questions.push({id:'q1',key:'synthetic-question-key',scope:'Example Employer',question:'Describe your SQL work.',status});
  return state;
}
const answerBody=(overrides={})=>({questionId:'q1',decision:'answered',capabilityDecision:'yes',text:'I wrote SQL.',submissionId:'synthetic-submit-001',...overrides});
function fixture(state=stateWithQuestion(),env={GEMINI_API_KEY:'fixture-only'}){
  const service=new ProfileService(env,'synthetic-owner',{factPrompt:'SYNTHETIC FACT POLICY'});
  let record={revision:1,state:structuredClone(state)},saves=0,reserves=0;
  service.memory.load=async()=>structuredClone(record);
  service.memory.save=async(revision,next)=>{
    assert.equal(revision,record.revision,'fixture saves must use the latest aggregate revision');
    record={revision:revision+1,state:structuredClone(next)};saves++;
    return structuredClone(record);
  };
  service.memory.reserve=async()=>{reserves++;};
  return {service,current:()=>structuredClone(record),counts:()=>({saves,reserves})};
}
function modelResponse(input,{quote=input.segments[0].text,conflicts}={}){
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({facts:[{
    category:'experience_claims',field:'sql_work',scope:'Example Employer',statement:input.segments[0].text,
    evidence:[{documentId:input.documentId,segmentId:input.segments[0].id,quote}]
  }],...(conflicts?{conflicts}:{})})}]}}]});
}
function sourceFact(documentId,text,overrides={}){
  return {category:'experience_claims',field:'sql_work',scope:'Example Employer',statement:text,evidence:[{documentId,segmentId:documentId+'.p1',quote:text}],...overrides};
}

test('bare Yes is saved as needing details without invented facts or answer documents',async()=>{
  for(const text of ['', 'Yes', 'I can', 'Yes I have.']){
    const state=stateWithQuestion(),answer=await addAnswer(state,answerBody({text}));
    assert.equal(answer.status,'needs_details');assert.equal(answer.text,text);
    assert.equal(state.questions[0].status,'needs_details');assert.equal(state.answers.length,1);
    assert.equal(state.documents.length,0);assert.equal(state.facts.length,0);assert.equal(state.approvals.length,0);
    assert.equal(state.outbox.length,0);
  }
});

test('a short substantive example is accepted and remains separate from fact approval',async()=>{
  const state=stateWithQuestion(),answer=await addAnswer(state,answerBody());
  assert.ok(answer.text.length<20);assert.equal(answer.status,'answered');
  assert.equal(state.documents.length,1);assert.equal(state.documents[0].id,answer.documentId);
  assert.equal(state.documents[0].segments[0].text,'I wrote SQL.');assert.equal(state.documents[0].analysis,'pending');
  assert.equal(state.facts.length,0);assert.equal(state.approvals.length,0);assert.equal(state.outbox.length,0);
});

test('No, Not sure and decline save decisions without creating or indexing evidence',async()=>{
  for(const [decision,capabilityDecision] of [['not_experienced','no'],['deferred','unsure'],['declined',undefined]]){
    const state=stateWithQuestion(),answer=await addAnswer(state,answerBody({decision,capabilityDecision,text:''}));
    assert.equal(answer.status,decision);assert.equal(state.answers.length,1);assert.equal(state.questions[0].status,decision);
    assert.equal(state.documents.length,0);assert.equal(state.facts.length,0);assert.equal(state.outbox.length,0);
  }
});

test('a declined question requires explicit reopening before recording experience',async()=>{
  const state=stateWithQuestion('declined');
  await assert.rejects(addAnswer(state,answerBody()),error=>error.status===409&&/reopen/i.test(error.message));
  assert.equal(state.answers.length,0);assert.equal(state.documents.length,0);assert.equal(state.questions[0].status,'declined');
  const answer=await addAnswer(state,answerBody({reopen:true}));assert.equal(answer.status,'answered');
});

test('oversized answers are rejected instead of silently truncating a saved response',async()=>{
  const state=stateWithQuestion();
  await assert.rejects(addAnswer(state,answerBody({text:'x'.repeat(5001)})),/5,000/);
  assert.equal(state.answers.length,0);assert.equal(state.documents.length,0);assert.equal(state.questions[0].status,'unresolved');
});

test('replaying one submission returns the original answer and document',async()=>{
  const state=stateWithQuestion(),body=answerBody(),first=await addAnswer(state,body),second=await addAnswer(state,body);
  assert.equal(second.id,first.id);assert.equal((await replayedAnswer(state,body)).id,first.id);
  assert.equal(state.answers.length,1);assert.equal(state.documents.length,1);
  await assert.rejects(replayedAnswer(state,{...body,text:'I wrote Python.'}),error=>error.status===409);
  assert.equal(state.documents[0].segments[0].text,body.text);
});

test('saving an answer returns a durable receipt without requiring an available analysis model',async()=>{
  const f=fixture(stateWithQuestion(),{}),saved=await f.service.action({action:'answer',revision:1,...answerBody()});
  assert.equal(saved.result.kind,'answer_saved');assert.equal(saved.result.analysisStatus,'pending');
  assert.equal(saved.result.answerId,saved.state.answers[0].id);assert.equal(saved.result.submissionId,'synthetic-submit-001');
  assert.equal(saved.state.documents.length,1);assert.deepEqual(f.counts(),{saves:1,reserves:0});
});

test('a stale replay returns its saved receipt without a second document, save or model call',async t=>{
  const f=fixture();let requests=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{requests++;return modelResponse(JSON.parse(JSON.parse(options.body).contents[0].parts[0].text));});
  const body={action:'answer',revision:1,...answerBody(),analyze:true};
  const first=await f.service.action(body),counts=f.counts(),second=await f.service.action(body);
  assert.equal(first.result.analysisStatus,'complete');assert.equal(second.result.answerId,first.result.answerId);
  assert.equal(second.result.analysisStatus,'complete');assert.equal(second.state.documents.length,1);assert.equal(second.state.answers.length,1);
  assert.equal(second.state.facts.length,1);assert.equal(second.state.facts[0].approval,'pending');assert.equal(requests,1);
  assert.deepEqual(f.counts(),counts);assert.ok(second.revision>body.revision);
});

test('a submission token reused for different content fails even with a stale revision',async()=>{
  const f=fixture();await f.service.action({action:'answer',revision:1,...answerBody()});
  await assert.rejects(f.service.action({action:'answer',revision:1,...answerBody({text:'I wrote Python.'})}),error=>error.status===409&&/different answer/.test(error.message));
  const current=f.current();assert.equal(current.state.answers.length,1);assert.equal(current.state.documents.length,1);
  assert.equal(current.state.answers[0].text,'I wrote SQL.');
});

test('a new submission with a stale revision does not overwrite or add an answer',async()=>{
  const f=fixture();await f.service.action({action:'answer',revision:1,...answerBody()});
  await assert.rejects(f.service.action({action:'answer',revision:1,...answerBody({submissionId:'synthetic-submit-002',text:'I wrote Python.'})}),error=>error.status===409&&/profile changed/.test(error.message));
  assert.equal(f.current().state.answers.length,1);
});

for(const failure of ['quota','unavailable','invalid_quote'])test('saved answer survives '+failure+' and extraction retries the same document',async t=>{
  const f=fixture();let requests=0;const sourceIds=[];
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    requests++;const request=JSON.parse(options.body),input=JSON.parse(request.contents[0].parts[0].text);sourceIds.push(input.documentId);
    assert.ok(request.systemInstruction.parts[0].text.includes('SYNTHETIC FACT POLICY'));
    if(requests===1){
      if(failure==='invalid_quote')return modelResponse(input,{quote:'Not present in the answer'});
      return Response.json({error:{status:failure==='quota'?'RESOURCE_EXHAUSTED':'UNAVAILABLE'}},{status:failure==='quota'?429:503});
    }
    return modelResponse(input);
  });
  const failed=await f.service.action({action:'answer',revision:1,...answerBody(),analyze:true});
  assert.equal(failed.result.kind,'answer_saved');assert.equal(failed.result.analysisStatus,'failed');assert.match(failed.result.message,/answer is saved/i);
  assert.equal(failed.state.answers.length,1);assert.equal(failed.state.documents.length,1);assert.equal(failed.state.documents[0].analysis,'pending');
  assert.equal(failed.state.facts.length,0);assert.equal(failed.state.approvals.length,0);assert.equal(failed.state.runs.at(-1).status,'failed');
  const completed=await f.service.action({action:'analyzeAnswer',revision:failed.revision,id:failed.result.answerId});
  assert.equal(completed.result.kind,'answer_saved');assert.equal(completed.result.analysisStatus,'complete');
  assert.equal(completed.result.answerId,failed.result.answerId);assert.equal(completed.state.answers.length,1);assert.equal(completed.state.documents.length,1);
  assert.equal(completed.state.facts.length,1);assert.equal(completed.state.facts[0].approval,'pending');assert.equal(completed.state.approvals.length,0);
  assert.equal(completed.state.facts[0].origin,'user_answer');assert.equal(completed.state.facts[0].confirmation,'user_stated');
  assert.deepEqual(sourceIds,[failed.state.documents[0].id,failed.state.documents[0].id]);
  const counts=f.counts();await f.service.action({action:'analyzeAnswer',revision:completed.revision,id:completed.result.answerId});
  assert.equal(requests,2);assert.deepEqual(f.counts(),counts,'extracting an already complete answer is idempotent');
});

test('a missing model produces a saved answer receipt and does not lose the source text',async()=>{
  const f=fixture(stateWithQuestion(),{}),result=await f.service.action({action:'answer',revision:1,...answerBody(),analyze:true});
  assert.equal(result.result.kind,'answer_saved');assert.equal(result.result.analysisStatus,'failed');assert.match(result.result.message,/answer is saved/i);
  assert.equal(result.state.answers.length,1);assert.equal(result.state.documents[0].segments[0].text,'I wrote SQL.');
  assert.equal(result.state.runs.length,0);assert.deepEqual(f.counts(),{saves:1,reserves:0});
});

test('changing a previous Yes to No flags linked approved facts for review without withdrawing approvals',async()=>{
  const state=stateWithQuestion(),answer=await addAnswer(state,answerBody());
  await proposeFacts(state,[sourceFact(answer.documentId,'I wrote SQL.')],'user_answer');
  decideFacts(state,[{id:state.facts[0].id,version:1,decision:'approved'}],'synthetic-owner');
  const approval=structuredClone(state.approvals),approvalRef=state.facts[0].approvalRef;state.outbox=[];
  state.roleProfiles.push({id:'role1',factRefs:[{id:state.facts[0].id,version:1}],status:'approved'});
  state.snapshots.push({id:'snapshot1',factRefs:[{id:state.facts[0].id,version:1}],stale:false});
  const negative=await addAnswer(state,answerBody({submissionId:'synthetic-submit-002',decision:'not_experienced',capabilityDecision:'no',text:''}));
  assert.equal(negative.requiresConsistencyReview,true);assert.deepEqual(negative.consistencyFactRefs,[{id:state.facts[0].id,version:1}]);
  assert.equal(state.facts[0].approval,'approved');assert.equal(state.facts[0].approvalRef,approvalRef);assert.deepEqual(state.approvals,approval);
  assert.equal(approvedFacts(state).length,0);assert.equal(chunks(state).filter(c=>c.record_type==='approved_fact').length,0);
  assert.equal(state.facts[0].conflict,true);assert.deepEqual(state.facts[0].consistencyAnswerIds,[negative.id]);
  assert.equal(state.roleProfiles[0].status,'needs_review');assert.equal(state.snapshots[0].stale,true);
  assert.equal(state.documents.length,1);assert.equal(state.outbox.filter(e=>e.kind==='reindex').length,1);
});

async function linkedFacts(count=2){
  const state=stateWithQuestion(),answer=await addAnswer(state,answerBody({text:'I wrote SQL and prepared reports.'}));
  await proposeFacts(state,Array.from({length:count},(_,i)=>sourceFact(answer.documentId,answer.text,{field:'work_'+i,statement:'Work assertion '+i})),'user_answer');
  decideFacts(state,state.facts.map(f=>({id:f.id,version:1,decision:'approved'})),'synthetic-owner');
  state.outbox=[];
  const negative=await addAnswer(state,answerBody({submissionId:'synthetic-submit-002',decision:'not_experienced',capabilityDecision:'no',text:''}));
  return {state,answer,negative};
}

test('explicitly keeping a fact resolves only its linked review and restores only eligible evidence',async()=>{
  const {state,negative}=await linkedFacts(),approvals=structuredClone(state.approvals);
  assert.equal(approvedFacts(state).length,0);resolveConflict(state,state.facts[0].id);
  assert.equal(negative.requiresConsistencyReview,true,'the other linked fact still needs a decision');
  assert.deepEqual(approvedFacts(state).map(f=>f.id),[state.facts[0].id]);assert.equal(state.facts[1].conflict,true);
  resolveConflict(state,state.facts[1].id);
  assert.equal(negative.requiresConsistencyReview,false);assert.ok(negative.consistencyResolvedAt);
  assert.equal(approvedFacts(state).length,2);assert.deepEqual(state.approvals,approvals);
  assert.equal(state.facts.every(f=>f.approval==='approved'&&!f.consistencyAnswerIds.length),true);
});

test('repeating No retains unresolved linked reviews without another index removal',async()=>{
  const {state,negative}=await linkedFacts(1);state.outbox=[];
  const again=await addAnswer(state,answerBody({submissionId:'synthetic-submit-003',decision:'not_experienced',capabilityDecision:'no',text:''}));
  assert.equal(again.requiresConsistencyReview,true);assert.equal(negative.requiresConsistencyReview,true);
  assert.equal(approvedFacts(state).length,0);assert.equal(state.outbox.length,0);
  resolveConflict(state,state.facts[0].id);
  assert.equal(again.requiresConsistencyReview,false);assert.equal(negative.requiresConsistencyReview,false);
  assert.equal(approvedFacts(state).length,1);
});

test('correcting one linked fact and withdrawing another resolves review without approving the correction',async()=>{
  const {state,negative}=await linkedFacts(),prior=state.facts[0];
  const correction=await correctFact(state,{id:prior.id,version:1,statement:'I prepared reports without writing SQL.'});
  assert.equal(prior.lifecycle,'superseded');assert.equal(correction.approval,'pending');
  assert.equal(negative.requiresConsistencyReview,true,'the second approved fact remains unresolved');
  decideFacts(state,[{id:state.facts[1].id,version:1,decision:'withdrawn'}],'synthetic-owner');
  assert.equal(negative.requiresConsistencyReview,false);assert.equal(approvedFacts(state).length,0);
  assert.equal(prior.approval,'approved');assert.equal(correction.approval,'pending');
});

test('withdrawing the source retires linked assertions and clears their outstanding answer review',async()=>{
  const {state,answer,negative}=await linkedFacts();
  removeDocument(state,answer.documentId);
  assert.equal(negative.requiresConsistencyReview,false);assert.equal(approvedFacts(state).length,0);
  assert.equal(state.facts.every(f=>f.lifecycle==='withdrawn'),true);
});

test('a declined No cannot change an approved fact before the question is explicitly reopened',async()=>{
  const state=stateWithQuestion(),answer=await addAnswer(state,answerBody());
  await proposeFacts(state,[sourceFact(answer.documentId,'I wrote SQL.')],'user_answer');
  decideFacts(state,[{id:state.facts[0].id,version:1,decision:'approved'}],'synthetic-owner');
  state.questions[0].status='declined';state.outbox=[];
  await assert.rejects(addAnswer(state,answerBody({submissionId:'synthetic-submit-002',decision:'not_experienced',capabilityDecision:'no',text:''})),error=>error.status===409);
  assert.equal(approvedFacts(state).length,1);assert.equal(state.facts[0].conflict,false);assert.equal(state.outbox.length,0);
});

test('reported semantic contradictions preserve approval history but block unsupported evidence merges',async()=>{
  const state=stateWithQuestion();
  addDocument(state,{id:'resume',kind:'resume',title:'Synthetic resume',hash:'synthetic-resume',segments:[{id:'resume.p1',text:'I led the SQL migration.'}]});
  await proposeFacts(state,[sourceFact('resume','I led the SQL migration.')]);
  decideFacts(state,[{id:state.facts[0].id,version:1,decision:'approved'}],'synthetic-owner');
  const prior=state.facts[0],approvalRef=prior.approvalRef,approvals=structuredClone(state.approvals);
  state.roleProfiles.push({id:'role1',factRefs:[{id:prior.id,version:1}],status:'approved'});
  state.snapshots.push({id:'snapshot1',factRefs:[{id:prior.id,version:1}],stale:false});
  const answer=await addAnswer(state,answerBody({text:'I did not lead the SQL migration.'}));
  const added=await proposeFacts(state,[sourceFact(answer.documentId,answer.text)],'user_answer',[{existingFactId:prior.id,proposedFactIndex:0,reason:'The leadership statements conflict within the same employer and project.'}]);
  assert.equal(added.length,1);assert.equal(prior.approval,'approved');assert.equal(prior.approvalRef,approvalRef);assert.deepEqual(state.approvals,approvals);
  assert.equal(added[0].approval,'pending');assert.equal(prior.conflict,true);assert.equal(added[0].conflict,true);
  assert.ok(prior.conflictIds.includes(added[0].id));assert.ok(added[0].conflictIds.includes(prior.id));
  assert.equal(approvedFacts(state).length,0);assert.equal(state.roleProfiles[0].status,'needs_review');assert.equal(state.snapshots[0].stale,true);
  assert.throws(()=>decideFacts(state,[{id:added[0].id,version:1,decision:'approved'}],'synthetic-owner'),/Resolve conflicting/);
});

test('invalid semantic conflict references reject the batch before adding facts',async()=>{
  const state=stateWithQuestion(),answer=await addAnswer(state,answerBody()),proposals=[sourceFact(answer.documentId,answer.text)];
  for(const conflict of [
    {existingFactId:'unknown',proposedFactIndex:0,reason:'Unsupported reference'},
    {existingFactId:'unknown',proposedFactIndex:2,reason:'Unsupported proposal index'}
  ]){
    await assert.rejects(proposeFacts(state,proposals,'user_answer',[conflict]),error=>error.status===502);
    assert.equal(state.facts.length,0);assert.equal(state.approvals.length,0);
  }
});
