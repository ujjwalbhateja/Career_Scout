import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile} from '../lib/profile/domain.mjs';
import {buildConsolidatedProfile, CONSOLIDATED_SECTION_LABELS} from '../lib/profile/consolidated.mjs';

function fixture() {
  const state = emptyProfile();
  const fact = (category, field, statement, options = {}) => {
    const id = `fact-${state.facts.length + 1}`, documentId = `source-${state.documents.length + 1}`;
    state.documents.push({id: documentId, version: 1, kind: 'resume', title: 'Synthetic source', analysis: 'complete',
      segments: [{id: `${documentId}.p1`, text: statement}]});
    const item = {id, version: 1, category, field, scope: 'Example Employer / Analyst', statement,
      evidence: [{documentId, documentVersion: 1, segmentId: `${documentId}.p1`, quote: statement}],
      approval: 'approved', approvalRef: `approve-${id}`, confirmation: 'user_confirmed', lifecycle: 'active', conflict: false,
      createdAt: '2024-01-01T12:00:00.000Z', ...options};
    state.facts.push(item);
    if (item.approval === 'approved') state.approvals.push({id: item.approvalRef, kind: 'fact', recordId: id, recordVersion: 1, decision: 'approved'});
    return item;
  };
  const role = (name, facts, options = {}) => {
    const id = `role-${state.roleProfiles.length + 1}`;
    const item = {id, version: 1, basis: 'resume', roleName: name, summary: 'Supported reporting role hypothesis.',
      status: 'approved', approvalRef: `approve-${id}`, factRefs: facts.map(fact => ({id: fact.id, version: fact.version})),
      keywords: ['reporting'], mappings: [], jdIds: [], createdAt: '2024-01-02T12:00:00.000Z', ...options};
    state.roleProfiles.push(item);
    if (item.status === 'approved') state.approvals.push({id: item.approvalRef, kind: 'role', recordId: id, recordVersion: 1, decision: 'approved'});
    return item;
  };
  const snapshot = (options = {}) => {
    const item = {id: 'snapshot-1', version: 'profile-1', createdAt: '2024-03-15T12:00:00.000Z', stale: false,
      factRefs: state.facts.filter(fact => fact.approval === 'approved' && fact.lifecycle === 'active' && !fact.conflict).map(fact => ({id: fact.id, version: fact.version, approvalRef: fact.approvalRef})),
      profileRefs: state.roleProfiles.filter(role => role.status === 'approved').map(role => ({id: role.id, version: role.version, approvalRef: role.approvalRef})),
      approvalRef: 'approve-snapshot-1', searchPreferences: {location: 'London'},
      reviewScope: {requirementIds: [], questionIds: [], answerRefs: []}, ...options};
    state.snapshots.push(item); return item;
  };
  return {state, fact, role, snapshot};
}

test('consolidation covers the professional categories using exact approved facts and source refs', () => {
  const {state, fact, role} = fixture();
  const facts = [
    fact('experience_claims', 'subject_matter_expertise', 'Cash-flow forecasting'),
    fact('skills', 'programming_languages', 'Python'),
    fact('skills', 'tools_technologies', 'Excel'),
    fact('experience_claims', 'industry', 'Asset management'),
    fact('employment', 'company_name', 'Example Employer'),
    fact('experience_claims', 'leadership', 'Led a team of four analysts.'),
    fact('client_relationships', 'stakeholder_work', 'Prepared quarterly client updates.'),
    fact('education', 'degree', 'Master of Science'),
    fact('certifications', 'certification_name', 'Example Certificate'),
    fact('employment', 'responsibilities', 'Prepared monthly reports.'),
    fact('quantitative_claims', 'measurable_outcome', 'Reduced processing time by 20%.')
  ];
  fact('personal', 'email', 'private@example.test');
  role('Reporting Analyst', facts);
  const before = structuredClone(state), profile = buildConsolidatedProfile(state);
  assert.deepEqual(Object.keys(profile.sections), Object.keys(CONSOLIDATED_SECTION_LABELS));
  for (const [section, items] of Object.entries(profile.sections)) assert.ok(items.length, section);
  assert.equal(profile.sections.toolsTechnologies[0].statement, 'Excel');
  const achievement = profile.sections.achievements[0];
  assert.equal(achievement.statement, 'Reduced processing time by 20%.');
  assert.equal(achievement.factRefs[0].approvalRef, achievement.approvalRef);
  assert.equal(achievement.sourceStatus, 'matched_source');
  assert.equal(achievement.approvalReceiptStatus, 'matched_approval');
  assert.equal(achievement.confirmation, 'user_confirmed');
  assert.equal(achievement.independentlyVerified, false);
  assert.ok(!JSON.stringify(profile.sections).includes('private@example.test'));
  assert.deepEqual(state, before);
});

test('summary quotes approved professional facts and ignores every generated role summary', () => {
  const {state, fact, role} = fixture(), supported = fact('experience_claims', 'responsibilities', 'Prepared monthly reports.');
  role('Reporting Analyst', [supported], {summary: 'An approved role summary.'});
  role('Unapproved Manager', [supported], {status: 'proposed', summary: 'Must not enter the professional summary.'});
  const profile = buildConsolidatedProfile(state);
  assert.equal(profile.professionalSummary.kind, 'approved_professional_statements');
  assert.match(profile.professionalSummary.label, /approved source statements/);
  assert.deepEqual(profile.professionalSummary.items.map(item => item.statement), ['Prepared monthly reports.']);
  assert.equal(profile.professionalSummary.items[0].approvalStatus, 'approved');
  assert.equal(profile.professionalSummary.items[0].independentlyVerified, false);
  assert.deepEqual(profile.roles, []);
  assert.ok(!JSON.stringify(profile).includes('An approved role summary.'));
});

test('a JD requirement and pending source claims never become professional achievements', () => {
  const {state, fact} = fixture();
  const pending = fact('quantitative_claims', 'achievement', 'Increased revenue by 60%.', {approval: 'pending', approvalRef: null});
  state.documents.push({id: 'jd', kind: 'jd', selected: true, segments: [{id: 'jd.p1', text: 'Must lead a team.'}]});
  state.requirements.push({id: 'req', documentId: 'jd', text: 'Must lead a team.', category: 'task', importance: 'required', evidence: [{documentId: 'jd', segmentId: 'jd.p1', quote: 'Must lead a team.'}]});
  const profile = buildConsolidatedProfile(state);
  assert.deepEqual(profile.sections.achievements, []);
  assert.deepEqual(profile.sections.managementLeadership, []);
  assert.equal(profile.review.pendingFacts[0].id, pending.id);
  assert.equal(profile.requirements.missing[0].text, 'Must lead a team.');
});

test('empty sections remain empty rather than inferring tools or leadership from a title', () => {
  const {state, fact, role} = fixture(), title = fact('employment', 'job_title', 'Senior Data Science Manager');
  role('Senior Data Science Manager', [title]);
  const profile = buildConsolidatedProfile(state);
  assert.deepEqual(profile.sections.toolsTechnologies, []);
  assert.deepEqual(profile.sections.managementLeadership, []);
  assert.deepEqual(profile.sections.subjectMatterExpertise, []);
  assert.deepEqual(profile.roles, []);
  assert.deepEqual(profile.targetTitles.map(item => item.title), ['Senior Data Science Manager']);
});

test('snapshot projection never includes facts and roles approved after the saved version', () => {
  const {state, fact, role, snapshot} = fixture(), first = fact('skills', 'other_skills', 'Reporting');
  const firstRole = role('Reporting Analyst', [first]), saved = snapshot();
  const late = fact('skills', 'tools_technologies', 'LATE PRIVATE TOOL');
  role('LATE APPROVED ROLE', [late]);
  const profile = buildConsolidatedProfile(state, {snapshot: saved});
  assert.equal(profile.version, 'profile-1');
  assert.equal(profile.counts.approvedFacts, 1);
  assert.equal(profile.roles.length, 0);
  assert.deepEqual(profile.binding.roleRefs, []);
  assert.ok(!JSON.stringify(profile.sections).includes('LATE PRIVATE TOOL'));
  assert.ok(!JSON.stringify(profile.professionalSummary).includes('LATE APPROVED ROLE'));
  assert.ok(!profile.binding.factRefs.some(ref => ref.id === late.id));
});

test('a superseded snapshot fact never resolves to a newly approved version with the same ID', () => {
  const {state, fact, role, snapshot} = fixture(), original = fact('skills', 'other_skills', 'Reporting');
  role('Reporting Analyst', [original]); const saved = snapshot();
  original.lifecycle = 'superseded';
  const revised = {...structuredClone(original), version: 2, lifecycle: 'active', statement: 'NEW VERSION CLAIM', approvalRef: 'approve-revised'};
  state.facts.push(revised); state.approvals.push({id: 'approve-revised', kind: 'fact', recordId: revised.id, recordVersion: 2, decision: 'approved'});
  const profile = buildConsolidatedProfile(state, {snapshot: saved});
  assert.equal(profile.binding.valid, false);
  assert.equal(profile.counts.approvedFacts, 0);
  assert.ok(!JSON.stringify(profile.sections).includes('NEW VERSION CLAIM'));
  assert.equal(profile.roles.length, 0);
});

test('source or approval receipt failure excludes a claim and invalidates its dependent role', () => {
  for (const damage of [
    state => { state.documents[0].deleted = true; },
    state => { state.documents[0].kind = 'jd'; },
    state => { state.documents[0].version = 2; },
    state => { state.facts[0].evidence[0].quote = 'not in the source'; },
    state => { state.approvals[0].recordVersion = 3; },
    state => { state.facts[0].approval = 'withdrawn'; }
  ]) {
    const {state, fact, role, snapshot} = fixture(), skill = fact('skills', 'other_skills', 'Reporting');
    role('Reporting Analyst', [skill]); const saved = snapshot(); damage(state);
    const profile = buildConsolidatedProfile(state, {snapshot: saved});
    assert.equal(profile.binding.valid, false);
    assert.equal(profile.counts.approvedFacts, 0);
    assert.equal(profile.roles.length, 0);
  }
});

test('saved preferences and Present date coverage remain tied to the saved version', () => {
  const {state, fact, role, snapshot} = fixture();
  const start = fact('employment', 'start_date', 'January 2024');
  const end = fact('employment', 'end_date', 'Present');
  role('Reporting Analyst', [start, end]); const saved = snapshot();
  state.preferences.search = {location: 'CHANGED LOCATION'};
  const profile = buildConsolidatedProfile(state, {snapshot: saved, asOf: '2026-10-30'});
  assert.equal(profile.asOf, '2024-03-15');
  assert.equal(profile.professionalExperience.totalMonths, 3);
  assert.deepEqual(profile.preferences, {location: 'London'});
});

test('stored snapshot.consolidated preserves its explicit asOf basis', () => {
  const {state, fact, role, snapshot} = fixture();
  const start = fact('employment', 'start_date', 'January 2024'), end = fact('employment', 'end_date', 'Present');
  role('Reporting Analyst', [start, end]);
  const saved = snapshot({createdAt: '2024-04-01T01:00:00.000Z', consolidated: {asOf: '2024-03-31'}});
  const profile = buildConsolidatedProfile(state, {snapshot: saved, asOf: '2026-10-30'});
  assert.equal(profile.asOf, '2024-03-31');
  assert.equal(profile.professionalExperience.totalMonths, 3);
});

test('snapshot frozen review scope ignores later requirements, answers and pending facts', () => {
  const {state, fact, role, snapshot} = fixture(), skill = fact('skills', 'other_skills', 'Reporting');
  role('Reporting Analyst', [skill]);
  state.questions.push({id: 'q1', question: 'Do you use SQL?', scope: 'Example', status: 'not_experienced', requirementId: 'r1'});
  state.answers.push({id: 'a1', questionId: 'q1', status: 'not_experienced', text: ''});
  state.requirements.push({id: 'r1', documentId: 'jd1', text: 'SQL', category: 'skill', importance: 'required'});
  const saved = snapshot({reviewScope: {requirementIds: ['r1'], questionIds: ['q1'], answerRefs: [{id: 'a1', questionId: 'q1', status: 'not_experienced'}]}});
  state.questions[0].status = 'answered';
  state.questions[0].coveredByApprovedFacts = true;
  state.answers.push({id: 'LATE ANSWER', questionId: 'q1', status: 'answered', text: 'LATE TEXT'});
  state.requirements.push({id: 'late-req', documentId: 'jd1', text: 'LATE REQUIREMENT'});
  fact('skills', 'tools_technologies', 'LATE PENDING', {approval: 'pending', approvalRef: null});
  const profile = buildConsolidatedProfile(state, {snapshot: saved});
  assert.deepEqual(profile.review.answers.map(answer => answer.id), ['a1']);
  assert.equal(profile.review.questions[0].status, 'not_experienced');
  assert.equal(profile.review.questions[0].coveredByApprovedFacts, false);
  assert.deepEqual(profile.requirements.all.map(item => item.id), ['r1']);
  assert.equal(profile.review.pendingFacts.length, 0);
});

test('legacy snapshots lacking review scope do not borrow current questionnaire responses', () => {
  const {state, fact, role, snapshot} = fixture(), skill = fact('skills', 'other_skills', 'Reporting');
  role('Reporting Analyst', [skill]); const saved = snapshot({reviewScope: undefined});
  state.questions.push({id: 'q1', question: 'Later question?', status: 'unresolved'});
  state.answers.push({id: 'later-answer', questionId: 'q1', status: 'answered', text: 'Later response.'});
  const profile = buildConsolidatedProfile(state, {snapshot: saved});
  assert.equal(profile.binding.reviewScopeFrozen, false);
  assert.deepEqual(profile.review.questions, []);
  assert.deepEqual(profile.review.answers, []);
});

test('review uses only the latest answer per question and links extraction and approval stages', () => {
  const {state, fact} = fixture();
  for (const id of ['q1', 'q2', 'q3', 'q4']) state.questions.push({id, scope: 'Example', question: id, status: 'answered'});
  state.answers.push({id: 'old-q1', questionId: 'q1', status: 'answered', text: 'Old positive answer.'});
  state.answers.push({id: 'latest-q1', questionId: 'q1', status: 'not_experienced', text: ''});
  state.answers.push({id: 'latest-q2', questionId: 'q2', status: 'needs_details', text: 'Yes'});
  state.answers.push({id: 'latest-q3', questionId: 'q3', status: 'answered', text: 'Wrote SQL.', documentId: 'answer-3'});
  state.documents.push({id: 'answer-3', kind: 'answer', analysis: 'pending', segments: [{id: 'answer-3.p1', text: 'Wrote SQL.'}]});
  state.answers.push({id: 'latest-q4', questionId: 'q4', status: 'answered', text: 'Used Excel.', documentId: 'answer-4'});
  state.documents.push({id: 'answer-4', kind: 'answer', analysis: 'complete', segments: [{id: 'answer-4.p1', text: 'Used Excel.'}]});
  const pending = fact('skills', 'tools_technologies', 'Used Excel.', {approval: 'pending', approvalRef: null,
    evidence: [{documentId: 'answer-4', segmentId: 'answer-4.p1', quote: 'Used Excel.'}]});
  const profile = buildConsolidatedProfile(state);
  assert.equal(profile.review.answers.length, 4);
  assert.ok(!profile.review.answers.some(answer => answer.id === 'old-q1'));
  assert.deepEqual(profile.review.pendingAnswers.map(answer => answer.stage), ['needs_details', 'pending_extraction', 'pending_approval']);
  assert.equal(profile.review.pendingAnswers[2].factRefs[0].id, pending.id);
  assert.equal(profile.review.pendingFacts[0].evidence[0].documentId, 'answer-4');
});

test('only explicitly sourced titles are consolidated; generated role titles and keywords are ignored', () => {
  const {state, fact, role} = fixture(), skill = fact('skills', 'other_skills', 'Reporting');
  fact('employment', 'job_title', 'Reporting Analyst');
  role('Reporting Analyst', [skill], {alternativeTitles: ['Business Reporting Analyst'], relatedTitles: ['Operations Reporting Analyst'],
    keywords: ['Reporting', 'UNSUPPORTED KEYWORD']});
  const profile = buildConsolidatedProfile(state);
  assert.deepEqual(profile.targetTitles.map(item => item.kind), ['employment_title']);
  assert.ok(profile.targetTitles.every(item => item.basis === 'explicit_employment_title'));
  assert.ok(!profile.searchKeywords.some(item => item.term === 'UNSUPPORTED KEYWORD'));
  assert.ok(!JSON.stringify(profile.targetTitles).includes('Business Reporting Analyst'));
  assert.ok(!JSON.stringify(profile.sections).includes('UNSUPPORTED KEYWORD'));
});

test('legacy role-scoped Scout contexts cannot override source-only profile terms', () => {
  const {state, fact, role, snapshot} = fixture(), work = fact('experience_claims', 'responsibilities', 'Prepared monthly reports.');
  const supported = role('Reporting Analyst', [work]), saved = snapshot();
  const late = fact('skills', 'tools_technologies', 'LateTool');
  const contact = fact('personal', 'email', 'private@example.test');
  const profile = buildConsolidatedProfile(state, {snapshot: saved, scoutContexts: {[supported.id]: {
    responsibilities: [{term: 'monthly reports', factIds: [work.id]}, {term: 'Invented leadership', factIds: [work.id]}],
    skills: [{term: 'LateTool', factIds: [late.id]}, {term: 'private@example.test', factIds: [contact.id]}]
  }}});
  assert.deepEqual(profile.searchTerms.responsibilities.map(item => item.term), ['Prepared monthly reports']);
  assert.equal(profile.searchTerms.responsibilities[0].factRefs[0].approvalRef, work.approvalRef);
  assert.deepEqual(profile.searchTerms.skills, []);
});

test('standalone Builder assessments cite approved facts while gaps stay distinct from user facts', () => {
  const {state, fact, role} = fixture(), work = fact('experience_claims', 'responsibilities', 'Prepared monthly reports.');
  state.documents.push({id: 'jd1', kind: 'jd', selected: true, segments: []});
  state.requirements.push({id: 'supported', documentId: 'jd1', text: 'Monthly reporting', importance: 'required'},
    {id: 'gap', documentId: 'jd1', text: 'Team leadership', importance: 'preferred'});
  role('Reporting Analyst', [work], {mappings: [{requirementId: 'supported', factRefs: [{id: work.id, version: 1}], assessment: 'candidate_support', explanation: 'Explicit reporting source.'},
    {requirementId: 'gap', factRefs: [], assessment: 'not_established', explanation: 'No leadership source.'}]});
  state.builderReviews = [{basis: 'analysis', mappings: [{requirementId: 'supported', factRefs: [{id: work.id, version: 1}], assessment: 'candidate_support', explanation: 'Explicit reporting source.'},
    {requirementId: 'gap', factRefs: [], assessment: 'not_established', explanation: 'No leadership source.'}]}];
  const profile = buildConsolidatedProfile(state);
  assert.equal(profile.requirements.supported[0].id, 'supported');
  assert.equal(profile.requirements.supported[0].supportAssessment, 'candidate_support');
  assert.equal(profile.requirements.supported[0].independentlyVerified, false);
  assert.equal(profile.requirements.missing[0].id, 'gap');
  assert.deepEqual(profile.sections.managementLeadership, []);
});

test('conflicting mapped facts remain requirement conflicts instead of supported claims', () => {
  const {state, fact, role, snapshot} = fixture(), work = fact('experience_claims', 'responsibilities', 'Prepared monthly reports.');
  state.requirements.push({id: 'req', documentId: 'jd1', text: 'Monthly reporting', importance: 'required'});
  role('Reporting Analyst', [work], {jdIds: ['jd1'], mappings: [{requirementId: 'req', factRefs: [{id: work.id, version: 1}], assessment: 'candidate_support'}]});
  const saved = snapshot({reviewScope: {requirementIds: ['req'], questionIds: [], answerRefs: [], assessments: [{requirementId: 'req', factRefs: [{id: work.id, version: 1}], assessment: 'candidate_support'}]}});
  work.conflict = true;
  const profile = buildConsolidatedProfile(state, {snapshot: saved});
  assert.equal(profile.binding.valid, false);
  assert.equal(profile.requirements.conflicting[0].id, 'req');
  assert.equal(profile.requirements.supported.length, 0);
  assert.deepEqual(profile.sections.responsibilities, []);
});

test('empty projection produces no fabricated summary or records and exposes the shared save guard', () => {
  const {state} = fixture(), profile = buildConsolidatedProfile(state);
  assert.deepEqual(profile.professionalSummary.items, []);
  assert.deepEqual(profile.roles, []);
  assert.ok(Object.values(profile.sections).every(items => items.length === 0));
  assert.equal(profile.readiness.ready, false);
  assert.equal(profile.readiness.scope, 'current_state_save_guard');
  assert.ok(profile.readiness.blockers.length);
});
