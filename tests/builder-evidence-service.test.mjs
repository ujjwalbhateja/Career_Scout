import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile,addDocument,proposeFacts,decideFacts,addJDAnalysis} from '../lib/profile/domain.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
import {buildRoleQuestionnaires} from '../lib/profile/builder-expansion.mjs';
const target='Partner with cross-functional teams to develop portfolio performance materials for current and prospective investors';
const control='Must use Kubernetes to deploy production services';
async function exercise(t,repeatBadAssessment=false){
  const state=emptyProfile();
  const text='Professional Experience\nCoordinated cross-functional teams to deliver operational projects.\nBuilt portfolio performance dashboards and reporting materials.\nDelivered investor reporting and investment performance analysis.\nSkills\nSQL';
  addDocument(state,{id:'cv',kind:'resume',title:'Synthetic profile',hash:'cv',segments:[{id:'cv.1',text}]});
  await proposeFacts(state,[{category:'skills',field:'programming_languages',scope:'Skills',statement:'SQL',evidence:[{documentId:'cv',segmentId:'cv.1',quote:'SQL'}]}]);
  decideFacts(state,[{id:state.facts[0].id,version:1,decision:'approved'}],'test-owner');
  addDocument(state,{id:'jd',kind:'jd',title:'Synthetic role',hash:'jd',selected:true,segments:[{id:'jd.1',text:target+'\n'+control}]});
  await addJDAnalysis(state,'jd',{roleName:'Synthetic role',sector:'',requirements:[target,control].map(text=>({text,category:'task',importance:'required',evidence:[{documentId:'jd',segmentId:'jd.1',quote:text}]}))});
  const baseline=JSON.stringify({facts:state.facts,approvals:state.approvals});let saved={revision:1,state},calls=0;
  const service=new ProfileService({GEMINI_API_KEY:'fixture-only'},'test-owner');
  service.memory.load=async()=>structuredClone(saved);service.memory.save=async(revision,state)=>{assert.equal(revision,saved.revision);saved={revision:revision+1,state:structuredClone(state)};return structuredClone(saved);};service.memory.reserve=async()=>{};
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);calls++;
    if(calls===2){assert.equal(input.evidenceValidation.version,1);assert.ok(input.sourceCoverageCorrections.every(c=>!('previousAssessment' in c)));}
    const assessments=Object.fromEntries(input.requirements.map(r=>{
      const isTarget=r.text===target,part=(scope,sourceIds=[],weight=3,critical=false)=>({scope,sourceIds,weight,critical});
      let components=[part(r.text,[],3,!isTarget)];
      if(isTarget&&calls===2&&!repeatBadAssessment){
        const source=prefix=>input.sourceRecords.find(r=>r.statement.startsWith(prefix)).id;
        components=[part('Partner with cross-functional teams',[source('Coordinated')]),part('develop portfolio performance materials',[source('Built')]),part('current',[source('Delivered')],1),part('prospective',[],1)];
      }
      const reason=isTarget?'The user has experience building reporting materials; the prospective audience remains unestablished.':'No supplied source establishes Kubernetes deployment.';
      return [r.id,{factIds:[],evidenceStatus:'not_established',explanation:reason,atsArea:isTarget?'Portfolio Performance Reporting':'Kubernetes Deployment',profileCoverage:{relevance:'material',components,explanation:reason},...(calls===2?{evidenceReview:{consideredSourceIds:input.sourceRecords.map(r=>r.id),reason}}:{})}];
    }));
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({assessments})}]}}]});
  });
  const result=await service.action({action:'buildProfiles',mode:'expansion',revision:1});assert.equal(calls,2);
  assert.equal(JSON.stringify({facts:result.state.facts,approvals:result.state.approvals}),baseline);
  return {result,group:buildRoleQuestionnaires(result.state)[0]};
}
test('production flow independently reviews a false zero and only asks the genuinely missing capability',async t=>{
  const {result,group}=await exercise(t);
  assert.equal(group.skipped.length,1);assert.equal(group.skipped[0].percent,87);assert.deepEqual(group.skipped[0].unconfirmed,['prospective']);
  assert.deepEqual(group.experience.map(r=>r.proposedStatement),[control]);assert.equal(group.unresolved.length,0);
  assert.equal(result.state.runs.at(-1).evidenceReview.requirementsReviewed,2);
  assert.ok(result.state.builderReviews.at(-1).sourceComparisons.every(c=>c.evidenceReview.version===1));
});
test('still-contradictory review becomes unresolved instead of a repeated zero-score question',async t=>{
  const {group}=await exercise(t,true);assert.equal(group.unresolved.length,1);assert.equal(group.skipped.length,0);
  assert.deepEqual(group.experience.map(r=>r.proposedStatement),[control]);
});
