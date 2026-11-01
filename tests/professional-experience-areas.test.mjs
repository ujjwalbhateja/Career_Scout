import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProfessionalExperience} from '../lib/profile/professional-experience.mjs';

function profile(lines){
  const document={id:'synthetic-resume',kind:'resume',title:'Synthetic professional history',version:1,segments:lines.map((text,index)=>({id:'paragraph-'+index,text}))};
  const state={documents:[document],facts:[],approvals:[],snapshots:[],questions:[],answers:[],requirements:[],roleProfiles:[],preferences:{}};
  const approve=(index,{id='fact-'+index,category='experience_claims',field='responsibility',scope='Source-listed work'}={})=>{
    const segment=document.segments[index],approvalRef='approval-'+id;
    const fact={id,version:1,category,field,scope,statement:segment.text,origin:'resume',confirmation:'resume_stated',lifecycle:'active',approval:'approved',approvalRef,evidence:[{documentId:document.id,documentVersion:1,segmentId:segment.id,quote:segment.text}]};
    state.facts.push(fact);state.approvals.push({id:approvalRef,kind:'fact',recordId:fact.id,recordVersion:1,decision:'approved',actor:'synthetic-owner'});return fact;
  };
  return {state,document,approve};
}
const items=review=>review.rows.flatMap(row=>row.items);
const sourceSegments=review=>new Set(items(review).flatMap(item=>item.sourceRefs.map(ref=>ref.segmentId)));
const assertSources=(review,document)=>{
  for(const item of items(review)){
    assert.equal(item.independentlyVerified,false);
    assert.ok(item.sourceRefs.length>0);
    assert.ok(item.sourceRefs.every(ref=>ref.documentId===document.id&&document.segments.find(segment=>segment.id===ref.segmentId)?.text.includes(ref.quote)));
  }
};

test('engineering work creates relevant areas and includes older engineering responsibilities without finance defaults',()=>{
  const {state,document,approve}=profile([
    'PROFESSIONAL EXPERIENCE',
    'Lake Systems | Senior Software Engineer | January 2021 - Present',
    'Developed Python APIs and deployed containerized services for internal applications.',
    'Led incident response and wrote platform recovery runbooks.',
    'EARLIER EXPERIENCE',
    'Hill Robotics | Test Engineer | January 2014 - December 2020',
    'Designed hardware-in-the-loop tests and automated device validation.',
    'SKILLS',
    'Python, Kubernetes, NAV oversight, financial reporting',
    'EDUCATION',
    'Bachelor of Engineering in Electronics'
  ]);
  const fact=approve(2),review=buildProfessionalExperience(state),areas=review.rows.map(row=>row.area).join(' ');
  assert.ok(review.rows.length>0);assert.match(areas,/engineer|software|system|test|quality|technology|technical|platform|application|incident|reliab|support/i);
  assert.doesNotMatch(areas,/fund accounting|NAV|hedge fund|portfolio management/i);
  assert.ok(sourceSegments(review).has('paragraph-2'));assert.ok(sourceSegments(review).has('paragraph-3'));assert.ok(sourceSegments(review).has('paragraph-6'));
  assert.ok(items(review).some(item=>item.approvedFactRefs.some(ref=>(ref.id||ref.factId)===fact.id)));
  assert.ok(items(review).filter(item=>item.sourceRefs.some(ref=>ref.segmentId==='paragraph-6')).every(item=>item.approvalStatus!=='approved'));
  assert.ok(!sourceSegments(review).has('paragraph-8'));assert.ok(!sourceSegments(review).has('paragraph-10'));assertSources(review,document);
});

test('nursing history adapts to clinical care while listed tools and education remain outside applied work',()=>{
  const {state,document}=profile([
    'WORK EXPERIENCE',
    'North Clinic | Registered Nurse | March 2019 - Present',
    'Administered prescribed medication, monitored patient vital signs and documented care plans.',
    'Community Health Centre | Nurse | June 2013 - February 2019',
    'Provided wound care and educated patients about discharge instructions.',
    'TECHNICAL SKILLS',
    'Electronic health records, Python, sterile technique',
    'EDUCATION',
    'Bachelor of Science in Nursing',
    'Coursework: clinical assessment and medication safety'
  ]);
  const review=buildProfessionalExperience(state),areas=review.rows.map(row=>row.area).join(' ');
  assert.match(areas,/patient|clinical|nurs|medic|health|care/i);assert.doesNotMatch(areas,/fund accounting|NAV|portfolio management/i);
  assert.ok(sourceSegments(review).has('paragraph-2'));assert.ok(sourceSegments(review).has('paragraph-4'));
  for(const index of [6,8,9])assert.ok(!sourceSegments(review).has('paragraph-'+index));
  assert.ok(!items(review).some(item=>/implemented|developed|automated/i.test(item.statement)&&/Python|health records/i.test(item.statement)));assertSources(review,document);
});

test('unknown occupations retain literal supported work in a generic area without invented specialization',()=>{
  const {state,document}=profile([
    'EMPLOYMENT HISTORY',
    'Synthetic Workshop | Team Assistant | 2017 - 2020',
    'Maintained a manual log of daily deliveries.',
    'Prepared checklists for weekly handovers.',
    'SKILLS',
    'Financial modelling, medication administration, artificial intelligence'
  ]);
  const review=buildProfessionalExperience(state);
  assert.ok(review.rows.length>0);assert.ok(review.rows.every(row=>typeof row.area==='string'&&row.area.trim()));
  assert.ok(sourceSegments(review).has('paragraph-2'));assert.ok(sourceSegments(review).has('paragraph-3'));
  assert.ok(!sourceSegments(review).has('paragraph-5'));
  assert.doesNotMatch(items(review).map(item=>item.statement).join(' '),/medication administration|artificial intelligence|financial modelling|\$|\d+%/i);assertSources(review,document);
});

test('job titles and skill lists alone do not establish performed engineering or clinical responsibilities',()=>{
  const {state,approve}=profile([
    'EMPLOYMENT',
    'Synthetic Systems | Software Engineer | 2020 - 2022',
    'SKILLS',
    'Python, Kubernetes, patient triage, fund accounting',
    'EDUCATION',
    'Bachelor of Science in Computer Science'
  ]);
  approve(3,{category:'skills',field:'tools_technologies'});
  const review=buildProfessionalExperience(state);assert.deepEqual(review.rows,[]);
});

test('repeated work across different roles keeps both source associations rather than dropping older evidence',()=>{
  const statement='Prepared incident reports and maintained support handover records.';
  const {state,document,approve}=profile([
    'PROFESSIONAL EXPERIENCE',
    'Recent Systems | Support Engineer | 2022 - Present',
    statement,
    'EARLIER EXPERIENCE',
    'Earlier Systems | Support Associate | 2015 - 2021',
    statement
  ]);
  approve(2);
  const review=buildProfessionalExperience(state),segments=sourceSegments(review);
  assert.ok(segments.has('paragraph-2'));assert.ok(segments.has('paragraph-5'));assertSources(review,document);
  const recent=items(review).filter(item=>item.sourceRefs.some(ref=>ref.segmentId==='paragraph-2')),older=items(review).filter(item=>item.sourceRefs.some(ref=>ref.segmentId==='paragraph-5'));
  assert.equal(recent.length,1);assert.equal(older.length,1);assert.equal(recent[0].approvalStatus,'approved');assert.notEqual(older[0].approvalStatus,'approved');
  assert.ok(review.rows.some(row=>['paragraph-2','paragraph-5'].every(id=>row.sourceRefs.some(ref=>ref.segmentId===id))));
  assert.ok(review.rows.some(row=>row.highlights.some(highlight=>['paragraph-2','paragraph-5'].every(id=>highlight.sourceRefs.some(ref=>ref.segmentId===id)))));
});

test('area highlights remain concise source excerpts while full material work paragraphs are retained',()=>{
  const paragraph='Developed a service deployment pipeline that checked configuration, ran automated tests, published artifacts, recorded release outcomes and supported recovery when deployments failed. Maintained troubleshooting notes and handed operational ownership to the support team.';
  const {state,document}=profile(['WORK EXPERIENCE','Synthetic Tools | Platform Engineer | 2018 - Present',paragraph]);
  const review=buildProfessionalExperience(state);assert.ok(items(review).some(item=>item.sourceRefs.some(ref=>ref.quote.includes(paragraph))));
  for(const row of review.rows){assert.ok(row.highlights.length<=2);for(const highlight of row.highlights){assert.ok(highlight.statement);assert.ok(highlight.sourceRefs.some(ref=>ref.quote.includes(highlight.statement)));}}
  assertSources(review,document);
});
