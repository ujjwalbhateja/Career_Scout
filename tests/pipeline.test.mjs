import test from 'node:test';
import assert from 'node:assert/strict';
import {runProvider} from '../lib/workflow/agent-providers.mjs';
import {generateAgentJSON,ProfileMemory} from '../lib/profile/providers.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
import {applicationRequest,pipelineCall} from '../lib/workflow/pipeline-client.mjs';
import {emptyProfile,addDocument,proposeFacts,decideFacts,buildProfiles,approveRole,finalize} from '../lib/profile/domain.mjs';

test('web request allows selected target jobs but rejects incomplete inputs',()=>{
  const input={profileSelection:{roleId:'r1',version:'profile-1'},job:{id:'j1',title:'Analyst',company:'Example',description:'Monthly reporting for clients and portfolio analysis. '.repeat(3),application_url:'https://example.com/jobs/1'}};
  assert.equal(applicationRequest(input).selected_job.id,'j1');
  assert.throws(()=>applicationRequest({...input,job:{...input.job,application_url:'http://localhost/'}}),/HTTPS/);
  assert.throws(()=>applicationRequest({...input,job:{...input.job,description:'short'}}),/readable/);
  assert.throws(()=>applicationRequest({profileSelection:{roleId:'r1',version:'old'}}),/Load the current stored profile/);
});
test('service token stays in server headers and only loopback is allowed',async()=>{
  let request;
  await pipelineCall({CAREER_AGENT_URL:'http://127.0.0.1:8765',CAREER_AGENT_TOKEN:'private'},'list',{owner:'owner'},async(url,options)=>{request={url,options};return Response.json({runs:[]});});
  assert.equal(request.options.headers.Authorization,'Bearer private');
  assert.equal(JSON.parse(request.options.body).owner,'owner');
  await assert.rejects(()=>pipelineCall({CAREER_AGENT_URL:'http://example.com',CAREER_AGENT_TOKEN:'private'},'list'),/invalid/);
  await assert.rejects(()=>pipelineCall({},'list'),/Start-Scout/);
  await assert.rejects(()=>pipelineCall({CAREER_AGENT_URL:'http://127.0.0.1:8765',CAREER_AGENT_TOKEN:'private'},'list',{},async()=>new Response(null,{status:302,headers:{Location:'http://example.com/'}})),/redirects/);
});
test('deleting a never-indexed profile does not require an unused vector index',async()=>{
  const memory=new ProfileMemory({PINECONE_INDEX_HOST:'https://unused.pinecone.io'},'synthetic');
  memory.pinecone=async()=>{assert.fail('A never-indexed profile must not call Pinecone.');};
  memory.removeFiles=async()=>{};let purged=false;
  memory.rpc=async name=>{assert.equal(name,'purge');purged=true;};
  await memory.purge(emptyProfile(),1);assert.ok(purged);
});
test('Critic checks are independent and omit owner identifiers from model input',async()=>{
  const inputs=[];
  const payload={profile:{version:'profile-1',facts:[{id:'f1',text:'Prepared reports'}]},job:{id:'j1',description:'Prepare reports'},draft:{content:'Prepared reports'},draft_hash:'abc'};
  const result=await runProvider({name:'review_draft',prompt:'EDITABLE INSTRUCTIONS',payload,owner:'private-owner'}, {},{generate:async(_env,call)=>{inputs.push(call);return {passed:true,issues:[]};}});
  assert.equal(inputs.length,2);assert.equal(result.draft_hash,'abc');assert.equal(result.job_id,'j1');
  assert.ok(inputs.every(input=>input.instructions.includes('EDITABLE INSTRUCTIONS')));
  assert.ok(!JSON.stringify(inputs).includes('private-owner'));
  assert.equal(inputs[0].input.job,undefined);
});
test('Scout keeps source terms in bounded routes and never sends a full profile',async()=>{
  let body;
  const result=await runProvider({name:'search_jobs',owner:'scope',payload:{role_name:'',scout_context:{profileId:'master-profile',basis:'validated_source_data',roleName:'',titles:[],functions:[],responsibilities:[{term:'reporting',factIds:['f1']}],skills:[],industries:[],qualifications:[],approvedFactIds:['f1']},keywords:[],preferences:{location:'Boston',arrangement:'onsite',on_work_visa:true}},prompt:''},{KEENABLE_API_KEY:'private'},{search:async input=>{body=input;return {jobs:[{id:'j1',title:'Analyst',company:'Example',url:'https://example.com/job',description:'Responsibilities include reporting and client support. Apply to this actual synthetic employer vacancy. '.repeat(2),verification:{status:'available'}},{id:'j2',verification:{status:'unverified'}}]};}});
  assert.equal(body.relatedKeywords,'');assert.equal(body.arrangement,'on-site');assert.equal(body.requiredKeywords,undefined);
  assert.equal(body.profile,undefined);assert.equal(body.onWorkVisa,true);assert.equal(result.jobs.length,1);
});
test('Gemini transport uses constrained JSON and rejects truncated or blocked output',async()=>{
  let sent;
  const config={instructions:'System instructions',input:{text:'Untrusted document'},schema:{type:'OBJECT',properties:{content:{type:'STRING'}},required:['content']}};
  const result=await generateAgentJSON({GEMINI_API_KEY:'private'},config,async(_url,options)=>{sent=JSON.parse(options.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"content":"Grounded resume"}'}]}}]});});
  assert.equal(result.content,'Grounded resume');assert.equal(sent.generationConfig.responseMimeType,'application/json');
  assert.ok(!JSON.stringify(sent).includes('private'));
  await assert.rejects(()=>generateAgentJSON({GEMINI_API_KEY:'private'},config,async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[]}}]})),/complete agent result/);
  await assert.rejects(()=>generateAgentJSON({GEMINI_API_KEY:'private'},config,async()=>Response.json({error:{status:'RESOURCE_EXHAUSTED'}},{status:429})),/quota|limit|exhaust/i);
});
test('Profile converts only current approved evidence with matching owner approval history',async()=>{
  const state=emptyProfile(),owner='synthetic-owner';
  addDocument(state,{id:'resume',kind:'resume',title:'Synthetic',hash:'h',segments:[{id:'resume.p1',text:'Prepared monthly reports for clients.'}]});
  await proposeFacts(state,[{category:'experience_claims',field:'reporting',scope:'Example Employer',statement:'Prepared monthly reports for clients.',evidence:[{documentId:'resume',segmentId:'resume.p1',quote:'Prepared monthly reports for clients.'}]}]);
  decideFacts(state,state.facts.map(f=>({id:f.id,version:f.version,decision:'approved'})),owner);
  await buildProfiles(state,{profiles:[{roleName:'Analyst',summary:'Supported',keywords:['reporting'],factIds:[state.facts[0].id]}]},'resume');
  approveRole(state,state.roleProfiles[0].id,owner);state.documents[0].analysis='complete';new ProfileService({},owner).finalProfileResult(state);
  const service={owner,memory:{load:async()=>({state})}};
  const result=await runProvider({name:'load_profile',owner,payload:{version:'profile-1'},prompt:''},{},{service});
  assert.equal(result.facts[0].confirmation,'user_confirmed');assert.equal(result.roles.length,0);assert.ok(result.search_profile.responsibilities.some(t=>t.term.includes('reports')));assert.ok(!JSON.stringify(result.search_profile).includes('Analyst'));
  state.approvals[0].actor='someone-else';
  await assert.rejects(()=>runProvider({name:'load_profile',owner,payload:{version:'profile-1'},prompt:''},{},{service}),/approval changed/);
});
