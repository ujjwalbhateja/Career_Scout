import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceCandidates,evidenceValidationIssues} from '../lib/profile/builder-evidence-validation.mjs';
import {normalizeSourceComparison} from '../lib/profile/builder-source-coverage.mjs';

// Synthetic independent passages; private resume evaluations stay under .local/.
const records=[
  {id:'teams',category:'experience_claims',statement:'Coordinated cross-functional teams to deliver operational projects.'},
  {id:'analytics',category:'experience_claims',statement:'Built portfolio performance dashboards and reporting materials.'},
  {id:'investors',category:'experience_claims',statement:'Delivered investor reporting and investment performance analysis.'},
  {id:'unrelated',category:'skills',statement:'Spreadsheet software'},
];
const text='Partner with cross-functional teams to develop portfolio performance materials for current and prospective investors';
const req={id:'r',text,category:'task',importance:'required',evidence:[{quote:text}]};
const part=(scope,ids,weight=3,critical=false)=>({scope,sourceIds:ids,weight,critical});
const assessment=components=>({atsArea:'Portfolio Performance Reporting',profileCoverage:{relevance:'material',explanation:'Compare recorded capabilities with remaining audience scope.',components}});

test('false zero that acknowledges reporting is rejected before the 75% calculation can drive questions',()=>{
  const result=assessment([part(text,[])]);result.profileCoverage.explanation='The user has experience building reporting tools, but the specific collaborative development of performance materials for prospective investors is not documented.';
  const issues=evidenceValidationIssues(req,result,records);
  assert.ok(issues.some(i=>i.includes('acknowledges')));assert.ok(issues.some(i=>i.includes('compound')));
  const candidates=evidenceCandidates(req,records);assert.deepEqual(new Set(candidates.map(c=>c.sourceId)),new Set(['teams','analytics','investors']));
  assert.ok(candidates.every(c=>!('matched' in c))); // retrieval never establishes support
});
test('separate passages support general collaboration/reporting while the audience remains unconfirmed',()=>{
  const result=assessment([part('Partner with cross-functional teams',['teams']),part('develop portfolio performance materials',['analytics']),part('current',['investors'],1),part('prospective',[],1)]);
  result.evidenceReview={consideredSourceIds:['teams','analytics','investors'],reason:'Team coordination, portfolio dashboards and investor reporting are documented separately; prospective audiences are not established.'};
  assert.deepEqual(evidenceValidationIssues(req,result,records,{reviewRequired:true}),[]);
  const comparison=normalizeSourceComparison(req,result,records);
  assert.equal(comparison.questionPolicy.coveragePercent,87);assert.equal(comparison.questionPolicy.disposition,'skip_minor');
  assert.deepEqual(comparison.missingScopes,['prospective']);assert.equal(comparison.status,'partial');
  assert.equal(records.length,4);
});
test('genuinely missing credential remains a question, with no invented evidence',()=>{
  const text='Hold a mandatory commercial pilot licence',requirement={id:'licence',text,category:'qualification',importance:'required',evidence:[{quote:text}]};
  const result=assessment([part(text,[],3,true)]);result.profileCoverage.explanation='No qualification record establishes this licence.';
  result.evidenceReview={consideredSourceIds:[],reason:'The supplied profile concerns financial reporting, not pilot licensing; no record establishes the credential.'};
  assert.deepEqual(evidenceValidationIssues(requirement,result,records,{reviewRequired:true}),[]);
  const comparison=normalizeSourceComparison(requirement,result,records);assert.equal(comparison.questionPolicy.disposition,'ask');assert.equal(comparison.questionPolicy.coveragePercent,0);
});
test('review cannot omit candidate evidence, invent references, or excuse gaps by phrasing alone',()=>{
  const result=assessment([part(text,[])]);result.profileCoverage.explanation='The exact phrasing is not recorded.';
  result.evidenceReview={consideredSourceIds:['invented'],reason:'Only the exact phrase was checked, not the existing responsibilities.'};
  const issues=evidenceValidationIssues(req,result,records,{reviewRequired:true});
  assert.ok(issues.some(i=>i.includes('Different wording')));assert.ok(issues.some(i=>i.includes('outside')));assert.ok(issues.some(i=>i.includes('candidate passages')));
  const overmatch=assessment([part('develop portfolio performance materials for current and prospective investors',['analytics','investors'])]);
  assert.ok(evidenceValidationIssues(req,overmatch,records).some(i=>i.includes('Separate the prospective')));
});
