import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFactReview, calculateProfessionalExperience, MISSING_FACT_VALUE, UNAVAILABLE_EXPERIENCE} from '../lib/profile/fact-review.mjs';

function fixture() {
  const state = {documents: [], facts: []};
  const fact = (category, field, scope, statement, options = {}) => {
    const id = `fact${state.facts.length + 1}`, documentId = `doc${state.documents.length + 1}`;
    const text = options.quote || statement;
    state.documents.push({id: documentId, kind: options.kind || 'resume', version: 1, segments: [{id: `${documentId}.s1`, text}]});
    const item = {
      id, version: 1, category, field, scope, statement,
      evidence: [{documentId, documentVersion: 1, segmentId: `${documentId}.s1`, quote: text}],
      approval: 'pending', confirmation: 'resume_stated', lifecycle: 'active', ...options
    };
    delete item.quote; delete item.kind;
    state.facts.push(item); return item;
  };
  const job = (scope, start, end, options = {}) => {
    fact('employment', 'company_name', scope, scope, options);
    if (start != null) fact('employment', 'start_date', scope, start, options);
    if (end != null) fact('employment', 'end_date', scope, end, options);
  };
  return {state, fact, job};
}

test('Fact review organizes all required sections and explicit skills without inventing missing fields', () => {
  const {state, fact, job} = fixture();
  fact('personal', 'full_name', 'personal', 'Sample Candidate');
  fact('personal', 'email', 'personal', 'sample@example.test');
  job('Company A / Analyst', 'January 2020', 'December 2022');
  fact('employment', 'location', 'Company A / Analyst', 'London');
  fact('education', 'institution_name', 'MSc', 'Example University');
  fact('education', 'start_date', 'MSc', 'September 2018');
  fact('education', 'end_date', 'MSc', 'June 2019');
  fact('certifications', 'certification_name', 'Certificate One', 'Certificate One');
  fact('skills', 'programming_languages', 'skills', 'Python');
  fact('skills', 'tools_technologies', 'skills', 'Excel');
  fact('skills', 'other_skills', 'skills', 'Stakeholder communication');
  const before = structuredClone(state), review = buildFactReview(state);
  assert.equal(review.personal.fullName.value, 'Sample Candidate');
  assert.equal(review.personal.mobile.value, MISSING_FACT_VALUE);
  assert.equal(review.personal.address.status, 'missing');
  assert.equal(review.employment.length, 1);
  assert.equal(review.employment[0].location.value, 'London');
  assert.equal(review.education[0].institutionName.value, 'Example University');
  assert.equal(review.education[0].location.value, MISSING_FACT_VALUE);
  assert.equal(review.certifications[0].issueDate.value, MISSING_FACT_VALUE);
  assert.deepEqual(review.skills.programmingLanguages.map(item => item.value), ['Python']);
  assert.deepEqual(review.skills.toolsTechnologies.map(item => item.value), ['Excel']);
  assert.deepEqual(review.skills.otherSkills.map(item => item.value), ['Stakeholder communication']);
  assert.ok(review.missingInformation.some(item => item.category === 'education' && item.field === 'location'));
  assert.deepEqual(state, before);
});

test('pending and user-confirmed facts stay distinct from independent verification', () => {
  const {state, fact, job} = fixture();
  fact('personal', 'name', 'personal', 'Example Person', {approval: 'approved', confirmation: 'user_confirmed'});
  job('Employer', '2020-01', '2020-12');
  const review = buildFactReview(state);
  assert.equal(review.personal.fullName.approvalStatus, 'approved');
  assert.equal(review.personal.fullName.entries[0].confirmation, 'user_confirmed');
  assert.equal(review.personal.fullName.independentlyVerified, false);
  assert.equal(review.professionalExperience.approvalStatus, 'pending');
  assert.equal(review.professionalExperience.basis, 'source_stated_dates');
  assert.equal(review.professionalExperience.independentlyVerified, false);
  assert.equal(review.professionalExperience.years, 1);
});

test('overlapping employment uses the full interval union and preserves individual records', () => {
  const {state, job} = fixture();
  job('Company A', 'January 2020', 'December 2022');
  job('Company B', 'June 2022', 'December 2024');
  const total = buildFactReview(state).professionalExperience;
  assert.equal(total.status, 'calculated');
  assert.equal(total.totalMonths, 60);
  assert.equal(total.label, '5 years 0 months');
  assert.equal(total.records.length, 2);
  assert.equal(total.records[0].totalMonths, 36);
  assert.equal(total.records[1].totalMonths, 31);
  assert.equal(total.mergedPeriods.length, 1);
  assert.equal(total.mergedPeriods[0].start, '2020-01');
  assert.equal(total.mergedPeriods[0].end, '2024-12');
  assert.equal(total.mergedPeriods[0].recordIds.length, 2);
  assert.match(total.countingConvention, /not day-exact/);
});

test('nested and chained overlaps count once while nonoverlapping periods remain separate', () => {
  const {state, job} = fixture();
  job('Long employer', '2020-01', '2021-12');
  job('Nested employer', '2020-06', '2020-08');
  job('Chained employer', '2021-11', '2022-02');
  job('Separate employer', '2023-01', '2023-03');
  const total = buildFactReview(state).professionalExperience;
  assert.equal(total.totalMonths, 29);
  assert.equal(total.mergedPeriods.length, 2);
  assert.equal(total.mergedPeriods[0].recordIds.length, 3);
  assert.equal(total.records.length, 4);
});

test('a missing date blocks the total without hiding valid individual durations', () => {
  const {state, job} = fixture();
  job('Complete employer', '2020-01', '2020-12');
  job('Incomplete employer', '2021-01', null);
  const review = buildFactReview(state), total = review.professionalExperience;
  assert.equal(review.employment[1].endDate.value, MISSING_FACT_VALUE);
  assert.equal(total.status, 'unavailable');
  assert.equal(total.totalMonths, null);
  assert.equal(total.label, UNAVAILABLE_EXPERIENCE);
  assert.equal(total.records[0].totalMonths, 12);
  assert.equal(total.records[1].reason, 'missing_date');
});

test('conflicting dates block calculation regardless of user approval', () => {
  const {state, fact, job} = fixture();
  job('Employer', '2020-01', '2020-12', {approval: 'approved'});
  fact('employment', 'start_date', 'Employer', '2020-03', {approval: 'approved'});
  const review = buildFactReview(state);
  assert.equal(review.employment[0].startDate.status, 'conflicting');
  assert.equal(review.professionalExperience.records[0].reason, 'conflicting_date');
  assert.ok(review.conflicts.some(item => item.field === 'startDate'));
});

test('year-only, ambiguous, invalid and reversed dates never acquire assumed months or days', () => {
  for (const [start, end, reason] of [
    ['2020', '2021', 'insufficient_date_precision'],
    ['01/02/2020', '12/03/2021', 'invalid_or_ambiguous_date'],
    ['2020-02-30', '2020-03-10', 'invalid_or_ambiguous_date'],
    ['2024-12', '2024-01', 'end_precedes_start'],
    ['Spring 2020', 'December 2020', 'invalid_or_ambiguous_date']
  ]) {
    const {state, job} = fixture(); job('Employer', start, end);
    const total = buildFactReview(state).professionalExperience;
    assert.equal(total.status, 'unavailable', start);
    assert.equal(total.records[0].reason, reason, start);
    assert.equal(total.totalMonths, null);
  }
});

test('common unambiguous month formats preserve source precision', () => {
  for (const [start, end] of [['01/2020', '12/2020'], ['2020/1', '2020/12'], ['Jan-2020', 'Dec-2020'], ['Sept. 2020', 'December 2020']]) {
    const {state, job} = fixture(); job('Employer', start, end);
    const total = buildFactReview(state).professionalExperience;
    assert.equal(total.status, 'calculated', start);
    assert.equal(total.totalMonths, start.startsWith('Sept') ? 4 : 12, start);
    assert.equal(total.precision, 'month');
  }
});

test('month union agrees with an explicit covered-month set in arbitrary input order', () => {
  const {state, job} = fixture(), covered = new Set();
  const literal = position => `${2020 + Math.floor(position / 12)}-${String(position % 12 + 1).padStart(2, '0')}`;
  for (let i = 0; i < 35; i++) {
    const start = i * 17 % 70, end = start + i * 7 % 20;
    job(`Employer ${i}`, literal(start), literal(end));
    for (let month = start; month <= end; month++) covered.add(month);
  }
  const total = buildFactReview(state).professionalExperience;
  assert.equal(total.status, 'calculated');
  assert.equal(total.totalMonths, covered.size);
  assert.equal(total.records.length, 35);
});

test('Present needs an explicit supplied as-of date and retains that basis', () => {
  const {state, job} = fixture(); job('Employer', 'January 2024', 'Present');
  assert.equal(buildFactReview(state).professionalExperience.records[0].reason, 'ongoing_requires_explicit_as_of');
  const total = buildFactReview(state, {asOf: '2024-03'}).professionalExperience;
  assert.equal(total.status, 'calculated');
  assert.equal(total.totalMonths, 3);
  assert.equal(total.asOf, '2024-03');
  assert.equal(total.records[0].usesAsOf, true);
});

test('Present with a supplied review day preserves a source month-precision start', () => {
  const {state, job} = fixture(); job('Employer', 'January 2024', 'Present');
  const total = buildFactReview(state, {asOf: '2024-03-15'}).professionalExperience;
  assert.equal(total.status, 'calculated');
  assert.equal(total.precision, 'month');
  assert.equal(total.totalMonths, 3);
  assert.equal(total.asOf, '2024-03-15');
  assert.equal(total.asOfPrecision, 'day');
  assert.equal(total.asOfCoverage, '2024-03');
  assert.match(total.countingConvention, /through calendar month 2024-03, using supplied review date 2024-03-15/);
  const dayStart = fixture(); dayStart.job('Employer', '2024-01-01', 'Present');
  assert.equal(buildFactReview(dayStart.state, {asOf: '2024-03'}).professionalExperience.records[0].reason, 'mixed_date_precision');
  const explicitEnd = fixture(); explicitEnd.job('Employer', 'January 2024', '2024-03-15');
  assert.equal(buildFactReview(explicitEnd.state, {asOf: '2024-03-15'}).professionalExperience.records[0].reason, 'mixed_date_precision');
});

test('exact day dates deduplicate overlapping days, including a leap day', () => {
  const {state, job} = fixture();
  job('Company A', '2024-01-01', '2024-02-15');
  job('Company B', '2024-02-01', '2024-02-29');
  const total = buildFactReview(state).professionalExperience;
  assert.equal(total.status, 'calculated');
  assert.equal(total.totalDays, 60);
  assert.equal(total.totalMonths, 2);
  assert.equal(total.residualDays, 0);
  assert.equal(total.mergedPeriods.length, 1);
});

test('disjoint day intervals preserve residual days without inventing a fixed month length', () => {
  const {state, job} = fixture();
  job('Company A', '2024-01-01', '2024-01-10');
  job('Company B', '2024-03-01', '2024-03-25');
  const total = buildFactReview(state).professionalExperience;
  assert.equal(total.totalDays, 35);
  assert.equal(total.totalMonths, 0);
  assert.equal(total.residualDays, 35);
  assert.equal(total.label, '0 years 0 months + 35 days');
  assert.match(total.countingConvention, /no fixed days-per-month/);
});

test('mixed precision is reported rather than silently supplying missing days', () => {
  const {state, job} = fixture();
  job('Month precision', '2020-01', '2020-02');
  job('Day precision', '2021-01-01', '2021-02-01');
  assert.ok(buildFactReview(state).professionalExperience.issues.some(item => item.reason === 'mixed_record_precision'));
  const another = fixture(); another.job('Employer', '2020-01', '2020-02-29');
  assert.equal(buildFactReview(another.state).professionalExperience.records[0].reason, 'mixed_date_precision');
});

test('a JD, deleted document, changed version or nonexistent quote cannot verify dates', () => {
  for (const damage of [
    state => { state.documents[1].kind = 'jd'; },
    state => { state.documents[1].deleted = true; },
    state => { state.documents[1].version = 2; },
    state => { state.facts[1].evidence[0].quote = 'not in the document'; }
  ]) {
    const {state, job} = fixture(); job('Employer', '2020-01', '2020-12'); damage(state);
    const total = buildFactReview(state).professionalExperience;
    assert.equal(total.status, 'unavailable');
    assert.equal(total.records[0].reason, 'unmatched_source');
  }
});

test('a valid quote alone does not establish a date absent from that quote', () => {
  const {state, fact} = fixture();
  fact('employment', 'company_name', 'Employer', 'Employer');
  fact('employment', 'start_date', 'Employer', '2020-01', {quote: 'Worked at Employer'});
  fact('employment', 'end_date', 'Employer', '2020-12');
  const total = buildFactReview(state).professionalExperience;
  assert.equal(total.records[0].reason, 'date_not_explicit_in_source');
});

test('optional literal value permits an exact date span without treating a paraphrase as evidence', () => {
  const {state, fact} = fixture();
  fact('employment', 'company_name', 'Employer', 'Worked at Employer', {value: 'Employer', quote: 'Worked at Employer'});
  fact('employment', 'start_date', 'Employer', 'Employment began in January 2020.', {value: 'January 2020', quote: 'Employer: January 2020 – December 2020'});
  fact('employment', 'end_date', 'Employer', 'Employment ended in December 2020.', {value: 'December 2020', quote: 'Employer: January 2020 – December 2020'});
  assert.equal(buildFactReview(state).professionalExperience.totalMonths, 12);
  state.facts[1].value = 'January 2019';
  assert.equal(buildFactReview(state).professionalExperience.status, 'unavailable');
});

test('duplicate skills preserve sources and confirmation but roles never create implied skills', () => {
  const {state, fact} = fixture();
  fact('skills', 'programming_language', 'skills', 'Python');
  fact('skills', 'programming_languages', 'skills', 'python', {approval: 'approved', confirmation: 'user_confirmed'});
  fact('skills', 'other_skills', 'skills', 'Python');
  fact('employment', 'job_title', 'Employer', 'Data Scientist');
  const review = buildFactReview(state);
  assert.equal(review.skills.programmingLanguages.length, 1);
  assert.equal(review.skills.programmingLanguages[0].entries.length, 3);
  assert.equal(review.skills.programmingLanguages[0].approvalStatus, 'mixed');
  assert.equal(review.skills.otherSkills.length, 0);
  assert.equal(review.employment[0].jobTitle.value, 'Data Scientist');
  assert.equal(review.employment[0].companyName.value, MISSING_FACT_VALUE);
});

test('rejected, withdrawn and superseded facts do not fill missing fields', () => {
  const {state, fact} = fixture();
  fact('personal', 'email', 'personal', 'old@example.test', {approval: 'rejected'});
  fact('personal', 'phone', 'personal', '000-000-0000', {approval: 'withdrawn'});
  fact('personal', 'address', 'personal', 'Old address', {lifecycle: 'superseded'});
  const review = buildFactReview(state);
  assert.equal(review.personal.email.status, 'missing');
  assert.equal(review.personal.mobile.status, 'missing');
  assert.equal(review.personal.address.status, 'missing');
  assert.equal(review.professionalExperience.label, UNAVAILABLE_EXPERIENCE);
});

test('unscoped dates are not silently associated with a company inferred from order', () => {
  const {state, fact} = fixture();
  fact('employment', 'start_date', '', '2020-01');
  fact('employment', 'end_date', '', '2020-12');
  const review = buildFactReview(state);
  assert.equal(review.employment[0].companyName.value, MISSING_FACT_VALUE);
  assert.equal(review.professionalExperience.records[0].reason, 'unresolved_record_association');
});

test('standalone duration helper requires original documents, not unvalidated citation metadata', () => {
  const {state, job} = fixture(); job('Employer', '2020-01', '2020-12');
  const review = buildFactReview(state);
  const total = calculateProfessionalExperience(review.employment);
  assert.equal(total.status, 'unavailable');
  assert.equal(total.records[0].reason, 'unmatched_source');
  assert.equal(calculateProfessionalExperience(review.employment, {documents: state.documents}).totalMonths, 12);
});

test('source-corrobated legacy and structured employment projections merge without changing their approvals', () => {
  const {state, fact} = fixture(), passage = 'Analyst at Example Employer from January 2020 to December 2020.';
  const original = fact('employment', 'Analyst', 'Example Employer', passage, {approval: 'approved', approvalRef: 'original-approval', confirmation: 'user_confirmed'});
  const source = structuredClone(original.evidence), modernScope = 'Example Employer / Analyst / 2020';
  const title = fact('employment', 'job_title', modernScope, 'Analyst', {evidence: source});
  const start = fact('employment', 'start_date', modernScope, 'January 2020', {evidence: source});
  fact('employment', 'end_date', modernScope, 'December 2020', {evidence: source});
  fact('employment', 'company_name', modernScope, 'Example Employer', {evidence: source});
  const before = structuredClone(state), review = buildFactReview(state), row = review.employment[0];
  assert.equal(review.employment.length, 1);
  assert.equal(row.duplicateResolution, 'same_explicit_record_sources');
  assert.equal(row.jobTitle.approvalStatus, 'mixed');
  assert.equal(row.startDate.approvalStatus, 'mixed');
  assert.ok(row.startDate.entries.some(entry => entry.factId === original.id && entry.approval === 'approved' && entry.approvalRef === 'original-approval'));
  assert.ok(row.startDate.entries.some(entry => entry.factId === start.id && entry.approval === 'pending'));
  assert.ok(row.factRefs.some(ref => ref.id === title.id));
  assert.equal(row.scopes.length, 2);
  assert.equal(review.professionalExperience.records.length, 1);
  assert.equal(review.professionalExperience.totalMonths, 12);
  assert.deepEqual(state, before);
});

test('merged literal date spellings calculate only when each spelling has its own exact matching source', () => {
  const {state, fact} = fixture();
  const firstLine = 'Analyst at Example Employer from Jan 2020 to Dec 2020.';
  const source = firstLine + '\nDate range written in full: January 2020 – December 2020.';
  const original = fact('employment', 'Analyst', 'Example Employer', firstLine, {quote: source, approval: 'approved'});
  original.evidence[0].quote = firstLine;
  for (const [field, value] of [['job_title', 'Analyst'], ['start_date', 'January 2020'], ['end_date', 'December 2020'], ['company_name', 'Example Employer']])
    fact('employment', field, 'Modern explicit record', value, {evidence: [{...original.evidence[0], quote: value}]});
  const review = buildFactReview(state);
  assert.equal(review.employment.length, 1);
  assert.deepEqual(review.employment[0].startDate.equivalentDateValues, ['Jan 2020', 'January 2020']);
  assert.equal(review.employment[0].startDate.status, 'provided');
  assert.equal(review.professionalExperience.totalMonths, 12);
  const dateEntry = review.employment[0].startDate.entries.find(entry => entry.value === 'January 2020');
  dateEntry.evidence[0].quote = 'Analyst';
  const damaged = calculateProfessionalExperience(review.employment, {documents: state.documents});
  assert.equal(damaged.status, 'unavailable');
  assert.equal(damaged.records[0].reason, 'date_not_explicit_in_source');
});

test('migration dedup preserves different roles and periods at the same employer', () => {
  const {state, fact} = fixture();
  const original = fact('employment', 'Analyst', 'Example Employer', 'Analyst at Example Employer from January 2020 to December 2020.', {approval: 'approved'});
  fact('employment', 'Analyst', 'Example Employer', 'Analyst at Example Employer from January 2021 to December 2021.', {approval: 'approved'});
  fact('employment', 'Manager', 'Example Employer', 'Manager at Example Employer from January 2022 to December 2022.', {approval: 'approved'});
  for (const [field, value] of [['job_title', 'Analyst'], ['start_date', 'January 2020'], ['end_date', 'December 2020'], ['company_name', 'Example Employer']])
    fact('employment', field, 'First analyst stint — structured', value, {evidence: structuredClone(original.evidence)});
  const review = buildFactReview(state);
  assert.equal(review.employment.length, 3);
  assert.deepEqual(review.employment.map(row => row.jobTitle.value), ['Analyst', 'Analyst', 'Manager']);
  assert.deepEqual(review.employment.map(row => row.startDate.value), ['January 2020', 'January 2021', 'January 2022']);
});

test('education migration merges only the same explicit qualification, interval and source record', () => {
  const {state, fact} = fixture();
  const original = fact('education', 'Master of Science', 'Example University',
    'Master of Science at Example University from September 2018 to June 2019.', {approval: 'approved', approvalRef: 'old-education-approval'});
  for (const [field, value] of [['qualification', 'Master of Science'], ['start_date', 'September 2018'], ['end_date', 'June 2019'], ['institution_name', 'Example University']])
    fact('education', field, 'MSc / Example University / 2018-2019', value, {evidence: structuredClone(original.evidence)});
  const review = buildFactReview(state);
  assert.equal(review.education.length, 1);
  assert.equal(review.education[0].qualification.approvalStatus, 'mixed');
  assert.ok(review.education[0].qualification.entries.some(entry => entry.approvalRef === 'old-education-approval'));
});

test('different employer assertions are never merged merely because role/date source segments match', () => {
  const {state, fact} = fixture();
  const original = fact('employment', 'Analyst', 'Example Employer',
    'Analyst at Example Employer from January 2020 to December 2020; served clients at Other Company.', {approval: 'approved'});
  for (const [field, value] of [['job_title', 'Analyst'], ['start_date', 'January 2020'], ['end_date', 'December 2020'], ['company_name', 'Other Company']])
    fact('employment', field, 'Potentially conflicting new record', value, {evidence: structuredClone(original.evidence)});
  const review = buildFactReview(state);
  assert.equal(review.employment.length, 2);
  assert.equal(review.possibleDuplicates[0].reason, 'entity_requires_review');
});

test('equal dates and role in different source records remain separate with a possible-duplicate flag', () => {
  const {state, fact} = fixture(), passage = 'Analyst at Example Employer from January 2020 to December 2020.';
  fact('employment', 'Analyst', 'Example Employer', passage, {approval: 'approved'});
  fact('employment', 'Analyst', 'Separate extraction scope', passage, {approval: 'pending'});
  const review = buildFactReview(state);
  assert.equal(review.employment.length, 2);
  assert.equal(review.possibleDuplicates.length, 1);
  assert.equal(review.possibleDuplicates[0].reason, 'source_identity_not_established');
  assert.ok(review.employment.every(row => row.possibleDuplicate));
});

test('user-confirmed degree and certification statements appear unchanged without invented dates or completion claims', () => {
  const {state, fact} = fixture();
  const degreeStatement = 'I earned a BSc in Mathematics.';
  const certificateStatement = 'I passed CFA Level I.';
  fact('education', 'user_confirmed_qualification', 'education', degreeStatement,
    {approval: 'approved', approvalRef: 'degree-approval', confirmation: 'user_confirmed', kind: 'answer'});
  fact('certifications', 'user_confirmed_qualification', 'certification', certificateStatement,
    {approval: 'approved', approvalRef: 'certificate-approval', confirmation: 'user_confirmed', kind: 'answer'});
  const review = buildFactReview(state);
  assert.equal(review.education[0].qualification.value, degreeStatement);
  assert.equal(review.education[0].qualification.approvalStatus, 'approved');
  assert.equal(review.education[0].qualification.entries[0].approvalRef, 'degree-approval');
  assert.equal(review.education[0].institutionName.status, 'missing');
  assert.equal(review.education[0].endDate.status, 'missing');
  assert.equal(review.certifications[0].name.value, certificateStatement);
  assert.equal(review.certifications[0].name.approvalStatus, 'approved');
  assert.equal(review.certifications[0].name.entries[0].confirmation, 'user_confirmed');
  assert.equal(review.certifications[0].issueDate.status, 'missing');
  assert.ok(!JSON.stringify(review.certifications).includes('charterholder'));
});

test('short resume date ranges remain visible without inferring a century or discarding Pres.', () => {
  const {state, fact} = fixture();
  fact('employment','Portfolio Analytics Manager','Example Services',
    'Portfolio Analytics Manager at Example Services.',
    {quote:'Portfolio Analytics Manager           Sep 24- Pres.',approval:'approved',approvalRef:'original-role'});
  fact('employment','Portfolio Analytics Associate','Example Services',
    'Portfolio Analytics Associate at Example Services.',
    {quote:'Portfolio Analytics Associate           Oct 20- Aug 24',approval:'approved'});
  const review=buildFactReview(state,{asOf:'2026-10-31'});
  assert.equal(review.employment.length,2);
  assert.equal(review.employment[0].startDate.value,'Sep 24');
  assert.equal(review.employment[0].endDate.value,'Pres.');
  assert.equal(review.employment[1].startDate.value,'Oct 20');
  assert.equal(review.employment[1].endDate.value,'Aug 24');
  assert.equal(review.employment[0].jobTitle.entries[0].approvalRef,'original-role');
  assert.equal(review.professionalExperience.status,'unavailable');
  assert.ok(!JSON.stringify(review).includes('2024-09'),'a two-digit source year does not silently become a four-digit date');
});

test('legacy skill summaries display the literal source list and reuse canonical source-backed buckets', () => {
  const {state, fact} = fixture();
  const original=fact('skills','Technical Tools','personal','The candidate is skilled in Python, Excel, and SQL.',
    {quote:'Technical Tools (skills): Python, Excel, SQL',approval:'approved',approvalRef:'original-skills'});
  fact('skills','programming_languages','personal','Python',{evidence:structuredClone(original.evidence)});
  fact('skills','tools_technologies','personal','Excel',{evidence:structuredClone(original.evidence)});
  fact('skills','programming_languages','personal','SQL',{evidence:structuredClone(original.evidence)});
  const review=buildFactReview(state);
  assert.deepEqual(review.skills.programmingLanguages.map(item=>item.value),['Python','SQL']);
  assert.deepEqual(review.skills.toolsTechnologies.map(item=>item.value),['Excel']);
  assert.ok(review.skills.programmingLanguages[0].entries.some(entry=>entry.approvalRef==='original-skills'));
  assert.ok(Object.values(review.skills).flat().every(item=>!item.value.includes('The candidate is skilled')),'a narrative assertion is not displayed as a tool name');
});
