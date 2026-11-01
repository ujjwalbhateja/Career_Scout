import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanJDText,primaryJDSegments,extractPrimaryJDContent} from '../lib/profile/link-intake.mjs';

const employer='Responsibilities\nPerform NAV oversight and prepare client reports.\nQualifications\nExperience with fund accounting and client communication is required. This is the employer job description.';

test('primary HTML excludes BuiltIn-style AI summaries, nested recommendations and navigation',()=>{
  const html='<html><title>Fund Analyst</title><body><nav>Python Navigation Engineer</nav><main><h1>Fund Analyst</h1><section data-testid="ai-summary"><h2>AI Summary</h2><div>Invented Quantum Architecture</div></section><div id="job-description"><div><h2>Responsibilities</h2><p>Perform NAV oversight and prepare client reports.</p></div><h2>Qualifications</h2><p>Experience with fund accounting and client communication is required.</p><section class="similar-jobs"><div><h3>Space Surgeon</h3><p>Unrelated medical qualifications</p></div></section></div><aside>Recommended SQL Guru</aside></main></body></html>';
  const result=extractPrimaryJDContent(html,'https://builtin.example/jobs/fund-analyst');assert.ok(result.content.includes('NAV oversight'));assert.ok(result.content.includes('fund accounting'));
  for(const excluded of ['Invented Quantum','Space Surgeon','medical qualifications','Navigation Engineer','Recommended SQL'])assert.ok(!result.content.includes(excluded),excluded);
});

test('AI-summary and recommendation text headings are excluded without depending on CSS attributes',()=>{
  const result=cleanJDText('Fund Analyst\nAI Summary\nInvented Quantum Architecture\nFull Job Description\n'+employer+'\nSimilar Jobs\nSpace Surgeon\nMedical degree required');
  assert.ok(result.includes('NAV oversight'));assert.ok(!result.includes('Quantum'));assert.ok(!result.includes('Space Surgeon'));
});

test('structured primary JobPosting is selected by URL instead of combining recommended job schemas',()=>{
  const postings=[{'@type':'JobPosting',title:'Fund Analyst',url:'https://board.example/jobs/one',description:employer},{'@type':'JobPosting',title:'Space Surgeon',url:'https://board.example/jobs/two',description:'Medical degree required. Responsibilities include operating on astronauts.'}];
  const html='<h1>Fund Analyst</h1><script type="application/ld+json">'+JSON.stringify(postings)+'</script>';
  const result=extractPrimaryJDContent(html,'https://board.example/jobs/one?utm_source=test');assert.equal(result.title,'Fund Analyst');assert.ok(result.content.includes('NAV oversight'));assert.ok(!result.content.includes('astronauts'));
});

test('ambiguous multiple-job directory pages are rejected instead of merging requirements',()=>{
  const postings=['First Analyst','Second Analyst'].map((title,i)=>({'@type':'JobPosting',title,url:'https://board.example/jobs/'+i,description:employer}));
  assert.throws(()=>extractPrimaryJDContent('<h1>Current jobs</h1><script type="application/ld+json">'+JSON.stringify(postings)+'</script>','https://board.example/jobs'),/multiple jobs/);
});

test('stored paragraph filtering carries AI/recommendation state across paragraphs and preserves exact sources',()=>{
  const segments=[{id:'p1',text:'Fund Analyst'},{id:'p2',text:'AI Summary'},{id:'p3',text:'Invented Quantum Architecture'},{id:'p4',text:'Full Job Description'},{id:'p5',text:employer},{id:'p6',text:'Similar Jobs'},{id:'p7',text:'Space Surgeon: Medical degree required'}];
  const cleaned=primaryJDSegments(segments);assert.deepEqual(cleaned.map(s=>s.id),['p1','p4','p5']);assert.ok(cleaned.every(s=>segments.find(original=>original.id===s.id).text.includes(s.text)));
});

test('one stored segment keeps only an original contiguous employer description span',()=>{
  const original='AI Summary\nInvented Quantum Architecture\nFull Job Description\n'+employer+'\nRecommended Jobs\nSpace Surgeon';
  const cleaned=primaryJDSegments([{id:'one',text:original,locator:'original page'}]);assert.equal(cleaned.length,1);assert.equal(cleaned[0].id,'one');assert.equal(cleaned[0].locator,'original page');assert.ok(original.includes(cleaned[0].text));assert.ok(cleaned[0].text.includes('NAV oversight'));assert.ok(!cleaned[0].text.includes('Quantum'));assert.ok(!cleaned[0].text.includes('Space Surgeon'));
});
