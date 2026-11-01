import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeJDLink,readJDLink} from '../lib/profile/link-intake.mjs';

test('LinkedIn selected-job search URLs become direct postings without tracking parameters',()=>{
  for(const host of ['www.linkedin.com','linkedin.com','uk.linkedin.com']){
    for(const path of ['search','search-results'])assert.equal(normalizeJDLink(`https://${host}/jobs/${path}/?currentJobId=1234567890&eBP=tracking&keywords=other+jobs#details`).href,'https://www.linkedin.com/jobs/view/1234567890/');
  }
  assert.equal(normalizeJDLink('https://www.linkedin.com/jobs/view/sample-role-1234567890/').pathname,'/jobs/view/sample-role-1234567890/');
  assert.equal(normalizeJDLink('https://linkedin.com.example.org/jobs/search/?currentJobId=1234567890').hostname,'linkedin.com.example.org');
});

test('ambiguous or malformed LinkedIn job selections are rejected before fetching',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('Must not fetch');});
  for(const query of ['','currentJobId=','currentJobId=abc','currentJobId=123&currentJobId=456','currentJobId=https%3A%2F%2F127.0.0.1','currentJobId=123%2F456']){
    await assert.rejects(readJDLink('https://www.linkedin.com/jobs/search-results/?'+query),/without one selected job/);
  }
  for(const url of ['http://www.linkedin.com/jobs/search/?currentJobId=123','https://user:secret@www.linkedin.com/jobs/search/?currentJobId=123'])assert.throws(()=>normalizeJDLink(url),/public HTTPS/);
});

test('link intake fetches and saves only the selected posting, preserving JD evidence and network guards',async t=>{
  const requests=[];
  t.mock.method(globalThis,'fetch',async(value,options={})=>{
    const url=new URL(value);requests.push(url.href);
    if(url.hostname==='cloudflare-dns.com')return Response.json({Answer:url.searchParams.get('type')==='A'?[{type:1,data:'93.184.216.34'}]:[]});
    assert.equal(url.href,'https://www.linkedin.com/jobs/view/1234567890/');
    assert.equal(options.redirect,'manual');assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.Authorization,undefined);
    return new Response('<html><main><h1>Risk Analyst</h1><div class="job-description"><p>Responsibilities include preparing risk reports and reviewing portfolio exposures. Experience in financial analysis and clear written communication is required.</p></div></main></html>',{headers:{'Content-Type':'text/html'}});
  });
  const doc=await readJDLink('https://www.linkedin.com/jobs/search-results/?currentJobId=1234567890&trackingId=private-tracking');
  assert.ok(requests.some(url=>url.startsWith('https://cloudflare-dns.com/')));
  assert.ok(requests.every(url=>!url.includes('trackingId')&&!url.includes('search-results')));
  assert.equal(doc.sourceURL,'https://www.linkedin.com/jobs/view/1234567890/');assert.equal(doc.title,'Risk Analyst');assert.equal(doc.kind,'jd');assert.equal(doc.selected,true);
  assert.ok(doc.segments.some(p=>p.text.includes('reviewing portfolio exposures')));assert.equal(doc.facts,undefined);
});
