import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProfessionalExperience} from '../lib/profile/professional-experience.mjs';

function fixture(lines) {
  const document = {id: 'resume', kind: 'resume', version: 1, segments: lines.map((text, i) => ({id: `p${i + 1}`, text}))};
  const state = {documents: [document], facts: [], approvals: []};
  const approve = (category, field, statement, segmentId, quote = statement) => {
    const id = 'fact' + (state.facts.length + 1), approvalRef = 'approval-' + id;
    const fact = {id, version: 1, category, field, scope: 'Example Employer', statement, lifecycle: 'active', approval: 'approved', approvalRef,
      evidence: [{documentId: 'resume', documentVersion: 1, segmentId, quote}], confirmation: 'user_confirmed'};
    state.facts.push(fact); state.approvals.push({id: approvalRef, kind: 'fact', recordId: id, recordVersion: 1, decision: 'approved'}); return fact;
  };
  return {state, document, approve};
}

test('leadership highlight preserves the headcount and client context without attributing client assets personally', () => {
  const passage = 'Manage a team of 7 people serving institutional clients with AUM of $2 billion to improve reporting controls.';
  const {state, approve} = fixture(['PROFESSIONAL EXPERIENCE', 'Example Employer            New York, NY',
    'Reporting Manager           Jan 2020- Dec 2022', passage]);
  approve('quantitative_claims', 'team_size', 'Manages a team of 7 people.', 'p4', 'Manage a team of 7 people');
  const result = buildProfessionalExperience(state), row = result.rows.find(row => /Leadership/.test(row.area));
  assert.equal(row.highlights[0].statement, 'Manage a team of 7 people serving institutional clients');
  assert.equal(row.approvalStatus, 'partial');
  assert.equal(row.items[0].statement, passage);
  assert.equal(row.items[0].sourceRefs[0].quote, passage);
  assert.equal(row.items[0].coveredQuotes[0], 'Manage a team of 7 people');
  assert.ok(!row.highlights[0].statement.includes('$2 billion'));
});

test('private-market highlight retains explicit metrics and keeps the complete purpose/outcome in source details', () => {
  const passage = 'Designed an IRR reporting system for private market clients, incorporating MOIC, DPI, and RVPI to enable granular attribution analysis across investments.';
  const {state} = fixture(['PROFESSIONAL EXPERIENCE', passage]);
  const row = buildProfessionalExperience(state).rows.find(row => /Private-market/.test(row.area));
  assert.equal(row.highlights[0].statement, 'Designed an IRR reporting system for private market clients, incorporating MOIC, DPI, and RVPI');
  assert.equal(row.items[0].statement, passage);
  assert.equal(row.approvalStatus, 'needs_review');
  assert.equal(row.independentlyVerified, false);
});

test('risk appositive can be shortened while trading money ranges and product limits remain unchanged', () => {
  const risk = 'Partnered with investment teams and executives to build risk analytics solutions- Portfolio dashboards and detailed risk reporting controls.';
  const trading = 'Managed trading books ($30 million-$60 million) of OTC products, futures and options to analyze trading exposure.';
  const {state} = fixture(['PROFESSIONAL EXPERIENCE', risk, trading]);
  const result = buildProfessionalExperience(state), riskRow = result.rows.find(row => row.area === 'Risk analytics'), tradeRow = result.rows.find(row => /Trading/.test(row.area));
  assert.equal(riskRow.highlights[0].statement, 'Partnered with investment teams and executives to build risk analytics solutions');
  assert.equal(tradeRow.highlights[0].statement, trading);
  assert.equal(riskRow.items[0].statement, risk);
  assert.equal(tradeRow.items[0].statement, trading);
});

test('work appended to a job header stays included with explicit source context', () => {
  const {state} = fixture(['PROFESSIONAL EXPERIENCE', 'Example Employer            Harbor City, MD',
    'Reporting Analyst           January 2020- December 2021. Built reporting controls using Python.']);
  const result = buildProfessionalExperience(state), item = result.rows.flatMap(row => row.items)[0];
  assert.equal(item.statement, 'Built reporting controls using Python.');
  assert.equal(item.employerRole, 'Example Employer · Reporting Analyst');
  assert.deepEqual(item.period, {start: 'January 2020', end: 'December 2021'});
  assert.ok(state.documents[0].segments.find(segment => segment.id === item.sourceRefs[0].segmentId).text.includes(item.statement));
});

test('approved narrow answer claims are visible ahead of unreviewed resume commercial work without importing the raw answer remainder', () => {
  const {state} = fixture(['PROFESSIONAL EXPERIENCE', 'Monitored commercial margins and prepared financial summaries for clients.']);
  const answer = {id: 'answer', kind: 'answer', version: 1, segments: [{id: 'answer.p1', text: 'I negotiated service contracts. I priced administration services. I also owned all investment decisions.'}]};
  state.documents.push(answer);
  for (const [i, statement] of ['I negotiated service contracts.', 'I priced administration services.'].entries()) {
    const id = 'answer-fact' + i, approvalRef = 'approve-answer' + i;
    state.facts.push({id, version: 1, category: 'client_relationships', field: 'commercial_work', scope: 'Question employer', statement,
      approval: 'approved', approvalRef, lifecycle: 'active', evidence: [{documentId: answer.id, documentVersion: 1, segmentId: 'answer.p1', quote: answer.segments[0].text}]});
    state.approvals.push({id: approvalRef, kind: 'fact', recordId: id, recordVersion: 1, decision: 'approved'});
  }
  const result = buildProfessionalExperience(state), answers = result.rows.flatMap(row => row.items).filter(item => item.origin === 'user_answer');
  assert.equal(answers.length, 2);
  assert.ok(answers.every(item => item.employerRole === null && item.period === null));
  assert.ok(answers.every(item => item.coveredQuotes.every(quote => !quote.includes('owned all investment'))));
  const commercial = result.rows.find(row => /Commercial/.test(row.area));
  assert.equal(commercial.highlights[0].statement, 'I negotiated service contracts.');
});

test('legacy job-title wording containing Project cannot supply work approval', () => {
  const passage = 'Prepared weekly project status reports and coordinated delivery updates for clients.';
  const {state, approve} = fixture(['PROFESSIONAL EXPERIENCE', passage]);
  approve('employment', 'Project Manager', 'Served as Project Manager.', 'p2', passage);
  const item = buildProfessionalExperience(state).rows.flatMap(row => row.items)[0];
  assert.equal(item.approvalStatus, 'needs_review');
  assert.deepEqual(item.approvedFactRefs, []);
});

test('an alternate technology-stack heading never turns a long listed-tool row into applied work', () => {
  const {state} = fixture(['PROFESSIONAL EXPERIENCE', 'Prepared operational reports and reconciled daily accounts.',
    'TECHNOLOGY STACK', 'Python, SQL, TypeScript, PostgreSQL, Kubernetes, Docker, Terraform']);
  const items = buildProfessionalExperience(state).rows.flatMap(row => row.items);
  assert.equal(items.length, 1);
  assert.equal(items[0].statement, 'Prepared operational reports and reconciled daily accounts.');
});
