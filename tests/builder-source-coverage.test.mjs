import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile,addDocument,proposeFacts,addJDAnalysis,decideFacts} from '../lib/profile/domain.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
import {builderSourceRecords,normalizeSourceComparison,currentSourceComparison,builderArea,unresolvedSourceComparison} from '../lib/profile/builder-source-coverage.mjs';
import {buildRoleQuestionnaires,applyBuilderReview} from '../lib/profile/builder-expansion.mjs';

async function fixture(){
  const s=emptyProfile();
  addDocument(s,{id:'cv',kind:'resume',title:'Synthetic resume',hash:'cv',segments:[{id:'cv.1',text:'Professional Experience\nBuilt risk reports using VaR and option Greeks.\nSkills\nPython'}]});
  await proposeFacts(s,[{category:'skills',field:'programming_languages',scope:'Skills',statement:'Python',evidence:[{documentId:'cv',segmentId:'cv.1',quote:'Python'}]}]);
  addDocument(s,{id:'jd',kind:'jd',title:'Risk analyst',hash:'jd',selected:true,segments:[{id:'jd.1',text:'Prepare risk reports\nPython\nKnowledge of VaR, option Greeks, beta and volatility'}]});
  await addJDAnalysis(s,'jd',{roleName:'Risk analyst',sector:'',requirements:[['Prepare risk reports','task'],['Python','skill'],['Knowledge of VaR, option Greeks, beta and volatility','skill']].map(([text,category])=>({text,category,importance:'required',evidence:[{documentId:'jd',segmentId:'jd.1',quote:text}]}))});
  s.builderReviews=[];s.builderReviews.push({id:'review',jdIds:['jd'],mappings:s.requirements.map(r=>({requirementId:r.id,factRefs:[],evidenceStatus:'not_established',explanation:'No approved fact.'}))});
  return s;
}
function cover(s,index,status,ids,missingScopes=[]){const records=builderSourceRecords(s),r=s.requirements[index];return normalizeSourceComparison(r,{atsArea:builderArea(r.text),profileCoverage:{status,sourceIds:ids,missingScopes,explanation:'Compare saved source wording.'}},records);}

test('pending factual records suppress repeated questions without becoming approved; partial asks only missing metrics',async()=>{
  const s=await fixture(),records=builderSourceRecords(s),work=records.find(r=>r.category==='experience_claims'),skill=records.find(r=>r.category==='skills');
  assert.ok(work);assert.ok(skill);
  const before=JSON.stringify({facts:s.facts,approvals:s.approvals});
  s.builderReviews.at(-1).sourceComparisons=[cover(s,0,'covered',[work.id]),cover(s,1,'covered',[skill.id]),cover(s,2,'partial',[work.id],['beta and volatility'])];
  const g=buildRoleQuestionnaires(s)[0];
  assert.equal(g.recorded.length,2);assert.deepEqual(g.skills.map(r=>r.proposedStatement),['beta and volatility']);assert.equal(g.experience.length,0);
  assert.ok(g.skills[0].recordedStatements[0].includes('VaR'));assert.equal(JSON.stringify({facts:s.facts,approvals:s.approvals}),before);
});
test('stale source, removed document, rejected or conflicting fact restores questions',async()=>{
  const s=await fixture(),skill=builderSourceRecords(s).find(r=>r.category==='skills');
  s.builderReviews.at(-1).sourceComparisons=[cover(s,1,'covered',[skill.id])];
  assert.equal(buildRoleQuestionnaires(s)[0].recorded.length,1);
  for(const change of [d=>d.documents[0].deleted=true,d=>d.documents[0].version++,d=>d.facts[0].approval='rejected',d=>d.facts[0].conflict=true]){
    const d=structuredClone(s);change(d);assert.equal(buildRoleQuestionnaires(d)[0].recorded.length,0);assert.ok(buildRoleQuestionnaires(d)[0].skills.some(r=>r.proposedStatement==='Python'));
  }
});
test('invalid source IDs, invented gaps, and skill-only work matches are rejected',async()=>{
  const s=await fixture(),skill=builderSourceRecords(s).find(r=>r.category==='skills');
  assert.throws(()=>cover(s,0,'covered',['fake']));
  assert.throws(()=>cover(s,0,'covered',[skill.id]));
  assert.throws(()=>cover(s,1,'partial',[skill.id],['Expert Python developer']));
  assert.throws(()=>cover(s,1,'partial',[skill.id],[]));
  assert.throws(()=>cover(s,1,'covered',[skill.id],['Python']));
  assert.throws(()=>cover(s,1,'partial',[skill.id],['Python']));
  const c=cover(s,1,'covered',[skill.id]);assert.equal(currentSourceComparison({...s.requirements[1],text:'Advanced Python'},c,builderSourceRecords(s)),null);
});
test('approval of a narrowed gap saves only that gap and stale comparison submissions fail',async()=>{
  const s=await fixture(),work=builderSourceRecords(s).find(r=>r.category==='experience_claims');
  s.builderReviews.at(-1).sourceComparisons=[cover(s,2,'partial',[work.id],['beta and volatility'])];
  const row=buildRoleQuestionnaires(s)[0].skills.find(r=>r.proposedStatement==='beta and volatility');
  const body={submissionId:crypto.randomUUID(),revision:1,rows:[{rowId:row.id,fingerprint:row.fingerprint,decision:'approve'}]};
  const stale=structuredClone(s);stale.documents[0].version++;
  await assert.rejects(()=>applyBuilderReview(stale,body,'owner',{revision:1}));
  await applyBuilderReview(s,body,'owner',{revision:1});
  const approved=s.facts.filter(f=>f.approval==='approved');assert.equal(approved.length,1);assert.equal(approved[0].statement,'beta and volatility');assert.ok(approved[0].evidence.every(e=>s.documents.find(d=>d.id===e.documentId).kind==='answer'));
});
test('specific questionnaire areas retain finance topics without imposing them on other professions',()=>{
  assert.match(builderArea('Organize internal risk reports'),/Risk Reporting/);
  assert.match(builderArea('Experience with all primary asset classes'),/Cross-Asset/);
  assert.match(builderArea('Knowledge of financial instruments and risk metrics, beta, VaR and Greeks'),/Financial Instruments/);
  assert.equal(builderArea('Design accessible web applications'),'Design accessible web applications');
});

test('unresolved comparison is visible without an approval question or a false match',async()=>{
  const s=await fixture();s.builderReviews.at(-1).sourceComparisons=[unresolvedSourceComparison(s.requirements[2])];
  const group=buildRoleQuestionnaires(s)[0];assert.equal(group.unresolved.length,1);assert.equal(group.recorded.length,0);
  assert.ok(!group.skills.some(r=>r.requirementIds.includes(s.requirements[2].id)));
  assert.equal(s.facts.filter(f=>f.approval==='approved').length,0);
});

test('threshold skips are distinct from matches and related critical gaps form one durable review row',async()=>{
  const state=await fixture(),work=builderSourceRecords(state).find(r=>r.category==='experience_claims');
  const components=[{scope:'VaR',weight:3,sourceIds:[work.id],critical:false},{scope:'option Greeks',weight:3,sourceIds:[work.id],critical:false},{scope:'beta',weight:1,sourceIds:[],critical:false},{scope:'volatility',weight:1,sourceIds:[],critical:false}];
  const create=()=>normalizeSourceComparison(state.requirements[2],{atsArea:'Risk Metrics',profileCoverage:{relevance:'material',components,explanation:'Only additional metrics need review.'}},builderSourceRecords(state));
  state.builderReviews.at(-1).sourceComparisons=[create()];
  let group=buildRoleQuestionnaires(state)[0];assert.equal(group.skipped.length,1);assert.equal(group.skipped[0].percent,75);assert.equal(group.recorded.length,0);assert.deepEqual(group.skipped[0].unconfirmed,['beta','volatility']);
  assert.ok(!group.skills.some(r=>r.requirementIds.includes(state.requirements[2].id)));
  components[2].critical=true;components[3].critical=true;state.builderReviews.at(-1).sourceComparisons=[create()];
  group=buildRoleQuestionnaires(state)[0];let row=group.skills.find(r=>r.groupedStatements);
  assert.deepEqual(row.groupedStatements,['beta','volatility']);assert.equal(row.coverageEstimates.length,1);
  const body={submissionId:crypto.randomUUID(),revision:1,rows:[{rowId:row.id,fingerprint:row.fingerprint,decision:'somewhat',text:'Used beta in equity analysis'}]};
  await applyBuilderReview(state,body,'owner',{revision:1});assert.equal(state.facts.filter(f=>f.approval==='approved').length,0);
  row=buildRoleQuestionnaires(state)[0].skills.find(r=>r.groupedStatements);assert.equal(row.status,'awaiting_approval');
  await applyBuilderReview(state,{submissionId:crypto.randomUUID(),revision:1,rows:[{rowId:row.id,fingerprint:row.fingerprint,decision:'approve_revision',text:row.revisionText,draftVersion:row.draftVersion}]},'owner',{revision:1});
  assert.deepEqual(state.facts.filter(f=>f.approval==='approved').map(f=>f.statement),['Used beta in equity analysis']);
});

test('service refines only invalid source comparisons once, then persists without changing facts or approvals',async t=>{
  const state=await fixture();decideFacts(state,[{id:state.facts[0].id,version:1,decision:'approved'}],'test-owner');
  const before=JSON.stringify({facts:state.facts,approvals:state.approvals});let record={revision:1,state:structuredClone(state)},calls=0;
  const svc=new ProfileService({GEMINI_API_KEY:'fixture-only'},'test-owner');
  svc.memory.load=async()=>structuredClone(record);svc.memory.save=async(revision,state)=>{assert.equal(revision,record.revision);record={revision:revision+1,state:structuredClone(state)};return structuredClone(record);};svc.memory.reserve=async()=>{};
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    calls++;const input=JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
    assert.ok(input.sourceRecords.length);assert.equal(input.factualProfile,undefined);
    if(calls===2){assert.equal(input.requirements.length,1);assert.match(input.sourceCoverageCorrections[0].validationIssue,/whole requirement/);}
    const work=input.sourceRecords.find(r=>r.category==='experience_claims'),skill=input.sourceRecords.find(r=>r.category==='skills');
    const assessments=Object.fromEntries(input.requirements.map(r=>[r.id,{factIds:[],evidenceStatus:'not_established',explanation:'No approved work claim.',atsArea:builderArea(r.text),profileCoverage:{status:r.text.startsWith('Knowledge')?'partial':'covered',sourceIds:[r.text==='Python'?skill.id:work.id],missingScopes:r.text.startsWith('Knowledge')?[calls===1?r.text:'beta and volatility']:[],explanation:'Existing work reused.'}}]));
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({assessments})}]}}]});
  });
  const saved=await svc.action({action:'buildProfiles',mode:'expansion',revision:1});
  assert.equal(calls,2);assert.equal(saved.state.builderReviews.at(-1).sourceComparisons.length,3);
  assert.equal(JSON.stringify({facts:saved.state.facts,approvals:saved.state.approvals}),before);
  assert.deepEqual(buildRoleQuestionnaires(saved.state)[0].skills.map(r=>r.proposedStatement),['beta and volatility']);
});
