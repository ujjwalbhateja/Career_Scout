import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ProfileService} from '../lib/profile/service.mjs';
import {analyzeWithModel} from '../lib/profile/providers.mjs';
import {completeBuilderCoverage} from '../lib/profile/builder-coverage.mjs';
import {emptyProfile,addDocument,proposeFacts,decideFacts,addJDAnalysis,buildProfiles,approveRole,addAnswer} from '../lib/profile/domain.mjs';

const prompt=readFileSync(new URL('../backend/src/career_scout/agents/profile_builder/prompt.md',import.meta.url),'utf8');
async function fixture({analyzed=true}={}){
  const state=emptyProfile();
  addDocument(state,{id:'resume',kind:'resume',title:'Synthetic resume',hash:'resume',segments:[{id:'resume.p1',text:'Prepared monthly client reports at Example Employer.'}]});
  await proposeFacts(state,[{category:'experience_claims',field:'reporting',scope:'Example Employer',statement:'Prepared monthly client reports.',evidence:[{documentId:'resume',segmentId:'resume.p1',quote:'Prepared monthly client reports'}]}]);
  decideFacts(state,state.facts.map(f=>({id:f.id,version:f.version,decision:'approved'})),'synthetic');
  for(const [id,text] of [['jd1','Prepare monthly client reports. SQL is required.'],['jd2','SQL is required. Lead a reporting team.']]){
    addDocument(state,{id,kind:'jd',title:'Synthetic '+id,selected:true,hash:id,segments:[{id:id+'.p1',text}]});
    if(analyzed)await addJDAnalysis(state,id,analysis(id,text));
  }
  return state;
}
function analysis(id,text){
  return {roleName:'Reporting Analyst',requirements:[
    ...(id==='jd1'?[{category:'task',text:'Prepare monthly client reports',importance:'required',evidence:[{documentId:id,segmentId:id+'.p1',quote:'Prepare monthly client reports'}]}]:[]),
    {category:'skill',text:'SQL',importance:'required',evidence:[{documentId:id,segmentId:id+'.p1',quote:'SQL is required'}]},
    ...(id==='jd2'?[{category:'task',text:'Lead a reporting team',importance:'preferred',evidence:[{documentId:id,segmentId:id+'.p1',quote:'Lead a reporting team'}]}]:[])
  ]};
}
function result(state,{supported=true,sqlSupported=false}={}){
  return {profiles:[{roleName:'Reporting Analyst',summary:'Role direction with explicit gaps',keywords:['reporting'],mappings:state.requirements.map(r=>({requirementId:r.id,factIds:supported&&(r.text==='Prepare monthly client reports'||sqlSupported&&r.text==='SQL')?[state.facts[0].id]:[],explanation:'Evidence or a gap'}))}],questions:[]};
}
function service(state){
  const svc=new ProfileService({GEMINI_API_KEY:'fixture-only'},'synthetic',{builderPrompt:prompt});let record={revision:1,state:structuredClone(state)};
  svc.memory.load=async()=>structuredClone(record);
  svc.memory.save=async(revision,state)=>{assert.equal(revision,record.revision);record={revision:revision+1,state:structuredClone(state)};return structuredClone(record);};
  svc.memory.reserve=async()=>{};return svc;
}
test('multiple JD gaps always create grouped questions even when the model returns none',async()=>{
  const state=await fixture();await buildProfiles(state,result(state),'guided');
  assert.equal(state.questions.length,2);
  const sql=state.questions.find(q=>q.capability==='SQL');
  assert.equal(sql.requirementIds.length,2);assert.equal(sql.jdCount,2);assert.equal(sql.priority,'required');
  assert.equal(state.builderReviews[0].requirements,4);assert.equal(state.builderReviews[0].missing,3);
  assert.equal(state.builderReviews[0].questionIds.length,2);assert.equal(state.roleProfiles[0].status,'proposed');
  assert.equal(state.facts.length,1);assert.equal(state.approvals.length,1);
});
test('unsupported roles still produce the interview but cannot be approved',async()=>{
  const state=await fixture();await buildProfiles(state,result(state,{supported:false}),'guided');
  assert.equal(state.roleProfiles[0].classification,'not_currently_supported');
  assert.ok(state.questions.length>=2);assert.throws(()=>approveRole(state,state.roleProfiles[0].id,'synthetic'),/Supporting facts/);
});
test('No records a gap without creating positive facts, documents or another question',async()=>{
  const state=await fixture();await buildProfiles(state,result(state),'guided');
  const q=state.questions.find(q=>q.capability==='SQL'),documents=state.documents.length;
  await addAnswer(state,{questionId:q.id,decision:'not_experienced',capabilityDecision:'no'});
  assert.equal(state.facts.length,1);assert.equal(state.documents.length,documents);assert.equal(q.status,'not_experienced');
  await buildProfiles(state,result(state),'guided');assert.equal(state.questions.filter(q=>q.capability==='SQL').length,1);
  assert.equal(state.roleProfiles.at(-1).classification,'development_opportunity');
});
test('Yes confirmation is saved pending details, then the source example remains separate from approvals',async()=>{
  const state=await fixture();await buildProfiles(state,result(state),'guided');const q=state.questions[0];
  await addAnswer(state,{questionId:q.id,decision:'answered',capabilityDecision:'yes',text:'yes'});
  assert.equal(q.status,'needs_details');assert.equal(state.facts.length,1);assert.equal(state.documents.length,3);
  await addAnswer(state,{questionId:q.id,decision:'answered',capabilityDecision:'yes',text:'At Example Employer in 2022, I wrote SQL queries to validate monthly reporting data.'});
  assert.equal(state.facts.length,1);assert.equal(state.approvals.length,1);assert.equal(state.documents.at(-1).kind,'answer');
});
test('questions supported by approved evidence disappear from the current interview',async()=>{
  const state=await fixture();await buildProfiles(state,result(state),'guided');const sql=state.questions.find(q=>q.capability==='SQL');
  await buildProfiles(state,result(state,{sqlSupported:true}),'guided');
  assert.equal(sql.coveredByApprovedFacts,true);assert.ok(!state.builderReviews.at(-1).questionIds.includes(sql.id));
});
test('Builder action analyzes every pending JD and uses the editable prompt at every stage',async t=>{
  const state=await fixture({analyzed:false}),svc=service(state),requests=[];
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const body=JSON.parse(options.body),input=JSON.parse(body.contents[0].parts[0].text),instructions=body.systemInstruction.parts[0].text;
    assert.ok(instructions.includes(prompt));assert.ok(instructions.includes('CURRENT RUNTIME STAGE:'));
    requests.push(input.documentId||'builder');let output;
    if(input.documentId)output=analysis(input.documentId,input.segments[0].text);
    else{assert.equal(input.selectedJDs.length,2);assert.equal(input.requirements.length,4);assert.ok(input.requirements.every(r=>r.documentId));const current=await svc.memory.load();output={assessments:Object.fromEntries(input.requirements.map(r=>[r.id,{factIds:r.text==='Prepare monthly client reports'?[current.state.facts[0].id]:[],explanation:r.text==='Prepare monthly client reports'?'Approved client reporting evidence.':'No approved evidence establishes this requirement.'}]))};}
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]});
  });
  const saved=await svc.action({action:'buildProfiles',revision:1,mode:'guided'});
  assert.deepEqual(requests,['jd1','jd2','builder']);assert.equal(saved.state.questions.length,2);
  assert.equal(saved.state.roleProfiles.length,0);assert.equal(saved.state.builderReviews[0].mappings.length,4);assert.deepEqual(saved.state.builderReviews[0].profileIds,[]);
  assert.equal(saved.state.builderReviews[0].prompt.source,'agents/profile_builder/prompt.md');
  assert.ok(saved.state.runs.every(r=>r.prompt?.hash));assert.equal(saved.state.runs.at(-1).status,'complete');
});
test('model prompt is provided separately from untrusted JD text and retains the stage schema',async t=>{
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const body=JSON.parse(options.body);assert.ok(body.systemInstruction.parts[0].text.includes(prompt));
    assert.ok(body.generationConfig.responseSchema.properties.requirements);assert.equal(body.systemInstruction.parts[0].text.includes('UNTRUSTED-JD-MARKER'),false);
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"roleName":"Analyst","sector":"","requirements":[]}'}]}}]});
  });
  await analyzeWithModel({GEMINI_API_KEY:'fixture-only'},'jd',{text:'UNTRUSTED-JD-MARKER'},{agentPrompt:prompt});
});
test('omitted requirements become explicitly unassessed gaps, never invented support',async()=>{
  const state=await fixture(),requirements=state.requirements,output=result(state);
  output.profiles[0].mappings=output.profiles[0].mappings.slice(0,1);
  const covered=completeBuilderCoverage(output,{requirements,selectedJDs:state.documents.filter(d=>d.kind==='jd').map(d=>({id:d.id,roleName:d.roleName}))});
  assert.equal(covered.unassessedRequirementIds.length,3);
  assert.ok(covered.output.profiles[0].mappings.slice(1).every(m=>!m.factIds.length));
  await buildProfiles(state,covered.output,'guided');assert.equal(state.builderReviews[0].requirements,4);assert.equal(state.questions.length,2);
});
test('the live service assesses every requirement directly against approved facts without generating roles',async t=>{
  const state=await fixture(),svc=service(state),stages=[];
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const body=JSON.parse(options.body),input=JSON.parse(body.contents[0].parts[0].text);let output;
    const schema=body.generationConfig.responseSchema.properties;
    if(schema.assessments){
      stages.push('gap_assessment');assert.equal(schema.assessments.required.length,4);
      assert.equal(input.requirements.length,4);assert.equal(input.approvedFacts.length,1);
      output={assessments:Object.fromEntries(input.requirements.map(r=>[r.id,{factIds:r.text==='Prepare monthly client reports'?[state.facts[0].id]:[],explanation:'Source-backed reporting evidence or an explicitly unsupported skill/leadership requirement.'}]))};
    }else assert.fail('The current comparison must not request generated role profiles.');
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]});
  });
  const saved=await svc.action({action:'buildProfiles',revision:1,mode:'guided'});
  assert.deepEqual(stages,['gap_assessment']);assert.equal(saved.state.builderReviews.at(-1).mappings.length,4);
  assert.equal(saved.state.questions.length,2);assert.equal(saved.state.facts.length,1);assert.equal(saved.state.roleProfiles.length,0);
});
