import test from 'node:test';
import assert from 'node:assert/strict';
import {buildValidatedSearchProfile} from '../lib/profile/search-profile.mjs';

function fixture() {
  const state = {documents: [], facts: [], approvals: [], roleProfiles: []};
  const fact = (category, field, statement, options = {}) => {
    const id = `fact-${state.facts.length + 1}`, documentId = `doc-${state.documents.length + 1}`;
    const source = options.source || statement;
    state.documents.push({id: documentId, kind: options.kind || 'resume', version: 1, segments: [{id: `${documentId}.p1`, text: source}]});
    const item = {id, version: 1, category, field, statement, scope: 'Example Employer', lifecycle: 'active', approval: 'approved',
      approvalRef: `approve-${id}`, confirmation: 'user_confirmed', evidence: [{documentId, documentVersion: 1, segmentId: `${documentId}.p1`, quote: source}], ...options};
    delete item.source; delete item.kind;
    state.facts.push(item);
    state.approvals.push({id: item.approvalRef, kind: 'fact', recordId: item.id, recordVersion: item.version, decision: 'approved'});
    return item;
  };
  const jd = (roleName, source, options = {}) => {
    const item = {id: `jd-${state.documents.length + 1}`, kind: 'jd', selected: true, version: 1, roleName,
      segments: [{id: 'heading', text: source}], ...options};
    state.documents.push(item); return item;
  };
  const snapshot = () => ({version: 'profile-1', factRefs: state.facts.filter(fact => fact.approval === 'approved').map(fact => ({id: fact.id, version: fact.version, approvalRef: fact.approvalRef})),
    reviewScope: {documentIds: state.documents.filter(document => document.kind === 'jd' && document.selected).map(document => document.id)}, searchProfile: buildValidatedSearchProfile(state)});
  return {state, fact, jd, snapshot};
}

test('example-list punctuation is removed only from search terms while compound names and evidence stay exact',()=>{
  const {state,fact}=fixture();
  const original=fact('skills','tools_technologies','(e.g., Allvue, Oxane, Lakehouse environments, Power BI)');
  fact('skills','tools_technologies','C++, C#, .NET; financial reporting (IFRS, US GAAP); SQL (T-SQL)');
  const before=structuredClone(state),profile=buildValidatedSearchProfile(state);
  assert.deepEqual(profile.skills.map(t=>t.term),['Allvue','Oxane','Lakehouse environments','Power BI','C++','C#','.NET','financial reporting (IFRS, US GAAP)','SQL (T-SQL)']);
  for(const term of profile.skills.slice(0,4)){assert.deepEqual(term.factRefs,[{id:original.id,version:1,approvalRef:original.approvalRef}]);assert.equal(term.sourceRefs[0].quote,original.statement);}
  assert.deepEqual(state,before);
});

test('actual employment titles retain exact source spelling and approval evidence', () => {
  const {state, fact} = fixture();
  const title = fact('employment', 'job_title', 'portfolio analyst', {source: 'Portfolio Analyst'});
  const profile = buildValidatedSearchProfile(state);
  assert.equal(profile.id, 'master-profile');
  assert.equal(profile.titles[0].term, 'Portfolio Analyst');
  assert.equal(profile.titles[0].sourceKind, 'employment_title');
  assert.deepEqual(profile.titles[0].factIds, [title.id]);
  assert.equal(profile.titles[0].factRefs[0].approvalRef, title.approvalRef);
  assert.equal(profile.titles[0].sourceRefs[0].quote, 'Portfolio Analyst');
  assert.equal(profile.titles[0].independentlyVerified, false);
  assert.deepEqual(profile.context.alternativeTitles, []);
});

test('selected JD titles are explicit employer targets and never user experience', () => {
  const {state, jd} = fixture(); jd('investment analyst', 'Investment Analyst\nEssential qualifications: financial reporting.');
  const profile = buildValidatedSearchProfile(state);
  assert.equal(profile.titles[0].term, 'Investment Analyst');
  assert.equal(profile.titles[0].sourceKind, 'selected_jd_title');
  assert.equal(profile.titles[0].basis, 'selected_employer_requirement');
  assert.equal(profile.titles[0].userExperience, false);
  assert.deepEqual(profile.titles[0].factIds, []);
  assert.equal(profile.titles[0].sourceRefs[0].quote, 'Investment Analyst');
  assert.deepEqual(profile.approvedFactIds, []);
  assert.deepEqual(profile.responsibilities, []);
});

test('generated roles, alternate titles, summaries and arbitrary document labels never enter the search profile', () => {
  const {state, fact, jd} = fixture(); fact('skills', 'tools_technologies', 'Excel');
  state.roleProfiles.push({id: 'generated', status: 'approved', roleName: 'INVENTED ROLE', alternativeTitles: ['INVENTED ALTERNATIVE'], summary: 'INVENTED SUMMARY', keywords: ['INVENTED KEYWORD']});
  jd('ALSO INVENTED', 'Actual job text contains no extracted title.', {title: 'Filename Analyst.docx'});
  const profile = buildValidatedSearchProfile(state);
  assert.deepEqual(profile.titles, []);
  assert.equal(profile.context.roleName, '');
  assert.ok(profile.missingContext.some(item => item.code === 'title_not_provided'));
  assert.equal(profile.hasSearchableContext, true);
  assert.ok(!JSON.stringify(profile).includes('INVENTED'));
  assert.ok(!JSON.stringify(profile).includes('Filename Analyst'));
});

test('no title is invented from responsibilities, skills, company names or seniority', () => {
  const {state, fact} = fixture();
  fact('employment', 'company_name', 'Data Science Partners');
  fact('experience_claims', 'responsibilities', 'Prepared monthly reports.');
  fact('skills', 'programming_languages', 'Python');
  const profile = buildValidatedSearchProfile(state);
  assert.deepEqual(profile.titles, []);
  assert.equal(profile.context.functionName, '');
  assert.deepEqual(profile.responsibilities.map(item => item.term), ['Prepared monthly reports']);
  assert.deepEqual(profile.skills.map(item => item.term), ['Python']);
  assert.equal(profile.hasSearchableContext, true);
});

test('professional routes use literal source spans with explicit functions and qualifications', () => {
  const {state, fact} = fixture();
  fact('experience_claims', 'industry', 'Asset management');
  fact('employment', 'function', 'Portfolio operations');
  fact('skills', 'tools_technologies', 'Excel, Power BI and C++');
  fact('education', 'degree', 'Master of Science');
  fact('education', 'institution_name', 'Private University');
  fact('certifications', 'certification_name', 'Example Certificate');
  const profile = buildValidatedSearchProfile(state);
  assert.deepEqual(profile.industries.map(item => item.term), ['Asset management']);
  assert.deepEqual(profile.functions.map(item => item.term), ['Portfolio operations']);
  assert.equal(profile.context.functionName, 'Portfolio operations');
  assert.deepEqual(profile.skills.map(item => item.term), ['Excel', 'Power BI', 'C++']);
  assert.deepEqual(profile.qualifications.map(item => item.term), ['Master of Science', 'Example Certificate']);
  assert.ok(!JSON.stringify(profile.context).includes('Private University'));
});

test('contacts, employer identities and dated prose do not become search terms', () => {
  const {state, fact} = fixture();
  fact('personal', 'email', 'person@example.test');
  fact('employment', 'company_name', 'Private Employer');
  fact('experience_claims', 'responsibilities', 'Prepared monthly reports at Private Employer.');
  fact('skills', 'other_skills', 'person@example.test');
  fact('experience_claims', 'responsibilities', 'Worked during January 2020');
  const profile = buildValidatedSearchProfile(state);
  assert.deepEqual(profile.responsibilities.map(item => item.term), ['Prepared monthly reports']);
  assert.deepEqual(profile.skills, []);
  assert.ok(!JSON.stringify(profile.context).includes('Private Employer'));
  assert.ok(!JSON.stringify(profile.context).includes('person@example.test'));
});

test('invalid or unapproved facts cannot supply titles or search evidence', () => {
  for (const damage of [
    (state, item) => { item.approval = 'pending'; },
    (state, item) => { item.conflict = true; },
    (state, item) => { item.lifecycle = 'superseded'; },
    state => { state.approvals[0].recordVersion = 2; },
    state => { state.documents[0].deleted = true; },
    state => { state.documents[0].kind = 'jd'; },
    (state, item) => { item.evidence[0].quote = 'Not in the source'; }
  ]) {
    const {state, fact} = fixture(), item = fact('employment', 'job_title', 'Analyst'); damage(state, item);
    const profile = buildValidatedSearchProfile(state);
    assert.deepEqual(profile.titles, []);
    assert.deepEqual(profile.approvedFactIds, []);
    assert.equal(profile.excludedFacts.length, 1);
  }
});

test('a paraphrased assertion never supplies an unsupported literal search phrase', () => {
  const {state, fact} = fixture();
  fact('employment', 'job_title', 'Portfolio Analyst', {source: 'Prepared portfolio reporting.'});
  fact('skills', 'tools_technologies', 'Python', {source: 'Technical analysis experience.'});
  const profile = buildValidatedSearchProfile(state);
  assert.deepEqual(profile.titles, []);
  assert.deepEqual(profile.skills, []);
});

test('duplicate explicit skills retain both fact and source references without mutating state', () => {
  const {state, fact} = fixture(); fact('skills', 'tools_technologies', 'Excel'); fact('skills', 'tools_technologies', 'excel');
  const before = structuredClone(state), profile = buildValidatedSearchProfile(state);
  assert.equal(profile.skills.length, 1);
  assert.equal(profile.skills[0].factIds.length, 2);
  assert.equal(profile.skills[0].sourceRefs.length, 2);
  assert.deepEqual(state, before);
});

test('saved search artifacts exclude later facts, later selected JDs and changed extraction metadata', () => {
  const {state, fact, jd, snapshot} = fixture();
  fact('employment', 'job_title', 'Reporting Analyst'); const firstJD = jd('Analyst', 'Analyst\nActual vacancy.');
  const saved = snapshot();
  fact('employment', 'job_title', 'LATE TITLE'); fact('skills', 'tools_technologies', 'LATE TOOL');
  jd('LATE JD TITLE', 'LATE JD TITLE\nAnother vacancy.');
  firstJD.roleName = 'CHANGED EXTRACTED TITLE';
  const profile = buildValidatedSearchProfile(state, {snapshot: saved});
  assert.deepEqual(profile.titles.map(item => item.term), ['Reporting Analyst', 'Analyst']);
  assert.ok(!JSON.stringify(profile).includes('LATE TITLE'));
  assert.ok(!JSON.stringify(profile).includes('LATE TOOL'));
  assert.ok(!JSON.stringify(profile).includes('LATE JD TITLE'));
});

test('saved source terms disappear from usable context when their exact approval or source is revoked', () => {
  const {state, fact, jd, snapshot} = fixture();
  fact('employment', 'job_title', 'Reporting Analyst'); const target = jd('Analyst', 'Analyst vacancy.');
  const saved = snapshot(); state.facts[0].approval = 'withdrawn'; target.deleted = true;
  const profile = buildValidatedSearchProfile(state, {snapshot: saved});
  assert.deepEqual(profile.titles, []);
  assert.equal(profile.hasSearchableContext, false);
});

test('snapshot exact fact versions never fall forward to a newly approved revision', () => {
  const {state, fact, snapshot} = fixture(), original = fact('employment', 'job_title', 'Reporting Analyst');
  const saved = snapshot(); original.lifecycle = 'superseded';
  const replacement = fact('employment', 'job_title', 'NEW REVISION TITLE', {id: original.id, version: 2});
  state.approvals.at(-1).recordId = replacement.id; state.approvals.at(-1).recordVersion = 2;
  const profile = buildValidatedSearchProfile(state, {snapshot: saved});
  assert.deepEqual(profile.titles, []);
  assert.ok(!JSON.stringify(profile).includes('NEW REVISION TITLE'));
});
