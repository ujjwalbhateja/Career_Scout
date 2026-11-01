import test from 'node:test';
import assert from 'node:assert/strict';
import {buildExperienceReviewRows,normalizeRequirementAssessment,splitRequirementAtoms} from '../lib/profile/experience-review.mjs';

function fixture(){
  const state={documents:[],facts:[],approvals:[],questions:[],answers:[],experienceReviews:[],requirements:[],roleProfiles:[],builderReviews:[]};
  const fact=(statement,{id='f'+state.facts.length,category='skills',origin='resume'}={})=>{
    const documentId='source-'+id,segmentId=documentId+'.1',approvalRef='approval-'+id;
    state.documents.push({id:documentId,kind:origin==='user_answer'?'answer':'resume',segments:[{id:segmentId,text:statement}]});
    const value={id,version:1,category,field:'capability',statement,origin,lifecycle:'active',approval:'approved',approvalRef,evidence:[{documentId,segmentId,quote:statement}]};state.facts.push(value);state.approvals.push({id:approvalRef,kind:'fact',recordId:id,recordVersion:1,decision:'approved'});return value;
  };
  const req=(statement,{id='r'+state.requirements.length,documentId='jd1',category='task',questionId='q-'+id,mapping={}}={})=>{
    let document=state.documents.find(d=>d.id===documentId);if(!document){document={id:documentId,kind:'jd',selected:true,version:1,hash:'hash-'+documentId,title:documentId,analysis:'complete',segments:[]};state.documents.push(document);}
    const segmentId=documentId+'.'+id;document.segments.push({id:segmentId,text:statement});
    const requirement={id,documentId,text:statement,category,importance:'required',evidence:[{documentId,segmentId,quote:statement}]};state.requirements.push(requirement);state.questions.push({id:questionId,requirementId:id,requirementIds:[id],capability:statement,status:'unresolved'});
    const review=state.builderReviews[0]||(state.builderReviews[0]={id:'review',jdIds:[],mappings:[]});review.jdIds=[...new Set([...review.jdIds,documentId])];review.mappings.push({requirementId:id,factRefs:[],evidenceStatus:'not_established',explanation:'Missing evidence',...mapping});return requirement;
  };
  return {state,fact,req};
}

test('all approved Section 2 sources are reused, including previously confirmed answer skills and experience',()=>{
  const {state,fact,req}=fixture();fact('Financial reporting',{category:'experience_claims',origin:'user_answer'});fact('Power Query',{origin:'user_answer'});
  req('Financial reporting');req('Power Query',{category:'skill'});assert.deepEqual(buildExperienceReviewRows(state),[]);
});

test('simple established skills are not re-asked while advanced scope remains a separate gap',()=>{
  const {state,fact,req}=fixture();fact('Excel');req('Excel skills',{category:'skill'});req('Advanced Excel automation',{category:'skill'});
  const rows=buildExperienceReviewRows(state);assert.equal(rows.length,1);assert.equal(rows[0].proposedStatement,'Advanced Excel automation');
});

test('partial mappings expose only an exact unsupported source portion and preserve supported refs',()=>{
  const {state,fact,req}=fixture(),excel=fact('Excel');req('Excel and Power Query',{category:'skill',mapping:{factRefs:[{id:excel.id,version:1}],evidenceStatus:'partial',missingScope:'Power Query',proposedStatement:'Power Query'}});
  const rows=buildExperienceReviewRows(state);assert.equal(rows.length,1);assert.equal(rows[0].coverage,'partial');assert.equal(rows[0].proposedStatement,'Power Query');assert.equal(rows[0].approvedFactRefs[0].id,excel.id);assert.equal(rows[0].destinationSection,'facts');assert.equal(rows[0].kind,'skill');
});

test('compound missing skills become distinct atomic rows and cannot share an approval identifier',()=>{
  const {state,req}=fixture();req('Excel and SQL',{category:'skill'});
  const rows=buildExperienceReviewRows(state);assert.deepEqual(rows.map(r=>r.proposedStatement).sort(),['Excel','SQL']);assert.equal(new Set(rows.map(r=>r.id)).size,2);assert.ok(rows.every(r=>r.id.includes('::part-')));assert.deepEqual(rows[0].parentQuestionIds,['q-r0']);
});

test('a repeated capability is reviewed once across selected JDs with every source retained',()=>{
  const {state,req}=fixture();req('Financial reporting',{documentId:'jd1'});req('Financial reporting',{documentId:'jd2'});
  const rows=buildExperienceReviewRows(state);assert.equal(rows.length,1);assert.equal(rows[0].jdCount,2);assert.equal(rows[0].sourceQuotes.length,2);assert.equal(rows[0].requirementIds.length,2);
  state.documents.find(d=>d.id==='jd2').selected=false;state.builderReviews[0].jdIds=['jd1'];assert.equal(buildExperienceReviewRows(state)[0].jdCount,1);
});

test('a shared existing question still receives separate row IDs for different capabilities',()=>{
  const {state,req}=fixture();req('Python',{category:'skill',questionId:'shared'});req('SQL',{category:'skill',questionId:'shared'});
  const rows=buildExperienceReviewRows(state);assert.equal(new Set(rows.map(r=>r.id)).size,2);
});

test('shared-noun and shared-qualifier constructs never become unsupported fragment assertions',()=>{
  assert.deepEqual(splitRequirementAtoms('Manage market and liquidity risk'),['Manage market and liquidity risk']);
  assert.deepEqual(splitRequirementAtoms('Five years of SQL and Python experience'),['Five years of SQL and Python experience']);
  const {state,req}=fixture();req('Five years of SQL and Python experience',{category:'experience'});const row=buildExperienceReviewRows(state)[0];assert.equal(row.kind,'ambiguous');assert.equal(row.requiresDetails,true);
});

test('credentials and vague alternatives route to Facts or require exact inline details',()=>{
  const {state,req}=fixture();req('Bachelor degree in Finance',{category:'qualification'});req('Relevant experience',{category:'experience'});req('Python or R',{category:'skill'});
  const rows=buildExperienceReviewRows(state),degree=rows.find(r=>r.proposedStatement.startsWith('Bachelor'));
  assert.equal(degree.kind,'qualification');assert.equal(degree.destinationSection,'facts');assert.equal(rows.find(r=>r.proposedStatement==='Relevant experience').requiresDetails,true);assert.equal(rows.find(r=>r.proposedStatement==='Python or R').requiresDetails,true);
});

test('explicit supported semantic assessment suppresses a re-ask without needing a literal resume match',()=>{
  const {state,fact,req}=fixture(),approved=fact('Prepared regulatory packages',{category:'experience_claims',origin:'user_answer'});
  req('Financial reporting',{mapping:{factRefs:[{id:approved.id,version:1}],evidenceStatus:'supported'}});assert.deepEqual(buildExperienceReviewRows(state),[]);
});

test('negated facts cannot prove a positive skill even if an earlier mapping cites them',()=>{
  const {state,fact,req}=fixture(),negative=fact('I never used SQL');req('SQL',{category:'skill',mapping:{factRefs:[{id:negative.id,version:1}],evidenceStatus:'supported'}});
  assert.equal(buildExperienceReviewRows(state).length,1);
});

test('a listed skill cannot establish completion of a qualification or credential',()=>{
  const {state,fact,req}=fixture(),cfa=fact('CFA Level I');fact('MBA');req('CFA Level I',{category:'qualification',mapping:{factRefs:[{id:cfa.id,version:1}],evidenceStatus:'supported'}});req('MBA',{category:'qualification'});
  assert.equal(buildExperienceReviewRows(state).length,2);
  fact('Completed CFA Level I',{id:'credential',category:'certifications'});assert.deepEqual(buildExperienceReviewRows(state).map(row=>row.proposedStatement),['MBA']);
});

test('proposal fields are bounded exact JD spans and unknown fact IDs or fabricated metrics fail',()=>{
  const requirement={id:'r',text:'Portfolio reporting and client communication',evidence:[{quote:'Portfolio reporting and client communication'}]},facts=[{id:'f',category:'skills',approval:'approved'}];
  assert.equal(normalizeRequirementAssessment(requirement,{factIds:['f'],evidenceStatus:'partial',missingScope:'client communication',proposedStatement:'client communication',explanation:'Partial'},facts).missingScope,'client communication');
  assert.throws(()=>normalizeRequirementAssessment(requirement,{factIds:['foreign'],explanation:''},facts),/outside/);
  assert.throws(()=>normalizeRequirementAssessment(requirement,{factIds:[],proposedStatement:'Managed a $5 million portfolio',explanation:''},facts),/outside the quoted/);
  assert.throws(()=>normalizeRequirementAssessment(requirement,{factIds:[],evidenceStatus:'supported',explanation:''},facts),/needs approved/);
});

test('fingerprints are stable under key reorder, bind the exact proposal and do not repeat unrelated facts',()=>{
  const {state,fact,req}=fixture();for(let i=0;i<100;i++)fact('Unrelated capability '+i,{id:'unrelated-'+i});req('Client reporting');
  const row=buildExperienceReviewRows(state)[0],reordered=JSON.parse(JSON.stringify(state),(key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value);
  assert.equal(buildExperienceReviewRows(reordered)[0].fingerprint,row.fingerprint);assert.ok(row.fingerprint.length<1200);assert.ok(!row.fingerprint.includes('unrelated-'));
  state.documents.find(d=>d.id==='jd1').hash='changed';assert.notEqual(buildExperienceReviewRows(state)[0].fingerprint,row.fingerprint);
});

test('saved decline and needs-details history remain explicit, with no automatic affirmative decision',()=>{
  const {state,req}=fixture();req('Relevant experience');const row=buildExperienceReviewRows(state)[0];assert.equal(row.status,'pending');
  state.experienceReviews.push({rows:[{questionId:row.id,proposalFingerprint:row.fingerprint,decision:'approve',status:'needs_details'}]});assert.equal(buildExperienceReviewRows(state)[0].status,'needs_details');
  state.answers.push({id:'a',experienceRowId:row.id,proposalFingerprint:row.fingerprint,experienceDecision:'decline',status:'declined'});assert.equal(buildExperienceReviewRows(state)[0].status,'declined');
});

test('an exact declined capability stays declined when a later JD supplies new requirement and source IDs',()=>{
  const {state,req}=fixture();req('Client reporting');const previous=buildExperienceReviewRows(state)[0];
  state.experienceReviews.push({rows:[{questionId:previous.id,proposalFingerprint:previous.fingerprint,decision:'decline',status:'declined'}]});
  state.documents.find(d=>d.id==='jd1').selected=false;req('Client reporting',{documentId:'new-jd'});state.builderReviews.push({jdIds:['new-jd'],mappings:[]});
  const current=buildExperienceReviewRows(state)[0];assert.notEqual(current.id,previous.id);assert.notEqual(current.fingerprint,previous.fingerprint);assert.equal(current.status,'declined');
});

test('Somewhat retains the exact saved narrower statement across future identical JD capabilities',()=>{
  const {state,req}=fixture();req('Manage global fund reporting');const previous=buildExperienceReviewRows(state)[0];
  state.answers.push({id:'answer',experienceRowId:previous.id,proposalFingerprint:previous.fingerprint,experienceDecision:'somewhat',status:'answered',text:'Prepared domestic fund reports'});
  state.documents.find(d=>d.id==='jd1').selected=false;req('Manage global fund reporting',{documentId:'later-jd'});state.builderReviews.push({jdIds:['later-jd'],mappings:[]});
  const row=buildExperienceReviewRows(state)[0];assert.equal(row.status,'somewhat');assert.equal(row.decision.statement,'Prepared domestic fund reports');
});

test('legacy negative questions suppress only an exact literal capability, not a wider topic or degree fragment',()=>{
  const {state,req}=fixture();req('SQL',{category:'skill'});req('Bachelor degree in Finance',{category:'qualification'});
  state.questions.push({id:'old-sql',capability:'SQL',status:'not_experienced'},{id:'old-degree',capability:'degree',status:'declined'});
  const rows=buildExperienceReviewRows(state);assert.equal(rows.find(r=>r.proposedStatement==='SQL').status,'declined');assert.equal(rows.find(r=>r.proposedStatement.startsWith('Bachelor')).status,'pending');
});

test('disclosure preferences suppress protected topics without generating replacement synthetic rows',()=>{
  const {state,req}=fixture();req('Client relationship management');req('Python',{category:'skill'});state.questions=[];
  state.preferences={disclosure:['client relationships']};
  const rows=buildExperienceReviewRows(state);assert.deepEqual(rows.map(row=>row.proposedStatement),['Python']);
});

test('old AI-summary-derived requirements are not actionable review proposals before reanalysis',()=>{
  const {state,req}=fixture();req('Quantum architecture',{id:'ai'});req('Prepare client reports',{id:'real'});
  const doc=state.documents.find(document=>document.id==='jd1');doc.segments=[{id:'ai-header',text:'AI Summary'},doc.segments[0],{id:'primary-heading',text:'Full Job Description'},doc.segments[1]];
  const rows=buildExperienceReviewRows(state);assert.deepEqual(rows.map(row=>row.proposedStatement),['Prepare client reports']);
});

test('a previously narrowed requirement retains Somewhat history when only its literal remainder is reviewed later',()=>{
  const {state,req}=fixture();const original=req('Manage global fund reporting');const previous=buildExperienceReviewRows(state)[0];
  state.experienceReviews.push({rows:[{questionId:previous.id,proposalFingerprint:previous.fingerprint,decision:'somewhat',status:'somewhat',statement:'Prepared domestic fund reports',requirementIds:[original.id]}]});
  state.documents.find(document=>document.id==='jd1').selected=false;req('Manage global fund reporting',{documentId:'later',mapping:{missingScope:'global fund reporting'}});state.builderReviews.push({jdIds:['later'],mappings:[{requirementId:'r1',factRefs:[],evidenceStatus:'not_established',missingScope:'global fund reporting'}]});
  const row=buildExperienceReviewRows(state)[0];assert.equal(row.proposedStatement,'global fund reporting');assert.equal(row.status,'somewhat');assert.equal(row.decision.statement,'Prepared domestic fund reports');
  state.requirements.find(requirement=>requirement.id==='r1').text='Manage global fund reporting for a different unrelated requirement';assert.equal(buildExperienceReviewRows(state)[0].status,'pending');
});

test('standalone tools route to Facts while an explicitly applied work task stays in cumulative experience',()=>{
  const {state,req}=fixture();req('Python',{category:'skill'});req('Use SQL to reconcile portfolio transactions',{category:'skill'});
  const rows=buildExperienceReviewRows(state);assert.equal(rows.find(row=>row.proposedStatement==='Python').destinationSection,'facts');assert.equal(rows.find(row=>row.proposedStatement.startsWith('Use SQL')).destinationSection,'cumulativeExperience');
});

test('a listed tool cannot suppress an applied project when an old mapping incorrectly calls it supported',()=>{
  const {state,fact,req}=fixture(),python=fact('Python');req('Build Python automation projects',{mapping:{factRefs:[{id:python.id,version:1}],evidenceStatus:'supported'}});
  assert.equal(buildExperienceReviewRows(state).length,1);
});
