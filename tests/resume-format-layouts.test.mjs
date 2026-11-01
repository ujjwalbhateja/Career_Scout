import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSectionOneFacts, SECTION_ONE_PARSER_VERSION} from '../lib/profile/section-one.mjs';

const resume = lines => ({id: 'layout-fixture', kind: 'resume', version: 1,
  segments: lines.map((text, index) => ({id: `p${index}`, text}))});
function records(result, category) {
  const grouped = new Map();
  for (const fact of result.facts.filter(fact => fact.category === category)) {
    if (!grouped.has(fact.scope)) grouped.set(fact.scope, {});
    grouped.get(fact.scope)[fact.field] = fact.statement;
  }
  return [...grouped.values()];
}
function assertLiteralProposals(document, result) {
  for (const fact of result.facts) {
    assert.ok(fact.evidence.some(ref => ref.quote.includes(fact.statement)), fact.statement);
    assert.ok(fact.evidence.every(ref => ref.documentId === document.id && document.segments.some(segment => segment.id === ref.segmentId && segment.text.includes(ref.quote))));
    assert.ok(!('approval' in fact) && !('approvalRef' in fact));
    assert.ok(['personal', 'employment', 'education', 'certifications', 'skills'].includes(fact.category));
  }
}

test('employer/date then immediately adjacent title/location PDF lines establish separate literal stints', () => {
  const document = resume(['PROFESSIONAL EXPERIENCE',
    'Example Rail Systems Inc. Jul 2026 – Present', 'Project Coordinator | Boston, MA, USA',
    '• Coordinate two delivery projects and maintain schedules.',
    'Example Retail Group Oct 2025 – Jun 2026', 'Operations Management Specialist | Boston, MA, USA',
    '• Tracked inventory and investigated operational issues.',
    'Example Logistics Jul 2021 – Aug 2023', 'International Operations Manager | Kolkata, India',
    '• Coordinated international orders and timelines.',
    'Example Manufacturing Oct 2017 – Dec 2020', 'Business Support Analyst | Kolkata, India']);
  const result = extractSectionOneFacts(document), jobs = records(result, 'employment');
  assert.equal(jobs.length, 4);
  assert.deepEqual(jobs.map(job => job.company_name), ['Example Rail Systems Inc.', 'Example Retail Group', 'Example Logistics', 'Example Manufacturing']);
  assert.deepEqual(jobs.map(job => job.job_title), ['Project Coordinator', 'Operations Management Specialist', 'International Operations Manager', 'Business Support Analyst']);
  assert.deepEqual(jobs.map(job => job.start_date), ['Jul 2026', 'Oct 2025', 'Jul 2021', 'Oct 2017']);
  assert.deepEqual(jobs.map(job => job.end_date), ['Present', 'Jun 2026', 'Aug 2023', 'Dec 2020']);
  assert.deepEqual(jobs.map(job => job.location), ['Boston, MA, USA', 'Boston, MA, USA', 'Kolkata, India', 'Kolkata, India']);
  assert.ok(!result.facts.some(fact => /Coordinate two|Tracked inventory|Coordinated international/.test(fact.statement)));
  const title = result.facts.find(fact => fact.field === 'job_title');
  assert.equal(title.evidence[0].segmentId, 'p2');
  assert.equal(title.evidence[0].quote, 'Project Coordinator');
  assert.equal(result.facts.find(fact => fact.field === 'start_date').evidence[0].segmentId, 'p1');
  assertLiteralProposals(document, result);
});

test('split employment association cannot skip a work passage or a section heading', () => {
  for (const barrier of ['• Supported delivery and maintained records.', 'EDUCATION']) {
    const document = resume(['PROFESSIONAL EXPERIENCE', 'Example Employer Jul 2024 – Aug 2025', barrier, 'Project Coordinator | Boston, MA, USA']);
    const result = extractSectionOneFacts(document);
    assert.equal(result.facts.filter(fact => fact.category === 'employment').length, 0);
    assertLiteralProposals(document, result);
  }
});

test('bulleted and action narrative cannot become an employer/date header for the next title', () => {
  for (const narrative of ['• Built controls Jan 2020 - Dec 2021', '- Managed schedules Jan 2020 - Dec 2021',
    '• Example Project Jan 2020 - Dec 2021', 'Built controls Jan 2020 - Dec 2021']) {
    const document = resume(['PROFESSIONAL EXPERIENCE', narrative, 'Analyst | Boston, MA']);
    const result = extractSectionOneFacts(document);
    assert.equal(records(result, 'employment').length, 0, narrative);
    assertLiteralProposals(document, result);
  }
});

test('non-employment sections terminate split and same-line employment recognition until a new work heading', () => {
  for (const heading of ['PROJECTS', 'REFERENCES', 'PUBLICATIONS', 'AWARDS', 'INTERESTS', 'VOLUNTEER EXPERIENCE', 'PROFESSIONAL SUMMARY']) {
    const document = resume(['PROFESSIONAL EXPERIENCE', heading,
      'Example Pipeline Jan 2020 - Dec 2021', 'Data Engineer | Boston, MA',
      'Software Engineer Jan 2022 - Dec 2023',
      'PROFESSIONAL EXPERIENCE', 'Example Employer Jan 2024 - Dec 2025', 'Project Coordinator | Boston, MA']);
    const result = extractSectionOneFacts(document), jobs = records(result, 'employment');
    assert.equal(jobs.length, 1, heading);
    assert.equal(jobs[0].company_name, 'Example Employer', heading);
    assert.equal(jobs[0].job_title, 'Project Coordinator', heading);
    assertLiteralProposals(document, result);
  }
});

test('degree-first institution columns preserve explicit qualification and dates without assuming graduation', () => {
  const document = resume(['EDUCATION',
    'Master of Science in Business Analytics | Example University Sep 2023 – May 2025',
    'Bachelor of Economics | Sample University Aug 2016 – Dec 2018',
    'Diploma in Hardware & Networking | Example Institute Jul 2017 – Aug 2018']);
  const result = extractSectionOneFacts(document), education = records(result, 'education');
  assert.deepEqual(education, [
    {institution_name: 'Example University', qualification: 'Master of Science in Business Analytics', start_date: 'Sep 2023', end_date: 'May 2025'},
    {institution_name: 'Sample University', qualification: 'Bachelor of Economics', start_date: 'Aug 2016', end_date: 'Dec 2018'},
    {institution_name: 'Example Institute', qualification: 'Diploma in Hardware & Networking', start_date: 'Jul 2017', end_date: 'Aug 2018'}
  ]);
  assert.ok(!result.facts.some(fact => /completed|graduated|awarded/.test(fact.statement)));
  assertLiteralProposals(document, result);
});

test('wrapped competency lists extract complete source terms but leave a cross-segment term unresolved', () => {
  const document = resume(['CORE COMPETENCIES',
    'Project Delivery: Project Scheduling, Milestone Tracking, Procurement Coordination, Risk & Issue',
    'Tracking, Budget & Cost Tracking, Resource Allocation, Quality & Compliance.',
    'Operations: Process Improvement, Root Cause Analysis, Inventory Control, Audit Support.',
    'Tools: Procore, SharePoint, Excel (Advanced), Power BI, SQL, Tableau, Python, Jira.']);
  const result = extractSectionOneFacts(document), skills = result.facts.filter(fact => fact.category === 'skills');
  assert.ok(skills.some(fact => fact.statement === 'Budget & Cost Tracking'));
  assert.ok(skills.some(fact => fact.statement === 'Quality & Compliance'));
  assert.ok(skills.some(fact => fact.statement === 'Inventory Control'));
  assert.equal(skills.find(fact => fact.statement === 'Excel (Advanced)').field, 'tools_technologies');
  assert.deepEqual(skills.filter(fact => fact.field === 'programming_languages').map(fact => fact.statement), ['SQL', 'Python']);
  assert.ok(!skills.some(fact => ['Risk & Issue', 'Tracking', 'Risk & Issue Tracking', 'Jira.'].includes(fact.statement)));
  assert.ok(result.unresolved.some(issue => /spans source lines/.test(issue.reason)));
  assertLiteralProposals(document, result);
});

test('competency continuation stops at education, employment, unknown headings, and work bullets', () => {
  const document = resume(['CORE COMPETENCIES', 'Tools: Excel, SQL,', 'EDUCATION',
    'Bachelor of Science | Example University Aug 2016 – Dec 2018',
    'CORE COMPETENCIES', 'Operations: Process Improvement, Audit Support,', 'AWARDS', 'Example Honor',
    'CORE COMPETENCIES', 'Tools: Python, Jira,', 'PROFESSIONAL EXPERIENCE',
    'Example Employer Jan 2020 – Dec 2021', 'Project Coordinator | Boston, MA, USA',
    '• Managed inventory and coordinated projects.']);
  const result = extractSectionOneFacts(document), skills = result.facts.filter(fact => fact.category === 'skills');
  assert.deepEqual(skills.map(fact => fact.statement), ['Excel', 'SQL', 'Process Improvement', 'Audit Support', 'Python', 'Jira']);
  assert.equal(records(result, 'education').length, 1);
  assert.equal(records(result, 'employment').length, 1);
  assertLiteralProposals(document, result);
});

test('parenthesized phone prefixes and explicit country codes remain exact source values', () => {
  for (const value of ['(202) 555-0147', '+1 (202) 555-0147', '+44 20 7946 0958', '202-555-0147']) {
    const document = resume([`Sample Candidate ${value} sample@example.test`]);
    const result = extractSectionOneFacts(document);
    assert.equal(result.facts.find(fact => fact.field === 'mobile').statement, value);
    assert.equal(result.facts.find(fact => fact.field === 'full_name').statement, 'Sample Candidate');
    assertLiteralProposals(document, result);
  }
});

test('new layout support is deterministic, source-only, and keeps short years unexpanded', () => {
  const document = resume(['PROFESSIONAL EXPERIENCE', 'Example Employer Sep 24 – Pres.', 'Project Coordinator | Boston, MA, USA',
    'EDUCATION', 'Master of Science | Example University Sep 21 – May 23']);
  const before = structuredClone(document), first = extractSectionOneFacts(document), second = extractSectionOneFacts(document);
  assert.equal(SECTION_ONE_PARSER_VERSION, 'section-one-source-v3');
  assert.deepEqual(first, second);
  assert.deepEqual(document, before);
  assert.equal(records(first, 'employment')[0].start_date, 'Sep 24');
  assert.equal(records(first, 'education')[0].start_date, 'Sep 21');
  assert.ok(!JSON.stringify(first.facts).includes('2024'));
  assert.ok(first.unresolved.some(issue => /no century was assumed/.test(issue.reason)));
  assertLiteralProposals(document, first);
});
