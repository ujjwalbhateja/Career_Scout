import test from 'node:test';
import assert from 'node:assert/strict';
import {addDocument,canonicalJSON,decideFacts,digest,emptyProfile,proposeFacts} from '../lib/profile/domain.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
import {buildFactReview} from '../lib/profile/fact-review.mjs';
import {extractSectionOneFacts,SECTION_ONE_PARSER_VERSION} from '../lib/profile/section-one.mjs';
import {section1ReceiptMatches} from '../lib/profile/client-state.mjs';

const source=[
  'Sample Candidate',
  'sample@example.test | +1 212 555 0100',
  'Address: 1 Example Road, New York, NY',
  'PROFESSIONAL EXPERIENCE',
  'Example Services  New York, NY',
  'Senior Analyst  Sep 24 - Pres.',
  'Built scenario models.',
  'EDUCATION',
  'Example University  Boston, MA',
  'Master of Science in Finance  Jun 18 - May 20',
  'Technical tools (skills): Python, Excel, SQL',
  'CERTIFICATIONS',
  'Certification: CFA Level I passed'
];
function memoryService(state=emptyProfile()){
  const service=new ProfileService({},'synthetic-owner');let record={revision:1,state:structuredClone(state)},writes=0;
  service.memory.load=async()=>structuredClone(record);
  service.memory.save=async(revision,next)=>{assert.equal(revision,record.revision);writes++;record={revision:revision+1,state:structuredClone(next)};return structuredClone(record);};
  return {service,current:()=>structuredClone(record),writes:()=>writes};
}
async function oldCompleteState(){
  const state=emptyProfile();addDocument(state,{id:'resume',kind:'resume',title:'Sanitized short-year resume',hash:'resume-source',segments:source.map((text,index)=>({id:'resume.p'+index,text,locator:'paragraph '+index}))});
  const doc=state.documents[0];doc.analysis='complete';doc.coverage={sourcePassages:source.length,referencedPassages:3,unreferencedPassages:['resume.p1','resume.p8']};
  await proposeFacts(state,[
    {category:'personal',field:'full_name',scope:'personal',statement:'Sample Candidate',evidence:[{documentId:'resume',segmentId:'resume.p0',quote:'Sample Candidate'}]},
    {category:'employment',field:'Senior Analyst',scope:'Example Services',statement:'Senior Analyst Sep 24 - Pres.',evidence:[{documentId:'resume',segmentId:'resume.p5',quote:source[5]}]},
    {category:'education',field:'Master of Science in Finance',scope:'Example University',statement:'Master of Science in Finance Jun 18 - May 20',evidence:[{documentId:'resume',segmentId:'resume.p9',quote:source[9]}]},
    {category:'experience_claims',field:'scenario_models',scope:'Example Services / Senior Analyst',statement:'Built scenario models.',evidence:[{documentId:'resume',segmentId:'resume.p6',quote:'Built scenario models.'}]}
  ]);
  decideFacts(state,state.facts.map(fact=>({id:fact.id,version:fact.version,decision:'approved'})),'synthetic-owner');
  state.roleProfiles.push({id:'legacy-role',version:1,status:'approved',approvalRef:'legacy-role-approval',roleName:'Historical role',factRefs:[{id:state.facts[3].id,version:1}],mappings:[],jdIds:[]});
  // The snapshot is historical metadata. Section 1 extraction may mark it stale
  // when proposals are added, but cannot change its facts or approval identity.
  state.snapshots.push({id:'old-snapshot',version:'profile-1',approvalRef:'old-snapshot-approval',factRefs:state.facts.map(fact=>({id:fact.id,version:fact.version})),profileRefs:[],stale:false});
  state.runs.push({id:'old-failed-run',action:'analyze',documentId:'resume',status:'failed',message:'Gemini temporarily unavailable.',startedAt:'2026-10-31T03:11:48.000Z'});
  return state;
}

test('Section 1 repair uses saved literal source without a model and preserves every old approval and work fact',async t=>{
  const state=await oldCompleteState(),before=structuredClone(state),f=memoryService(state);
  t.mock.method(globalThis,'fetch',()=>assert.fail('Section 1 extraction must not call a model or provider.'));
  const result=await f.service.action({action:'extractSection1',revision:1,id:'resume'});
  assert.equal(f.writes(),1);assert.equal(result.result.kind,'section1_extracted');assert.equal(result.result.parserVersion,SECTION_ONE_PARSER_VERSION);
  assert.equal(result.result.unchanged,false);assert.ok(result.result.addedCount>8);assert.match(result.result.sourceHash,/^[a-f0-9]{64}$/);
  assert.deepEqual(result.state.facts.slice(0,before.facts.length),before.facts);assert.deepEqual(result.state.approvals,before.approvals);assert.deepEqual(result.state.roleProfiles,before.roleProfiles);
  const work=result.state.facts.filter(fact=>fact.category==='experience_claims');assert.deepEqual(work,before.facts.filter(fact=>fact.category==='experience_claims'));
  assert.equal(result.state.documents[0].analysis,'complete');assert.deepEqual(result.state.documents[0].coverage,before.documents[0].coverage);
  const added=result.state.facts.filter(fact=>result.result.addedFactIds.includes(fact.id));assert.equal(added.length,result.result.addedCount);
  assert.ok(added.every(fact=>fact.approval==='pending'&&fact.approvalRef===null&&fact.extractionStage==='section1'));
  assert.ok(added.every(fact=>!['experience_claims','quantitative_claims','client_relationships'].includes(fact.category)));
  for(const fact of added)for(const ref of fact.evidence){assert.equal(ref.documentId,'resume');assert.ok(result.state.documents[0].segments.find(segment=>segment.id===ref.segmentId).text.includes(ref.quote));}
  assert.equal(result.state.snapshots[0].stale,true);assert.deepEqual(result.state.snapshots[0].factRefs,before.snapshots[0].factRefs);assert.equal(result.state.snapshots[0].approvalRef,before.snapshots[0].approvalRef);
  const values=result.state.facts.filter(fact=>fact.extractionStage==='section1').map(fact=>fact.statement);
  assert.ok(values.includes('sample@example.test'));assert.ok(values.includes('Sep 24'));assert.ok(values.includes('Pres.'));assert.ok(values.includes('Example Services'));assert.ok(values.includes('Example University'));
  assert.ok(!values.includes('2024'));assert.ok(!values.includes('2018'));assert.ok(!result.state.facts.some(fact=>fact.field==='total_experience'));
  const review=buildFactReview(result.state,{asOf:'2026-10-31'});assert.equal(review.personal.email.status,'provided');assert.equal(review.personal.email.approvalStatus,'pending');
  assert.equal(result.state.documents[0].section1Analysis.sourceHash,result.result.sourceHash);
  assert.deepEqual(result.state.documents[0].section1Analysis.factIds,result.result.factIds);
  assert.equal(section1ReceiptMatches(result,{id:'resume'}),true);
  const wrongValue=structuredClone(result);
  wrongValue.state.facts.find(fact=>result.result.addedFactIds.includes(fact.id)).statement='Not present in the supplied source';
  assert.equal(section1ReceiptMatches(wrongValue,{id:'resume'}),false,'a saved receipt must not confirm invented field values');
  const wrongApproval=structuredClone(result);
  wrongApproval.state.facts.find(fact=>result.result.addedFactIds.includes(fact.id)).approval='approved';
  assert.equal(section1ReceiptMatches(wrongApproval,{id:'resume'}),false,'extraction cannot silently approve new factual fields');
  assert.equal(section1ReceiptMatches(result,{id:'different-resume'}),false);
});

test('an unchanged parser/source rerun returns the stored receipt without any write or duplicate fact',async()=>{
  const f=memoryService(await oldCompleteState());await f.service.action({action:'extractSection1',revision:1});const before=f.current();
  const again=await f.service.action({action:'extractSection1',revision:before.revision,id:'resume'});
  assert.equal(again.result.unchanged,true);assert.equal(again.result.addedCount,0);assert.equal(f.writes(),1);assert.equal(again.revision,before.revision);
  assert.deepEqual(f.current(),before);assert.deepEqual(again.result.factIds,before.state.documents[0].section1Analysis.factIds);
});

test('stale revisions and invalid document selection cannot mutate facts or receipts',async()=>{
  const f=memoryService(await oldCompleteState()),before=f.current();
  await assert.rejects(f.service.action({action:'extractSection1',revision:0,id:'resume'}),error=>error.status===409);
  await assert.rejects(f.service.action({action:'extractSection1',revision:1,id:'not-a-resume'}),error=>error.status===404);
  assert.equal(f.writes(),0);assert.deepEqual(f.current(),before);
});

test('literal proposals do not mark an older approved value conflicting or inherit its approval',async()=>{
  const state=await oldCompleteState(),scope='Example Services | Senior Analyst | Sep 24 | Pres.';
  const [old]=await proposeFacts(state,[{category:'employment',field:'company_name',scope,statement:'Example',evidence:[{documentId:'resume',segmentId:'resume.p4',quote:'Example Services'}]}]);
  decideFacts(state,[{id:old.id,version:1,decision:'approved'}],'synthetic-owner');const prior=structuredClone(old),f=memoryService(state);
  const saved=await f.service.action({action:'extractSection1',revision:1,id:'resume'});
  assert.deepEqual(saved.state.facts.find(fact=>fact.id===old.id),prior);
  const candidate=saved.state.facts.find(fact=>fact.field==='company_name'&&fact.statement==='Example Services'&&fact.scope===scope);
  assert.ok(candidate);assert.equal(candidate.approval,'pending');assert.equal(candidate.approvalRef,null);assert.equal(candidate.conflict,true);assert.ok(candidate.conflictIds.includes(old.id));
});

test('resume paste stages Section 1 pending proposals in the first CAS while leaving full-source analysis pending',async t=>{
  const f=memoryService();t.mock.method(globalThis,'fetch',()=>assert.fail('Resume intake must not call a model.'));
  const saved=await f.service.action({action:'paste',revision:1,kind:'resume',title:'Fresh source',text:source.join('\n')});
  assert.equal(f.writes(),1);assert.equal(saved.state.documents.length,1);assert.equal(saved.state.documents[0].analysis,'pending');assert.equal(saved.state.documents[0].coverage,undefined);
  assert.equal(saved.result.kind,'section1_extracted');assert.ok(saved.state.documents[0].section1Analysis);assert.ok(saved.state.facts.length>3);
  assert.ok(saved.state.facts.every(fact=>fact.approval==='pending'&&fact.extractionStage==='section1'));assert.equal(saved.state.approvals.length,0);
  assert.ok(!saved.state.facts.some(fact=>fact.category==='experience_claims'));assert.equal(saved.state.roleProfiles.length,0);
});

test('resume file upload stages Section 1 before original-file storage and saves once',async()=>{
  const f=memoryService(),bytes=new TextEncoder().encode(source.join('\n'));let uploads=0;
  f.service.memory.upload=async()=>{uploads++;assert.equal(f.writes(),0);return 'synthetic/original';};f.service.memory.removeFiles=async()=>assert.fail('A successful upload must not be removed.');
  const saved=await f.service.upload({name:'synthetic.txt',type:'text/plain',arrayBuffer:async()=>bytes.buffer},{kind:'resume',revision:1});
  assert.equal(uploads,1);assert.equal(f.writes(),1);assert.ok(saved.state.documents[0].section1Analysis);assert.equal(saved.state.documents[0].analysis,'pending');assert.equal(saved.state.documents[0].objectPath,'synthetic/original');
  assert.ok(saved.state.facts.some(fact=>fact.category==='personal'&&fact.field==='email'&&fact.approval==='pending'));assert.equal(saved.state.approvals.length,0);
});

test('a Section 1 staging failure happens before original-file upload and leaves saved state unchanged',async()=>{
  const state=emptyProfile();state.facts=Array.from({length:1200},(_,index)=>({id:'history-'+index,version:1,category:'preferences',field:'historical_preference',scope:'history '+index,statement:'Historical preference',fingerprint:'history-'+index,evidence:[],approval:'pending',approvalRef:null,lifecycle:'active',conflict:false}));
  const f=memoryService(state),before=f.current(),bytes=new TextEncoder().encode(source.join('\n'));let uploads=0;
  f.service.memory.upload=async()=>{uploads++;return 'must-not-upload';};
  await assert.rejects(f.service.upload({name:'synthetic.txt',type:'text/plain',arrayBuffer:async()=>bytes.buffer},{kind:'resume',revision:1}),/Fact history limit/);
  assert.equal(uploads,0);assert.equal(f.writes(),0);assert.deepEqual(f.current(),before);
});

test('JD paste does not invoke the resume Section 1 parser or create user facts',async()=>{
  const f=memoryService();const saved=await f.service.action({action:'paste',revision:1,kind:'jd',selected:true,text:'Example Analyst. Prepare client reports and perform reconciliations. This is a genuine source job description for the intake fixture.'});
  assert.equal(saved.state.documents[0].kind,'jd');assert.equal(saved.state.documents[0].section1Analysis,undefined);assert.deepEqual(saved.state.facts,[]);assert.equal(f.writes(),1);
});

test('a matching-version legacy receipt without required source bindings is repaired instead of cached',async()=>{
  const state=await oldCompleteState(),document=state.documents[0];
  document.section1Analysis={parserVersion:SECTION_ONE_PARSER_VERSION,sourceFingerprint:await digest(canonicalJSON({id:document.id,version:document.version,hash:document.hash||null,segments:document.segments})),status:'complete',addedFactIds:[]};
  const f=memoryService(state),saved=await f.service.action({action:'extractSection1',revision:1,id:document.id});
  assert.equal(saved.result.unchanged,false);assert.ok(saved.result.addedCount>0);assert.equal(f.writes(),1);
  const receipt=saved.state.documents[0].section1Analysis;assert.match(receipt.sourceHash,/^[a-f0-9]{64}$/);assert.equal(receipt.sourceVersion,document.version);assert.ok(Array.isArray(receipt.factIds));
  const again=await f.service.action({action:'extractSection1',revision:saved.revision,id:document.id});assert.equal(again.result.unchanged,true);assert.equal(f.writes(),1);
});

async function legacyToolState(){
  const state=emptyProfile(),lines=source.map(line=>line.startsWith('Technical tools')?'Technical tools (skills): Python, Excel, SQL, VBA':line);
  addDocument(state,{id:'resume',kind:'resume',title:'Legacy Section 1 source',hash:'legacy-source',segments:lines.map((text,index)=>({id:'resume.p'+index,text}))});
  const document=state.documents[0];document.analysis='complete';
  const [work]=await proposeFacts(state,[{category:'experience_claims',field:'duties',scope:'Example Services',statement:'Built scenario models.',evidence:[{documentId:document.id,segmentId:'resume.p6',quote:'Built scenario models.'}]}]);
  decideFacts(state,[{id:work.id,version:1,decision:'approved'}],'synthetic-owner');
  const current=extractSectionOneFacts(document),legacy=current.facts.map(fact=>({...fact,field:fact.category==='skills'&&fact.field==='programming_languages'?'tools_technologies':fact.field}));
  const pending=await proposeFacts(state,legacy,'resume');
  for(const fact of pending){fact.extractionStage='section1';fact.section1ParserVersion='section-one-source-v0';}
  document.section1Analysis={parserVersion:'section-one-source-v0',status:'complete',addedFactIds:pending.map(fact=>fact.id)};
  return {state,current,pending,tools:pending.filter(fact=>fact.category==='skills'&&['SQL','Python','VBA'].includes(fact.statement)),work};
}

test('parser migration supersedes only outdated pending Section 1 tool classifications and reuses all matching facts',async()=>{
  const {state,current,pending,tools,work}=await legacyToolState();assert.equal(tools.length,3);
  const before=structuredClone(state),unchanged=pending.filter(fact=>!tools.some(tool=>tool.id===fact.id)),f=memoryService(state);
  const saved=await f.service.action({action:'extractSection1',revision:1,id:'resume'});
  assert.equal(saved.result.addedCount,3);assert.equal(saved.result.retiredCount,3);assert.deepEqual([...saved.result.retiredFactIds].sort(),tools.map(fact=>fact.id).sort());
  assert.equal(saved.result.factIds.length,current.facts.length);assert.deepEqual(saved.state.approvals,before.approvals);assert.deepEqual(saved.state.facts.find(fact=>fact.id===work.id),before.facts.find(fact=>fact.id===work.id));
  for(const prior of unchanged)assert.deepEqual(saved.state.facts.find(fact=>fact.id===prior.id),prior);
  for(const prior of tools){const fact=saved.state.facts.find(item=>item.id===prior.id);assert.equal(fact.lifecycle,'superseded');assert.equal(fact.approval,'pending');assert.equal(fact.version,prior.version);assert.deepEqual(fact.evidence,prior.evidence);assert.equal(fact.supersededReason,'section1_parser_update');assert.equal(fact.supersededByParserVersion,SECTION_ONE_PARSER_VERSION);}
  const activeLanguages=saved.state.facts.filter(fact=>fact.lifecycle==='active'&&fact.category==='skills'&&fact.field==='programming_languages');assert.deepEqual(activeLanguages.map(fact=>fact.statement).sort(),['Python','SQL','VBA']);assert.ok(activeLanguages.every(fact=>fact.approval==='pending'&&!fact.approvalRef));
  const snapshot=f.current(),again=await f.service.action({action:'extractSection1',revision:saved.revision,id:'resume'});assert.equal(again.result.unchanged,true);assert.equal(again.result.addedCount,0);assert.equal(again.result.retiredCount,0);assert.equal(f.writes(),1);assert.deepEqual(f.current(),snapshot);
});

test('parser migrations never retire approved, rejected or withdrawn Section 1 records',async()=>{
  const {state,tools}=await legacyToolState();decideFacts(state,tools.map((fact,index)=>({id:fact.id,version:1,decision:['approved','rejected','withdrawn'][index]})),'synthetic-owner');
  const originals=structuredClone(tools),approvals=structuredClone(state.approvals),f=memoryService(state);
  const saved=await f.service.action({action:'extractSection1',revision:1,id:'resume'});
  assert.equal(saved.result.retiredCount,0);assert.equal(saved.result.addedCount,3);assert.deepEqual(saved.state.approvals,approvals);
  for(const prior of originals)assert.deepEqual(saved.state.facts.find(fact=>fact.id===prior.id),prior);
});
