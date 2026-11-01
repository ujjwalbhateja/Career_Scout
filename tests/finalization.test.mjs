import test from 'node:test';
import assert from 'node:assert/strict';
import {addAnswer,addDocument,addJDAnalysis,approveRole,approvedFacts,buildProfiles,decideFacts,emptyProfile,finalizationReadiness,finalize,invalidateProfileSnapshots,proposeFacts,savedPacket} from '../lib/profile/domain.mjs';

async function approvedState(){
  const s=emptyProfile();addDocument(s,{id:'resume',kind:'resume',title:'Synthetic resume',hash:'synthetic-resume',segments:[{id:'resume.p1',text:'At Example Employer, I prepared client reports.'}]});
  await proposeFacts(s,[{category:'experience_claims',field:'reporting',scope:'Example Employer',statement:'Prepared client reports.',evidence:[{documentId:'resume',segmentId:'resume.p1',quote:'I prepared client reports.'}]}]);
  decideFacts(s,[{id:s.facts[0].id,version:1,decision:'approved'}],'synthetic-owner');return s;
}
async function rebuild(s,overrides={}){
  const roles=await buildProfiles(s,{profiles:[{roleName:'Reporting Analyst',summary:'A conservative reporting role proposal.',keywords:['reporting'],factIds:approvedFacts(s).filter(f=>!['personal','preferences'].includes(f.category)).map(f=>f.id),...overrides}]},'resume');
  approveRole(s,roles[0].id,'synthetic-owner');return roles[0];
}
async function activated(){const s=await approvedState();await rebuild(s);finalize(s,'synthetic-owner');return s;}
function question(s,{required=false,...overrides}={}){const q={id:'q1',key:'synthetic-question',scope:'Example Employer',question:'Describe your SQL work.',status:'unresolved',required,...overrides};s.questions.push(q);return q;}
function answer(s,overrides={}){return addAnswer(s,{questionId:'q1',decision:'answered',capabilityDecision:'yes',text:'I wrote SQL.',...overrides});}
async function extractedAnswerFact(s,a){
  s.documents.find(d=>d.id===a.documentId).analysis='complete';
  const added=await proposeFacts(s,[{category:'experience_claims',field:'sql_work',scope:'Example Employer',statement:a.text,evidence:[{documentId:a.documentId,segmentId:a.documentId+'.p1',quote:a.text}]}],'user_answer');return added[0];
}

test('unchanged finalization reuses a complete snapshot without new approvals',async()=>{
  const s=await activated(),snapshot=s.snapshots[0],approvalCount=s.approvals.length;
  assert.equal(finalizationReadiness(s).ready,true);assert.equal(finalize(s,'synthetic-owner').id,snapshot.id);
  assert.equal(s.approvals.length,approvalCount);assert.equal(s.snapshots.length,1);assert.equal(savedPacket(s).snapshot.id,snapshot.id);
});

test('finalization freezes preferences, disclosure and questionnaire review scope',async()=>{
  const s=await approvedState();question(s);
  await answer(s,{decision:'deferred',capabilityDecision:'unsure',text:''});
  s.preferences.search={goals:'Client reporting',location:'Boston',arrangement:'hybrid'};s.preferences.disclosure=['Do not discuss compensation'];
  await rebuild(s);const snapshot=finalize(s,'synthetic-owner');
  assert.equal(snapshot.searchPreferences.goals,'Client reporting');assert.deepEqual(snapshot.disclosurePreferences,['Do not discuss compensation']);
  assert.deepEqual(snapshot.reviewScope.questionIds,['q1']);assert.equal(snapshot.reviewScope.answerRefs[0].status,'deferred');
  assert.equal(snapshot.reviewScope.answerRefs[0].id,s.answers[0].id);assert.ok(snapshot.reviewFingerprint);
  s.preferences.search.goals='A different career direction';
  assert.equal(snapshot.searchPreferences.goals,'Client reporting','the saved preference copy is immutable');
  assert.throws(()=>savedPacket(s),/preferences|save it again/);
  const next=finalize(s,'synthetic-owner');assert.notEqual(next.id,snapshot.id);assert.equal(next.searchPreferences.goals,'A different career direction');
});

test('a newly saved Yes cannot disappear behind an older active snapshot',async()=>{
  const s=await activated();question(s);const a=await answer(s,{text:'Yes'});
  assert.equal(a.status,'needs_details');assert.equal(s.snapshots[0].stale,true);
  assert.ok(finalizationReadiness(s).blockers.some(b=>b.code==='answer_details_required'&&b.questionId==='q1'));
  assert.throws(()=>finalize(s,'synthetic-owner'),/Add details/);assert.throws(()=>savedPacket(s),/current approved/);
  assert.equal(s.facts.length,1);assert.equal(s.approvals.filter(a=>a.kind==='fact').length,1);
});

test('answer extraction and explicit fact approval gate saving without requiring generated role rebuild',async()=>{
  const s=await activated(),oldRole=s.roleProfiles[0],oldSnapshot=s.snapshots[0];question(s);const a=await answer(s);
  assert.ok(finalizationReadiness(s).blockers.some(b=>b.code==='answer_extraction_pending'&&b.documentId===a.documentId));
  assert.throws(()=>finalize(s,'synthetic-owner'),/Extract facts/);
  const fact=await extractedAnswerFact(s,a);
  assert.ok(finalizationReadiness(s).blockers.some(b=>b.code==='answer_facts_pending'&&b.factIds.includes(fact.id)));
  assert.throws(()=>finalize(s,'synthetic-owner'),/Review the facts/);
  decideFacts(s,[{id:fact.id,version:1,decision:'approved'}],'synthetic-owner');
  assert.equal(finalizationReadiness(s).ready,true);assert.ok(!finalizationReadiness(s).blockers.some(b=>/role/.test(b.code)));
  assert.throws(()=>approveRole(s,oldRole.id,'synthetic-owner'),/Rebuild/);
  const snapshot=finalize(s,'synthetic-owner'),packet=savedPacket(s);
  assert.equal(packet.facts.records.length,2);assert.ok(snapshot.searchProfile.responsibilities.some(item=>item.term.includes('SQL')&&item.factIds.includes(fact.id)));
  assert.ok(snapshot.factRefs.some(ref=>ref.id===fact.id));assert.deepEqual(snapshot.profileRefs,[]);
  assert.equal(oldSnapshot.stale,true);assert.throws(()=>savedPacket(s,oldSnapshot.version),/current approved/);
});

test('all active pending answer facts require review, including a pending correction',async()=>{
  const s=await activated();question(s);const a=await answer(s),fact=await extractedAnswerFact(s,a);
  s.questions[0].status='deferred';s.answers.push({id:'later-defer',questionId:'q1',status:'deferred',text:'',at:new Date().toISOString()});
  await rebuild(s);
  assert.ok(finalizationReadiness(s).blockers.some(b=>b.code==='answer_facts_pending'&&b.factIds.includes(fact.id)));
  decideFacts(s,[{id:fact.id,version:1,decision:'rejected'}],'synthetic-owner');
  assert.equal(finalizationReadiness(s).ready,true);assert.equal(finalize(s,'synthetic-owner').factRefs.length,1);
});

for(const [decision,capabilityDecision] of [['not_experienced','no'],['deferred','unsure'],['declined',undefined]])test(decision+' can be saved as a gap without generated role approval',async()=>{
  const s=await activated();question(s,{required:true});await answer(s,{decision,capabilityDecision,text:''});
  assert.equal(s.facts.length,1);assert.ok(!finalizationReadiness(s).blockers.some(b=>/answer_|question_response/.test(b.code)));
  assert.equal(finalizationReadiness(s).ready,true);
  const snapshot=finalize(s,'synthetic-owner');assert.equal(snapshot.reviewScope.answerRefs[0].status,decision);
  assert.equal(savedPacket(s).facts.records.length,1);
});

test('required unanswered questions require an explicit response while optional gaps remain visible',async()=>{
  const s=await approvedState();question(s,{required:true});await rebuild(s);
  assert.ok(finalizationReadiness(s).blockers.some(b=>b.code==='question_response_required'));
  assert.throws(()=>finalize(s,'synthetic-owner'),/required question/);
  await answer(s,{decision:'deferred',capabilityDecision:'unsure',text:''});await rebuild(s);
  assert.equal(finalizationReadiness(s).ready,true);finalize(s,'synthetic-owner');
});

test('newly approved personal facts invalidate saved content without requiring a role rebuild',async()=>{
  const s=await activated(),role=s.roleProfiles[0];
  addDocument(s,{id:'contact',kind:'resume',title:'Synthetic contact update',hash:'contact-update',segments:[{id:'contact.p1',text:'Example Candidate'}]});
  const [fact]=await proposeFacts(s,[{category:'personal',field:'full_name',scope:'personal',statement:'Example Candidate',evidence:[{documentId:'contact',segmentId:'contact.p1',quote:'Example Candidate'}]}]);
  decideFacts(s,[{id:fact.id,version:1,decision:'approved'}],'synthetic-owner');
  assert.equal(s.snapshots[0].stale,true);assert.equal(role.status,'approved');assert.throws(()=>savedPacket(s),/current approved/);
  const next=finalize(s,'synthetic-owner');assert.equal(next.factRefs.length,2);
});

test('legacy role approvals preserve history without changing the authoritative source-backed profile',async()=>{
  const s=await activated(),old=s.snapshots[0];await rebuild(s,{roleName:'Client Reporting Specialist'});
  assert.equal(old.stale,false);assert.equal(savedPacket(s).snapshot.id,old.id);
  const next=finalize(s,'synthetic-owner');assert.equal(next.id,old.id);assert.equal(s.roleProfiles.filter(p=>p.status==='approved').length,2);
  assert.ok(!JSON.stringify(next.searchProfile).includes('Client Reporting Specialist'));
});

test('dynamic packet validation catches additions even if an old stale flag was not recorded',async()=>{
  const s=await activated();addDocument(s,{id:'extra',kind:'resume',title:'Extra source',hash:'extra',segments:[{id:'extra.p1',text:'Python'}]});
  const [fact]=await proposeFacts(s,[{category:'skills',field:'tools',scope:'Example Employer',statement:'Python',evidence:[{documentId:'extra',segmentId:'extra.p1',quote:'Python'}]}]);
  decideFacts(s,[{id:fact.id,version:1,decision:'approved'}],'synthetic-owner');s.snapshots[0].stale=false;
  assert.throws(()=>savedPacket(s),/validated search sources|save it again/);
});

test('preference invalidation preserves approvals and requires explicit profile resaving',async()=>{
  const s=await activated(),approvalCount=s.approvals.length;
  s.preferences.disclosure=['Keep salary private'];invalidateProfileSnapshots(s,'Search or disclosure preferences changed.');
  assert.equal(s.snapshots[0].stale,true);assert.equal(s.approvals.length,approvalCount);
  assert.throws(()=>savedPacket(s),/current approved/);const next=finalize(s,'synthetic-owner');
  assert.deepEqual(next.disclosurePreferences,['Keep salary private']);assert.equal(s.approvals.length,approvalCount+1);
});

test('legacy snapshots with unchanged safe inputs remain usable, while unknown preference scope requires resave',async()=>{
  const s=await activated(),snapshot=s.snapshots[0];delete snapshot.reviewFingerprint;delete snapshot.reviewScope;delete snapshot.searchPreferences;delete snapshot.disclosurePreferences;
  assert.equal(savedPacket(s).snapshot.id,snapshot.id);
  s.preferences.search={goals:'A newly stated career goal'};assert.throws(()=>savedPacket(s),/legacy profile/);
  const next=finalize(s,'synthetic-owner');assert.ok(next.reviewFingerprint);assert.equal(savedPacket(s).snapshot.id,next.id);
});

test('legacy role evidence from Builder reviews detects newly approved professional facts',async()=>{
  const s=await activated(),old=s.roleProfiles[0];delete old.inputFactRefs;delete old.inputAnswerRefs;
  addDocument(s,{id:'extra',kind:'resume',title:'Additional synthetic evidence',hash:'extra',segments:[{id:'extra.p1',text:'I used Python.'}]});
  const [fact]=await proposeFacts(s,[{category:'skills',field:'tools',scope:'Example Employer',statement:'Python',evidence:[{documentId:'extra',segmentId:'extra.p1',quote:'Python'}]}]);
  decideFacts(s,[{id:fact.id,version:1,decision:'approved'}],'synthetic-owner');
  assert.equal(old.requiresRebuild,true);assert.equal(old.status,'needs_review');assert.throws(()=>approveRole(s,old.id,'synthetic-owner'),/Rebuild/);
});

for(const mode of ['resume','guided'])test(mode+' role proposals retain bounded alternative titles without creating user experience',async()=>{
  const s=await approvedState(),factCount=s.facts.length,approvalCount=s.approvals.length;
  const titles=['Client Reporting Specialist','client reporting specialist','',...Array.from({length:12},(_,i)=>'Related role '+i),'x'.repeat(180)];
  let output;
  if(mode==='resume')output={profiles:[{roleName:'Reporting Analyst',summary:'Conservative role',keywords:['reporting'],factIds:[s.facts[0].id],alternativeTitles:titles}]};
  else{
    addDocument(s,{id:'jd',kind:'jd',title:'Synthetic JD',hash:'jd',selected:true,segments:[{id:'jd.p1',text:'SQL is required.'}]});
    await addJDAnalysis(s,'jd',{roleName:'Reporting Analyst',requirements:[{category:'skill',text:'SQL',importance:'required',evidence:[{documentId:'jd',segmentId:'jd.p1',quote:'SQL is required.'}]}]});
    output={profiles:[{roleName:'Reporting Analyst',summary:'A role with an explicit SQL gap',keywords:['SQL'],alternativeTitles:titles,mappings:[{requirementId:s.requirements[0].id,factIds:[],explanation:'No approved SQL experience is established.'}]}],questions:[]};
  }
  const [role]=await buildProfiles(s,output,mode);
  assert.equal(role.alternativeTitles.length,8);assert.equal(role.alternativeTitles[0],'Client Reporting Specialist');assert.equal(role.alternativeTitles.every(title=>title.length<=140),true);
  assert.equal(role.status,'proposed');assert.equal(role.approvalRef,null);assert.equal(s.facts.length,factCount);assert.equal(s.approvals.length,approvalCount);
  if(mode==='guided')assert.throws(()=>approveRole(s,role.id,'synthetic-owner'),/Supporting facts/);
});
