import test from 'node:test';
import assert from 'node:assert/strict';
import {groundFactProposals} from '../lib/profile/fact-grounding.mjs';
import {evidence} from '../lib/profile/domain.mjs';
import {buildFactReview} from '../lib/profile/fact-review.mjs';

function document(lines, options = {}) {
  return {id: 'resume', version: 2, kind: 'resume', mime: 'application/pdf',
    segments: lines.map((text, index) => ({id: `resume.page1.p${index + 1}`, text, locator: `page 1 paragraph ${index + 1}`})), ...options};
}
function proposal(doc, quote, index = 0, options = {}) {
  return {category: 'experience_claims', field: 'delivery', scope: 'Example Employer', statement: quote,
    experienceArea: 'Reporting', evidence: [{documentId: doc.id, segmentId: doc.segments[index].id, quote}], ...options};
}
const groundingError = error => error.status === 502 && error.message.startsWith('Fact evidence grounding: ');
function assertExact(doc, proposals) {
  for (const fact of proposals) assert.doesNotThrow(() => evidence({documents: [doc]}, fact.evidence));
}

test('already exact current references retain all supplied fields and leave the entire input untouched', () => {
  const doc = document(['Built 12 audit dashboards.']), fact = proposal(doc, doc.segments[0].text);
  fact.evidence[0].documentVersion = 2; fact.evidence[0].locator = 'model metadata preserved';
  const proposals = [fact], before = structuredClone({doc, proposals}), result = groundFactProposals(doc, proposals);
  assert.deepEqual(result, proposals); assert.notEqual(result, proposals); assert.notEqual(result[0], fact);
  assert.deepEqual({doc, proposals}, before); assertExact(doc, result);
});

test('whitespace-only differences map back to exact original whitespace rather than rewriting the source', () => {
  const doc = document(['Built\tmonthly  reports\u00a0for clients.']);
  const result = groundFactProposals(doc, [proposal(doc, 'Built monthly reports for clients.')]);
  assert.equal(result[0].statement, 'Built monthly reports for clients.');
  assert.equal(result[0].evidence[0].quote, doc.segments[0].text);
  assertExact(doc, result);
});

test('a same-page PDF continuation becomes exact original source fragments without changing the assertion', () => {
  const doc = document(['PROFESSIONAL EXPERIENCE', '• Prepared monthly risk reports for', 'regional clients using SQL.']);
  const fact = proposal(doc, 'Prepared monthly risk reports for regional clients using SQL.', 1);
  const result = groundFactProposals(doc, [fact]);
  assert.equal(result[0].statement, fact.statement); assert.equal(result[0].scope, fact.scope);
  assert.deepEqual(result[0].evidence, [
    {documentId: 'resume', segmentId: doc.segments[1].id, quote: 'Prepared monthly risk reports for'},
    {documentId: 'resume', segmentId: doc.segments[2].id, quote: 'regional clients using SQL.'}
  ]);
  assertExact(doc, result);
});

test('a uniquely quoted span can be reanchored from a mistaken known segment within the same source section', () => {
  const doc = document(['PROFESSIONAL EXPERIENCE', 'Built audit dashboards.']);
  const result = groundFactProposals(doc, [proposal(doc, 'Built audit dashboards.', 0)]);
  assert.equal(result[0].evidence[0].segmentId, doc.segments[1].id); assertExact(doc, result);
});

test('PDF labelled-list wrapping may recover a literal capitalized continuation without making a work claim', () => {
  const doc = document(['CORE COMPETENCIES', 'Project Delivery: Scheduling, Risk & Issue', 'Tracking, Resource Allocation.']);
  const result = groundFactProposals(doc, [proposal(doc, 'Risk & Issue Tracking', 1, {category: 'skills', field: 'other_skills', scope: 'Explicitly listed skills'})]);
  assert.deepEqual(result[0].evidence.map(ref => ref.quote), ['Risk & Issue', 'Tracking']);
  assert.equal(result[0].category, 'skills'); assertExact(doc, result);
});

test('ambiguous repeated recovery is rejected, while an already exact declared occurrence remains valid', () => {
  const doc = document(['PROFESSIONAL EXPERIENCE', 'Built  audit dashboards.', 'Built audit  dashboards.']);
  assert.throws(() => groundFactProposals(doc, [proposal(doc, 'Built audit dashboards.', 0)]), error => groundingError(error) && /more than one passage/.test(error.message));
  const exact = proposal(doc, doc.segments[1].text, 1);
  assert.deepEqual(groundFactProposals(doc, [exact]), [exact]);
});

test('changed metrics, punctuation, case, and meaningful spaces are never repaired', () => {
  const doc = document(['PROFESSIONAL EXPERIENCE', 'Managed 12 accounts using Power BI; improved speed by 10%.']);
  for (const quote of [
    'Managed 13 accounts using Power BI; improved speed by 10%.',
    'Managed 12 accounts using Power BI, improved speed by 10%.',
    'managed 12 accounts using Power BI; improved speed by 10%.',
    'Managed 12 accounts using PowerBI; improved speed by 10%.',
    'Managed 12 accounts using Power BI; improved speed by 100%.',
    'Managed 12 accounts using Power BI; improved speed by 10 %.'
  ]) assert.throws(() => groundFactProposals(doc, [proposal(doc, quote, 0)]), groundingError, quote);
});

test('recovered quotes cannot match only a word or number prefix of a different source value', () => {
  const doc = document(['PROFESSIONAL EXPERIENCE', 'Managed 1200 accounts.']);
  assert.throws(() => groundFactProposals(doc, [proposal(doc, '120', 0)]), groundingError);
  const words = document(['PROFESSIONAL EXPERIENCE', 'Reported risk exposures.']);
  assert.throws(() => groundFactProposals(words, [proposal(words, 'exposure', 0)]), groundingError);
});

test('foreign, stale, deleted and employer-JD documents cannot establish profile evidence', () => {
  const doc = document(['Built audit dashboards.']);
  const foreign = proposal(doc, doc.segments[0].text); foreign.evidence[0].documentId = 'another-resume';
  assert.throws(() => groundFactProposals(doc, [foreign]), groundingError);
  const stale = proposal(doc, doc.segments[0].text); stale.evidence[0].documentVersion = 1;
  assert.throws(() => groundFactProposals(doc, [stale]), groundingError);
  for (const overrides of [{deleted: true}, {kind: 'jd'}, {kind: 'unknown'}])
    assert.throws(() => groundFactProposals({...doc, ...overrides}, [proposal(doc, doc.segments[0].text)]), groundingError);
});

test('a fabricated segment ID is not guessed even if the literal passage exists elsewhere', () => {
  const doc = document(['Built audit dashboards.']), fact = proposal(doc, doc.segments[0].text);
  fact.evidence[0].segmentId = 'invented-segment';
  assert.throws(() => groundFactProposals(doc, [fact]), error => groundingError(error) && /unknown source segment/.test(error.message));
});

test('cross-segment recovery never crosses a page, a new bullet, or a separate paragraph', () => {
  const cases = [
    {lines: ['Prepared reports for', '• regional clients.']},
    {lines: ['Prepared reports for', 'Regional clients received them.']},
    {lines: ['Prepared reports.', 'regional clients received them.']},
    {lines: ['Prepared reports for', 'regional clients.'], secondPage: true},
    {lines: ['Prepared reports for', 'regional clients.'], mime: 'text/plain'},
    {lines: ['Prepared reports for', 'regional clients.'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
  ];
  for (const item of cases) {
    const doc = document(item.lines, item.mime ? {mime: item.mime} : {});
    if (item.secondPage) { doc.segments[1].id = 'resume.page2.p1'; doc.segments[1].locator = 'page 2 paragraph 1'; }
    assert.throws(() => groundFactProposals(doc, [proposal(doc, item.lines.join(' '))]), groundingError, JSON.stringify(item));
  }
});

test('headings, new labelled fields and employment records block cross-span quote repair', () => {
  for (const lines of [
    ['Prepared reports for', 'EDUCATION', 'regional clients.'],
    ['Tools: SQL, Python,', 'Operations: Tracking, Reporting.'],
    ['Prepared reports for', 'Example Employer Jan 2020 – Dec 2021', 'Analyst | Boston, MA'],
    ['Prepared reports for', 'Analyst | Boston, MA', 'regional clients.']
  ]) {
    const doc = document(lines);
    assert.throws(() => groundFactProposals(doc, [proposal(doc, lines.join(' '))]), groundingError);
  }
});

test('a unique source passage cannot be reanchored across two explicitly different employment records', () => {
  const doc = document(['PROFESSIONAL EXPERIENCE',
    'Example One Jan 2020 – Dec 2021', 'Analyst | Boston, MA', 'Built audit dashboards.',
    'Example Two Jan 2022 – Dec 2023', 'Analyst | Boston, MA', 'Prepared investor reports.']);
  assert.throws(() => groundFactProposals(doc, [proposal(doc, 'Prepared investor reports.', 3)]), error => groundingError(error) && /different record or section/.test(error.message));
});

test('oversized quotes are rejected before any truncation could turn them into matching source prefixes', () => {
  const doc = document(['A'.repeat(6000)]), fact = proposal(doc, 'A'.repeat(6000) + ' changed');
  assert.throws(() => groundFactProposals(doc, [fact]), error => groundingError(error) && /oversized/.test(error.message));
});

test('evidence caps apply before and after repair, without silently dropping citations', () => {
  const doc = document(['Built reports for', ...Array.from({length: 8}, (_, index) => `regional group ${index} and`)]);
  assert.throws(() => groundFactProposals(doc, [proposal(doc, doc.segments.map(segment => segment.text).join(' '))]), error => groundingError(error) && /eight source references/.test(error.message));
  const fact = proposal(doc, doc.segments[0].text); fact.evidence = Array.from({length: 9}, () => structuredClone(fact.evidence[0]));
  assert.throws(() => groundFactProposals(doc, [fact]), groundingError);
  fact.evidence = []; assert.throws(() => groundFactProposals(doc, [fact]), groundingError);
});

test('saved answers support original within-segment whitespace, without joining unknown paragraphs', () => {
  const doc = document(['Prepared\nmonthly reports for clients.'], {kind: 'answer', mime: 'text/plain'});
  const result = groundFactProposals(doc, [proposal(doc, 'Prepared monthly reports for clients.')]);
  assert.equal(result[0].evidence[0].quote, doc.segments[0].text); assertExact(doc, result);
  const split = document(['Prepared reports for', 'regional clients.'], {kind: 'answer', mime: 'text/plain'});
  assert.throws(() => groundFactProposals(split, [proposal(split, 'Prepared reports for regional clients.')]), groundingError);
});

test('all-batch preflight preserves input statements, order and metadata, including when a later quote fails', () => {
  const doc = document(['PROFESSIONAL EXPERIENCE', 'Prepared reports for', 'regional clients.', 'Managed 12 accounts.']);
  const proposals = [proposal(doc, 'Prepared reports for regional clients.', 1), proposal(doc, 'Managed 13 accounts.', 3)];
  const before = structuredClone({doc, proposals});
  assert.throws(() => groundFactProposals(doc, proposals), groundingError);
  assert.deepEqual({doc, proposals}, before);
  const valid = [proposals[0], proposal(doc, 'Managed 12 accounts.', 3, {category: 'quantitative_claims', field: 'accounts'})];
  const result = groundFactProposals(doc, valid);
  assert.deepEqual(result.map(({evidence, ...fact}) => fact), valid.map(({evidence, ...fact}) => fact));
  assertExact(doc, result);
});

const listedTools = 'Tools: Procore, SharePoint, Excel (Advanced), Power BI, SQL, Tableau, Python, Jira.';
const skillProposal = (doc, statement, field, quote = statement, index = 1) => proposal(doc, quote, index, {category: 'skills', field, scope: 'skills', statement});

test('established whitespace grounding takes precedence for whole-list evidence on single or grouped skill statements', () => {
  const doc = document(['CORE COMPETENCIES', 'Tools: Python, SQL']);
  for (const statement of ['Python', 'Python, SQL']) {
    const fact = skillProposal(doc, statement, 'programming_languages', 'Tools: Python,  SQL');
    const result = groundFactProposals(doc, [fact]);
    assert.equal(result[0].statement, statement);
    assert.deepEqual(result[0].evidence, [{documentId: doc.id, segmentId: doc.segments[1].id, quote: doc.segments[1].text}]);
    assertExact(doc, result);
  }
});

test('noncontiguous grouped skills recover only exact whole listed items with their canonical source buckets', () => {
  const doc = document(['CORE COMPETENCIES', listedTools]);
  const languages = skillProposal(doc, 'Python, SQL', 'programming_languages');
  const tools = skillProposal(doc, 'Procore, SharePoint, Excel (Advanced), Power BI, Tableau, Jira', 'tools_technologies');
  const before = structuredClone({doc, languages, tools}), result = groundFactProposals(doc, [languages, tools]);
  assert.deepEqual(result.map(fact => fact.statement), [languages.statement, tools.statement]);
  assert.deepEqual(result.map(fact => fact.evidence.map(ref => ref.quote)), [
    ['Python', 'SQL'], ['Procore', 'SharePoint', 'Excel (Advanced)', 'Power BI', 'Tableau', 'Jira']
  ]);
  assert.ok(result.flatMap(fact => fact.evidence).every(ref => ref.segmentId === doc.segments[1].id));
  assert.deepEqual({doc, languages, tools}, before); assertExact(doc, result);
  assert.deepEqual(groundFactProposals(doc, result), result, 'exact item citations remain valid on another grounding pass');
});

test('a grouped skill quote may differ in item order and comma/semicolon delimiters but never item contents', () => {
  const doc = document(['CORE COMPETENCIES', listedTools]);
  const result = groundFactProposals(doc, [skillProposal(doc, 'Python; SQL', 'programming_languages', 'SQL; Python')]);
  assert.equal(result[0].statement, 'Python; SQL');
  assert.deepEqual(result[0].evidence.map(ref => ref.quote), ['SQL', 'Python']);
  assertExact(doc, result);
});

test('grouped-skill repair rejects unsupported items, partial tool names, changed case, qualifiers and tenure', () => {
  const doc = document(['CORE COMPETENCIES', listedTools]);
  for (const [statement, field] of [
    ['Java, SQL', 'programming_languages'], ['Expert Python, SQL', 'programming_languages'],
    ['BI, Jira', 'tools_technologies'], ['python, SQL', 'programming_languages'],
    ['Python (5 years), SQL', 'programming_languages'], ['Python, SQL', 'tools_technologies'],
    ['Python, SQL', 'programming'], ['Python, Python, SQL', 'programming_languages']
  ]) assert.throws(() => groundFactProposals(doc, [skillProposal(doc, statement, field)]), groundingError, statement + ' / ' + field);
});

test('the asserted and quoted grouped skill sets must match without additional or omitted items', () => {
  const doc = document(['CORE COMPETENCIES', listedTools]);
  for (const [statement, quote] of [['Python, SQL, Java', 'Python, SQL'], ['Python', 'Python, SQL'], ['Python, SQL', 'Python, SQL, Java']])
    assert.throws(() => groundFactProposals(doc, [skillProposal(doc, statement, 'programming_languages', quote)]), groundingError);
});

test('grouped skill repair cannot borrow a narrative substring or another source segment listing', () => {
  const narrative = document(['PROFESSIONAL EXPERIENCE', 'Used SQL, Tableau and Python to prepare reports.']);
  assert.throws(() => groundFactProposals(narrative, [skillProposal(narrative, 'Python, SQL', 'programming_languages')]), groundingError);
  const doc = document(['CORE COMPETENCIES', 'Tools: Excel, Jira.', listedTools]);
  assert.throws(() => groundFactProposals(doc, [skillProposal(doc, 'Python, SQL', 'programming_languages')]), groundingError);
});

test('grouped-skill recovery preserves original internal source whitespace and the eight-reference cap', () => {
  const doc = document(['CORE COMPETENCIES', 'Tools: Power  BI, Excel, Jira.']);
  const result = groundFactProposals(doc, [skillProposal(doc, 'Jira, Power BI', 'tools_technologies')]);
  assert.deepEqual(result[0].evidence.map(ref => ref.quote), ['Jira', 'Power  BI']); assertExact(doc, result);
  const tooMany = document(['CORE COMPETENCIES', 'Tools: ToolA, ToolB, ToolC, ToolD, ToolE, ToolF, ToolG, ToolH, ToolI.']);
  assert.throws(() => groundFactProposals(tooMany, [skillProposal(tooMany, 'ToolI, ToolH, ToolG, ToolF, ToolE, ToolD, ToolC, ToolB, ToolA', 'tools_technologies')]), error => groundingError(error) && /eight source references/.test(error.message));
});

test('grouped repair keeps proposal indices and downstream atomic skill review without adding unrequested source skills', () => {
  const doc = document(['CORE COMPETENCIES', listedTools, 'Built audit dashboards.']);
  const facts = [proposal(doc, doc.segments[2].text, 2), skillProposal(doc, 'Python, SQL', 'programming_languages'),
    skillProposal(doc, 'Procore, SharePoint, Excel (Advanced), Power BI, Tableau, Jira', 'tools_technologies')];
  const result = groundFactProposals(doc, facts);
  assert.equal(result.length, facts.length);
  assert.deepEqual(result.map(({evidence, ...fact}) => fact), facts.map(({evidence, ...fact}) => fact));
  const state = {documents: [doc], facts: result.map((fact, index) => ({...fact, id: `group${index}`, version: 1, lifecycle: 'active', approval: 'pending'}))};
  const review = buildFactReview(state);
  assert.deepEqual(review.skills.programmingLanguages.map(item => item.value), ['Python', 'SQL']);
  assert.deepEqual(review.skills.toolsTechnologies.map(item => item.value), ['Procore', 'SharePoint', 'Excel (Advanced)', 'Power BI', 'Tableau', 'Jira']);
  assert.ok([...review.skills.programmingLanguages, ...review.skills.toolsTechnologies].every(item => item.approvalStatus === 'pending'));
});
