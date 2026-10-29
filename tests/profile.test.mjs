import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate/browser';
import {emptyProfile,addDocument,proposeFacts,decideFacts,correctFact,resolveConflict,addAnswer,addJDAnalysis,buildProfiles,approveRole,finalize,savedPacket,chunks,hybridResults,removeDocument} from '../lib/profile/domain.mjs';
import {extractDocument} from '../lib/profile/extraction.mjs';
import {ProfileMemory,embedTexts,providerStatus} from '../lib/profile/providers.mjs';
import {createProfileGraph,createCareerWorkflow} from '../lib/workflow/graph.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
const source='At Example Employer, supported 50 institutional clients. Python is listed as a skill.';
function fixture(){
  const s=emptyProfile();addDocument(s,{id:'resume',kind:'resume',title:'Synthetic resume',hash:'resume-hash',segments:[{id:'resume.p1',text:source,locator:'paragraph 1'}]});return s;
}
function proposal(statement='Supported 50 institutional clients',overrides={}){return {category:'client_relationships',field:'client_count',scope:'Example Employer, Portfolio Analyst',statement,evidence:[{documentId:'resume',segmentId:'resume.p1',quote:'supported 50 institutional clients'}],...overrides};}
async function approvedState(){const s=fixture();await proposeFacts(s,[proposal()]);decideFacts(s,[{id:s.facts[0].id,version:1,decision:'approved'}],'test-user');return s;}
async function withJDs(s){
  for(let i=0;i<10;i++){
    const doc={id:'jd'+i,kind:'jd',title:'Role '+i,hash:'jd-hash'+i,selected:true,segments:[{id:'jd'+i+'.p1',text:'Institutional client experience required for vacancy '+i+'.',locator:'paragraph 1'}]};addDocument(s,doc);
    await addJDAnalysis(s,doc.id,{roleName:'Portfolio Analyst',requirements:[{category:'task',text:'Institutional client experience',importance:'required',evidence:[{documentId:doc.id,segmentId:doc.segments[0].id,quote:'Institutional client experience required'}]}]});
  }
  return s;
}
async function finalized(){
  const s=await withJDs(await approvedState());
  await buildProfiles(s,{profiles:[{roleName:'Portfolio Analyst',summary:'Supported experience',keywords:['portfolio'],mappings:s.requirements.map(r=>({requirementId:r.id,factIds:[s.facts[0].id],explanation:'Client support evidence'}))}],questions:[]});
  approveRole(s,s.roleProfiles[0].id,'test-user');finalize(s,'test-user');return s;
}
test('facts remain unapproved until explicit user decisions, without independent verification claims',async()=>{
  const s=fixture();await proposeFacts(s,[proposal()]);assert.equal(s.facts[0].approval,'pending');assert.equal(s.facts[0].confirmation,'resume_stated');assert.equal(chunks(s).length,0);
  decideFacts(s,[{id:s.facts[0].id,version:1,decision:'approved'}],'actor');assert.equal(s.facts[0].confirmation,'user_confirmed');assert.equal(s.facts[0].verified,undefined);assert.equal(s.approvals[0].actor,'actor');
});
test('an unchanged assertion reuses its exact approval on reanalysis',async()=>{
  const s=await approvedState(),ref=s.facts[0].approvalRef;
  await proposeFacts(s,[proposal()]);assert.equal(s.facts.length,1);assert.equal(s.facts[0].approvalRef,ref);assert.equal(s.approvals.length,1);
});
test('source quotes must exist, and JDs cannot supply user facts',async()=>{
  const s=fixture();await assert.rejects(proposeFacts(s,[proposal('Invented',{evidence:[{documentId:'resume',segmentId:'resume.p1',quote:'built Python pipelines'}]})]),/source passage/);
  addDocument(s,{id:'jd',kind:'jd',title:'Job',hash:'job',segments:[{id:'jd.p1',text:source}]});
  await assert.rejects(proposeFacts(s,[proposal('Supported clients',{evidence:[{documentId:'jd',segmentId:'jd.p1',quote:'supported 50 institutional clients'}]})]),/cannot establish/);
});
test('contact records are retained but never embedded',async()=>{
  const s=fixture();s.documents[0].segments.push({id:'resume.p2',text:'Email person@example.test'});
  await proposeFacts(s,[{category:'personal',field:'email',scope:'personal',statement:'Email person@example.test',evidence:[{documentId:'resume',segmentId:'resume.p2',quote:'person@example.test'}]}]);decideFacts(s,[{id:s.facts[0].id,version:1,decision:'approved'}],'actor');
  assert.equal(chunks(s).length,0);assert.ok(s.facts[0].statement.includes('person@example.test'));
});
test('corrections preserve old evidence and require approval of only the new version',async()=>{
  const s=await approvedState(),oldId=s.facts[0].id;
  await correctFact(s,{id:oldId,version:1,statement:'Supported 55 institutional clients'});
  assert.equal(s.facts[0].lifecycle,'superseded');assert.equal(s.facts[0].evidence[0].quote,'supported 50 institutional clients');
  assert.equal(s.facts[1].id,oldId);assert.equal(s.facts[1].version,2);assert.equal(s.facts[1].approval,'pending');assert.equal(chunks(s).length,0);
  assert.throws(()=>decideFacts(s,[{id:oldId,version:1,decision:'approved'}],'actor'),/changed/);
});
test('same field in different roles does not create a false date conflict',async()=>{
  const s=fixture();await proposeFacts(s,[proposal('50 clients',{scope:'Employer A / Analyst'}),proposal('50 clients',{scope:'Employer B / Manager'})]);assert.ok(s.facts.every(f=>!f.conflict));
});
test('conflicting values cannot be approved until the user resolves them',async()=>{
  const s=await approvedState();await proposeFacts(s,[proposal('Supported 60 clients')]);assert.ok(s.facts.every(f=>f.conflict));
  assert.throws(()=>decideFacts(s,[{id:s.facts[1].id,version:1,decision:'approved'}],'actor'),/conflicting/);
  resolveConflict(s,s.facts[0].id);assert.equal(s.facts[1].lifecycle,'superseded');assert.equal(s.facts[0].approval,'approved');
});
test('role proposals cannot use unapproved experience or manufacture facts from JDs',async()=>{
  const s=await withJDs(fixture()),before=s.facts.length;
  await assert.rejects(buildProfiles(s,{profiles:[{roleName:'Python Engineer',mappings:s.requirements.map(r=>({requirementId:r.id,factIds:['fictional-python-project']}))}]}),/not approved/);assert.equal(s.facts.length,before);
});
test('approved snapshots can be reused across jobs without adding approvals',async()=>{
  const s=await finalized(),count=s.approvals.length;
  const first=savedPacket(s),second=savedPacket(s);
  assert.equal(first.facts.version,second.facts.version);assert.equal(s.approvals.length,count);assert.equal(first.facts.approvalStatus,'approved');assert.equal(first.facts.verified,undefined);
});
test('withdrawal invalidates dependent snapshots and removes stale search hits',async()=>{
  const s=await finalized(),chunk=chunks(s)[0];decideFacts(s,[{id:s.facts[0].id,version:1,decision:'withdrawn'}],'actor');
  assert.throws(()=>savedPacket(s),/current approved/);assert.equal(hybridResults(s,'institutional',[{id:chunk.id}]).length,0);
});
test('document withdrawal removes its claims from retrieval immediately',async()=>{
  const s=await finalized();removeDocument(s,'resume');assert.equal(chunks(s).filter(c=>c.record_type==='approved_fact').length,0);assert.throws(()=>savedPacket(s),/current approved/);
});
test('declined questions cannot reopen implicitly and do not become new fact assertions',async()=>{
  const s=fixture();s.questions.push({id:'q',key:'python-project',scope:'technical projects',question:'What did you build?',status:'unresolved'});
  await addAnswer(s,{questionId:'q',decision:'declined'});assert.equal(s.facts.length,0);
  await assert.rejects(addAnswer(s,{questionId:'q',decision:'answered',text:'Built a tool'}),/Explicitly reopen/);assert.equal(s.questions[0].status,'declined');
  await addAnswer(s,{questionId:'q',decision:'answered',text:'Built a tool',reopen:true});assert.equal(s.questions[0].status,'answered');
});
test('semantic results are rehydrated against current owned records, not accepted by score',async()=>{
  const s=await approvedState(),chunk=chunks(s)[0],results=hybridResults(s,'relationship service',[{id:'other-user-fact',score:1},{id:chunk.id,score:.4}]);
  assert.equal(results.length,1);assert.equal(results[0].record_id,s.facts[0].id);assert.match(results[0].meaning,/not a qualification/);
});
test('real Profile LangGraph loads a saved profile without onboarding or Fact/Builder calls',async()=>{
  const s=await finalized(),packet=savedPacket(s);let reads=0;
  const result=await createProfileGraph({loadApprovedProfile:async()=>{reads++;return packet;}}).invoke({request:{savedProfileVersion:'current'}});
  assert.equal(result.outcome,'approved');assert.equal(reads,1);assert.deepEqual(result.audit.map(e=>e.from+'>'+e.to),['profile>memory','memory>profile']);
});
test('whole workflow reuses the approved profile and does not require ten new JDs',async()=>{
  const packet=savedPacket(await finalized());let scouts=0;
  const handlers={loadApprovedProfile:async()=>packet,scout:async()=>{scouts++;return [];},matcher:async()=>{},tailor:async()=>{},critic:async()=>{},savePackage:async()=>{}};
  const result=await createCareerWorkflow(handlers).invoke({request:{profileInput:{savedProfileVersion:'current'}}});assert.equal(result.outcome,'no_jobs');assert.equal(scouts,1);
});
test('DOCX paragraphs and table text retain source locators; tracked changes are refused',async()=>{
  const make=content=>zipSync({'[Content_Types].xml':strToU8('<Types/>'),'word/document.xml':strToU8(content)});
  const xml='<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Example Employer, Portfolio Analyst</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Supported institutional clients and prepared reports.</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const parsed=await extractDocument(make(xml),{name:'resume.docx',documentId:'d'});assert.equal(parsed.segments.length,2);assert.match(parsed.segments[1].locator,/paragraph 2/);
  await assert.rejects(extractDocument(make(xml.replace('<w:body>','<w:body><w:del/>')),{name:'resume.docx'}),/tracked changes/);
});
test('unsafe DOCX expansion, traversal, unsupported files and excessive text fail closed',async()=>{
  const bomb=zipSync({'[Content_Types].xml':strToU8('<Types/>'),'word/document.xml':strToU8('x'.repeat(2_000_001))});
  await assert.rejects(extractDocument(bomb,{name:'resume.docx'}),/too large/);
  const traversal=zipSync({'../bad.xml':strToU8('x'),'[Content_Types].xml':strToU8('<Types/>'),'word/document.xml':strToU8('<w:p/>')});
  await assert.rejects(extractDocument(traversal,{name:'resume.docx'}),/unsafe/);
  await assert.rejects(extractDocument(strToU8(source),{name:'resume.exe'}),/DOCX/);
  await assert.rejects(extractDocument(strToU8('x'.repeat(60001)),{name:'resume.txt'}),/text exceeds/);
});
test('retrieval degrades to database evidence when semantic provider fails',async()=>{
  const s=await approvedState(),memory=new ProfileMemory({},'user-A');
  const result=await memory.retrieve(s,'institutional');assert.equal(result.mode,'database');assert.equal(result.results.length,1);
});
test('embedding configuration requires model credentials as well as Pinecone credentials',()=>{
  assert.equal(providerStatus({PINECONE_API_KEY:'not-real',PINECONE_INDEX_HOST:'https://index.pinecone.io'}).pinecone,false);
});
test('embedding adapter pins the requested model and rejects wrong dimensions',async t=>{
  const requests=[];t.mock.method(globalThis,'fetch',async(url,options)=>{requests.push(JSON.parse(options.body));return Response.json({data:[{index:0,embedding:Array(3072).fill(.1)}]});});
  assert.equal((await embedTexts({OPENAI_API_KEY:'fixture-key'},['portfolio reports']))[0].length,3072);assert.equal(requests[0].model,'text-embedding-3-large');
  assert.equal(requests[0].dimensions,3072);
});
test('service keeps optimistic revisions and rejects client attempts to reuse stale approvals',async()=>{
  const s=await approvedState(),service=new ProfileService({},'owner');service.memory.load=async()=>({revision:8,state:structuredClone(s)});
  await assert.rejects(service.action({action:'decideFacts',revision:7,decisions:[]}),/changed/);
});
test('Builder rejects missing and duplicate requirements before creating role records',async()=>{
  const s=await withJDs(await approvedState());
  await assert.rejects(buildProfiles(s,{profiles:[{roleName:'Analyst',mappings:[{requirementId:s.requirements[0].id,factIds:[s.facts[0].id]}]}]}),/omitted/);
  assert.equal(s.roleProfiles.length,0);
  const mappings=s.requirements.map(r=>({requirementId:r.id,factIds:[s.facts[0].id]}));
  await assert.rejects(buildProfiles(s,{profiles:[{roleName:'Analyst',mappings:[...mappings,mappings[0]]}]}),/duplicated/);
});
test('unchanged facts retain approval when an independent evidence source remains',async()=>{
  const s=await approvedState(),approval=s.facts[0].approvalRef;
  addDocument(s,{id:'resume2',kind:'resume',title:'Second source',hash:'second',segments:[{id:'resume2.p1',text:source+' Updated document context.'}]});
  await proposeFacts(s,[proposal(undefined,{evidence:[{documentId:'resume2',segmentId:'resume2.p1',quote:'supported 50 institutional clients'}]})]);
  removeDocument(s,'resume');assert.equal(s.facts[0].lifecycle,'active');assert.equal(s.facts[0].approvalRef,approval);assert.equal(s.facts[0].evidence.length,1);
});
test('changed onboarding selection cannot finalize old profiles as if new JDs were assessed',async()=>{
  const s=await finalized(),version=savedPacket(s).facts.version;s.documents.find(d=>d.id==='jd0').selected=false;
  addDocument(s,{id:'replacement',kind:'jd',title:'Unanalyzed replacement',hash:'replacement',selected:true,segments:[{id:'replacement.p1',text:'New requirements not yet analyzed.'}]});
  assert.equal(savedPacket(s).facts.version,version); // Existing approved scope stays immutable.
  assert.throws(()=>finalize(s,'actor'),/Approve at least one/);
});
test('declined implementation topics are not reopened by common paraphrases',async()=>{
  const s=await withJDs(await approvedState());
  s.questions.push({id:'q',key:'old',capability:'Python project details',scope:'technical projects',status:'declined'});
  const result={profiles:[{roleName:'Analyst',mappings:s.requirements.map((r,i)=>({requirementId:r.id,factIds:i===0?[]:[s.facts[0].id]}))}],questions:[{requirementId:s.requirements[0].id,capability:'Python automation projects',scope:'another job',question:'Which Python automation projects did you build?'}]};
  await buildProfiles(s,result);assert.equal(s.questions.length,1);
});
test('deletion waits for pending index writers and cannot lose a first-sync intent',async()=>{
  const s=await approvedState(),service=new ProfileService({},'owner');
  s.runs.push({id:'sync-1',status:'running'});s.memoryIntent={runId:'sync-1',expiresAt:new Date(Date.now()+60000).toISOString()};
  service.memory.load=async()=>({revision:2,state:structuredClone(s)});
  await assert.rejects(service.action({action:'deleteProfile',revision:2,confirmation:'DELETE MY PROFILE'}),/safety window/);
});
test('keyword retrieval uses whole tool tokens rather than substring matches',async()=>{
  const s=await approvedState();assert.equal(hybridResults(s,'stitution').length,0);
});
test('text-based PDF extraction keeps page evidence without OCR claims',async()=>{
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const content='BT /F1 12 Tf 50 700 Td (Synthetic resume: supported institutional clients and prepared performance reports.) Tj ET';
  objects.push('<< /Length '+content.length+' >>\nstream\n'+content+'\nendstream');
  let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';}
  const xref=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  const parsed=await extractDocument(new TextEncoder().encode(pdf),{name:'synthetic.pdf',documentId:'pdf'});
  assert.match(parsed.segments[0].text,/institutional clients/);assert.match(parsed.segments[0].locator,/page 1/);
});
test('identical JD text cannot count twice merely because file metadata changed',()=>{
  const s=fixture();addDocument(s,{id:'a',kind:'jd',title:'First',hash:'bytes-a',segments:[{id:'a.p1',text:'Required institutional client experience.'}]});
  assert.throws(()=>addDocument(s,{id:'b',kind:'jd',title:'Second',hash:'bytes-b',segments:[{id:'b.p1',text:'Required  institutional client experience.'}]}),/already saved/);
});
test('activating an unchanged snapshot does not create another approval',async()=>{
  const s=await finalized(),count=s.approvals.length,version=s.snapshots.at(-1).version;
  assert.equal(finalize(s,'actor').version,version);assert.equal(s.approvals.length,count);assert.equal(s.snapshots.length,1);
});
