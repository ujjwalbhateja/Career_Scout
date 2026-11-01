import test from 'node:test';
import assert from 'node:assert/strict';
import {questionPolicy} from '../lib/profile/builder-question-policy.mjs';
import {normalizeSourceComparison} from '../lib/profile/builder-source-coverage.mjs';
const records=[{id:'work',category:'experience_claims',statement:'Built risk reports.'}];
const requirement=(text,importance='required')=>({id:'r',category:'task',text,importance,evidence:[{quote:text}]});
const component=(scope,weight,matched=false,critical=false)=>({scope,weight,sourceIds:matched?['work']:[],critical});
const score=(r,components,relevance='material')=>questionPolicy(r,{components,relevance},records);
test('75% skips minor gaps but never fills the remaining 25% as fact',()=>{
  const r=requirement('Build risk reports and organize templates');
  const components=[component('Build risk reports',3,true),component('organize templates',1)];
  const p=score(r,components);assert.equal(p.coveragePercent,75);assert.equal(p.disposition,'skip_minor');
  const c=normalizeSourceComparison(r,{atsArea:'Risk Reporting',profileCoverage:{components,relevance:'material',explanation:'Reports recorded; templates not established.'}},records);
  assert.equal(c.status,'partial');assert.deepEqual(c.missingScopes,['organize templates']);assert.equal(c.questionPolicy.disposition,'skip_minor');
});
test('50-74% retains focused questions; below 50% defers only incidental gaps',()=>{
  const r=requirement('Analyze reports, explain results and polish templates');
  assert.equal(score(r,[component('Analyze reports',3,true),component('explain results',1),component('polish templates',1)]).coveragePercent,60);
  assert.equal(score(r,[component('Analyze reports',3,true),component('explain results',1),component('polish templates',1)]).disposition,'ask');
  assert.equal(score(r,[component('Analyze reports',3),component('explain results',1,true)],'incidental').disposition,'defer_incidental');
  assert.equal(score(r,[component('Analyze reports',3),component('explain results',1,true)],'material').disposition,'ask');
});
test('core and critical gaps override 75% and incidental classifications',()=>{
  const r=requirement('Build reports, analyze models, lead research and use Python');
  const base=[component('Build reports',3,true),component('analyze models',3,true),component('lead research',3,true)];
  const p=score(r,[...base,component('use Python',1)],'incidental');assert.equal(p.coveragePercent,90);assert.equal(p.criticalGap,true);assert.equal(p.disposition,'ask');
  assert.equal(score(requirement('Build reports and validate results'),[component('Build reports',3,true),component('validate results',3)]).disposition,'ask');
  const licence=score(requirement('Hold a mandatory licence'),[component('mandatory licence',1)],'incidental');assert.equal(licence.disposition,'ask');
  const assets=score(requirement('Work with all primary asset classes: equities, rates, FX'),[component('equities',3,true),component('rates',3,true),component('FX',1)],'incidental');assert.equal(assets.disposition,'ask');
});
test('invalid evidence, duplicate or overlapping components and invented scores are not accepted',()=>{
  const r=requirement('Build risk reports and explain results');
  assert.throws(()=>score(r,[component('Invented leadership',3,true)]));
  assert.throws(()=>score(r,[component('Build risk reports',3,true),component('risk reports',1,true)]));
  assert.throws(()=>score(r,[component('Build risk reports',3,true),component('Build risk reports',1,true)]));
  assert.throws(()=>score(r,[{...component('Build risk reports',3),sourceIds:['invented']}]));
  assert.throws(()=>score(r,[component('Build risk reports',90,true)]));
  assert.equal(questionPolicy(r,{coveragePercent:100},records),null);
});

test('ordinary investor reporting does not prove a prospective audience; explicit evidence can',()=>{
  const r=requirement('Partner with teams to develop performance materials for current and prospective investors');
  const components=[component('Partner with teams',3,true),component('develop performance materials',3,true),component('for current and prospective investors',1,true)];
  const ordinary=[{id:'work',category:'experience_claims',statement:'Partnered with teams to develop investor performance reports.'}];
  const partial=questionPolicy(r,{components,relevance:'material'},ordinary);
  assert.equal(partial.coveragePercent,85);assert.equal(partial.disposition,'skip_minor');assert.equal(partial.components[2].matched,false);
  const explicit=[{...ordinary[0],statement:'Partnered with teams to develop performance reports for current and prospective investors.'}];
  assert.equal(questionPolicy(r,{components,relevance:'material'},explicit).disposition,'covered');
});

test('prospective audience guard does not discard evidence about potential risks',()=>{
  const r=requirement('Analyze potential risks');
  assert.equal(score(r,[component('Analyze potential risks',3,true)]).disposition,'covered');
});
