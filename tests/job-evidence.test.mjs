import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateFromHit,classifyHit,verifyEvidence,dedupeEvidence,canonicalJobURL} from '../lib/job-evidence.mjs';
import {locationAssessment} from '../lib/matching.mjs';

const hit={title:'Portfolio Analyst @ Harbor Investments | Simplify',url:'https://simplify.jobs/p/12345678/Portfolio-Analyst',snippet:'Location: New York, NY, US\nRequirements: Analyze portfolio performance and attribution. Apply for this full-time role.',published_at:'2026-10-22T00:00:00Z',acquired_at:'2026-10-23T00:00:00Z'};
const checkedAt='2026-10-24T16:00:00Z';
const body='# Portfolio Analyst\nLocation: New York, NY, US\nCompany: Harbor Investments\nFull-time\nResponsibilities\nAnalyze investment portfolio performance and attribution. Build reporting processes and quantitative tools for institutional clients.\nRequirements\nThree years of investment experience and Python skills.\nAnnual base salary: USD $95,000–$120,000 per year.\nApply for this job';

test('directory title overrides misleading job-shaped search URL',()=>{
  assert.equal(classifyHit({title:'10,000+ Portfolio Analyst Jobs in United States | LinkedIn',url:'https://linkedin.com/jobs/view/analyst-at-company-12345'}),'directory');
  assert.equal(candidateFromHit({title:'Portfolio Analyst Jobs, Employment | Indeed.com',url:'https://indeed.com/q-portfolio-analyst-jobs.html'}),null);
  assert.equal(classifyHit({title:'Portfolio Analyst salary guide',url:'https://example.com/career/salary-guide'}),'irrelevant');
});
test('a discovery lead keeps page/index dates separate from an unknown posting date',()=>{
  const job=candidateFromHit(hit);
  assert.equal(job.title,'Portfolio Analyst');assert.equal(job.company,'Harbor Investments');
  assert.equal(job.location,'New York, NY, US');assert.equal(job.postedAt,null);
  assert.equal(job.indexedAt,'2026-10-23T00:00:00.000Z');assert.equal(job.pagePublishedAt,'2026-10-22T00:00:00.000Z');
  assert.equal(job.verification.status,'unverified');
});
test('unknown employer and geography are never inferred from the search country or provider',()=>{
  const job=candidateFromHit({title:'Registered Nurse',url:'https://example.com/jobs/rn-123',snippet:'Requirements: nursing qualification. Apply now. Company Does Not Provide H1B Sponsorship'});
  assert.equal(job.company,'Company not stated');assert.equal(job.location,'Not stated');
});
test('employer + geography in a page title remain grounded',()=>{
  const job=candidateFromHit({title:'Portfolio Insights Analyst (New York, NY, United States) - Initio Capital',url:'https://app.workwolf.com/pipelineLink/PUUVC38C',snippet:'Apply now'});
  assert.equal(job.title,'Portfolio Insights Analyst');assert.equal(job.company,'Initio Capital');assert.equal(job.location,'New York, NY, United States');
});
test('readable individual page with application evidence is available, with salary evidence',()=>{
  const job=verifyEvidence(candidateFromHit(hit),{title:'Portfolio Analyst',url:'https://jobs.example.com/job/123',content:body},checkedAt);
  assert.equal(job.verification.status,'available');assert.equal(job.isJob,true);assert.equal(job.salary.max,120000);assert.equal(job.salary.currency,'USD');assert.equal(job.salary.period,'year');
  assert.equal(job.postedAt,null);assert.match(job.fieldEvidence.salary,/Annual base salary/);
});
test('unreadable and insufficient-content pages remain unverified, not closed',()=>{
  for (const content of ['', 'Access denied', 'Portfolio Analyst. Welcome to our website.']) {
    const job=verifyEvidence(candidateFromHit(hit),{title:'Portfolio Analyst',content},checkedAt);
    assert.equal(job.verification.status,'unverified');
  }
});
test('live directory content invalidates a misleading candidate',()=>{
  const job=verifyEvidence(candidateFromHit(hit),{title:'Portfolio Analyst Jobs in United States',content:'Search results\n10,000 jobs\nApply now'},checkedAt);
  assert.equal(job.isJob,false);assert.equal(job.isDirectory,true);assert.equal(job.verification.status,'unverified');
});
test('closure notice is explicit and does not confuse ordinary negative role wording',()=>{
  const normal=verifyEvidence(candidateFromHit(hit),{content:body+'\nThis is not a traditional investment analyst role.'},checkedAt);
  assert.equal(normal.verification.status,'available');
  const closed=verifyEvidence(candidateFromHit(hit),{content:"We're sorry, the job you are trying to apply for has been filled."},checkedAt);
  assert.equal(closed.verification.status,'closed');
  const other=verifyEvidence(candidateFromHit(hit),{content:body+'\nRelated jobs\nThis position has been filled.'},checkedAt);
  assert.equal(other.verification.status,'available');
});
test('absolute application deadline expires at end of stated date, indexing cannot revive it',()=>{
  const current=verifyEvidence(candidateFromHit(hit),{content:body+'\nApplication deadline: October 24, 2026'},checkedAt);
  assert.equal(current.verification.status,'available');
  const closed=verifyEvidence(candidateFromHit(hit),{content:body+'\nApplication deadline: October 10, 2026'},checkedAt);
  assert.equal(closed.verification.status,'closed');
  const relative=verifyEvidence(candidateFromHit(hit),{content:body+'\nApplications close: in 5 days'},checkedAt);
  assert.equal(relative.verification.status,'available');
});
test('structured JobPosting takes precedence and expiry remains distinct from datePosted',()=>{
  const jobPosting={'@type':'JobPosting',title:'Portfolio Analyst',description:body,hiringOrganization:{name:'Verified Employer'},jobLocation:{address:{addressLocality:'Boston',addressRegion:'MA',addressCountry:'US'}},datePosted:'2026-09-20',validThrough:'2026-10-10',employmentType:'FULL_TIME',baseSalary:{currency:'USD',value:{minValue:100000,maxValue:130000,unitText:'YEAR'}}};
  const job=verifyEvidence(candidateFromHit(hit),{content:body,jobPosting},checkedAt);
  assert.equal(job.company,'Verified Employer');assert.equal(job.location,'Boston, MA, US');assert.equal(job.salary.max,130000);
  assert.equal(job.postedAt,'2026-09-20T00:00:00.000Z');assert.equal(job.verification.status,'closed');
});
test('HTML structured data is extracted and publisher scripts never enter description',()=>{
  const schema={'@type':'JobPosting',title:'Portfolio Analyst',description:body,hiringOrganization:{name:'Schema Firm'},datePosted:'2026-10-20'};
  const job=verifyEvidence(candidateFromHit(hit),{content:'<script type="application/ld+json">'+JSON.stringify(schema)+'</script><h1>Portfolio Analyst</h1><div>'+body+'</div><script>alert(1)</script>'},checkedAt);
  assert.equal(job.company,'Schema Firm');assert.equal(job.verification.status,'available');assert.ok(!job.description.includes('alert(1)'));
});
test('canonical URLs drop tracking but preserve job identity query parameters',()=>{
  assert.equal(canonicalJobURL('https://www.example.com/job?job_id=123&utm_source=mail&fbclid=abc#apply'),'https://example.com/job?job_id=123');
  assert.notEqual(canonicalJobURL('https://example.com/job?jk=abc'),canonicalJobURL('https://example.com/job?jk=def'));
  assert.equal(canonicalJobURL('https://example.com/careers?position=123&utm_source=mail'),'https://example.com/careers?position=123');
  assert.notEqual(canonicalJobURL('https://example.com/careers?position=123'),canonicalJobURL('https://example.com/careers?position=456'));
  assert.equal(canonicalJobURL('https://secret@example.com/job'),'');
});
test('duplicates combine source links and prefer employer application URL',()=>{
  const board=candidateFromHit(hit);
  const employer=verifyEvidence(board,{title:hit.title,url:'https://jobs.example.com/job/123',content:body},checkedAt);
  employer.id='employer:123';
  const jobs=dedupeEvidence([board,employer]);
  assert.equal(jobs.length,1);assert.equal(jobs[0].sources.length,2);assert.equal(jobs[0].url,'https://jobs.example.com/job/123');assert.equal(jobs[0].verification.status,'available');assert.equal(jobs[0].duplicateCount,1);
});
test('different known locations, requisitions, and unknown employers stay distinct',()=>{
  const a=candidateFromHit({...hit,url:'https://job-boards.greenhouse.io/harbor/jobs/123'});
  const b=candidateFromHit({...hit,url:'https://job-boards.greenhouse.io/harbor/jobs/456'});
  assert.equal(dedupeEvidence([a,b]).length,2);
  assert.equal(dedupeEvidence([a,{...b,requisitionId:'',url:'https://example.net/job/789',location:'Boston, MA, US'}]).length,2);
  assert.equal(dedupeEvidence([{...a,company:'Company not stated'},{...b,company:'Company not stated'}]).length,2);
});
test('employer closure overrides an available aggregate copy',()=>{
  const board=verifyEvidence(candidateFromHit(hit),{content:body},checkedAt);
  const employer=verifyEvidence(board,{title:hit.title,url:'https://jobs.example.com/job/123',content:'This position has been filled.'},checkedAt);
  assert.equal(dedupeEvidence([board,employer])[0].verification.status,'closed');
});
test('a company named after a city is not mistaken for the vacancy location',()=>{
  const job=candidateFromHit({...hit,title:'Portfolio Analyst @ Chicago Investment Management',snippet:'Chicago Investment Management\nRequirements: portfolio analytics. Apply now.'});
  assert.equal(job.company,'Chicago Investment Management');assert.equal(job.location,'Not stated');
});
test('salary extraction does not treat a retirement-plan number as a salary bound',()=>{
  const job=verifyEvidence(candidateFromHit(hit),{content:body.replace('Annual base salary: USD $95,000–$120,000 per year.','Annual salary: USD $100,000 plus 401(k) benefits.')},checkedAt);
  assert.equal(job.salary.min,100000);assert.equal(job.salary.max,100000);
});
test('login page does not invalidate the lead and closure preserves its role title',()=>{
  const initial=candidateFromHit(hit);
  const login=verifyEvidence(initial,{title:'Sign in',content:'Enter your email to sign in and find career opportunities. '.repeat(10)},checkedAt);
  assert.equal(login.isJob,true);assert.equal(login.verification.status,'unverified');
  const closed=verifyEvidence(initial,{title:'Job no longer available',content:'This job has been filled.'},checkedAt);
  assert.equal(closed.title,'Portfolio Analyst');assert.equal(closed.verification.status,'closed');
});
test('an individual linked vacancy with a short ID needs no invented description to become an unverified lead',()=>{
  const job=candidateFromHit({title:'Portfolio Analyst',url:'https://careers.example.com/jobs/1',snippet:'Portfolio Analyst\nIndividual job link discovered on a search-results page.'});
  assert.ok(job);assert.equal(job.verification.status,'unverified');assert.equal(job.company,'Company not stated');
  assert.equal(classifyHit({title:'Portfolio Analyst Jobs in United States',url:'https://careers.example.com/jobs/search'}),'directory');
});
test('explicit closure remains a job record even on a generic career landing page',()=>{
  const initial=candidateFromHit(hit);
  const closed=verifyEvidence(initial,{title:'Careers',url:'https://careers.example.com',content:'This position has been filled.'},checkedAt);
  assert.equal(closed.isJob,true);assert.equal(closed.isDirectory,false);assert.equal(closed.title,'Portfolio Analyst');
  assert.equal(dedupeEvidence([closed]).length,1);assert.equal(dedupeEvidence([closed])[0].verification.status,'closed');
  assert.equal(closed.url,initial.url);assert.equal(closed.sources.some(s=>s.url==='https://careers.example.com/'),false);
});
test('structured remote eligibility takes precedence over employer office geography',()=>{
  const jobPosting={'@type':'JobPosting',title:'Portfolio Analyst',description:body,jobLocation:{address:{addressLocality:'New York',addressRegion:'NY',addressCountry:'US'}},jobLocationType:'TELECOMMUTE',applicantLocationRequirements:{'@type':'Country',name:'Canada'}};
  const job=verifyEvidence(candidateFromHit(hit),{content:body,jobPosting},checkedAt);
  assert.equal(job.location,'Remote · Canada only');assert.equal(job.arrangement,'remote');
  assert.equal(locationAssessment(job.location,job.arrangement,'USA').match,false);
  assert.equal(locationAssessment(job.location,job.arrangement,'Canada').match,true);
  assert.equal(job.fieldEvidence.jobLocation,'New York, NY, US');
});

test('generic board headings and explicit talent-network marketing are not individual vacancies',()=>{
  assert.equal(candidateFromHit({title:'Tech:NYC Job Board',url:'https://jobs.technyc.org/companies/bank/jobs/123-portfolio-analyst',snippet:body}),null);
  const lead=candidateFromHit({...hit,title:'Portfolio Insights Analyst Job in New York, NY - Career Launch AI | Apply Today at CareerBuilder',url:'https://careerbuilder.com/job-details/portfolio-insights--123'});
  assert.equal(lead.company,'Career Launch AI');assert.equal(lead.title,'Portfolio Insights Analyst');
  assert.equal(lead.sources[0].kind,'job-board');
  const content='This description represents roles featured on our private job board. It is not a direct job opening with a specific employer.\n'+body;
  assert.equal(candidateFromHit({...hit,snippet:content}),null);
  assert.equal(verifyEvidence(lead,{content},checkedAt).isJob,false);
  assert.equal(verifyEvidence(lead,{content:'This is not a position for beginners.\n'+body},checkedAt).isJob,true);
});

test('publisher title formats remove hiring and location decorations without inventing an employer',()=>{
  const variants=[
    ['[Hiring] Portfolio Analytics Specialist @Arcana Analytics','Arcana Analytics'],
    ['Portfolio Analytics Specialist at Arcana Analytics (On-site, US) | Big World Jobs','Arcana Analytics'],
    ['Portfolio Analytics Specialist at Arcana Analytics — USA (On-Site) 🇺🇸','Arcana Analytics'],
    ['Portfolio Analytics Specialist | Arcanaanalytics | United States | May 2026','Arcanaanalytics'],
  ];
  for (const [title,company] of variants) {
    const job=candidateFromHit({...hit,title,snippet:'Requirements\n- Open to New York, Chicago, or Remote'});
    assert.equal(job.title,'Portfolio Analytics Specialist');assert.equal(job.company,company);assert.equal(job.location,'New York, Chicago, or Remote');
  }
  const glassdoor=candidateFromHit({...hit,title:'Point72 hiring Quantitative Portfolio Analyst – 2026 Grad Job in New York, NY'});
  assert.equal(glassdoor.company,'Point72');assert.equal(glassdoor.title,'Quantitative Portfolio Analyst – 2026 Grad');
});

test('syndicated descriptions merge only with substantial identical evidence and matching explicit location',()=>{
  const description=[
    'Lead onboarding and implementation projects for hedge funds and asset managers using Arcana’s portfolio intelligence platform and specialized analytics workflows.',
    'Partner directly with portfolio managers, analysts, risk teams, and operations teams to understand workflows and analytical requirements across institutional clients.',
    'Collaborate cross-functionally with product, engineering, and data science teams to improve analytics workflows and platform capabilities for institutional users.',
    'Strong communication and interpersonal skills, with the ability to explain complex analytical concepts clearly to institutional clients and collaborating teams.',
    'Requirements', 'Open to New York, Chicago, or Remote',
  ].join('\n');
  const employer=candidateFromHit({title:'Portfolio Analytics Specialist',url:'https://job-boards.greenhouse.io/arcanaanalytics/jobs/123',snippet:description});
  const board=candidateFromHit({title:'Portfolio Analytics Specialist @ Arcana Analytics',url:'https://simplify.jobs/p/456/role',snippet:description});
  const merged=dedupeEvidence([employer,board]);
  assert.equal(merged.length,1);assert.equal(merged[0].url,employer.url);assert.equal(merged[0].company,'Arcana Analytics');assert.equal(merged[0].sources.length,2);
  assert.equal(dedupeEvidence([employer,{...board,description:'A short generic description.'}]).length,2);
  assert.equal(dedupeEvidence([employer,{...board,location:'Boston, MA, US'}]).length,2);
  assert.equal(dedupeEvidence([{...employer,company:'Different Investment Firm'},board]).length,2);
  const differentReq=candidateFromHit({title:employer.title,url:'https://job-boards.greenhouse.io/arcanaanalytics/jobs/124',snippet:description});
  assert.equal(dedupeEvidence([employer,differentReq]).length,2);
});
