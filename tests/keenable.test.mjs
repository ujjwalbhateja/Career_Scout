import test from 'node:test';
import assert from 'node:assert/strict';
import { searchKeenable,searchCriteria,planQueries,clearSearchCaches,SEARCH_LIMITS } from '../lib/keenable.mjs';

const criteria={roles:'Portfolio Analyst',location:'USA',mode:'related',includeUnknown:true};
const body='# Portfolio Analyst\nCompany: Harbor Investments\nLocation: New York, NY, US\nFull-time\nResponsibilities\nAnalyze investment portfolio performance and attribution. Build reporting processes and quantitative tools for institutional clients.\nRequirements\nThree years of investment experience and Python skills.\nApply for this job';
const hit=(id=1)=>({title:'Portfolio Analyst @ Harbor Investments',url:`https://careers.example.com/jobs/${id}`,snippet:body,acquired_at:'2026-10-23T00:00:00Z'});
function mock({hits=[hit()],content=body,status=200}={}){
  const requests=[];
  return {requests,fetcher:async(url,options)=>{
    requests.push({url,options});
    if(status!==200)return new Response('provider detail must never escape',{status});
    return Response.json(url.includes('/v1/search')?{results:hits}:{title:'Portfolio Analyst',url:new URL(url).searchParams.get('url'),content});
  }};
}
test('validates role and batch and keeps user-removable suggestions',()=>{
  assert.throws(()=>searchCriteria({roles:''}),{status:400});
  assert.throws(()=>searchCriteria({...criteria,batch:3}),{status:400});
  const {criteria:c}=searchCriteria({...criteria,relatedKeywords:''});
  assert.equal(c.relatedKeywords,'');assert.equal(c.includeUnverified,true);
  const q0=planQueries(c,0),q1=planQueries(c,1),q2=planQueries(c,2);
  assert.ok(q0.length<=4);assert.ok(q1.every(x=>x.site));
  assert.notDeepEqual(q0,q1);assert.ok(q2.every(q=>!q0.some(old=>old.query===q.query&&old.site===q.site)));
  const broad=searchCriteria({...criteria,mode:'broad'}).criteria;
  assert.ok(planQueries(broad).some(q=>/portfolio manager/i.test(q.query)));
});
test('streams leads then verified jobs, dedupes and reports actual requests without inferred credits',async()=>{
  clearSearchCaches();const m=mock(),events=[];
  const result=await searchKeenable(criteria,{key:'test-private-key',...m,onEvent:e=>events.push(e)});
  assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].verification.status,'available');
  assert.equal(result.scanned,4);assert.equal(result.duplicates,3);
  assert.equal(result.usage.searchRequests,4);assert.equal(result.usage.fetchRequests,1);assert.equal(result.usage.credits,null);
  assert.ok(events.some(e=>e.type==='results'&&e.result.phase==='discovering'));
  assert.equal(events.at(-1).type,'complete');assert.equal(result.jobs[0].postedAt,null);
  assert.ok(!JSON.stringify(result).includes('test-private-key'));
  assert.ok(m.requests.every(r=>r.url.startsWith('https://api.keenable.ai/')&&r.options.headers['X-API-Key']==='test-private-key'));
  assert.ok(m.requests.every(r=>r.options.redirect==='manual'));
  assert.ok(m.requests.filter(r=>r.url.includes('/v1/fetch')).every(r=>r.url.includes('live=true')));
});
test('result cache avoids charges; refresh, account and scope changes do not reuse it',async()=>{
  clearSearchCaches();const m=mock();
  await searchKeenable(criteria,{key:'test-a',...m});
  const result=await searchKeenable(criteria,{key:'test-a',...m});
  assert.equal(m.requests.length,5);assert.equal(result.cache.hit,true);assert.equal(result.usage.searchRequests,0);
  await searchKeenable({...criteria,refresh:true},{key:'test-a',...m});assert.equal(m.requests.length,10);
  await searchKeenable(criteria,{key:'test-b',...m});assert.equal(m.requests.length,15);
  await searchKeenable(criteria,{key:'test-a',scope:'another-owner',...m});assert.equal(m.requests.length,20);
});
test('bounds verification and leaves unchecked candidates honestly unverified',async()=>{
  clearSearchCaches();const m=mock({hits:Array.from({length:15},(_,i)=>({...hit(i),title:`Portfolio Analyst ${i}`,snippet:body.replace('Portfolio Analyst',`Portfolio Analyst ${i}`)}))});
  const result=await searchKeenable(criteria,{key:'test',...m});
  assert.equal(result.usage.searchRequests,SEARCH_LIMITS.queries);assert.ok(result.usage.fetchRequests<=SEARCH_LIMITS.checks);
  assert.ok(result.jobs.some(j=>j.verification.status==='unverified'));
});
test('known closed jobs disappear and produce rejected URLs; closed toggle exposes evidence',async()=>{
  clearSearchCaches();const m=mock({content:'This position has been filled. We are no longer accepting applications.'});
  const result=await searchKeenable(criteria,{key:'test',...m});
  assert.equal(result.jobs.length,0);assert.ok(result.rejectedUrls.includes(hit().url));assert.equal(result.excluded.Closed,1);
  const closed=await searchKeenable({...criteria,showClosed:true},{key:'test',...m});
  assert.equal(closed.jobs[0].verification.status,'closed');
});
test('directories are not jobs, but individual links can become verified leads',async()=>{
  clearSearchCaches();const m=mock({hits:[{title:'Portfolio Analyst Jobs in United States',url:'https://example.com/jobs',snippet:`[Portfolio Analyst at Harbor Investments](${hit().url})`}]});
  const result=await searchKeenable(criteria,{key:'test',...m});
  assert.equal(result.directoriesSkipped,4);assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].url,hit().url);
});
test('authentication errors are sanitized and missing keys do not make calls',async()=>{
  clearSearchCaches();const m=mock({status:401});
  await assert.rejects(searchKeenable(criteria,{key:'',...m}),{status:503});assert.equal(m.requests.length,0);
  await assert.rejects(searchKeenable(criteria,{key:'private',...m}),/authentication failed/);
});
test('an aborted search never starts provider calls',async()=>{
  clearSearchCaches();const m=mock(),controller=new AbortController();controller.abort();
  await assert.rejects(searchKeenable(criteria,{key:'test',signal:controller.signal,...m}),{name:'AbortError'});assert.equal(m.requests.length,0);
});
test('malformed and oversized provider responses fail safely',async()=>{
  clearSearchCaches();
  for(const response of [()=>new Response('not json'),()=>new Response('{}',{headers:{'Content-Length':'2000000'}})]){
    await assert.rejects(searchKeenable({...criteria,refresh:true},{key:'test',fetcher:async()=>response()}),/unreadable data|size limit/);
  }
});
test('provider rate limits retain HTTP 429 and redirects cannot forward credentials',async()=>{
  clearSearchCaches();
  await assert.rejects(searchKeenable(criteria,{key:'test',...mock({status:429})}),{status:429});
  let calls=0;
  await assert.rejects(searchKeenable(criteria,{key:'test',fetcher:async(_url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://other.example/'}});}}),/HTTP 302/);
  assert.equal(calls,4);
});
test('live directory invalidation includes aliases and is not counted as duplication',async()=>{
  clearSearchCaches();const m=mock({content:'Search results\n10,000 jobs\nApply now'});
  const result=await searchKeenable(criteria,{key:'test',...m});
  assert.equal(result.jobs.length,0);assert.ok(result.rejectedUrls.includes(hit().url));
  assert.equal(result.excluded['Not an individual vacancy'],1);assert.equal(result.duplicates,0);
});
