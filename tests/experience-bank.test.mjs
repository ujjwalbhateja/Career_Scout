import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFactReview} from '../lib/profile/fact-review.mjs';
import {buildExperienceBank} from '../lib/profile/experience-bank.mjs';

function fixture(lines, kind = 'resume') {
  const document = {id: 'source', kind, version: 1, title: 'Synthetic source', analysis: 'complete',
    segments: lines.map((text, index) => ({id: `p${index + 1}`, text, locator: `paragraph ${index + 1}`}))};
  const state = {documents: [document], facts: [], approvals: []};
  const fact = (category, field, scope, statement, segmentId, options = {}) => {
    const id = `fact-${state.facts.length + 1}`, segment = document.segments.find(item => item.id === segmentId);
    const item = {id, version: 1, category, field, scope, statement, origin: kind === 'answer' ? 'user_answer' : 'resume',
      approval: 'approved', approvalRef: `approval-${id}`, lifecycle: 'active', confirmation: 'user_confirmed',
      evidence: [{documentId: document.id, documentVersion: 1, segmentId, quote: segment.text}], ...options};
    state.facts.push(item);
    if (item.approval === 'approved') state.approvals.push({id: item.approvalRef, kind: 'fact', recordId: id, recordVersion: 1, decision: 'approved'});
    return item;
  };
  return {state, document, fact};
}

test('legacy whole employment sentences preserve separate stints, explicit dates and original approvals', () => {
  const {state, fact} = fixture([
    'Worked as Analyst at Example Employer from January 2020 to December 2020.',
    'Worked as Vice President at Example Employer from January 2021 to December 2022.'
  ]);
  const first = fact('employment', 'Analyst', 'Example Employer', 'Analyst at Example Employer from January 2020 to December 2020.', 'p1');
  fact('employment', 'Vice President', 'Example Employer', 'Vice President at Example Employer from January 2021 to December 2022.', 'p2');
  const before = structuredClone(state), review = buildFactReview(state);
  assert.equal(review.employment.length, 2);
  assert.deepEqual(review.employment.map(row => row.jobTitle.value), ['Analyst', 'Vice President']);
  assert.deepEqual(review.employment.map(row => row.companyName.value), ['Example Employer', 'Example Employer']);
  assert.equal(review.employment[0].startDate.value, 'January 2020');
  assert.equal(review.employment[1].endDate.value, 'December 2022');
  assert.equal(review.employment[0].startDate.entries[0].approvalRef, first.approvalRef);
  assert.equal(review.employment[0].startDate.entries[0].factId, first.id);
  assert.equal(review.professionalExperience.totalMonths, 36);
  assert.deepEqual(state, before);
});

test('an immediate explicit company header supplies context without granting a new approval', () => {
  const {state, fact} = fixture(['Example Employer', 'Analyst | January 2020 – December 2020', 'Prepared monthly client reports.']);
  const record = fact('employment', 'Analyst', 'Example Employer', 'Analyst from January 2020 to December 2020.', 'p2');
  const review = buildFactReview(state), employer = review.employment[0].companyName;
  assert.equal(employer.value, 'Example Employer');
  assert.equal(employer.approvalStatus, 'pending');
  assert.equal(employer.entries[0].requiresReview, true);
  assert.equal(employer.entries[0].sourceFactApprovalRef, record.approvalRef);
  assert.equal(employer.entries[0].evidence[0].segmentId, 'p1');
  assert.equal(review.employment[0].startDate.approvalStatus, 'approved');
});

test('adjacent company header can share a segment or contain separate location metadata', () => {
  const {state, fact} = fixture(['Example Employer | London', 'Analyst | January 2020 – December 2020']);
  fact('employment', 'Analyst', 'Example Employer', 'Analyst from January 2020 to December 2020.', 'p2');
  assert.equal(buildFactReview(state).employment[0].companyName.value, 'Example Employer');
  const same = fixture(['Example Employer\nAnalyst | January 2020 – December 2020']);
  same.fact('employment', 'Analyst', 'Example Employer', 'Analyst from January 2020 to December 2020.', 'p1',
    {evidence: [{documentId: 'source', documentVersion: 1, segmentId: 'p1', quote: 'Analyst | January 2020 – December 2020'}]});
  const row = buildFactReview(same.state).employment[0];
  assert.equal(row.companyName.value, 'Example Employer');
  assert.equal(row.companyName.approvalStatus, 'pending');
  assert.equal(row.location.status, 'missing');
});

test('company association does not walk across a different employer or intervening section', () => {
  const {state, fact} = fixture(['Example Employer', 'Education', 'Different Employer', 'Analyst | January 2020 – December 2020']);
  fact('employment', 'Analyst', 'Example Employer', 'Analyst from January 2020 to December 2020.', 'p4');
  const review = buildFactReview(state);
  assert.equal(review.employment[0].companyName.status, 'missing');
  assert.equal(review.employment[0].jobTitle.value, 'Analyst');
});

test('legacy educational sentences retain the literal qualification, institution and dates', () => {
  const {state, fact} = fixture(['Master of Science at Example University from September 2018 to June 2019.']);
  const original = fact('education', 'Master of Science', 'Example University', 'Master of Science at Example University from September 2018 to June 2019.', 'p1');
  const row = buildFactReview(state).education[0];
  assert.equal(row.qualification.value, 'Master of Science');
  assert.equal(row.institutionName.value, 'Example University');
  assert.equal(row.startDate.value, 'September 2018');
  assert.equal(row.endDate.value, 'June 2019');
  assert.equal(row.location.status, 'missing');
  assert.equal(row.qualification.entries[0].approvalRef, original.approvalRef);
});

test('ambiguous multi-record passages and dates absent from the approved quote remain unresolved', () => {
  const {state, fact} = fixture(['Analyst at Company A January 2020 – December 2020; Analyst at Company B January 2021 – December 2021.']);
  fact('employment', 'Analyst', 'Company A', 'Analyst with two historical periods.', 'p1');
  const review = buildFactReview(state);
  assert.equal(review.employment[0].startDate.status, 'missing');
  assert.equal(review.professionalExperience.status, 'unavailable');
  const another = fixture(['Analyst', 'January 2020 – December 2020']);
  another.fact('employment', 'Analyst', 'Company A', 'Analyst from January 2020 to December 2020.', 'p1');
  assert.equal(buildFactReview(another.state).employment[0].startDate.status, 'missing');
});

test('legacy Technical Tools lists are split into explicit source items without project claims', () => {
  const {state, fact} = fixture(['Excel, Power BI and Bloomberg Terminal']);
  const skill = fact('skills', 'Technical Tools', 'Skills', 'Excel, Power BI and Bloomberg Terminal', 'p1');
  const bank = buildExperienceBank(state);
  assert.deepEqual(bank.factualRecords.skills.toolsTechnologies.map(item => item.value), ['Excel', 'Power BI', 'Bloomberg Terminal']);
  assert.ok(bank.factualRecords.skills.toolsTechnologies.every(item => item.entries[0].approvalRef === skill.approvalRef));
  assert.equal(bank.experienceGained.groups.length, 0);
});

test('work claims group under the explicit surviving employment source section and retain decisions', () => {
  const {state, fact} = fixture(['Example Employer', 'Analyst | January 2020 – December 2020', 'Prepared monthly client reports.', 'Reduced processing time by 20%.', 'Education', 'Example University']);
  fact('employment', 'Analyst', 'Example Employer', 'Analyst from January 2020 to December 2020.', 'p2');
  const work = fact('experience_claims', 'responsibilities', 'Example Employer', 'Prepared monthly client reports.', 'p3');
  fact('quantitative_claims', 'outcome', 'Example Employer', 'Reduced processing time by 20%.', 'p4', {approval: 'pending', approvalRef: null});
  const bank = buildExperienceBank(state), claims = bank.experienceGained.groups.flatMap(group => group.items);
  assert.equal(claims.length, 2);
  assert.equal(claims[0].association.basis, 'same_resume_record_section');
  assert.equal(claims[0].employerRole, 'Example Employer · Analyst');
  assert.equal(claims[0].approvalRef, work.approvalRef);
  assert.equal(claims[0].association.contextRequiresReview, true);
  assert.equal(bank.counts.approvedExperienceClaims, 1);
  assert.equal(bank.counts.pendingExperienceClaims, 1);
  assert.equal(claims[1].canApprove, true);
});

test('a questionnaire answer without an explicit employer never inherits its question or scope employer', () => {
  const {state, fact} = fixture(['I prepared monthly reports.'], 'answer');
  const answer = fact('experience_claims', 'reporting', 'Employer from the JD question', 'I prepared monthly reports.', 'p1',
    {experienceArea: 'Reporting', employerRole: 'Invented Employer', experienceDecision: 'somewhat', experienceReviewId: 'review1', experienceRowId: 'row1', originatingRequirements: ['req1']});
  const bank = buildExperienceBank(state), item = bank.experienceGained.groups[0].items[0];
  assert.equal(item.origin, 'user_answer');
  assert.equal(item.approvalRef, answer.approvalRef);
  assert.equal(item.employerRole, null);
  assert.equal(item.association.basis, 'not_provided');
  assert.equal(item.experienceArea, 'Reporting');
  assert.equal(item.area.factualClaim, false);
  assert.equal(item.experienceDecision, 'somewhat');
  assert.equal(item.requirementEvidenceStatus, 'partial_support');
  assert.deepEqual(item.originatingRequirements, ['req1']);
  assert.equal(item.statement, 'I prepared monthly reports.');
});

test('explicit employer-role metadata must occur in the work claim source', () => {
  const {state, fact} = fixture(['As an analyst at Example Employer, I prepared monthly reports.'], 'answer');
  fact('experience_claims', 'reporting', 'work', 'As an analyst at Example Employer, I prepared monthly reports.', 'p1', {employerRole: 'analyst at Example Employer'});
  const item = buildExperienceBank(state).experienceGained.groups[0].items[0];
  assert.equal(item.employerRole, 'analyst at Example Employer');
  assert.equal(item.association.basis, 'explicit_claim_source');
});

test('mentioning another person or client does not establish the user employer or role', () => {
  const {state, fact} = fixture(['I prepared reports for the Chief Executive Officer.'], 'answer');
  fact('experience_claims', 'reporting', 'work', 'I prepared reports for the Chief Executive Officer.', 'p1', {employerRole: 'Chief Executive Officer'});
  const item = buildExperienceBank(state).experienceGained.groups[0].items[0];
  assert.equal(item.employerRole, null);
  assert.equal(item.association.basis, 'not_provided');
});

test('unrepresented resume passages remain extraction-review flags and never become automatic facts', () => {
  const {state, fact} = fixture(['Prepared monthly reports.', 'Built an internal workflow for data checks.', 'Education']);
  fact('experience_claims', 'reporting', 'work', 'Prepared monthly reports.', 'p1');
  const before = structuredClone(state), bank = buildExperienceBank(state);
  assert.equal(bank.coverage.unrepresentedSegmentCount, 2);
  assert.equal(bank.coverage.documents[0].unrepresentedSegments[0].status, 'needs_extraction_review');
  assert.equal(bank.coverage.documents[0].completeness, 'not_established_by_link_counts');
  assert.equal(bank.counts.experienceClaims, 1);
  assert.deepEqual(state, before);
});

test('stored no-claim paragraph reviews are distinct from passages still needing extraction', () => {
  const {state, document, fact} = fixture(['Prepared reports.', 'Education', 'Additional work not yet extracted.']);
  fact('experience_claims', 'reporting', 'work', 'Prepared reports.', 'p1');
  document.coverage = {passageReview: [{segmentId: 'p2', reason: 'Section heading only; no factual claim.'}], unreviewedPassages: ['p3']};
  const bank = buildExperienceBank(state), coverage = bank.coverage.documents[0];
  assert.equal(coverage.segments[1].status, 'reviewed_no_claim');
  assert.equal(coverage.segments[1].reviewReason, 'Section heading only; no factual claim.');
  assert.equal(coverage.reviewedNoClaimSegments.length, 1);
  assert.deepEqual(coverage.unrepresentedSegments.map(segment => segment.segmentId), ['p3']);
  assert.equal(bank.coverage.unrepresentedSegmentCount, 1);
  assert.equal(bank.coverage.reviewedNoClaimSegmentCount, 1);
  assert.match(bank.coverage.note, /Neither a linked passage nor a no-claim classification proves/);
  assert.equal(bank.counts.experienceClaims, 1);
});

test('malformed, conflicting or omission-based passage reviews never mark a paragraph accounted for', () => {
  const {state, document} = fixture(['One passage.', 'Two passages.', 'Three passages.', 'Four passages.']);
  document.coverage = {passageReview: [
    {segmentId: 'p1', reason: ''},
    {segmentId: 'p2', reason: 'Work omitted due to token limit.'},
    {segmentId: 'p3', reason: 'Heading with no claim.'},
    {segmentId: 'missing-id', reason: 'Not a real source paragraph.'}
  ], unreviewedPassages: ['p3']};
  const bank = buildExperienceBank(state);
  assert.equal(bank.coverage.reviewedNoClaimSegmentCount, 0);
  assert.equal(bank.coverage.unrepresentedSegmentCount, 4);
  assert.ok(bank.coverage.documents[0].segments.every(segment => segment.status === 'needs_extraction_review'));
  assert.equal(state.facts.length, 0);
});

test('a rejected claim or JD quote is not usable cumulative experience', () => {
  const {state, fact} = fixture(['Prepared monthly reports.']);
  fact('experience_claims', 'reporting', 'work', 'Prepared monthly reports.', 'p1', {approval: 'rejected'});
  assert.equal(buildExperienceBank(state).counts.experienceClaims, 0);
  state.facts[0].approval = 'approved'; state.documents[0].kind = 'jd';
  const bank = buildExperienceBank(state);
  assert.equal(bank.counts.experienceClaims, 0);
  assert.equal(bank.experienceGained.sourceIssues.length, 1);
  assert.equal(bank.experienceGained.sourceIssues[0].canApprove, false);
});

test('same-company repeated stints associate work by their own section rather than first matching company', () => {
  const {state, fact} = fixture(['Analyst at Example Employer | January 2020 – December 2020', 'Prepared client reports.',
    'Vice President at Example Employer | January 2021 – December 2022', 'Led a team of four analysts.']);
  fact('employment', 'Analyst', 'Example Employer', 'Analyst at Example Employer from January 2020 to December 2020.', 'p1');
  fact('employment', 'Vice President', 'Example Employer', 'Vice President at Example Employer from January 2021 to December 2022.', 'p3');
  fact('experience_claims', 'reporting', 'Example Employer', 'Prepared client reports.', 'p2');
  fact('experience_claims', 'leadership', 'Example Employer', 'Led a team of four analysts.', 'p4');
  const items = buildExperienceBank(state).experienceGained.groups.flatMap(group => group.items);
  assert.equal(items[0].employerRole, 'Example Employer · Analyst');
  assert.equal(items[1].employerRole, 'Example Employer · Vice President');
  assert.notEqual(items[0].association.recordId, items[1].association.recordId);
});

test('snapshot bank excludes later fact versions and unrelated new source documents', () => {
  const {state, fact} = fixture(['Prepared client reports.']);
  const original = fact('experience_claims', 'reporting', 'work', 'Prepared client reports.', 'p1');
  const snapshot = {factRefs: [{id: original.id, version: 1}]};
  state.documents.push({id: 'new-resume', kind: 'resume', title: 'Later resume', segments: [{id: 'later', text: 'Later private material.'}]});
  state.facts.push({...structuredClone(original), version: 2, statement: 'Later revised claim.'});
  const bank = buildExperienceBank(state, {snapshot});
  assert.equal(bank.counts.experienceClaims, 1);
  assert.equal(bank.experienceGained.groups[0].items[0].statement, 'Prepared client reports.');
  assert.equal(bank.coverage.documents.length, 1);
  assert.ok(!JSON.stringify(bank).includes('Later private material.'));
});
