import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEmploymentDurations} from '../lib/profile/employment-duration.mjs';
import {buildFactReview} from '../lib/profile/fact-review.mjs';

function fixture() {
  const state = {documents: [], facts: [], approvals: []};
  function role(title, start, end, {approvedInterval, category = 'employment'} = {}) {
    const index = state.documents.length + 1, scope = `Example Employer | ${title} | ${start} | ${end}`;
    const document = {id: `resume${index}`, kind: 'resume', version: 1, segments: [{id: `p${index}`, text: `${title}  ${start} - ${end}`} ]};
    state.documents.push(document);
    const evidence = [{documentId: document.id, documentVersion: 1, segmentId: `p${index}`, quote: document.segments[0].text}];
    for (const [field, value] of [[category === 'employment' ? 'job_title' : 'qualification', title], ['start_date', start], ['end_date', end]]) {
      if (value == null) continue;
      state.facts.push({id: `f${state.facts.length + 1}`, version: 1, category, field, scope, statement: value, evidence: structuredClone(evidence), approval: 'pending', lifecycle: 'active'});
    }
    if (approvedInterval) {
      const id = `f${state.facts.length + 1}`, approvalRef = `a${index}`;
      state.facts.push({id, version: 1, category, field: title, scope: 'Example Employer', statement: `${title} at Example Employer from ${approvedInterval[0]} to ${approvedInterval[1]}.`, evidence, approval: 'approved', lifecycle: 'active', approvalRef});
      state.approvals.push({id: approvalRef, kind: 'fact', recordId: id, recordVersion: 1, decision: 'approved'});
    }
    return scope;
  }
  return {state, role};
}

test('short-source employment periods use matching approved years and elapsed-month differences', () => {
  const {state, role} = fixture();
  role('Analytics Manager', 'Sep 24', 'Pres.', {approvedInterval: ['September 2024', 'present']});
  role('Analytics Associate', 'Oct 20', 'Aug 24', {approvedInterval: ['October 2020', 'August 2024']});
  role('Risk Analyst', 'Jan 19', 'Sep 20', {approvedInterval: ['January 2019', 'September 2020']});
  role('Trading Analyst', 'Mar 18', 'Jul 18', {approvedInterval: ['March 2018', 'July 2018']});
  const before = structuredClone(state), result = buildEmploymentDurations(state, {asOf: '2026-10-31'});
  assert.deepEqual(result.roles.map(row => row.duration.totalMonths), [25, 46, 20, 4]);
  assert.deepEqual(result.roles.map(row => row.duration.label), ['2 years 1 month', '3 years 10 months', '1 year 8 months', '4 months']);
  assert.equal(result.total.label, '7 years 11 months');
  assert.equal(result.total.totalMonths, 95);
  assert.equal(result.total.status, 'calculated');
  assert.equal(result.roles[0].duration.start, '2024-09');
  assert.equal(result.roles[0].duration.end, '2026-10');
  assert.equal(result.roles[0].duration.asOf, '2026-10-31');
  assert.equal(result.roles[0].duration.independentlyVerified, false);
  assert.deepEqual(state, before);
});

test('a projection with full source years does not require approval or change existing inclusive review defaults', () => {
  const {state, role} = fixture(); role('Engineer', 'January 2020', 'December 2020');
  const before = buildFactReview(state);
  const result = buildEmploymentDurations(state);
  assert.equal(result.roles[0].duration.months, 11);
  assert.equal(result.roles[0].duration.resolvedFromFactRefs.length, 0);
  assert.equal(before.professionalExperience.totalMonths, 12);
  assert.deepEqual(buildFactReview(state), before);
  assert.equal(state.facts.every(fact => fact.approval === 'pending'), true);
});

test('month spellings and explicit numeric month formats retain their source precision', () => {
  for (const [start, end] of [['Sept. 2020', 'December 2020'], ['2020-09', '2020-12'], ['09/2020', '12/2020'], ['2020/9', '2020/12'], ['Sep-2020', 'Dec-2020']]) {
    const {state, role} = fixture(); role('Technician', start, end);
    const result = buildEmploymentDurations(state);
    assert.equal(result.total.months, 3, start);
    assert.equal(result.total.precision, 'month', start);
  }
});

test('exact source days use elapsed calendar months and residual days, without inclusive-day addition', () => {
  const {state, role} = fixture(); role('Nurse', '2020-01-15', '2020-03-20');
  const result = buildEmploymentDurations(state);
  assert.equal(result.roles[0].duration.precision, 'day');
  assert.equal(result.roles[0].duration.months, 2);
  assert.equal(result.roles[0].duration.residualDays, 5);
  assert.equal(result.total.totalDays, 65);
  assert.equal(result.total.label, '2 months 5 days');
});

test('missing, invalid, reversed, ambiguous and year-only role dates never become zero durations', () => {
  for (const [start, end, reason] of [
    [null, '2020-12', 'missing_date'], ['2020-01', null, 'missing_date'],
    ['2020', '2021', 'insufficient_date_precision'], ['01/02/2020', '12/03/2020', 'invalid_or_ambiguous_date'],
    ['2020-02-30', '2020-03-10', 'invalid_or_ambiguous_date'], ['2022-05', '2022-04', 'end_precedes_start']
  ]) {
    const {state, role} = fixture(); role('Specialist', start, end);
    const result = buildEmploymentDurations(state);
    assert.equal(result.roles[0].duration.status, 'unavailable', String(start));
    assert.equal(result.roles[0].duration.reason, reason, String(start));
    assert.equal(result.roles[0].duration.months, null);
    assert.equal(result.total.months, null);
  }
});

test('mixed explicit precision does not acquire assumed source days or combine incompatible records', () => {
  const {state, role} = fixture();
  role('Assistant', '2020-01', '2020-05-31');
  assert.equal(buildEmploymentDurations(state).roles[0].duration.reason, 'mixed_date_precision');
  const second = fixture();
  second.role('Manager', '2020-01', '2020-05');
  second.role('Clinician', '2020-01-15', '2020-04-20');
  const result = buildEmploymentDurations(second.state);
  assert.ok(result.roles.every(row => row.duration.status === 'calculated'));
  assert.equal(result.total.status, 'unavailable');
  assert.equal(result.total.reason, 'mixed_record_precision');
  assert.equal(result.total.months, null);
});

test('education is excluded and incomplete employment yields a clearly limited dated-role total', () => {
  const {state, role} = fixture();
  role('Coordinator', '2018-03', '2018-07');
  role('Bachelor of Science', '2008-01', '2012-01', {category: 'education'});
  role('Unfinished role', '2022-01', null);
  const result = buildEmploymentDurations(state);
  assert.equal(result.roles.length, 2);
  assert.equal(result.total.status, 'partial');
  assert.equal(result.total.months, 4);
  assert.equal(result.total.label, '4 months from dated roles');
  assert.equal(result.total.complete, false);
  assert.equal(result.total.excludedRoleIds.length, 1);
});

test('records overload uses the same evidence and approval checks without mutating supplied records', () => {
  const {state, role} = fixture(); role('Analyst', 'Mar 18', 'Jul 18', {approvedInterval: ['March 2018', 'July 2018']});
  const records = buildFactReview(state).employment, before = structuredClone(records);
  const result = buildEmploymentDurations(records, {documents: state.documents, facts: state.facts, approvals: state.approvals});
  assert.equal(result.total.months, 4);
  assert.deepEqual(records, before);
  assert.deepEqual(result, buildEmploymentDurations(state));
});

test('a broad legacy assertion cannot supply approval for a short date interpreted as 20YY', () => {
  const {state, role} = fixture(); role('Analyst', 'Mar 18', 'Jul 18', {approvedInterval: ['March 2018', 'July 2018']});
  state.facts.at(-1).statement += ' A different stint ran from March 1918 to July 1918.';
  const result = buildEmploymentDurations(state);
  assert.equal(result.roles[0].duration.start, '2018-03');
  assert.equal(result.roles[0].duration.months, 4);
  assert.deepEqual(result.roles[0].duration.resolvedFromFactRefs, []);
});

test('identical titles and short periods in a shared segment require the specific quoted record span', () => {
  const {state, role} = fixture();
  const firstScope = role('Analyst', 'Sep 24', 'Jan 25', {approvedInterval: ['September 2024', 'January 2025']});
  const firstLine = 'Example One | Analyst | Sep 24 - Jan 25', secondLine = 'Example Two | Analyst | Sep 24 - Jan 25';
  state.documents[0].segments[0].text = firstLine + '\n' + secondLine;
  for (const fact of state.facts) fact.evidence[0].quote = firstLine;
  const approved = state.facts.at(-1);
  approved.scope = 'Example One';
  approved.statement = 'Analyst at Example One from September 2024 to January 2025.';
  const secondScope = 'Example Two | Analyst | Sep 24 | Jan 25';
  for (const [field, statement] of [['job_title', 'Analyst'], ['start_date', 'Sep 24'], ['end_date', 'Jan 25']])
    state.facts.push({id: `f${state.facts.length + 1}`, version: 1, category: 'employment', field, scope: secondScope, statement, approval: 'pending',
      evidence: [{documentId: 'resume1', documentVersion: 1, segmentId: 'p1', quote: secondLine}]});
  const result = buildEmploymentDurations(state);
  assert.equal(result.roles.find(row => row.scope === firstScope).duration.months, 4);
  const second = result.roles.find(row => row.scope === secondScope).duration;
  assert.equal(second.status, 'calculated');
  assert.deepEqual(second.resolvedFromFactRefs, []);
  assert.equal(result.total.status, 'calculated');
  assert.equal(result.total.months, 4);
});

test('a broad shared evidence quote cannot override a different explicitly sourced employer', () => {
  const {state, role} = fixture(); role('Analyst', 'Sep 24', 'Jan 25', {approvedInterval: ['September 2024', 'January 2025']});
  const firstLine = 'Example One | Analyst | Sep 24 - Jan 25', secondLine = 'Example Two | Analyst | Sep 24 - Jan 25';
  const broadQuote = firstLine + '\n' + secondLine;
  state.documents[0].segments[0].text = broadQuote;
  for (const fact of state.facts) fact.evidence[0].quote = broadQuote;
  const approved = state.facts.at(-1);
  approved.scope = 'Example One';
  approved.statement = 'Analyst at Example One from September 2024 to January 2025.';
  const scope = 'Example Two | Analyst | Sep 24 | Jan 25';
  for (const [field, statement] of [['company_name', 'Example Two'], ['job_title', 'Analyst'], ['start_date', 'Sep 24'], ['end_date', 'Jan 25']])
    state.facts.push({id: `f${state.facts.length + 1}`, version: 1, category: 'employment', field, scope, statement, approval: 'pending',
      evidence: [{documentId: 'resume1', documentVersion: 1, segmentId: 'p1', quote: secondLine}]});
  const result = buildEmploymentDurations(state);
  const other = result.roles.find(row => row.scope === scope).duration;
  assert.equal(other.start, '2024-09');
  assert.deepEqual(other.resolvedFromFactRefs, []);
});

test('literal month and short-year dates calculate all roles without approvals, including duplicate records', () => {
  const {state, role} = fixture();
  role('Example Manager', 'Jun 25', 'Pres.');
  role('Example Associate', 'Feb 22', 'MAY 25');
  role('Example Analyst', 'Apr 20', 'Jan 22');
  role('Example Trainee', 'May 19', 'Sep 19');
  role('Duplicate Manager', 'Jun 25', 'Pres.');
  const before = structuredClone(state);
  const result = buildEmploymentDurations(state, {asOf: '2026-11-10'});
  assert.deepEqual(result.roles.map(row => row.duration.months), [17, 39, 21, 4, 17]);
  assert.equal(result.total.label, '6 years 9 months');
  assert.equal(result.total.months, 81, 'duplicate intervals count once');
  assert.equal(result.total.status, 'calculated');
  assert.ok(result.roles.every(row => row.duration.resolvedFromFactRefs.length === 0));
  assert.equal(result.roles[1].duration.end, '2025-05');
  assert.deepEqual(result.roles[1].duration.dateInterpretations[1], {field: 'endDate', source: 'MAY 25', year: 2025, basis: 'month_year_20xx'});
  assert.deepEqual(state, before, 'no rewritten dates, approval receipts or saved-profile mutations');
});

test('month abbreviations, full names, case, periods and hyphens work with two-digit years', () => {
  for (const [start, end] of [['AUG 24', 'sep 24'], ['August 24', 'September 24'], ['Aug. 24', 'Sept. 24'], ['Aug-24', 'Sep-24'], ['Aug 24', 'September 2024']]) {
    const {state, role} = fixture(); role('Analyst', start, end);
    const duration = buildEmploymentDurations(state).roles[0].duration;
    assert.equal(duration.start, '2024-08', start);
    assert.equal(duration.end, '2024-09', end);
    assert.equal(duration.months, 1);
  }
});

test('short-year convention does not bypass source, date-conflict or missing-date checks', () => {
  for (const mutation of ['deleted_source', 'stale_source', 'invalid_quote', 'conflict']) {
    const {state, role} = fixture(); role('Analyst', 'Aug 24', 'Sep 24');
    if (mutation === 'deleted_source') state.documents[0].deleted = true;
    if (mutation === 'stale_source') state.documents[0].version = 2;
    if (mutation === 'invalid_quote') state.facts.find(f => f.field === 'start_date').evidence[0].quote = 'Invented source';
    if (mutation === 'conflict') state.facts.find(f => f.field === 'start_date').conflict = true;
    assert.notEqual(buildEmploymentDurations(state).total.status, 'calculated', mutation);
  }
  for (const [start, end] of [['Aug 24', null], ['24', '25'], ['Aug 25', 'Jan 24'], ['08/09/24', '09/10/24']]) {
    const {state, role} = fixture(); role('Analyst', start, end);
    assert.equal(buildEmploymentDurations(state).roles[0].duration.status, 'unavailable');
  }
});
