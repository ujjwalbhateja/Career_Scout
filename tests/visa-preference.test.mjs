import test from 'node:test';
import assert from 'node:assert/strict';
import {sponsorship,normalize,criteriaFrom,assess} from '../lib/scout.mjs';
import {rankJob} from '../lib/matching.mjs';
import {searchKeenable,clearSearchCaches} from '../lib/keenable.mjs';
import {presentScoutResults} from '../lib/workflow/scout-policy.mjs';

const denials=[
  'We do not provide visa sponsorship for this role.',
  'Please note we are unable to provide immigration sponsorship for this position.',
  'Applicants for employment must have work authorization that does not now, or in the future, require sponsorship of a visa for employment in the United States.',
  'Candidates must be authorized to work in the US without sponsorship.',
  'We cannot sponsor candidates for this position.',
  'We cannot sponsor at this time.',
  'Visa sponsorship will not be provided.',
  'Visa sponsorship is not available.',
  'Sponsorship: No.',
  'Candidates requiring visa sponsorship will not be considered.',
  'This position is not eligible for visa sponsorship.',
];
for(const sentence of denials)test('explicit refusal: '+sentence,()=>{
  const result=sponsorship(sentence);assert.equal(result.status,'no');assert.ok(result.evidence);
});
for(const sentence of [
  'Applicants must be authorized to work in the United States.',
  'Will you now or in the future require visa sponsorship?',
  'We do not discriminate based on immigration status. Contact us about visa sponsorship.',
  'Manage corporate sponsorship relationships. No event sponsorship budget is available.',
  'No prior experience required. Ask the recruiter about work authorization.',
])test('does not infer a refusal: '+sentence,()=>assert.equal(sponsorship(sentence).status,'unknown'));
test('unrelated negation does not turn explicit sponsorship support into a refusal',()=>{
  assert.equal(sponsorship('No previous finance experience required, visa sponsorship is available.').status,'yes');
  assert.equal(sponsorship('We offer visa sponsorship. We do not provide visa sponsorship.').status,'unknown');
});

const description='Responsibilities\nPrepare portfolio reporting using SQL.\nRequirements\nSQL.\nApply for this job';
const raw={title:'Portfolio Analyst',company:'Synthetic Company',location:'New York, USA',description,url:'https://careers.example.com/jobs/visa',source:'Synthetic',postedAt:'2026-11-02T00:00:00Z'};
test('visa filter is opt-in, distinct from ranking, and retains unknown policies with strict detail filters',()=>{
  const no=normalize({...raw,description:description+'\n'+denials[0]});
  for(const evaluate of [assess,rankJob]){
    const base=criteriaFrom({roles:'Portfolio Analyst',includeUnknown:false,preferSponsorship:true});
    assert.equal(evaluate(no,base).match,true);
    assert.equal(evaluate(no,{...base,onWorkVisa:true}).match,false);
    assert.ok(evaluate(no,{...base,onWorkVisa:true}).conflicts.includes('Visa sponsorship explicitly unavailable'));
    for(const suffix of ['', '\nWe offer visa sponsorship.', '\nWe offer visa sponsorship. '+denials[0]]){
      const result=evaluate(normalize({...raw,description:description+suffix}),{...base,onWorkVisa:true});
      assert.equal(result.match,true);
    }
  }
  for(const value of [undefined,false,'false','true',1])assert.equal(criteriaFrom({onWorkVisa:value}).onWorkVisa,false);
  assert.equal(criteriaFrom({onWorkVisa:true}).onWorkVisa,true);
});

test('profile Scout excludes refusals and keeps unstated sponsorship in review',async()=>{
  const context={approvedFactIds:['skill'],skills:[{term:'SQL',factIds:['skill']}]};
  const jobs=['no','yes','unknown'].map((status,i)=>({...normalize({...raw,company:'Synthetic Company '+status,url:raw.url+i}),id:status,sponsorship:{status},verification:{status:'available'},sources:[{kind:'employer',url:raw.url+i}]}));
  const result=await presentScoutResults({jobs},{context,criteria:{onWorkVisa:true,includeUnknown:false},now:'2026-11-03T17:00:00Z'});
  assert.deepEqual(new Set(result.jobs.map(j=>j.id)),new Set(['yes','unknown']));
  assert.equal(result.excluded['Visa sponsorship explicitly unavailable'],1);
  assert.equal(result.jobs.find(j=>j.id==='unknown').group,'review');
});

test('live page refusal removes a streamed lead; changing visa preference cannot reuse unfiltered results',async()=>{
  clearSearchCaches();let searches=0;
  const content='# Portfolio Analyst\nCompany: Synthetic Company\nLocation: New York, USA\n'+description;
  const fetcher=async(url)=>{
    if(url.includes('/v1/search')){searches++;return Response.json({results:[{title:'Portfolio Analyst at Synthetic Company',url:raw.url,snippet:content}]});}
    return Response.json({title:'Portfolio Analyst',url:raw.url,content:content+'\n'+denials[1]});
  };
  const options={key:'synthetic-key',fetcher},body={roles:'Portfolio Analyst'};
  const first=await searchKeenable(body,options);assert.equal(first.jobs.length,1);
  const before=searches,events=[];
  const filtered=await searchKeenable({...body,onWorkVisa:true},{...options,onEvent:e=>events.push(e)});
  assert.ok(searches>before);assert.equal(filtered.cache.hit,false);
  assert.equal(filtered.jobs.length,0);assert.equal(filtered.excluded['Visa sponsorship explicitly unavailable'],1);
  assert.ok(filtered.rejectedUrls.includes(raw.url));
  assert.ok(events.some(e=>e.result?.phase==='discovering'&&e.result.jobs.length===1));
  assert.equal(events.at(-1).result.jobs.length,0);
  assert.equal((await searchKeenable({...body,onWorkVisa:true},options)).cache.hit,true);
});
