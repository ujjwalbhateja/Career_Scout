import test from 'node:test';
import assert from 'node:assert/strict';
import {expandRoles,suggestRoleKeywords,locationAssessment,rankJob} from '../lib/matching.mjs';

const job=(extra={})=>({title:'Portfolio Analyst',company:'Example',location:'New York, NY, US',description:'Analyze portfolio performance using Python and SQL.',seniority:'unknown',arrangement:'hybrid',employment:'full-time',salary:{min:null,max:null,currency:'',period:''},sponsorship:{status:'unknown'},...extra});
const criteria=(extra={})=>({roles:'Portfolio Analyst',mode:'related',location:'USA',includeUnknown:true,...extra});

test('exact, related and broad expansions are distinct and bounded',()=>{
  assert.deepEqual(expandRoles(criteria({mode:'exact'})),[{term:'Portfolio Analyst',kind:'exact'}]);
  assert.ok(expandRoles(criteria()).some(x=>x.term==='portfolio insights analyst'));
  assert.ok(expandRoles(criteria({roles:'portfolio analytics'})).some(x=>x.term==='portfolio analyst'));
  assert.ok(!expandRoles(criteria()).some(x=>x.term==='portfolio manager'));
  assert.ok(expandRoles(criteria({mode:'broad'})).some(x=>x.term==='portfolio manager'&&x.kind==='broad'));
  assert.ok(expandRoles({roles:Array.from({length:20},(_,i)=>`role ${i}`).join(',')}).length<=12);
});
test('editing related terms can remove every suggestion and arbitrary roles work',()=>{
  assert.deepEqual(expandRoles(criteria({relatedKeywords:''})),[{term:'Portfolio Analyst',kind:'exact'}]);
  assert.equal(expandRoles(criteria({relatedKeywords:'Fund Reporting Specialist'}))[1].term,'Fund Reporting Specialist');
  assert.equal(rankJob(job({title:'Marine Biologist'}),criteria({roles:'Marine Biologist'})).match,true);
  assert.equal(suggestRoleKeywords({roles:'Marine Biologist'}).length,0);
});
test('curated expansion is domain scoped and custom terms are explicit',()=>{
  assert.ok(suggestRoleKeywords({roles:'data engineer'}).some(x=>x.term==='ETL developer'));
  assert.ok(suggestRoleKeywords({roles:'registered nurse'}).some(x=>x.term==='RN'));
  assert.equal(rankJob(job({title:'IT Portfolio Manager',description:'Manage technology initiatives.'}),criteria({mode:'broad'})).match,false);
  assert.equal(rankJob(job({title:'IT Portfolio Manager',description:'Manage technology initiatives.'}),criteria({mode:'broad',relatedKeywords:'IT Portfolio Manager'})).match,true);
});
test('US aliases and city-state formats normalize without substring matches',()=>{
  for(const location of ['United States','USA','U.S.','U.S.A.','New York, NY','Austin, TX','Chicago, Illinois','Boston, MA, US'])assert.equal(locationAssessment(location,'hybrid','USA').match,true,location);
  for(const location of ['Australia','Toronto, Canada','Toronto, CA','London, United Kingdom'])assert.equal(locationAssessment(location,'remote','US').match,false,location);
  assert.equal(locationAssessment('Birmingham, Alabama','on-site','US').match,true);
});
test('remote eligibility honors explicit geographic restrictions',()=>{
  for(const location of ['Remote - Canada only','Worldwide, Europe only','Worldwide except US','Worldwide, excluding the United States','United States excluded; remote worldwide'])assert.equal(locationAssessment(location,'remote','USA').match,false,location);
  assert.deepEqual(locationAssessment('Remote','remote','USA'),{match:true,unknown:true,reason:'Location eligibility not stated'});
  assert.equal(locationAssessment('Worldwide','remote','USA').unknown,true);
  assert.equal(locationAssessment('Remote - United States','remote','USA').unknown,false);
  assert.equal(locationAssessment('Worldwide excluding Canada','remote','USA').match,true);
  assert.equal(locationAssessment('Worldwide excluding Canada','remote','Canada').match,false);
});
test('city qualifiers do not broaden to the entire country; location alternatives work',()=>{
  assert.equal(locationAssessment('Chicago, IL, US','on-site','New York, USA').match,false);
  assert.equal(locationAssessment('New York, NY, US','on-site','NYC').match,true);
  assert.equal(locationAssessment('Boston, MA','hybrid','New York, Boston').match,true);
  assert.equal(locationAssessment('Toronto, Canada','hybrid','US, Canada').match,true);
});
test('exact titles rank above related titles, then broader titles and descriptions',()=>{
  const c=criteria({mode:'broad'});
  const exact=rankJob(job(),c), related=rankJob(job({title:'Portfolio Insights Analyst'}),c), broad=rankJob(job({title:'Portfolio Manager'}),c), description=rankJob(job({title:'Financial Operations Specialist',description:'Experience as a portfolio analyst is useful.'}),c);
  assert.ok(exact.score>related.score&&related.score>broad.score&&broad.score>description.score);
  assert.equal(exact.matchKind,'exact');assert.equal(related.matchKind,'related');assert.equal(broad.matchKind,'broad');assert.equal(description.matchKind,'description');
  assert.equal(rankJob(job({title:'Financial Operations Specialist',description:'Experience as a portfolio analyst is useful.'}),{...c,searchDescriptions:false}).match,false);
});
test('required phrases use ALL, excluded phrases use ANY and token boundaries',()=>{
  assert.equal(rankJob(job(),criteria({requiredKeywords:'Python, SQL'})).match,true);
  assert.equal(rankJob(job(),criteria({requiredKeywords:'Python, Tableau'})).match,false);
  assert.equal(rankJob(job(),criteria({excludedKeywords:'sales, SQL'})).match,false);
  assert.equal(rankJob(job({description:'Analyze portfolio performance with Salesforce.'}),criteria({excludedKeywords:'sales'})).match,true);
});
test('plural tokens and cautious typo handling preserve domain words',()=>{
  assert.equal(rankJob(job({title:'Senior Portfolio Analysts'}),criteria()).match,true);
  assert.equal(rankJob(job(),criteria({roles:'Portfolio Analist'})).match,true);
  assert.equal(rankJob(job(),criteria({roles:'Portfolio Analist',mode:'exact'})).match,false);
  assert.equal(rankJob(job({title:'Account Executive — Engineered Arts',description:'Sell products.'}),criteria({roles:'engineer',location:''})).match,false);
});
test('missing filters, mismatched pay units and sponsorship preserve explicit unknowns',()=>{
  assert.equal(rankJob(job(),criteria({seniority:'senior',includeUnknown:false})).match,false);
  assert.equal(rankJob(job(),criteria({seniority:'senior'})).match,true);
  const alternatePay=job({salary:{min:100000,max:150000,currency:'EUR',period:'year'}});
  const assessment=rankJob(alternatePay,criteria({minSalary:100000,currency:'USD',period:'year'}));
  assert.equal(assessment.match,true);assert.ok(assessment.unknowns.includes('Pay uses a different currency or period'));
  assert.equal(rankJob(job({sponsorship:{status:'no'}}),criteria({preferSponsorship:true})).match,true);
  assert.equal(rankJob(job({arrangement:'on-site'}),criteria({arrangement:'remote'})).match,false);
});
test('posting age uses employer posting date, never retrieval/index date',()=>{
  assert.ok(rankJob(job({postedAt:null,indexedAt:new Date().toISOString()}),criteria({maxAge:7})).unknowns.includes('Posting date not stated'));
  assert.equal(rankJob(job({postedAt:'2020-01-01T00:00:00Z'}),criteria({maxAge:7})).match,false);
});
