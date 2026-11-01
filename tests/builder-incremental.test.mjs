import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile,addDocument,proposeFacts,decideFacts,addJDAnalysis,buildProfiles} from '../lib/profile/domain.mjs';
import {buildRoleQuestionnaires,applyBuilderReview,builderQuestionnaireScope} from '../lib/profile/builder-expansion.mjs';
import {ProfileService} from '../lib/profile/service.mjs';

async function fixture(){
  const s=emptyProfile();addDocument(s,{id:'cv',kind:'resume',title:'Synthetic resume',hash:'cv',segments:[{id:'cv.1',text:'SQL'}]});
  await proposeFacts(s,[{category:'skills',field:'programming_languages',scope:'Skills',statement:'SQL',evidence:[{documentId:'cv',segmentId:'cv.1',quote:'SQL'}]}]);decideFacts(s,[{id:s.facts[0].id,version:1,decision:'approved'}],'test-owner');
  async function jd(id,statements){addDocument(s,{id,kind:'jd',title:id,hash:id,selected:true,segments:[{id:id+'.1',text:statements.join('\n')}]});await addJDAnalysis(s,id,{roleName:id,requirements:statements.map(text=>({text,category:'task',importance:'required',evidence:[{documentId:id,segmentId:id+'.1',quote:text}]}))});}
  await jd('old',['Prepared portfolio reports','Conducted operational audits']);
  await buildProfiles(s,{profiles:[],mappings:s.requirements.map(r=>({requirementId:r.id,factIds:[],evidenceStatus:'not_established',explanation:'Not recorded.'})),questions:[]},'analysis');
  const rows=buildRoleQuestionnaires(s)[0].experience;assert.equal(rows.length,2);
  await applyBuilderReview(s,{revision:1,submissionId:'old-decisions',rows:rows.map((r,i)=>({rowId:r.id,fingerprint:r.fingerprint,decision:i?'reject':'approve'}))},'test-owner',{revision:1});
  await jd('new',['Operated Kubernetes clusters']);
  return s;
}
test('new-only analysis preserves earlier reviews, selections, facts and decisions and sends only new requirements',async t=>{
  const s=await fixture(),oldReview=JSON.stringify(s.builderReviews),decisions=JSON.stringify(s.builderExpansion),facts=JSON.stringify(s.facts),approvals=JSON.stringify(s.approvals);
  assert.deepEqual(builderQuestionnaireScope(s),{newDocumentIds:['new'],activeDocumentIds:['new']});
  const service=new ProfileService({GEMINI_API_KEY:'fixture-only'},'test-owner');let saved={revision:1,state:s},calls=0;
  service.memory.load=async()=>structuredClone(saved);service.memory.save=async(revision,state)=>{assert.equal(revision,saved.revision);saved={revision:revision+1,state:structuredClone(state)};return structuredClone(saved);};service.memory.reserve=async()=>{};
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);calls++;
    assert.deepEqual(input.selectedJDs.map(d=>d.id),['new']);assert.ok(input.requirements.every(r=>r.documentId==='new'));assert.ok(input.builderDecisions.some(d=>d.status==='approved'));assert.ok(input.builderDecisions.some(d=>d.status==='rejected'));
    const assessments=Object.fromEntries(input.requirements.map(r=>[r.id,{factIds:[],evidenceStatus:'not_established',explanation:'No Kubernetes evidence.',atsArea:'Kubernetes Operations',profileCoverage:{relevance:'material',components:[{scope:r.text,weight:3,sourceIds:[],critical:true}],explanation:'No Kubernetes evidence.'},...(input.evidenceValidation?{evidenceReview:{consideredSourceIds:input.sourceRecords.map(r=>r.id),reason:'The supplied profile contains no Kubernetes operations experience.'}}:{})}]));
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({assessments})}]}}]});
  });
  const result=await service.action({action:'buildProfiles',mode:'expansion',documentIds:['new'],revision:1}),after=result.state;assert.equal(calls,2);
  assert.equal(JSON.stringify(after.builderReviews.slice(0,-1)),oldReview);assert.deepEqual(after.builderReviews.at(-1).jdIds,['new']);
  assert.equal(JSON.stringify(after.builderExpansion),decisions);assert.equal(JSON.stringify(after.facts),facts);assert.equal(JSON.stringify(after.approvals),approvals);
  assert.deepEqual(after.documents.filter(d=>d.kind==='jd'&&d.selected).map(d=>d.id),['old','new']);
  assert.deepEqual(builderQuestionnaireScope(after),{newDocumentIds:[],activeDocumentIds:['new']});
  assert.ok(buildRoleQuestionnaires(after).find(g=>g.documentId==='old').experience.every(r=>['approved','already_supported','rejected'].includes(r.status)));
  const n=calls;for(const documentIds of [[],['missing'],['new','new'],['cv']])await assert.rejects(service.action({action:'buildProfiles',mode:'expansion',documentIds,revision:result.revision}),/valid selected/);assert.equal(calls,n);
});
