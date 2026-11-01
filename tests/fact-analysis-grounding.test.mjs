import test from 'node:test';
import assert from 'node:assert/strict';
import {addDocument,decideFacts,emptyProfile,proposeFacts} from '../lib/profile/domain.mjs';
import {ProfileService} from '../lib/profile/service.mjs';

const docId='resume';
const segmentId=index=>`${docId}.page1.p${index+1}`;
const proposal=(statement,index,{category='experience_claims',field='duties',scope='Example Employer',quote=statement,documentId=docId,sourceId=segmentId(index)}={})=>({category,field,scope,statement,evidence:[{documentId,segmentId:sourceId,quote}]});
const wrappedLines=['PROFESSIONAL EXPERIENCE','Prepared monthly risk reports for','regional clients using SQL.'];
const wrappedStatement='Prepared monthly risk reports for regional clients using SQL.';

async function fixture(t,lines,outputs){
  const initial=emptyProfile();
  addDocument(initial,{id:'approved-resume',kind:'resume',title:'Existing approved synthetic source',hash:'approved-source',segments:[{id:'approved.p1',text:'Previously approved client reporting.'},{id:'approved.p2',text:'Analyst'}]});
  await proposeFacts(initial,[
    proposal('Previously approved client reporting.',0,{documentId:'approved-resume',sourceId:'approved.p1'}),
    proposal('Analyst',0,{category:'employment',field:'job_title',documentId:'approved-resume',sourceId:'approved.p2'})
  ]);
  decideFacts(initial,initial.facts.map(fact=>({id:fact.id,version:fact.version,decision:'approved'})),'synthetic-owner');
  const refs=initial.facts.map(fact=>({id:fact.id,version:fact.version,approvalRef:fact.approvalRef}));
  initial.roleProfiles.push({id:'historic-role',version:1,basis:'resume',roleName:'Historic role',status:'approved',approvalRef:'historic-role-approval',factRefs:refs});
  initial.snapshots.push({id:'historic-snapshot',version:'profile-1',stale:false,approvalRef:'historic-snapshot-approval',factRefs:refs,profileRefs:[{id:'historic-role',version:1}]});
  addDocument(initial,{id:docId,kind:'resume',mime:'application/pdf',title:'Synthetic PDF source',hash:'pdf-source',segments:lines.map((text,index)=>({id:segmentId(index),text,locator:`page 1 paragraph ${index+1}`}))});
  let stored={revision:1,state:structuredClone(initial)},modelResponses=0,reservations=0,saves=0;const savedStates=[];
  const before=structuredClone(initial),modelOutputs=structuredClone(outputs),service=new ProfileService({GEMINI_API_KEY:'synthetic-test-key',PROFILE_SEMANTIC_SEARCH:'disabled'},'synthetic-owner',{factPrompt:'Synthetic Fact extraction policy.'});
  service.memory.load=async()=>structuredClone(stored);
  service.memory.save=async(revision,state)=>{assert.equal(revision,stored.revision);saves++;savedStates.push(structuredClone(state));stored={revision:revision+1,state:structuredClone(state)};return structuredClone(stored);};
  service.memory.reserve=async()=>{reservations++;return {};};
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(new URL(url).hostname,'generativelanguage.googleapis.com','all provider I/O is intercepted by the local model fixture');
    const body=JSON.parse(options.body),input=JSON.parse(body.contents[0].parts[0].text);
    assert.match(body.systemInstruction.parts[0].text,/CURRENT RUNTIME STAGE: facts/);assert.equal(input.documentId,docId);
    const output=modelOutputs[modelResponses++];assert.ok(output,'unexpected additional model request');
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]});
  });
  return {service,before,current:()=>structuredClone(stored),savedStates:()=>structuredClone(savedStates),counts:()=>({modelResponses,reservations,saves}),analyze:async()=>service.analysis(await service.memory.load(),{action:'analyze',id:docId})};
}
function approvedRecordsUnchanged(f,state){
  assert.deepEqual(state.facts.filter(fact=>f.before.facts.some(old=>old.id===fact.id)),f.before.facts);
  assert.deepEqual(state.approvals,f.before.approvals);assert.deepEqual(state.roleProfiles,f.before.roleProfiles);assert.deepEqual(state.snapshots,f.before.snapshots);
  for(const document of f.before.documents)assert.deepEqual(state.documents.find(current=>current.id===document.id).segments,document.segments,'grounding must not rewrite saved source passages');
}
function failurePreservesData(f){
  const state=f.current().state;
  assert.deepEqual({...state,runs:[]},{...f.before,runs:[]},'failure may save run metadata, never partial proposals, evidence or invalidation');
  for(const saved of f.savedStates())assert.deepEqual({...saved,runs:[]},{...f.before,runs:[]},'partial mutations must never appear in an intermediate save');
  assert.equal(state.documents.find(document=>document.id===docId).analysis,'pending');
  assert.equal(state.runs.at(-1).status,'failed');assert.match(state.runs.at(-1).message,/source passage|grounding|passage review/i);
  approvedRecordsUnchanged(f,state);
}

test('Fact analysis grounds a wrapped PDF assertion into separate exact original source references',async t=>{
  const output={facts:[proposal(wrappedStatement,1)],passageReview:[{segmentId:segmentId(0),reason:'Section heading.'}]};
  const unchangedOutput=structuredClone(output),f=await fixture(t,wrappedLines,[output]),saved=await f.analyze();
  const added=saved.state.facts.find(fact=>fact.statement===wrappedStatement);assert.ok(added);assert.equal(added.approval,'pending');assert.equal(added.approvalRef,null);
  assert.deepEqual(added.evidence,[
    {documentId:docId,documentVersion:1,segmentId:segmentId(1),quote:wrappedLines[1]},
    {documentId:docId,documentVersion:1,segmentId:segmentId(2),quote:wrappedLines[2]}
  ]);
  assert.equal(saved.state.documents.find(document=>document.id===docId).analysis,'complete');assert.equal(saved.state.runs.at(-1).status,'complete');
  approvedRecordsUnchanged(f,saved.state);assert.deepEqual(output,unchangedOutput);
});

test('Fact analysis reanchors a unique exact quote to the correct segment within the same document',async t=>{
  const text='Built audit dashboards.',f=await fixture(t,['PROFESSIONAL EXPERIENCE',text],[{facts:[proposal(text,0)],passageReview:[{segmentId:segmentId(0),reason:'Section heading.'}]}]);
  const saved=await f.analyze(),added=saved.state.facts.find(fact=>fact.statement===text);assert.ok(added);
  assert.deepEqual(added.evidence,[{documentId:docId,documentVersion:1,segmentId:segmentId(1),quote:text}]);
  approvedRecordsUnchanged(f,saved.state);
});

test('Fact analysis leaves an already exact valid citation unchanged',async t=>{
  const text='Built audit dashboards.',f=await fixture(t,['PROFESSIONAL EXPERIENCE',text],[{facts:[proposal(text,1)],passageReview:[{segmentId:segmentId(0),reason:'Section heading.'}]}]);
  const saved=await f.analyze(),added=saved.state.facts.find(fact=>fact.statement===text);assert.ok(added);
  assert.deepEqual(added.evidence,[{documentId:docId,documentVersion:1,segmentId:segmentId(1),quote:text}]);
  assert.equal(saved.state.documents.find(document=>document.id===docId).analysis,'complete');approvedRecordsUnchanged(f,saved.state);
});

for(const invalid of ['fabricated quote','changed metric','foreign source'])test(`Fact analysis rejects the whole batch for ${invalid} without changing any saved confirmation`,async t=>{
  const lines=['PROFESSIONAL EXPERIENCE','Previously approved client reporting.','Senior Analyst','Managed 12 accounts.'];
  const bad=invalid==='fabricated quote'?proposal('Invented achievement.',3):invalid==='changed metric'?proposal('Managed 13 accounts.',3)
    :proposal('Previously approved client reporting.',0,{documentId:'approved-resume',sourceId:'approved.p1'});
  const facts=[proposal(lines[1],1),proposal(lines[2],2,{category:'employment',field:'job_title'}),bad];
  const f=await fixture(t,lines,[{facts}]);
  await assert.rejects(f.analyze(),error=>/source passage|grounding/i.test(error.message));failurePreservesData(f);
  assert.deepEqual(f.counts(),{modelResponses:1,reservations:1,saves:2});
});

test('invalid passage-review metadata rolls back earlier valid duplicate evidence and conflict proposals',async t=>{
  const lines=['PROFESSIONAL EXPERIENCE','Previously approved client reporting.','Senior Analyst'];
  const f=await fixture(t,lines,[{facts:[proposal(lines[1],1),proposal(lines[2],2,{category:'employment',field:'job_title'})],passageReview:[{segmentId:'not-a-source-segment',reason:'Section heading.'}]}]);
  await assert.rejects(f.analyze(),/invalid passage review/i);failurePreservesData(f);
});

test('a rejected extraction can retry the same document and preserve existing approved facts',async t=>{
  const f=await fixture(t,wrappedLines,[{facts:[proposal('Invented achievement.',1)]},{facts:[proposal(wrappedStatement,1)],passageReview:[{segmentId:segmentId(0),reason:'Section heading.'}]}]);
  await assert.rejects(f.analyze(),error=>/source passage|grounding/i.test(error.message));failurePreservesData(f);
  const saved=await f.analyze();assert.equal(saved.state.documents.filter(document=>document.id===docId).length,1);
  assert.deepEqual(saved.state.runs.map(run=>run.status),['failed','complete']);
  assert.equal(saved.state.documents.find(document=>document.id===docId).analysis,'complete');
  assert.equal(saved.state.facts.filter(fact=>fact.statement===wrappedStatement).length,1);approvedRecordsUnchanged(f,saved.state);
  assert.deepEqual(f.counts(),{modelResponses:2,reservations:2,saves:4});
});
