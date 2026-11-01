import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile,addDocument,proposeFacts,decideFacts,addJDAnalysis,buildProfiles,finalize,savedPacket} from '../lib/profile/domain.mjs';
import {buildRoleQuestionnaires,applyBuilderReview,builderReviewReceiptMatches} from '../lib/profile/builder-expansion.mjs';
import {buildProfessionalExperience} from '../lib/profile/professional-experience.mjs';
import {buildFactReview} from '../lib/profile/fact-review.mjs';
import {buildConsolidatedProfile} from '../lib/profile/consolidated.mjs';
import {ProfileService} from '../lib/profile/service.mjs';

async function fixture(){
  const s=emptyProfile();addDocument(s,{id:'resume',kind:'resume',title:'Synthetic resume',hash:'resume',segments:[{id:'resume.1',text:'Excel'}]});s.documents[0].analysis='complete';
  await proposeFacts(s,[{category:'skills',field:'tools_technologies',scope:'Listed skills',statement:'Excel',evidence:[{documentId:'resume',segmentId:'resume.1',quote:'Excel'}]}]);
  decideFacts(s,[{id:s.facts[0].id,version:1,decision:'approved'}],'test-owner');
  for(const [id,title] of [['jd1','Portfolio Reporting Manager'],['jd2','Risk Manager']]){
    const text=title+'\nPrepared risk reports; Python; Excel; Bachelor degree';
    addDocument(s,{id,kind:'jd',title,hash:id,selected:true,segments:[{id:id+'.1',text}]});
    await addJDAnalysis(s,id,{roleName:title,sector:'',requirements:[['Prepared risk reports','task'],['Python','skill'],['Excel','skill'],['Bachelor degree','qualification']].map(([text,category])=>({text,category,importance:'required',evidence:[{documentId:id,segmentId:id+'.1',quote:text}]}))});
  }
  await refresh(s);return s;
}
async function refresh(s){
  await buildProfiles(s,{questions:[],mappings:s.requirements.map(r=>({requirementId:r.id,factIds:[],evidenceStatus:'not_established',explanation:'No specific supported scope.'}))},'analysis');
  // Expansion discovery questions do not require inventing answers to save a profile.
  for(const q of s.questions)q.required=false;
}
const rows=s=>buildRoleQuestionnaires(s).flatMap(g=>[...g.experience,...g.skills]);
const find=(s,statement,doc='jd1')=>rows(s).find(r=>r.proposedStatement===statement&&r.documentId===doc);
const body=(r,decision,extra={})=>({submissionId:crypto.randomUUID(),revision:1,rows:[{rowId:r.id,fingerprint:r.fingerprint,decision,...extra}]});
const apply=(s,b)=>applyBuilderReview(s,b,'test-owner',{revision:1});

test('each role has separate experience and skill tables; existing skills and qualifications are not proposed',async()=>{
  const s=await fixture(),groups=buildRoleQuestionnaires(s);
  assert.equal(groups.length,2);for(const g of groups){assert.equal(g.experience.length,1);assert.equal(g.skills.length,1);assert.equal(g.skills[0].proposedStatement,'Python');}
  assert.equal(new Set(rows(s).map(r=>r.id)).size,4);assert.equal(s.facts.length,1);
});
test('Somewhat is durable draft-only; a separate exact revision approval adds work to the factual and final profiles',async()=>{
  const s=await fixture(),before=structuredClone(s.facts),approvals=structuredClone(s.approvals),revision='Prepared monthly risk reports with my team';
  let r=find(s,'Prepared risk reports'),b=body(r,'somewhat',{text:revision});
  const draftReceipt=await apply(s,b);assert.ok(builderReviewReceiptMatches({state:s,result:draftReceipt},b));
  assert.deepEqual(s.facts,before);assert.deepEqual(s.approvals,approvals);assert.equal(s.documents.filter(d=>d.kind==='answer').length,0);
  assert.ok(!JSON.stringify(buildConsolidatedProfile(s).sections).includes(revision));
  const restored=JSON.parse(JSON.stringify(s));r=find(restored,'Prepared risk reports');assert.equal(r.status,'awaiting_approval');assert.equal(r.revisionText,revision);
  await assert.rejects(apply(restored,body(r,'approve')),/revised wording/);
  await assert.rejects(apply(restored,body(r,'approve_revision',{text:'Managed all risk',draftVersion:r.draftVersion})),/draft changed/);
  b=body(r,'approve_revision',{text:revision,draftVersion:r.draftVersion});const receipt=await apply(restored,b);
  assert.ok(builderReviewReceiptMatches({state:restored,result:receipt},b));assert.equal(restored.facts.length,2);assert.deepEqual(restored.facts[0],before[0]);
  const f=restored.facts.at(-1);assert.equal(f.statement,revision);assert.equal(f.approval,'approved');assert.equal(f.category,'experience_claims');assert.ok(f.evidence.every(e=>restored.documents.find(d=>d.id===e.documentId).kind==='answer'));
  assert.ok(buildProfessionalExperience(restored).rows.some(g=>g.items.some(i=>i.statement===revision)));
  await refresh(restored);const snapshot=finalize(restored,'test-owner');const final=buildConsolidatedProfile(restored,{snapshot});
  assert.ok(final.binding.valid);assert.ok(JSON.stringify(final.sections).includes(revision));assert.ok(savedPacket(restored).facts.records.some(f=>f.statement===revision));
});
test('Reject adds no fact, persists across roles and needs explicit reopening',async()=>{
  const s=await fixture(),b=body(find(s,'Python'),'reject');await apply(s,b);assert.equal(s.facts.length,1);
  const r=find(s,'Python','jd2');assert.equal(r.status,'rejected');await assert.rejects(apply(s,body(r,'approve')),/reopen/);
  await apply(s,body(r,'approve',{reopen:true}));assert.equal(s.facts.length,2);assert.equal(s.facts.at(-1).category,'skills');
  assert.ok(Object.values(buildFactReview(s).skills).flat().some(item=>item.value==='Python'));
});
test('approved skill is reused across roles and no duplicate fact is created',async()=>{
  const s=await fixture();await apply(s,body(find(s,'Python'),'approve'));assert.equal(s.facts.length,2);
  assert.ok(!buildRoleQuestionnaires(s).find(g=>g.documentId==='jd2').skills.some(r=>r.status==='pending'));
  await refresh(s);assert.equal(s.facts.length,2);assert.ok(rows(s).some(r=>r.status==='approved'&&r.proposedStatement==='Python'));
});
test('changed revision wording, stale facts and invalid mixed batches are atomic',async()=>{
  const s=await fixture(),old=find(s,'Prepared risk reports');await apply(s,body(old,'somewhat',{text:'Prepared monthly risk reports'}));
  let current=find(s,'Prepared risk reports');const staleApprove=body(current,'approve_revision',{text:current.revisionText,draftVersion:current.draftVersion});
  await apply(s,body(current,'somewhat',{text:'Prepared quarterly risk reports'}));const before=structuredClone(s);
  await assert.rejects(apply(s,staleApprove),/proposal changed/);assert.deepEqual(s,before);
  const b=body(find(s,'Python'),'approve');b.rows.push({rowId:'forged',fingerprint:'bad',decision:'approve'});await assert.rejects(apply(s,b),/proposal changed/);assert.deepEqual(s,before);
});
test('retries are idempotent before revision guards; receipts detect changed decisions',async()=>{
  const s=await fixture(),b=body(find(s,'Python'),'approve'),result=await apply(s,b),before=structuredClone(s);
  assert.deepEqual(await applyBuilderReview(s,b,'test-owner',{revision:999}),result);assert.deepEqual(s,before);
  assert.equal(builderReviewReceiptMatches({state:s,result},{...b,rows:b.rows.map(r=>({...r,decision:'reject'}))}),false);
  await assert.rejects(apply(s,{...b,rows:b.rows.map(r=>({...r,decision:'reject'}))}),/different decisions/);
});
test('withdrawn or changed source proposals cannot be approved',async()=>{
  const s=await fixture(),b=body(find(s,'Python'),'approve');s.documents.find(d=>d.id==='jd1').selected=false;
  await assert.rejects(apply(s,b),/proposal changed/);assert.equal(s.facts.length,1);
});
test('Profile service persists review in a single save; reload and stale retry preserve exact receipt',async()=>{
  let record={revision:1,state:await fixture()},writes=0;const service=new ProfileService({},'test-owner');
  service.memory.load=async()=>structuredClone(record);service.memory.save=async(revision,state)=>{assert.equal(revision,record.revision);writes++;record={revision:revision+1,state:structuredClone(state)};return structuredClone(record);};
  const b={action:'reviewBuilder',...body(find(record.state,'Python'),'approve')},saved=await service.action(b);
  assert.equal(writes,1);assert.ok(builderReviewReceiptMatches(saved,b));assert.deepEqual((await service.action(b)).result,saved.result);assert.equal(writes,1);
  const loaded=await service.memory.load();assert.equal(loaded.state.facts.at(-1).statement,'Python');
});
test('a saved revision survives reanalysis of the same role without becoming a fact',async()=>{
  const s=await fixture();await apply(s,body(find(s,'Prepared risk reports'),'somewhat',{text:'Prepared monthly risk reports'}));
  for(const r of s.requirements.filter(r=>r.documentId==='jd1'))r.id+='-new';
  await refresh(s);const r=find(s,'Prepared risk reports');assert.equal(r.status,'awaiting_approval');assert.equal(r.revisionText,'Prepared monthly risk reports');assert.equal(s.facts.length,1);
});
test('withdrawn confirmation evidence is not presented as supported experience',async()=>{
  const s=await fixture();await apply(s,body(find(s,'Python'),'approve'));const fact=s.facts.at(-1);
  s.documents.find(d=>d.id===fact.evidence[0].documentId).deleted=true;
  const row=find(s,'Python');assert.equal(row.status,'needs_review');
});
test('role questionnaires retain complete contextual statements rather than conjunction fragments',async()=>{
  const s=await fixture(),d=s.documents.find(d=>d.id==='jd1'),quote='Clear interpersonal and written communication skills to articulate risk data to senior leaders';
  d.segments.push({id:'jd1.extra',text:quote});s.requirements.push({id:'new-skill',documentId:d.id,text:quote,category:'skill',importance:'required',evidence:[{documentId:d.id,segmentId:'jd1.extra',quote}]});
  await refresh(s);const group=buildRoleQuestionnaires(s).find(g=>g.documentId===d.id);
  assert.ok(group.skills.some(r=>r.proposedStatement===quote));assert.ok(!group.skills.some(r=>r.proposedStatement==='Clear interpersonal'));
});
