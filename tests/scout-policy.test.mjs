import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScoutContext,scoutContextFromSearchProfile,normalizeScoutContext,planScoutQueries,assessScoutJob,presentScoutResults,searchApprovedProfileJobs,SCOUT_LIMITS} from '../lib/workflow/scout-policy.mjs';
import {clearSearchCaches,searchKeenable} from '../lib/keenable.mjs';
import {candidateFromHit,verifyEvidence} from '../lib/job-evidence.mjs';

const now='2026-10-30T12:00:00.000Z';
const criteria={roles:'Portfolio Analyst',location:'USA',includeUnknown:true,searchDescriptions:true};
const context={roleName:'Validated professional profile',functionName:'fund operations',alternativeTitles:['Invented Chief Visionary'],titles:[{term:'Portfolio Analyst',sourceKind:'employment_title',factIds:['work']},{term:'Fund Analyst',sourceKind:'selected_jd_title',factIds:[],sourceRefs:[{documentId:'jd',segmentId:'jd.1',quote:'Fund Analyst'}]}],functions:[{term:'fund operations',factIds:['industry']}],approvedFactIds:['work','skill','industry'],responsibilities:[{term:'NAV oversight',factIds:['work']},{term:'client reporting',factIds:['work']}],skills:[{term:'Python',factIds:['skill']}],industries:[{term:'fund administration',factIds:['industry']}],qualifications:[]};
const description='Responsibilities\nNAV oversight and client reporting in fund administration. Build Python tools for investment clients.\nRequirements\nPython.\nNAV oversight.\nApply for this job';
const job=(id='one',extra={})=>({id,requisitionId:`synthetic:${id}`,title:'Portfolio Analyst',company:'Synthetic Harbor',description,url:`https://careers.example.com/jobs/${id}`,postedAt:'2026-10-28T00:00:00.000Z',location:'New York, NY, USA',sources:[{url:`https://careers.example.com/jobs/${id}`,kind:'employer'}],verification:{status:'available',checkedAt:now,sourceURL:`https://careers.example.com/jobs/${id}`},...extra});

test('Profile creates search terms only from exact current approved professional evidence',()=>{
  const c=buildScoutContext({roleName:'Portfolio Analyst',keywords:['NAV oversight','Python','Made up expertise','person@example.com'],approvedFacts:[{id:'work',version:1,approval:'approved',lifecycle:'active',category:'experience_claims',statement:'Performed NAV oversight and client reporting.'},{id:'skill',version:1,approval:'approved',lifecycle:'active',category:'skills',statement:'Python'},{id:'private',approval:'approved',category:'personal',statement:'person@example.com'},{id:'pending',approval:'pending',category:'skills',statement:'Made up expertise'}],searchTerms:{industries:[{term:'fund administration',factIds:['work']}]}});
  assert.ok(c.responsibilities.some(t=>t.term==='NAV oversight'&&t.factIds.includes('work')));
  assert.ok(c.responsibilities.some(t=>t.term==='client reporting'&&t.factIds.includes('work')));
  assert.deepEqual(c.skills,[{term:'Python',factIds:['skill']}]);
  assert.equal(c.industries.length,0);
  assert.ok(!JSON.stringify(c).includes('person@example.com'));
  assert.ok(!JSON.stringify(c).includes('Performed NAV'));
});

test('Profile derives exact safe skills, responsibilities, industry and qualification candidates from approved fields',()=>{
  const approved=(id,category,field,statement)=>({id,version:1,approval:'approved',lifecycle:'active',category,field,statement});
  const c=buildScoutContext({roleName:'Fund Analyst',keywords:[],approvedFacts:[
    approved('skills','skills','programming languages','Python, SQL and Excel'),
    approved('work','experience_claims','responsibilities','Managed NAV oversight and client reporting for Private Holdings'),
    approved('industry','employment','industry','Fund administration'),
    approved('degree','education','degree name','Bachelor of Science in Economics, Private University, 2015'),
    approved('cert','certifications','certification name','Chartered Financial Analyst (CFA)'),
    approved('org','employment','company','Private Holdings'),
    approved('university','education','institution name','Private University'),
    approved('location','employment','location','Private City'),
    approved('name','personal','full name','Jane Example'),
    approved('contact','personal','email','jane@example.com'),
    approved('date','employment','start date','January 2015'),
    approved('long','experience_claims','responsibilities','A'.repeat(240)),
  ]});
  assert.deepEqual(c.skills.map(t=>t.term),['Python','SQL','Excel']);
  assert.deepEqual(c.responsibilities.map(t=>t.term),['NAV oversight','client reporting']);
  assert.deepEqual(c.industries.map(t=>t.term),['Fund administration']);
  assert.deepEqual(c.qualifications.map(t=>t.term),['Bachelor of Science in Economics','Chartered Financial Analyst (CFA)']);
  const output=JSON.stringify(c);
  for(const secret of ['Private Holdings','Private University','Private City','Jane Example','jane@example.com','January 2015','2015','A'.repeat(121)])assert.ok(!output.includes(secret),secret);
  assert.ok([...c.skills,...c.responsibilities,...c.industries,...c.qualifications].every(t=>t.term.length<=120));
});

test('Profile rejects identity/date keywords even if a source claim contains them',()=>{
  const facts=[{id:'private',approval:'approved',category:'personal',field:'name',statement:'Jane Example'},{id:'work',approval:'approved',category:'experience_claims',field:'duties',statement:'Delivered reporting for Jane Example in 2020.'}];
  const c=buildScoutContext({roleName:'Analyst',keywords:['Jane Example','2020','Unsupported specialist experience'],approvedFacts:facts});
  const terms=[...c.responsibilities,...c.industries,...c.skills,...c.qualifications].map(t=>t.term);
  assert.ok(!terms.includes('Jane Example'));assert.ok(!terms.includes('2020'));assert.ok(!terms.includes('Unsupported specialist experience'));
  assert.equal(terms.includes('reporting'),false); // Single-word work fragments are not query candidates.
});

test('three independent routes use small term subsets and an original-date window',()=>{
  const c=normalizeScoutContext({...context,skills:[...context.skills,{term:'SQL',factIds:['skill']},{term:'Excel',factIds:['skill']}],responsibilities:[...context.responsibilities,{term:'regulatory reporting',factIds:['work']}]});
  const plan=planScoutQueries(c,{days:7,now});
  assert.deepEqual(plan.queries.map(q=>q.route),['titles','responsibilities_industry','skills_function']);
  assert.match(plan.queries[0].query,/Portfolio Analyst.*Fund Analyst/);
  assert.match(plan.queries[1].query,/NAV oversight.*fund administration/);
  assert.match(plan.queries[2].query,/Python.*fund operations/);
  assert.ok(plan.queries.every(q=>q.query.includes('2026-10-23 to 2026-10-30')));
  assert.ok(!plan.queries.some(q=>q.query.includes('regulatory reporting')||q.query.includes('Excel')));
});

test('missing approved context is disclosed without inventing responsibility or skill routes',()=>{
  const plan=planScoutQueries({roleName:'Analyst',approvedFactIds:[]},{now});
  assert.equal(plan.queries.length,0);assert.equal(plan.missing.length,4);
  assert.equal(normalizeScoutContext({...context,skills:[{term:'SQL',factIds:['unapproved']}]}).skills.length,0);
  assert.equal(normalizeScoutContext({...context,skills:[{term:'Call 555-123-4567',factIds:['skill']}]}).skills.length,0);
});

test('titleless profile discovery uses source-backed work and skills without generated display titles or functions',async()=>{
  const titleless={...context,titles:[],functions:[],functionName:'Invented Chief Visionary',roleName:'Invented Chief Visionary'};
  const plan=planScoutQueries(titleless,{now});
  assert.deepEqual(plan.queries.map(q=>q.route),['responsibilities_industry','skills_function']);
  assert.ok(!JSON.stringify(plan.queries).includes('Invented Chief Visionary'));
  const requests=[];
  const output=await searchApprovedProfileJobs({criteria:{...criteria,roles:'Unapproved AI title'},context:titleless},{now,minimumRecent:1,search:async(body,options)=>{requests.push({body,options});return {jobs:[job()],criteria:body,reports:[],queryPlan:options.queryPlan,usage:{searchRequests:2,fetchRequests:1,credits:0}};}});
  assert.equal(output.jobs.length,1);assert.equal(output.criteria.roles,'');assert.deepEqual(output.expandedRoles,[]);
  assert.ok(!JSON.stringify(requests.map(r=>({body:r.body,queries:r.options.queryPlan}))).includes('Invented Chief Visionary'));
  assert.ok(requests.every(r=>r.body.roles==='NAV oversight'));
  assert.equal(output.jobs[0].title,'Portfolio Analyst');
});

test('saved source search profile accepts exact JD title metadata without claiming it as user experience',()=>{
  const source={id:'master-profile',basis:'validated_source_data',label:'Saved master profile',...context,context:{...context}};
  const c=scoutContextFromSearchProfile(source);
  assert.deepEqual(c.titles.map(t=>t.term),['Portfolio Analyst','Fund Analyst']);
  assert.equal(c.titles[1].sourceKind,'selected_jd_title');assert.deepEqual(c.titles[1].factIds,[]);
  assert.equal(normalizeScoutContext({...context,titles:[{term:'Invented Role',sourceKind:'generated_role',factIds:['work']}]}).titles.length,0);
  assert.throws(()=>scoutContextFromSearchProfile({id:'generated-role',basis:'ai_proposal'}),/source-based/);
});

test('performed responsibilities outrank title alone, including alternative job titles',()=>{
  const work=assessScoutJob(job('work',{title:'Fund Operations Specialist'}),criteria,context);
  const title=assessScoutJob(job('title',{description:'Responsibilities\nUnrelated property maintenance.\nRequirements\nFacilities management.\nApply now'}),criteria,context);
  assert.ok(work.match);assert.ok(work.strong);assert.ok(work.score>title.score);
  assert.equal(title.strong,false);assert.ok(title.unknowns.some(s=>s.includes('performed responsibilities')));
});

test('confirmed mandatory conflicts are excluded while unknown salary and sponsorship remain review',async()=>{
  const output=await presentScoutResults({jobs:[job('conflict',{sponsorship:{status:'no'}}),job('unknown',{sponsorship:{status:'unknown'},salary:null})]},{context:{...context,requiresSponsorship:true},criteria:{...criteria,minSalary:100000,currency:'USD',period:'year'},now});
  assert.deepEqual(output.jobs.map(j=>j.id),['unknown']);
  assert.equal(output.jobs[0].group,'review');
  assert.ok(output.jobs[0].uncertainties.some(s=>/sponsorship/.test(s)));
  assert.ok(output.jobs[0].uncertainties.some(s=>/Pay/.test(s)));
});

test('strong seven-day, older and unknown-date results have explicit separate metadata',async()=>{
  const output=await presentScoutResults({jobs:[job('recent'),job('older',{postedAt:'2026-10-10T00:00:00.000Z'}),job('unknown',{postedAt:null,indexedAt:now,pagePublishedAt:now})]},{context,criteria,now});
  assert.deepEqual(output.jobs.map(j=>j.group),['strong_recent','other_strong','review']);
  assert.equal(output.jobs[2].originalPostingDate,null);
  assert.equal(output.jobs[2].dateGroup,'unknown');
  assert.deepEqual(output.unknownDateJobs,['unknown']);
  assert.equal(output.jobs[0].applicationDeadline,null);
  assert.equal(output.jobs[0].lastVerifiedAt,now);
  assert.equal(output.jobs[0].officialApplicationURL,job('recent').url);
});

test('closed, expired and old vacancies are excluded and unofficial verification remains review',async()=>{
  const output=await presentScoutResults({jobs:[job('closed',{verification:{status:'closed',checkedAt:now}}),job('expired',{description:description+'\nApplication deadline: October 20, 2026'}),job('old',{postedAt:'2026-09-01T00:00:00.000Z'}),job('board',{sources:[{url:job('board').url,kind:'job-board'}]})]},{context,criteria,now});
  assert.deepEqual(output.jobs.map(j=>j.id),['board']);
  assert.equal(output.jobs[0].group,'review');assert.equal(output.jobs[0].officialApplicationURL,null);
  assert.equal(output.excluded.Closed,1);assert.equal(output.excluded['Application deadline passed'],1);
});

test('unanswered essential tenure cannot be covered by a matching tool in the same sentence',()=>{
  const result=assessScoutJob(job('tenure',{description:description.replace('Python.','Five years of Python experience.')}),criteria,context);
  assert.equal(result.strong,false);assert.ok(result.unknowns.some(s=>s.includes('Five years')));
});

test('deduplication preserves earliest known posting date and unchanged results are not repeated',async()=>{
  const first=await presentScoutResults({jobs:[job('one',{postedAt:'2026-10-12T00:00:00.000Z'}),job('one',{postedAt:'2026-10-29T00:00:00.000Z'})]},{context,criteria,now});
  assert.equal(first.jobs.length,1);assert.equal(first.jobs[0].dateGroup,'days_8_to_30');
  const again=await presentScoutResults({jobs:[job('one',{postedAt:'2026-10-29T00:00:00.000Z'})]},{context,criteria,now,previousSeen:first.seen});
  assert.equal(again.jobs.length,0);assert.equal(again.suppressedUnchanged,1);
  assert.equal(again.seen[0].originalPostedAt,'2026-10-12T00:00:00.000Z');
  const changed=await presentScoutResults({jobs:[job('one',{description:description+'\nSalary: USD 120,000 per year'})]},{context,criteria,now,previousSeen:first.seen});
  assert.equal(changed.jobs[0].updateKind,'material_update');
});

test('an officially active vacancy after a recorded closure is identified as reopened',async()=>{
  const closed=await presentScoutResults({jobs:[job('one',{verification:{status:'closed',checkedAt:now}})]},{context,criteria,now});
  const reopened=await presentScoutResults({jobs:[job('one')]},{context,criteria,now,previousSeen:closed.seen});
  assert.equal(reopened.jobs[0].updateKind,'reopened');
});

test('few suitable recent matches trigger a separate bounded thirty-day phase',async()=>{
  const calls=[];
  const search=async(body,options)=>{
    calls.push({body,options});
    return {criteria:body,jobs:[job(calls.length===1?'one':'two')],scanned:3,reports:[],queryPlan:options.queryPlan,usage:{searchRequests:options.queryPlan.length,fetchRequests:options.verificationLimit,cacheHits:0,credits:null}};
  };
  const output=await searchApprovedProfileJobs({criteria,context},{search,now});
  assert.deepEqual(calls.map(c=>c.options.verificationLimit),[6,4]);
  assert.ok(calls.every(c=>c.options.queryPlan.length===3));
  assert.ok(calls[0].options.queryPlan.every(q=>q.query.includes('2026-10-23')));
  assert.ok(calls[1].options.queryPlan.every(q=>q.query.includes('2026-09-30')));
  assert.ok(calls[0].options.queryPlan.every(q=>q.query.includes('in USA')));
  assert.deepEqual(output.scoutPolicy.windows,[7,30]);
  assert.equal(output.usage.searchRequests,SCOUT_LIMITS.totalQueries);assert.equal(output.usage.fetchRequests,10);
});

test('enough verified recent matches avoid expansion, and partial expansion failures remain explicit',async()=>{
  let count=0;
  const first=async(body)=>{count++;return {criteria:body,jobs:[job()],reports:[],usage:{searchRequests:3,fetchRequests:1,credits:0}};};
  await searchApprovedProfileJobs({criteria,context},{search:first,now,minimumRecent:1});assert.equal(count,1);
  count=0;
  const output=await searchApprovedProfileJobs({criteria,context},{search:async(body)=>{if(++count===2)throw new Error('private detail');return {criteria:body,jobs:[job()],reports:[],usage:{searchRequests:3,fetchRequests:1,credits:0}};},now});
  assert.equal(output.jobs.length,1);assert.ok(output.reports.some(r=>r.status==='error'));
  assert.deepEqual(output.scoutPolicy.attemptedWindows,[7,30]);assert.equal(output.scoutPolicy.expansionFailed,true);assert.equal(output.usage.incomplete,true);
  assert.ok(!JSON.stringify(output).includes('private detail'));
});

test('only an official page can establish a deadline extension',async()=>{
  const extended=description+'\nClosing date: 20 October 2026\nDeadline extended to: November 10, 2026';
  const official=await presentScoutResults({jobs:[job('official',{description:extended})]},{context,criteria,now});
  assert.equal(official.jobs.length,1);assert.match(official.jobs[0].applicationDeadline,/2026-11-10/);
  const board=await presentScoutResults({jobs:[job('board',{description:extended,sources:[{url:job('board').url,kind:'job-board'}]})]},{context,criteria,now});
  assert.equal(board.jobs.length,0);assert.equal(board.excluded['Application deadline passed'],1);
});

test('live official deadline extensions supersede an expired date without overriding closure text',()=>{
  const candidate=candidateFromHit({title:'Portfolio Analyst at Synthetic Harbor',url:job().url,snippet:description});
  const content=description+'\nApplication deadline: October 20, 2026\nDeadline extended to: November 10, 2026';
  const official=verifyEvidence(candidate,{title:candidate.title,url:job().url,content},now);
  assert.equal(official.verification.status,'available');
  const board=verifyEvidence(candidate,{title:candidate.title,url:'https://www.indeed.com/viewjob?jk=synthetic',content},now);
  assert.equal(board.verification.status,'closed');
  const closed=verifyEvidence(candidate,{title:candidate.title,url:job().url,content:content+'\nWe are no longer accepting applications.'},now);
  assert.equal(closed.verification.status,'closed');
});

test('real orchestration adapter keeps provider payloads scoped and all request budgets bounded',async()=>{
  clearSearchCaches();const requests=[];
  const fetcher=async(url,options)=>{
    requests.push({url,options});
    if(url.includes('/v1/search'))return Response.json({results:[{title:'Portfolio Analyst at Synthetic Harbor',url:job().url,snippet:description,acquired_at:now}]});
    return Response.json({title:'Portfolio Analyst at Synthetic Harbor',url:job().url,content:description+'\nPosted: October 28, 2026\nLocation: New York, NY, USA'});
  };
  const output=await searchApprovedProfileJobs({criteria,context},{search:searchKeenable,fetcher,key:'test-only-secret',scope:'synthetic-scout',now,minimumRecent:1});
  const searches=requests.filter(r=>r.url.includes('/v1/search'));
  assert.equal(searches.length,3);assert.ok(output.usage.fetchRequests<=10);
  assert.ok(searches.every(r=>{const b=JSON.parse(r.options.body);return Object.keys(b).every(k=>['query','mode','max_results','snippet_max_length','site'].includes(k));}));
  assert.ok(searches.every(r=>!r.options.body.includes('factIds')&&!r.options.body.includes('approvedFactIds')));
  assert.ok(!JSON.stringify(output).includes('test-only-secret'));
  assert.equal(output.jobs[0].source,'Keenable');assert.equal(output.jobs[0].title,'Portfolio Analyst');
  assert.ok(output.jobs[0].sources.some(s=>s.url===job().url));assert.match(output.jobs[0].provenance,/Live page|Publisher/);
});

test('titleless discovery runs through the real provider adapter and returns only provider vacancy records',async()=>{
  clearSearchCaches();const queries=[];
  const fetcher=async(url,options)=>{
    if(url.includes('/v1/search')){queries.push(JSON.parse(options.body).query);return Response.json({results:[{title:'Portfolio Analyst at Synthetic Harbor',url:job().url,snippet:description,acquired_at:now}]});}
    return Response.json({title:'Portfolio Analyst at Synthetic Harbor',url:job().url,content:description+'\nPosted: October 28, 2026\nLocation: New York, NY, USA'});
  };
  const titleless={...context,roleName:'Master profile display label',titles:[],functions:[],functionName:'Invented Chief Visionary',alternativeTitles:['Invented Chief Visionary']};
  const output=await searchApprovedProfileJobs({criteria,context:titleless},{fetcher,key:'fixture-key',scope:'titleless-fixture',now,minimumRecent:1});
  assert.equal(queries.length,2);assert.ok(queries.every(query=>!query.includes('Master profile')&&!query.includes('Invented Chief Visionary')));
  assert.equal(output.jobs.length,1);assert.equal(output.jobs[0].title,'Portfolio Analyst');assert.equal(output.jobs[0].source,'Keenable');
  assert.equal(output.jobs[0].verification.sourceURL,job().url);assert.equal(output.criteria.roles,'');
});

test('query-plan and verification override ceilings cannot increase existing phase limits',async()=>{
  await assert.rejects(searchKeenable(criteria,{key:'test',queryPlan:Array.from({length:5},()=>({query:'Analyst jobs'}))}),/budget/);
  await assert.rejects(searchKeenable(criteria,{key:'test',queryPlan:[{query:'Analyst jobs'}],verificationLimit:11}),/budget/);
});
