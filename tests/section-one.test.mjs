import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSectionOneFacts, SECTION_ONE_PARSER_VERSION} from '../lib/profile/section-one.mjs';

const resume = lines => ({id: 'synthetic-resume', kind: 'resume', version: 1,
  segments: lines.map((text, i) => ({id: `p${i + 1}`, text, locator: `paragraph ${i + 1}`}))});
const anchor = (category, field, scope, statement = '') => ({category, field, scope, statement, lifecycle: 'active', approval: 'approved'});
function groups(result, category) {
  const grouped = new Map();
  for (const fact of result.facts.filter(fact => fact.category === category)) {
    if (!grouped.has(fact.scope)) grouped.set(fact.scope, {});
    grouped.get(fact.scope)[fact.field] = fact.statement;
  }
  return [...grouped.values()];
}
function assertExactEvidence(document, facts) {
  for (const fact of facts) {
    assert.ok(fact.evidence.some(ref => ref.quote.includes(fact.statement)));
    assert.ok(fact.evidence.every(ref => ref.documentId === document.id && document.segments.some(segment => segment.id === ref.segmentId && segment.text.includes(ref.quote))));
    assert.equal('approval' in fact, false);
    assert.equal('approvalRef' in fact, false);
  }
}

test('shared multi-space company header maps all separate stints with literal short dates', () => {
  const document = resume(['Sample Candidate', 'PROFESSIONAL EXPERIENCE', 'Example Fund Services            New York, NY',
    'Reporting Manager           Sep 24- Pres.', 'Manage a team and prepare client reports.',
    'Analytics Associate           Oct 20- Aug 24', 'Prepared reconciliation reports.',
    'Risk Analyst            Jan 19- Sep 20']);
  const knownFacts = [anchor('employment', 'Reporting Manager', 'Example Fund Services'),
    anchor('employment', 'Analytics Associate', 'Example Fund Services'), anchor('employment', 'Risk Analyst', 'Example Fund Services')];
  const before = structuredClone({document, knownFacts});
  const result = extractSectionOneFacts(document, {knownFacts}), rows = groups(result, 'employment');
  assert.equal(result.parserVersion, SECTION_ONE_PARSER_VERSION);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.company_name), ['Example Fund Services', 'Example Fund Services', 'Example Fund Services']);
  assert.deepEqual(rows.map(row => row.job_title), ['Reporting Manager', 'Analytics Associate', 'Risk Analyst']);
  assert.deepEqual(rows.map(row => row.start_date), ['Sep 24', 'Oct 20', 'Jan 19']);
  assert.deepEqual(rows.map(row => row.end_date), ['Pres.', 'Aug 24', 'Sep 20']);
  assert.ok(rows.every(row => row.location === 'New York, NY'));
  assert.ok(result.unresolved.some(issue => /no century was assumed/.test(issue.reason)));
  assert.ok(result.facts.every(fact => ['personal', 'employment'].includes(fact.category)));
  assertExactEvidence(document, result.facts);
  assert.deepEqual({document, knownFacts}, before);
});

test('mixed employer/city/title/date and education headers preserve known literal record labels', () => {
  const document = resume(['PROFESSIONAL EXPERIENCE',
    'Example Securities            Harbor City, MD Trading Analyst (Contract Position)        Mar 18- Jul 18',
    'EDUCATION AND CERTIFICATION',
    'Example University           Harbor City, MD Master of Finance- Merit Scholarship         July 16- Aug 17',
    'Sample University           New Delhi, India', 'Bachelor of Science in Mathematics         July 12- June 15']);
  const knownFacts = [anchor('employment', 'Trading Analyst', 'Example Securities'), anchor('education', 'Master of Finance', 'Example University'),
    anchor('education', 'Bachelor of Science in Mathematics', 'Sample University')];
  const result = extractSectionOneFacts(document, {knownFacts}), jobs = groups(result, 'employment'), education = groups(result, 'education');
  assert.deepEqual(jobs, [{company_name: 'Example Securities', location: 'Harbor City, MD', job_title: 'Trading Analyst', start_date: 'Mar 18', end_date: 'Jul 18'}]);
  assert.equal(education.length, 2);
  assert.equal(education[0].qualification, 'Master of Finance');
  assert.equal(education[0].institution_name, 'Example University');
  assert.equal(education[0].location, 'Harbor City, MD');
  assert.equal(education[1].institution_name, 'Sample University');
  assert.equal(education[1].location, 'New Delhi, India');
  assert.equal(education[1].end_date, 'June 15');
  assert.ok(!result.facts.some(fact => /completion|award|charter/.test(fact.field)));
  assertExactEvidence(document, result.facts);
});

test('new ingestion extracts name before email and phone on one paragraph without prior facts', () => {
  const document = resume(['Sample Candidate sample@example.test +1 (202) 555-0147', 'PROFESSIONAL EXPERIENCE']);
  const result = extractSectionOneFacts(document), personal = groups(result, 'personal')[0];
  assert.deepEqual(personal, {full_name: 'Sample Candidate', email: 'sample@example.test', mobile: '+1 (202) 555-0147'});
  assert.ok(!result.facts.some(fact => fact.field === 'address'));
  assertExactEvidence(document, result.facts);
});

test('only an explicit personal address is extracted; work locations are never home addresses', () => {
  const document = resume(['Name: Sample Candidate | Address: Example Road, Example City',
    'PROFESSIONAL EXPERIENCE', 'Example Employer            New York, NY', 'Reporting Analyst           Jan 2020- Dec 2021']);
  const result = extractSectionOneFacts(document);
  assert.equal(result.facts.find(fact => fact.field === 'address').statement, 'Example Road, Example City');
  assert.equal(result.facts.filter(fact => fact.field === 'address').length, 1);
  assert.equal(result.facts.find(fact => fact.category === 'employment' && fact.field === 'location').statement, 'New York, NY');
});

test('a later employer and education section bound earlier employer context', () => {
  const document = resume(['PROFESSIONAL EXPERIENCE', 'First Employer           Toronto, ON', 'Analyst           Jan 2020- Dec 2020',
    'Second Employer           Boston, MA', 'Senior Analyst           Jan 2021- Dec 2021', 'EDUCATION',
    'Example University           Boston, MA', 'Master of Science           Sep 2018- Jun 2019']);
  const result = extractSectionOneFacts(document), jobs = groups(result, 'employment');
  assert.deepEqual(jobs.map(job => job.company_name), ['First Employer', 'Second Employer']);
  assert.equal(groups(result, 'education')[0].institution_name, 'Example University');
  assert.ok(!result.facts.some(fact => fact.category === 'employment' && /University/.test(fact.statement)));
});

test('explicit known entities allow plain city columns without guessing from a scope alone', () => {
  const document = resume(['PROFESSIONAL EXPERIENCE', 'Example Services  New York', 'Senior Analyst  Sep 24 - Pres.',
    'EDUCATION', 'Example University  Boston', 'Master of Science in Finance  Jun 18 - May 20']);
  const knownFacts = [anchor('employment', 'Senior Analyst', 'Example Services'), anchor('education', 'Master of Science in Finance', 'Example University')];
  const result = extractSectionOneFacts(document, {knownFacts});
  assert.equal(groups(result, 'employment')[0].company_name, 'Example Services');
  assert.equal(groups(result, 'employment')[0].location, 'New York');
  assert.equal(groups(result, 'education')[0].institution_name, 'Example University');
  assert.equal(groups(result, 'education')[0].location, 'Boston');
});

test('only explicitly listed language names change buckets; unknown tools stay in the stated bucket', () => {
  const document = resume(['Technical Tools (skills): SQL, Python, VBA, Example Terminal, Advanced MS-Excel, CustomDesk']);
  const result = extractSectionOneFacts(document), skills = result.facts.filter(fact => fact.category === 'skills');
  assert.deepEqual(skills.filter(fact => fact.field === 'programming_languages').map(fact => fact.statement), ['SQL', 'Python', 'VBA']);
  assert.deepEqual(skills.filter(fact => fact.field === 'tools_technologies').map(fact => fact.statement), ['Example Terminal', 'Advanced MS-Excel', 'CustomDesk']);
  assert.equal(skills.length, 6);
  assert.ok(!result.facts.some(fact => ['experience_claims', 'quantitative_claims', 'client_relationships'].includes(fact.category)));
  assertExactEvidence(document, result.facts);
});

test('plain lists under an explicit skills heading remain literal skill facts', () => {
  const document = resume(['SKILLS', 'Python, Excel, SQL']);
  const result = extractSectionOneFacts(document);
  assert.deepEqual(result.facts.filter(fact => fact.field === 'programming_languages').map(fact => fact.statement), ['Python', 'SQL']);
  assert.equal(result.facts.find(fact => fact.statement === 'Excel').field, 'other_skills');
  assertExactEvidence(document, result.facts);
});

test('raw short years and Unicode date separators never acquire an assumed century', () => {
  const document = resume(['PROFESSIONAL EXPERIENCE', 'Example Employer            New York, NY', 'Reporting Analyst           Sep\u00a024\u2011Pres.']);
  const knownFacts = [anchor('employment', 'Reporting Analyst', 'Example Employer', 'Served from September 2024 to present.')];
  const result = extractSectionOneFacts(document, {knownFacts}), row = groups(result, 'employment')[0];
  assert.equal(row.start_date, 'Sep\u00a024');
  assert.equal(row.end_date, 'Pres.');
  assert.ok(!JSON.stringify(result.facts).includes('2024'));
  assert.ok(result.unresolved.some(issue => issue.field === 'start_date'));
  assertExactEvidence(document, result.facts);
});

test('only a labelled certification issue date is extracted without inventing a credential', () => {
  const document = resume(['CERTIFICATIONS', 'Certification: Example Certificate | Issue Date: March 2024']);
  const result = extractSectionOneFacts(document), rows = groups(result, 'certifications');
  assert.deepEqual(rows, [{certification_name: 'Example Certificate', issue_date: 'March 2024'}]);
  assertExactEvidence(document, result.facts);
});

test('job descriptions, deleted documents and narrative work create no Section1 user facts', () => {
  const jd = {...resume(['Hiring a Reporting Analyst  Jan 2020- Dec 2021']), kind: 'jd'};
  assert.equal(extractSectionOneFacts(jd).facts.length, 0);
  assert.equal(extractSectionOneFacts({...jd, kind: 'resume', deleted: true}).facts.length, 0);
  const document = resume(['PROFESSIONAL EXPERIENCE', 'Managed a team from January 2020 to December 2021 and improved reporting.']);
  assert.equal(extractSectionOneFacts(document).facts.length, 0);
});

test('deterministic reruns preserve source strings and do not mutate anchors or document state', () => {
  const document = resume(['Sample Candidate', 'PROFESSIONAL EXPERIENCE', 'Example Employer            New York, NY', 'Analyst           January 2020 – December 2021']);
  const knownFacts = [anchor('employment', 'Analyst', 'Example Employer')], before = structuredClone({document, knownFacts});
  const first = extractSectionOneFacts(document, {knownFacts}), second = extractSectionOneFacts(document, {knownFacts});
  assert.deepEqual(first, second);
  assert.deepEqual({document, knownFacts}, before);
  assertExactEvidence(document, first.facts);
});
