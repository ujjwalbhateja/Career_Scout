import test from 'node:test';
import assert from 'node:assert/strict';
import {ProfileService} from '../lib/profile/service.mjs';
import {addAnswer,addDocument,addJDAnalysis,approveRole,approvedFacts,buildProfiles,canonicalJSON,decideFacts,emptyProfile,finalizationReadiness,finalize,proposeFacts,savedPacket} from '../lib/profile/domain.mjs';

async function fixture(){
  const s=emptyProfile();addDocument(s,{id:'resume',kind:'resume',title:'Synthetic resume',hash:'synthetic',segments:[{id:'resume.p1',text:'I prepared client reports. My tool is Excel. My employment title is Reporting Analyst.'}]});
  await proposeFacts(s,[['experience_claims','duties','prepared client reports'],['skills','tools_technologies','Excel'],['employment','job_title','Reporting Analyst']].map(([category,field,statement])=>({category,field,scope:'Example Employer',statement,evidence:[{documentId:'resume',segmentId:'resume.p1',quote:statement}]})));
  decideFacts(s,s.facts.map(f=>({id:f.id,version:1,decision:'approved'})),'synthetic-owner');return s;
}
async function jd(s){
  addDocument(s,{id:'jd1',kind:'jd',title:'Selected opening',hash:'jd1',selected:true,segments:[{id:'jd1.p1',text:'Treasury Analyst. Prepare client reports. SQL is preferred.'}]});
  await addJDAnalysis(s,'jd1',{roleName:'Treasury Analyst',requirements:[{category:'task',text:'Prepare client reports',importance:'required',evidence:[{documentId:'jd1',segmentId:'jd1.p1',quote:'Prepare client reports'}]},{category:'skill',text:'SQL',importance:'preferred',evidence:[{documentId:'jd1',segmentId:'jd1.p1',quote:'SQL is preferred'}]}]});
}
function comparison(s){return {profiles:[],mappings:s.requirements.map(r=>({requirementId:r.id,factIds:r.category==='task'?[s.facts[0].id]:approvedFacts(s).filter(f=>f.category==='skills'&&f.statement==='SQL').map(f=>f.id),explanation:r.category==='task'?'The approved source states client reporting work.':'Only an explicit approved SQL fact can establish the tool.'})),questions:[]};}
function question(s){s.questions.push({id:'q1',key:'synthetic-question',question:'Have you used SQL?',scope:'Example Employer',status:'unresolved'});}
async function approveSQL(s){
  const answer=await addAnswer(s,{questionId:'q1',decision:'answered',capabilityDecision:'yes',text:'I used SQL.'});
  s.documents.find(d=>d.id===answer.documentId).analysis='complete';
  const [fact]=await proposeFacts(s,[{category:'skills',field:'tools_technologies',scope:'Example Employer',statement:'SQL',evidence:[{documentId:answer.documentId,segmentId:answer.documentId+'.p1',quote:'SQL'}]}],'user_answer');
  return {answer,fact};
}
const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().reverse().map(key=>[key,reorder(value[key])])):value;

test('approved Fact data can be consolidated and saved without generating or approving a role',async()=>{
  const s=await fixture(),before=s.approvals.length;assert.equal(s.roleProfiles.length,0);assert.equal(finalizationReadiness(s).ready,true);
  const snapshot=finalize(s,'synthetic-owner'),packet=savedPacket(s);
  assert.equal(snapshot.profileBasis,'validated_source_data');assert.equal(snapshot.searchProfile.id,'master-profile');assert.equal(snapshot.searchProfile.version,snapshot.version);
  assert.deepEqual(snapshot.profileRefs,[]);assert.deepEqual(packet.roleProfiles,[]);assert.equal(packet.searchProfile.id,'master-profile');
  assert.equal(s.approvals.length,before+1);assert.equal(s.approvals.at(-1).kind,'snapshot');
  assert.deepEqual(snapshot.searchProfile.titles.map(item=>item.term),['Reporting Analyst']);
  assert.ok(snapshot.searchProfile.skills.some(item=>item.term==='Excel'));assert.ok(snapshot.searchProfile.responsibilities.some(item=>item.term==='prepared client reports'));
  assert.equal(finalize(s,'synthetic-owner').id,snapshot.id);assert.equal(s.approvals.length,before+1);
});

test('generated role history and its approval never supply the validated search titles',async()=>{
  const s=await fixture();await buildProfiles(s,{profiles:[{roleName:'Invented Executive Track',alternativeTitles:['Imagined Global Chief'],summary:'An old generated hypothesis.',keywords:['unsupported-keyword'],factIds:[s.facts[0].id]}]},'resume');
  approveRole(s,s.roleProfiles[0].id,'synthetic-owner');const history=structuredClone(s.roleProfiles),approvals=structuredClone(s.approvals);
  const snapshot=finalize(s,'synthetic-owner');assert.deepEqual(s.roleProfiles,history);assert.deepEqual(s.approvals.slice(0,approvals.length),approvals);
  assert.ok(!JSON.stringify(snapshot.searchProfile).includes('Invented Executive Track'));assert.ok(!JSON.stringify(snapshot.searchProfile).includes('Imagined Global Chief'));
  assert.ok(!JSON.stringify(snapshot.searchProfile).includes('unsupported-keyword'));assert.equal(snapshot.searchProfile.titles[0].sourceKind,'employment_title');
  s.roleProfiles[0].status='needs_review';assert.equal(finalizationReadiness(s).ready,true);assert.equal(savedPacket(s).searchProfile.id,'master-profile');
});

test('new approved answers can be saved without rebuilding generated role proposals',async()=>{
  const s=await fixture();await buildProfiles(s,{profiles:[{roleName:'Legacy Analyst',summary:'Old hypothesis',keywords:[],factIds:[s.facts[0].id]}]},'resume');
  approveRole(s,s.roleProfiles[0].id,'synthetic-owner');finalize(s,'synthetic-owner');question(s);
  const {fact}=await approveSQL(s);assert.ok(finalizationReadiness(s).blockers.some(b=>b.code==='answer_facts_pending'));
  decideFacts(s,[{id:fact.id,version:1,decision:'approved'}],'synthetic-owner');
  assert.equal(s.roleProfiles[0].status,'needs_review');assert.equal(s.roleProfiles[0].requiresRebuild,true);
  assert.equal(finalizationReadiness(s).ready,true);assert.ok(!finalizationReadiness(s).blockers.some(b=>/role/.test(b.code)));
  const next=finalize(s,'synthetic-owner');assert.ok(next.searchProfile.skills.some(item=>item.term==='SQL'));assert.deepEqual(next.profileRefs,[]);
  assert.equal(savedPacket(s).facts.records.length,4);
});

test('analysis mode assesses every selected requirement and creates questions without any generated role',async()=>{
  const s=await fixture();await jd(s);const factCount=s.facts.length,approvals=s.approvals.length;
  assert.ok(finalizationReadiness(s).blockers.some(b=>b.code==='builder_comparison_required'));
  assert.throws(()=>finalize(s,'synthetic-owner'),/Compare all selected JD/);
  const created=await buildProfiles(s,comparison(s),'analysis');assert.deepEqual(created,[]);assert.deepEqual(s.roleProfiles,[]);
  const review=s.builderReviews.at(-1);assert.equal(review.basis,'analysis');assert.deepEqual(review.profileIds,[]);assert.equal(review.mappings.length,2);
  assert.equal(review.supported,1);assert.equal(review.missing,1);assert.equal(s.questions.length,1);assert.equal(s.questions[0].capability,'SQL');
  assert.equal(s.facts.length,factCount);assert.equal(s.approvals.length,approvals);
  const snapshot=finalize(s,'synthetic-owner');assert.deepEqual(snapshot.reviewScope.documentIds,['jd1']);assert.equal(snapshot.reviewScope.assessments.length,2);
  assert.ok(snapshot.searchProfile.titles.some(item=>item.term==='Treasury Analyst'&&item.sourceKind==='selected_jd_title'&&item.userExperience===false));
  assert.ok(!snapshot.searchProfile.skills.some(item=>item.term==='SQL'));assert.equal(savedPacket(s).roleProfiles.length,0);
});

test('selected JD extraction must finish before consolidation independently of any legacy role',async()=>{
  const s=await fixture();addDocument(s,{id:'pending-jd',kind:'jd',title:'Unanalyzed JD',hash:'pending-jd',selected:true,segments:[{id:'pending-jd.p1',text:'A real source description with requirements.'}]});
  assert.ok(finalizationReadiness(s).blockers.some(b=>b.code==='selected_jd_analysis_pending'&&b.documentId==='pending-jd'));
  assert.throws(()=>finalize(s,'synthetic-owner'),/Analyze each selected/);
});

test('independent mappings reject omissions, duplicates, JD IDs and unapproved facts before persistence',async()=>{
  const s=await fixture();await jd(s);const before=canonicalJSON(s),good=comparison(s);
  const invalid=[{...good,mappings:good.mappings.slice(0,1)},{...good,mappings:[good.mappings[0],good.mappings[0]]},{...good,mappings:good.mappings.map((m,i)=>i?m:{...m,factIds:['jd1']})}];
  for(const result of invalid){await assert.rejects(buildProfiles(s,result,'analysis'),error=>error.status===502);assert.equal(canonicalJSON(s),before);}
  const pending=structuredClone(s.facts[0]);pending.id='pending-fact';pending.approval='pending';s.facts.push(pending);const withPending=canonicalJSON(s);
  await assert.rejects(buildProfiles(s,{...good,mappings:good.mappings.map((m,i)=>i?m:{...m,factIds:[pending.id]})},'analysis'),/outside the approved/);
  assert.equal(canonicalJSON(s),withPending);
});

test('a changed answer requires the actual JD comparison again, without introducing role approval',async()=>{
  const s=await fixture();await jd(s);await buildProfiles(s,comparison(s),'analysis');const sqlQuestion=s.questions[0];
  await addAnswer(s,{questionId:sqlQuestion.id,decision:'deferred',capabilityDecision:'unsure'});
  assert.ok(finalizationReadiness(s).blockers.some(b=>b.code==='builder_comparison_required'));
  assert.ok(!finalizationReadiness(s).blockers.some(b=>/role/.test(b.code)));
  await buildProfiles(s,comparison(s),'analysis');assert.equal(s.questions.length,1);assert.equal(s.questions[0].status,'deferred');
  assert.equal(finalizationReadiness(s).ready,true);finalize(s,'synthetic-owner');
});

test('analysis mappings support the assessments-object contract and JSONB key ordering',async()=>{
  let s=await fixture();await jd(s);
  const output={profiles:[],assessments:Object.fromEntries(comparison(s).mappings.map(({requirementId,...value})=>[requirementId,value])),questions:[]};
  await buildProfiles(s,output,'analysis');s=reorder(s);assert.equal(finalizationReadiness(s).ready,true);
  const snapshot=finalize(s,'synthetic-owner');s=reorder(s);
  assert.equal(savedPacket(s).snapshot.id,snapshot.id);assert.equal(finalize(s,'synthetic-owner').id,snapshot.id);assert.equal(s.snapshots.length,1);
});

test('a saved source-backed profile rejects changed JD requirement data',async()=>{
  const s=await fixture();await jd(s);await buildProfiles(s,comparison(s),'analysis');finalize(s,'synthetic-owner');
  s.requirements[0].text='A changed responsibility that was never reviewed';
  assert.throws(()=>savedPacket(s),/validated search sources|save it again/);
});

test('resume analysis can save material clarifications while keeping optional gaps explicit and roles empty',async()=>{
  const s=await fixture();await buildProfiles(s,{profiles:[],mappings:[],questions:[{capability:'scope of reporting',scope:'Example Employer',question:'What reporting scope have you handled?',required:false}]},'analysis');
  assert.equal(s.roleProfiles.length,0);assert.equal(s.questions.length,1);assert.equal(s.builderReviews.at(-1).mappings.length,0);
  assert.equal(finalizationReadiness(s).ready,true);const snapshot=finalize(s,'synthetic-owner');assert.equal(snapshot.reviewScope.questionIds.length,1);
});


test('the retired generated-role approval action cannot add approvals or alter source data',async()=>{
  const state=await fixture(),before=canonicalJSON(state),service=new ProfileService({},'synthetic-owner');
  service.memory.load=async()=>({revision:1,state:structuredClone(state)});
  service.memory.save=async()=>assert.fail('Retired role approval must not write memory');
  await assert.rejects(service.action({action:'approveRole',id:'old-generated-role',revision:1}),/Generated role suggestions are retired/);
  assert.equal(canonicalJSON(state),before);
});
