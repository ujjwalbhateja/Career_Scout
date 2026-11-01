import test from 'node:test';
import assert from 'node:assert/strict';
import {addDocument,addJDAnalysis,applyExperienceReview,approvedFacts,buildProfiles,canonicalJSON,decideFacts,emptyProfile,finalizationReadiness,finalize,proposeFacts,replayedExperienceReview,savedPacket} from '../lib/profile/domain.mjs';
import {buildExperienceReviewRows} from '../lib/profile/experience-review.mjs';

async function fixture(requirements=['Prepare monthly cash reports']){
  const s=emptyProfile();addDocument(s,{id:'resume',kind:'resume',title:'Synthetic resume',hash:'resume',segments:[{id:'resume.p1',text:'Prepared reports. Excel.'}]});
  await proposeFacts(s,[{category:'experience_claims',field:'duties',scope:'Example Employer',statement:'Prepared reports',evidence:[{documentId:'resume',segmentId:'resume.p1',quote:'Prepared reports'}]},{category:'skills',field:'tools',scope:'Example Employer',statement:'Excel',evidence:[{documentId:'resume',segmentId:'resume.p1',quote:'Excel'}]}]);
  decideFacts(s,s.facts.map(f=>({id:f.id,version:f.version,decision:'approved'})),'synthetic-owner');
  for(const [index,value] of requirements.entries()){
    const text=typeof value==='string'?value:value.text,category=typeof value==='string'?'task':value.category||'task',docId='jd'+index;
    addDocument(s,{id:docId,kind:'jd',title:'Synthetic opening '+index,hash:docId,selected:true,segments:[{id:docId+'.p1',text:'Distinct opening '+index+': '+text}]});
    await addJDAnalysis(s,docId,{roleName:'Synthetic opening',requirements:[{category,text,importance:'required',evidence:[{documentId:docId,segmentId:docId+'.p1',quote:text}]}]});
  }
  await buildProfiles(s,{profiles:[],mappings:s.requirements.map(r=>({requirementId:r.id,factIds:[],evidenceStatus:'not_established',explanation:'This JD capability is not yet established by approved experience.'})),questions:[]},'analysis');
  s.outbox=[];return s;
}
function body(rows,overrides={}){return {submissionId:'experience-submit-001',expectedRevision:4,rows:rows.map(row=>({questionId:row.id,proposalFingerprint:row.fingerprint,decision:'approve'})),...overrides};}
const submit=(s,input,revision=4)=>applyExperienceReview(s,input,'synthetic-owner',{revision});

test('Approve atomically creates exact user-confirmed experience with its own source and approval receipt',async t=>{
  const s=await fixture(),rows=buildExperienceReviewRows(s),before=structuredClone(s),row=rows[0];
  t.mock.method(globalThis,'fetch',()=>assert.fail('Explicit review submission must not call an LLM or another provider.'));
  const result=await submit(s,body(rows));assert.equal(result.kind,'experience_review_saved');assert.equal(result.saved,true);assert.equal(result.approvedCount,1);
  const fact=s.facts.find(f=>f.experienceRowId===row.id);assert.ok(fact);assert.equal(fact.statement,row.proposedStatement);assert.equal(fact.category,'experience_claims');
  assert.equal(fact.approval,'approved');assert.equal(fact.confirmation,'user_confirmed');assert.equal(fact.origin,'user_answer');assert.deepEqual(fact.originatingRequirements,row.requirementIds);
  const approval=s.approvals.find(a=>a.id===fact.approvalRef);assert.equal(approval.actor,'synthetic-owner');assert.equal(approval.recordId,fact.id);assert.equal(approval.recordVersion,fact.version);
  assert.deepEqual(s.approvals.slice(0,before.approvals.length),before.approvals);assert.equal(s.approvals.length,before.approvals.length+1);
  for(const evidence of fact.evidence){const document=s.documents.find(d=>d.id===evidence.documentId);assert.equal(document.kind,'answer');assert.equal(document.analysis,'complete');assert.equal(evidence.quote,row.proposedStatement);assert.equal(document.segments.find(p=>p.id===evidence.segmentId).text,row.proposedStatement);}
  assert.equal(s.answers.at(-1).sourceSegmentId,fact.evidence[0].segmentId);assert.equal(result.rows[0].sourceSegmentId,fact.evidence[0].segmentId);
  assert.equal(s.roleProfiles.length,0);assert.ok(!s.facts.some(f=>f.approval==='pending'));assert.ok(!buildExperienceReviewRows(s).some(item=>item.id===row.id));
  assert.ok(finalizationReadiness(s).blockers.some(b=>b.code==='builder_comparison_required'),'actual JD comparison must refresh for the new approved claim');
});

test('Somewhat approves only the exact user-edited subset without a second approval step',async()=>{
  const s=await fixture(['Manage global weekly risk reports']),row=buildExperienceReviewRows(s)[0],edited='Prepared weekly risk reports for one local team.';
  const result=await submit(s,body([row],{rows:[{questionId:row.id,proposalFingerprint:row.fingerprint,decision:'somewhat',text:edited}]}));
  assert.equal(result.rows[0].status,'somewhat');const fact=s.facts.find(f=>f.experienceRowId===row.id);assert.equal(fact.statement,edited);assert.equal(fact.approval,'approved');
  assert.ok(!fact.statement.includes('global'));assert.ok(!fact.statement.includes('Manage'));assert.equal(fact.experienceDecision,'somewhat');
  assert.equal(fact.evidence[0].quote,edited);assert.equal(s.answers.at(-1).text,edited);assert.ok(!s.facts.some(f=>f.approval==='pending'));
});

test('Decline creates no positive statement or source document and stays declined on future projections',async()=>{
  const s=await fixture(),row=buildExperienceReviewRows(s)[0],facts=structuredClone(s.facts),documents=s.documents.length,approvals=structuredClone(s.approvals);
  const result=await submit(s,body([row],{rows:[{questionId:row.id,proposalFingerprint:row.fingerprint,decision:'decline'}]}));
  assert.equal(result.declinedCount,1);assert.deepEqual(s.facts,facts);assert.equal(s.documents.length,documents);assert.deepEqual(s.approvals,approvals);
  const projected=buildExperienceReviewRows(s).find(item=>item.id===row.id);assert.equal(projected.status,'declined');assert.equal(s.questions.find(q=>q.id===row.id).status,'declined');
  await assert.rejects(submit(s,body([projected],{submissionId:'experience-submit-002'})),error=>error.status===409&&/reopen/.test(error.message));
  const reopened=await submit(s,body([projected],{submissionId:'experience-submit-003',rows:[{questionId:projected.id,proposalFingerprint:projected.fingerprint,decision:'approve',reopen:true}]}));
  assert.equal(reopened.approvedCount,1);assert.equal(s.experienceReviews.length,2);
});

test('approval of an atomic compound clause cannot confirm its unresolved sibling',async()=>{
  const s=await fixture(['Prepare monthly cash reports and reconcile cash balances']),rows=buildExperienceReviewRows(s);assert.equal(rows.length,2);
  const first=rows.find(row=>row.proposedStatement.startsWith('Prepare')),parentId=first.parentQuestionIds[0];
  await submit(s,body([first]));assert.equal(s.questions.find(q=>q.id===parentId).status,'unresolved');
  assert.equal(s.facts.filter(f=>f.origin==='user_answer').length,1);assert.ok(!s.facts.some(f=>f.statement==='reconcile cash balances'));
  const remaining=buildExperienceReviewRows(s).find(row=>row.proposedStatement==='reconcile cash balances');assert.ok(remaining);
  await submit(s,body([remaining],{submissionId:'experience-submit-002',rows:[{questionId:remaining.id,proposalFingerprint:remaining.fingerprint,decision:'decline'}]}));
  assert.equal(s.questions.find(q=>q.id===parentId).status,'answered','the parent records its resolved mixed decision without inventing the declined clause');
});

test('identical capabilities across JDs share one confirmed assertion with every originating requirement',async()=>{
  const s=await fixture(['Prepare monthly cash reports','Prepare monthly cash reports']),rows=buildExperienceReviewRows(s);assert.equal(rows.length,1);assert.equal(rows[0].requirementIds.length,2);
  const result=await submit(s,body(rows));assert.equal(result.approvedCount,1);assert.equal(s.facts.filter(f=>f.origin==='user_answer').length,1);
  const fact=s.facts.find(f=>f.origin==='user_answer');assert.equal(fact.originatingRequirements.length,2);assert.equal(fact.evidence.length,1);
});

test('an edited subset already approved elsewhere reuses the exact fact version and its approval',async()=>{
  const s=await fixture(),row=buildExperienceReviewRows(s)[0],facts=structuredClone(s.facts),approvals=structuredClone(s.approvals);
  const result=await submit(s,body([row],{rows:[{questionId:row.id,proposalFingerprint:row.fingerprint,decision:'somewhat',text:'Prepared reports'}]}));
  assert.equal(result.reusedCount,1);assert.equal(result.rows[0].factRefs[0].id,s.facts[0].id);assert.deepEqual(s.facts,facts);assert.deepEqual(s.approvals,approvals);
  assert.equal(s.answers.at(-1).confirmedFactRefs[0].approvalRef,s.facts[0].approvalRef);
});

test('lost-response replay returns the exact saved receipt despite stale revision without duplicating approvals',async()=>{
  const s=await fixture(),input=body(buildExperienceReviewRows(s)),first=await submit(s,input),saved=canonicalJSON(s);
  assert.deepEqual(await replayedExperienceReview(s,input),first);assert.deepEqual(await submit(s,input,99),first);assert.equal(canonicalJSON(s),saved);
  await assert.rejects(replayedExperienceReview(s,{...input,rows:input.rows.map(row=>({...row,decision:'decline'}))}),error=>error.status===409);
  assert.equal(canonicalJSON(s),saved);
});

test('stale rows, changed Approve text, duplicate rows and revision conflicts leave the whole batch untouched',async()=>{
  const s=await fixture(['Prepare monthly cash reports','Reconcile cash balances']),rows=buildExperienceReviewRows(s),before=canonicalJSON(s);
  const invalid=[body(rows,{rows:[{questionId:rows[0].id,proposalFingerprint:rows[0].fingerprint,decision:'approve'},{questionId:rows[1].id,proposalFingerprint:'stale',decision:'approve'}]}),body([rows[0]],{rows:[{questionId:rows[0].id,proposalFingerprint:rows[0].fingerprint,decision:'approve',text:'An altered claim'}]}),body([rows[0],rows[0]]),body(rows,{expectedRevision:3})];
  for(const input of invalid){await assert.rejects(submit(s,input));assert.equal(canonicalJSON(s),before);}
});

test('a conflict found after a valid row still rolls back every document, fact and approval in the batch',async()=>{
  const s=await fixture(['Prepare monthly cash reports','Use SQL']),rows=buildExperienceReviewRows(s);
  addDocument(s,{id:'old-negative',kind:'answer',title:'Earlier user statement',hash:'old-negative',segments:[{id:'old-negative.p1',text:'I have not used SQL.'}]});
  const [negative]=await proposeFacts(s,[{category:'experience_claims',field:'sql',scope:'Example Employer',statement:'I have not used SQL.',evidence:[{documentId:'old-negative',segmentId:'old-negative.p1',quote:'I have not used SQL.'}]}],'user_answer');
  decideFacts(s,[{id:negative.id,version:1,decision:'approved'}],'synthetic-owner');
  const fresh=buildExperienceReviewRows(s),cash=fresh.find(row=>row.proposedStatement.startsWith('Prepare')),sql=fresh.find(row=>row.proposedStatement==='Use SQL');assert.ok(sql);
  const before=canonicalJSON(s);
  await assert.rejects(submit(s,body([cash,sql],{rows:[{questionId:cash.id,proposalFingerprint:cash.fingerprint,decision:'approve'},{questionId:sql.id,proposalFingerprint:sql.fingerprint,decision:'somewhat',text:'I used SQL.'}]})),error=>error.status===409&&/conflicts/.test(error.message));
  assert.equal(canonicalJSON(s),before);assert.equal(approvedFacts(s).some(f=>f.id===negative.id),true);
});

test('generic qualifications stay inline for details while exact credentials do not invent institution or date',async()=>{
  const s=await fixture([{text:'Relevant professional qualification',category:'qualification'}]),row=buildExperienceReviewRows(s)[0],facts=s.facts.length;
  const pending=await submit(s,body([row]));assert.equal(pending.needsDetailsCount,1);assert.equal(s.facts.length,facts);
  assert.equal(buildExperienceReviewRows(s).find(item=>item.id===row.id).status,'needs_details');
  const current=buildExperienceReviewRows(s).find(item=>item.id===row.id),result=await submit(s,body([current],{submissionId:'experience-submit-002',rows:[{questionId:current.id,proposalFingerprint:current.fingerprint,decision:'somewhat',text:'CFA Level I passed'}]}));
  assert.equal(result.approvedCount,1);const fact=s.facts.find(f=>f.experienceRowId===row.id);assert.equal(fact.category,'certifications');assert.equal(fact.statement,'CFA Level I passed');assert.equal(fact.approval,'approved');
  assert.ok(!fact.statement.includes('2026'));assert.ok(!fact.statement.includes('Example Employer'));
});

test('partial evidence is preserved as a missing-scope review rather than treated as full support',async()=>{
  const s=await fixture(['Prepared reports and supervised analysts']),requirement=s.requirements[0];
  await buildProfiles(s,{profiles:[],mappings:[{requirementId:requirement.id,factIds:[s.facts[0].id],evidenceStatus:'partial',missingScope:'supervised analysts',proposedStatement:'supervised analysts',explanation:'Reporting is supported; supervision is not established.'}],questions:[]},'analysis');
  const mapping=s.builderReviews.at(-1).mappings[0];assert.equal(mapping.assessment,'partial_support');assert.equal(mapping.evidenceStatus,'partial');assert.equal(mapping.missingScope,'supervised analysts');
  assert.equal(s.builderReviews.at(-1).supported,0);assert.equal(s.questions.find(q=>(q.requirementIds||[]).includes(requirement.id)).coveredByApprovedFacts,false);
  const rows=buildExperienceReviewRows(s);assert.equal(rows.length,1);assert.equal(rows[0].proposedStatement,'supervised analysts');assert.equal(rows[0].coverage,'partial');
});

test('Fact metadata is bounded and retained without inventing record associations',async()=>{
  const s=emptyProfile();addDocument(s,{id:'r',kind:'resume',title:'Source',hash:'r',segments:[{id:'r.p1',text:'Prepared reports'}]});
  const [fact]=await proposeFacts(s,[{category:'experience_claims',field:'duties',scope:'explicit scope',statement:'Prepared reports',experienceArea:'Reporting',employerRole:'A'.repeat(250),recordScope:'Stated division',evidence:[{documentId:'r',segmentId:'r.p1',quote:'Prepared reports'}]}]);
  assert.equal(fact.experienceArea,'Reporting');assert.equal(fact.employerRole.length,200);assert.equal(fact.recordScope,'Stated division');
});

test('a shared confirmation document keeps each approved row bound to its own source segment',async()=>{
  const s=await fixture(['Prepare monthly cash reports','Reconcile cash balances']),result=await submit(s,body(buildExperienceReviewRows(s)));
  assert.equal(result.approvedCount,2);const answers=s.answers.filter(answer=>answer.submissionId==='experience-submit-001');
  assert.equal(new Set(answers.map(answer=>answer.documentId)).size,1);assert.equal(new Set(answers.map(answer=>answer.sourceSegmentId)).size,2);
  for(const answer of answers){const outcome=result.rows.find(row=>row.answerId===answer.id),fact=s.facts.find(item=>item.id===outcome.factRefs[0].id);assert.equal(outcome.sourceSegmentId,answer.sourceSegmentId);assert.equal(fact.evidence[0].segmentId,answer.sourceSegmentId);assert.equal(fact.evidence[0].quote,answer.text);}
});

test('explicitly incomplete or known omitted Fact passages block complete profile saving',async()=>{
  const s=await fixture(),document=s.documents.find(d=>d.id==='resume');
  for(const values of [{analysis:'incomplete'},{analysis:'complete',coverage:{unreviewedPassages:['resume.p1']}},{analysis:'complete',coverage:{unreferencedPassages:['resume.p1']}}]){
    delete document.coverage;Object.assign(document,values);
    assert.ok(finalizationReadiness(s).blockers.some(blocker=>blocker.code==='source_review_incomplete'&&blocker.documentId===document.id));
  }
  document.analysis='complete';document.coverage={unreferencedPassages:['resume.p1'],passageReview:[{segmentId:'resume.p1',reason:'A source passage was explicitly classified without a factual claim.'}],unreviewedPassages:[]};
  assert.ok(!finalizationReadiness(s).blockers.some(blocker=>blocker.code==='source_review_incomplete'));
  delete document.coverage;assert.ok(!finalizationReadiness(s).blockers.some(blocker=>blocker.code==='source_review_incomplete'),'bare legacy records without an omissions receipt remain compatible');
});

test('a listed skill cannot be reused as an explicitly confirmed qualification',async()=>{
  const s=await fixture([{text:'CFA Level I passed',category:'qualification'}]);
  addDocument(s,{id:'skills',kind:'resume',title:'Listed skill only',hash:'skills',segments:[{id:'skills.p1',text:'CFA Level I passed'}]});
  const [skill]=await proposeFacts(s,[{category:'skills',field:'skills',scope:'Example Employer',statement:'CFA Level I passed',evidence:[{documentId:'skills',segmentId:'skills.p1',quote:'CFA Level I passed'}]}]);
  decideFacts(s,[{id:skill.id,version:1,decision:'approved'}],'synthetic-owner');
  const row=buildExperienceReviewRows(s).find(item=>item.proposedStatement==='CFA Level I passed');assert.ok(row);
  const original=structuredClone(skill),result=await submit(s,body([row]));assert.equal(result.reusedCount,0);
  const credential=s.facts.find(f=>f.experienceRowId===row.id);assert.ok(credential);assert.equal(credential.category,'certifications');assert.notEqual(credential.id,skill.id);
  assert.deepEqual(s.facts.find(f=>f.id===skill.id),original);assert.equal(credential.evidence[0].quote,'CFA Level I passed');
});

test('missing evidence status cannot become full support merely because related facts are cited',async()=>{
  const s=await fixture(['Prepared reports and supervised analysts']),requirement=s.requirements[0];
  await buildProfiles(s,{mappings:[{requirementId:requirement.id,factIds:[s.facts[0].id],evidenceStatus:'missing',explanation:'A related reporting fact does not establish supervision.'}],questions:[]},'analysis');
  const mapping=s.builderReviews.at(-1).mappings[0];assert.equal(mapping.evidenceStatus,'not_established');assert.equal(mapping.assessment,'not_established');assert.equal(s.builderReviews.at(-1).supported,0);
  assert.equal(s.questions.find(q=>(q.requirementIds||[]).includes(requirement.id)).coveredByApprovedFacts,false);
  const before=canonicalJSON(s);
  await assert.rejects(buildProfiles(s,{mappings:[{requirementId:requirement.id,factIds:[s.facts[0].id],evidenceStatus:'partial',explanation:'An unspecified partial match.'}],questions:[]},'analysis'),/exact unsupported scope/);
  assert.equal(canonicalJSON(s),before);
});

test('saved review scope binds exact inline text, proof segment and reused fact versions',async()=>{
  const s=await fixture(),row=buildExperienceReviewRows(s)[0];
  await submit(s,body([row],{rows:[{questionId:row.id,proposalFingerprint:row.fingerprint,decision:'somewhat',text:'Prepared reports'}]}));
  await buildProfiles(s,{mappings:s.requirements.map(requirement=>({requirementId:requirement.id,factIds:[],evidenceStatus:'not_established',explanation:'The narrower confirmed statement does not establish the full JD scope.'})),questions:[]},'analysis');
  const snapshot=finalize(s,'synthetic-owner'),binding=snapshot.reviewScope.answerRefs.find(ref=>ref.experienceDecision==='somewhat');
  assert.equal(binding.text,'Prepared reports');assert.equal(binding.sourceText,'Prepared reports');assert.ok(binding.sourceSegmentId);assert.equal(binding.confirmedFactRefs[0].id,s.facts[0].id);
  assert.equal(savedPacket(s).snapshot.id,snapshot.id);
  const changed=structuredClone(s),answer=changed.answers.find(item=>item.id===binding.id);answer.text='A broader unsupported statement';
  assert.throws(()=>savedPacket(changed),/save it again/);
  const corrupted=structuredClone(s),source=corrupted.documents.find(document=>document.id===binding.documentId).segments.find(segment=>segment.id===binding.sourceSegmentId);source.text='A different source statement';
  assert.throws(()=>savedPacket(corrupted),/save it again/);
});

test('generic equivalent experience does not become an invented degree or certification',async()=>{
  const s=await fixture([{text:"Master's degree or equivalent experience",category:'qualification'}]),row=buildExperienceReviewRows(s)[0],before=s.facts.length;
  const result=await submit(s,body([row],{rows:[{questionId:row.id,proposalFingerprint:row.fingerprint,decision:'somewhat',text:'Equivalent experience in statistics'}]}));
  assert.equal(result.needsDetailsCount,1);assert.equal(s.facts.length,before);assert.deepEqual(result.rows[0].factRefs,[]);
  assert.equal(s.answers.at(-1).status,'needs_details');assert.ok(!s.facts.some(f=>['education','certifications'].includes(f.category)));
});

test('specific performed work supplied for a credential alternative remains Section 2 work, not a qualification',async()=>{
  const s=await fixture([{text:"Master's degree or equivalent experience",category:'qualification'}]),row=buildExperienceReviewRows(s)[0],statement='Prepared statistical models for research projects';
  const result=await submit(s,body([row],{rows:[{questionId:row.id,proposalFingerprint:row.fingerprint,decision:'somewhat',text:statement}]}));
  assert.equal(result.approvedCount,1);assert.equal(result.rows[0].destinationSection,'cumulativeExperience');
  const fact=s.facts.find(item=>item.id===result.rows[0].factRefs[0].id);assert.equal(fact.category,'experience_claims');assert.equal(fact.statement,statement);assert.equal(fact.approval,'approved');
  assert.deepEqual(fact.originatingRequirements,row.requirementIds);assert.ok(!s.facts.some(f=>['education','certifications'].includes(f.category)));
  assert.ok(finalizationReadiness(s).blockers.some(blocker=>blocker.code==='builder_comparison_required'),'qualification equivalence is assessed separately after this exact work is confirmed');
});

test('an invisible legacy question does not block a capability plainly established by approved source data',async()=>{
  const s=await fixture(['Prepare monthly cash reports']);assert.ok(finalizationReadiness(s).blockers.some(blocker=>blocker.code==='question_response_required'));
  addDocument(s,{id:'known-work',kind:'answer',title:'Explicit approved work',hash:'known-work',segments:[{id:'known-work.p1',text:'Prepare monthly cash reports'}]});s.documents.at(-1).analysis='complete';
  const [fact]=await proposeFacts(s,[{category:'experience_claims',field:'duties',scope:'Example Employer',statement:'Prepare monthly cash reports',evidence:[{documentId:'known-work',segmentId:'known-work.p1',quote:'Prepare monthly cash reports'}]}],'user_answer');
  decideFacts(s,[{id:fact.id,version:1,decision:'approved'}],'synthetic-owner');
  await buildProfiles(s,{mappings:s.requirements.map(requirement=>({requirementId:requirement.id,factIds:[],evidenceStatus:'not_established',explanation:'A stale conservative model assessment.'})),questions:[]},'analysis');
  assert.equal(s.questions[0].status,'unresolved');assert.equal(s.questions[0].coveredByApprovedFacts,false);assert.deepEqual(buildExperienceReviewRows(s),[]);
  assert.equal(finalizationReadiness(s).ready,true,'the current complete comparison exists and the hidden legacy question adds no extra gate');
});

test('durable Decline history for an identical new JD row does not create an invisible required-question blocker',async()=>{
  const s=await fixture(),oldRow=buildExperienceReviewRows(s)[0];await submit(s,body([oldRow],{rows:[{questionId:oldRow.id,proposalFingerprint:oldRow.fingerprint,decision:'decline'}]}));
  s.documents.find(d=>d.id==='jd0').selected=false;
  addDocument(s,{id:'later-jd',kind:'jd',title:'Later opening',hash:'later-jd',selected:true,segments:[{id:'later-jd.p1',text:'New employer: Prepare monthly cash reports'}]});
  await addJDAnalysis(s,'later-jd',{roleName:'Later opening',requirements:[{category:'task',text:'Prepare monthly cash reports',importance:'required',evidence:[{documentId:'later-jd',segmentId:'later-jd.p1',quote:'Prepare monthly cash reports'}]}]});
  await buildProfiles(s,{mappings:s.requirements.filter(requirement=>requirement.documentId==='later-jd').map(requirement=>({requirementId:requirement.id,factIds:[],evidenceStatus:'not_established',explanation:'The user previously declined this exact capability.'})),questions:[]},'analysis');
  const row=buildExperienceReviewRows(s)[0];assert.equal(row.status,'declined');
  const parent=s.questions.find(q=>(q.requirementIds||[]).includes(row.requirementIds[0]));parent.status='unresolved';parent.coveredByApprovedFacts=false;
  assert.equal(finalizationReadiness(s).ready,true);assert.ok(!finalizationReadiness(s).blockers.some(blocker=>blocker.code==='question_response_required'));
});

test('a simple approved tool becomes a Section 1 skill without implying a project or work activity',async()=>{
  const s=await fixture([{text:'Python',category:'skill'}]),row=buildExperienceReviewRows(s)[0];
  assert.equal(row.destinationSection,'facts');assert.equal(row.kind,'skill');
  const result=await submit(s,body([row])),fact=s.facts.find(item=>item.id===result.rows[0].factRefs[0].id);
  assert.equal(fact.category,'skills');assert.equal(fact.statement,'Python');assert.equal(result.rows[0].destinationSection,'facts');
  assert.equal(s.facts.filter(item=>item.origin==='user_answer'&&item.category==='experience_claims').length,0);
});

test('old JD analyses containing filtered AI summaries must be re-read before a validated save',async()=>{
  const s=await fixture();const document=s.documents.find(d=>d.id==='jd0');
  document.segments.unshift({id:'jd0.ai',text:'AI Summary\nInvented proprietary investment expertise'});document.segments.push({id:'jd0.real',text:'Job description\nPrepare monthly cash reports'});
  const readiness=finalizationReadiness(s);assert.ok(readiness.blockers.some(blocker=>blocker.code==='selected_jd_analysis_pending'&&blocker.documentId===document.id));
  document.sourceFilteringVersion=1;assert.ok(!finalizationReadiness(s).blockers.some(blocker=>blocker.code==='selected_jd_analysis_pending'));
});
