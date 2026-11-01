import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProfessionalExperience} from '../lib/profile/professional-experience.mjs';

function fixture(parts,{mime='application/pdf'}={}){
  const doc={id:'synthetic-pdf',kind:'resume',version:1,mime,segments:parts.map((text,index)=>({id:'p'+index,text,locator:'synthetic PDF paragraph '+index}))};
  const state={documents:[doc],facts:[],approvals:[]};
  const approve=(statement,indexes)=>{
    const fact={id:'f'+state.facts.length,version:1,category:'experience_claims',field:'duties',scope:'Synthetic work',statement,origin:'resume',lifecycle:'active',approval:'approved',approvalRef:'a'+state.facts.length,evidence:indexes.map(index=>({documentId:doc.id,documentVersion:1,segmentId:'p'+index,quote:doc.segments[index].text.replace(/^\u2022\s*/, '')}))};
    state.facts.push(fact);state.approvals.push({id:fact.approvalRef,kind:'fact',recordId:fact.id,recordVersion:1,decision:'approved'});return fact;
  };
  return {state,doc,approve};
}
const items=state=>buildProfessionalExperience(state).rows.flatMap(row=>row.items);
const from=(values,id)=>values.find(item=>item.sourceRefs.some(ref=>ref.segmentId===id));
const exactSources=(values,doc)=>assert.ok(values.every(item=>item.sourceRefs.every(ref=>doc.segments.find(segment=>segment.id===ref.segmentId)?.text.includes(ref.quote))));

test('split employer/date then role/location anchors work to the correct literal record',()=>{
  const {state,doc}=fixture(['WORK EXPERIENCE','Lake Systems  January 2022 - Present','Project Manager | London, UK','\u2022 Managed 12 migration workstreams with a four-million-dollar budget','across six sites while maintaining project risk registers.']);
  const before=structuredClone(state),values=items(state),work=from(values,'p3');
  assert.equal(work.statement,'Managed 12 migration workstreams with a four-million-dollar budget across six sites while maintaining project risk registers.');
  assert.match(work.employerRole,/Lake Systems/);assert.match(work.employerRole,/Project Manager/);assert.deepEqual(work.period,{start:'January 2022',end:'Present'});
  assert.deepEqual(work.sourceRefs.map(ref=>ref.segmentId),['p3','p4']);assert.equal(work.approvalStatus,'needs_review');
  assert.ok(!values.some(item=>/January 2022|Project Manager \|/.test(item.statement)));exactSources(values,doc);assert.deepEqual(state,before);
});

test('a new dated employer header stops both wrapping and the previous job scope',()=>{
  const {state,doc}=fixture(['WORK EXPERIENCE','Recent Systems  January 2022 - Present','Project Manager | London, UK','\u2022 Managed six delivery streams without losing the recorded source qualifiers','Earlier Systems  January 2018 - December 2021','Programme Coordinator | Bristol, UK','\u2022 Coordinated vendor schedules and maintained project handover records.']);
  const values=items(state),recent=from(values,'p3'),earlier=from(values,'p6');
  assert.equal(recent.sourceRefs.length,1);assert.match(recent.employerRole,/Recent Systems/);assert.match(earlier.employerRole,/Earlier Systems/);assert.doesNotMatch(earlier.employerRole,/Recent Systems/);
  assert.deepEqual(earlier.period,{start:'January 2018',end:'December 2021'});assert.ok(!values.some(item=>/Earlier Systems.*January/.test(item.statement)));exactSources(values,doc);
});

test('one approved PDF fragment cannot approve the complete wrapped work claim',()=>{
  const {state,approve}=fixture(['WORK EXPERIENCE','Lake Systems  January 2022 - Present','Project Manager | London, UK','\u2022 Managed a six-person delivery team','and maintained project risk registers for a wider programme.']);
  approve('Managed a six-person delivery team',[3]);const work=from(items(state),'p3');
  assert.equal(work.sourceRefs.length,2);assert.equal(work.approvalStatus,'partial');assert.ok(work.approvedClaims.every(claim=>claim.coverage==='partial'));assert.ok(!work.coveredQuotes.includes(work.statement));
});

test('a full wrapped assertion needs approved evidence covering every original fragment',()=>{
  const {state,approve}=fixture(['WORK EXPERIENCE','Lake Systems  January 2022 - Present','Project Manager | London, UK','\u2022 Managed a six-person delivery team','and maintained project risk registers for a wider programme.']);
  const statement='Managed a six-person delivery team and maintained project risk registers for a wider programme.';
  approve(statement,[3,4]);assert.equal(from(items(state),'p3').approvalStatus,'approved');
  state.facts[0].evidence=state.facts[0].evidence.slice(0,1);assert.notEqual(from(items(state),'p3').approvalStatus,'approved');
});

test('short numeric or limiting continuations are retained and section boundaries reset employer context',()=>{
  const {state}=fixture(['WORK EXPERIENCE','Lake Systems  January 2022 - Present','Project Manager | London, UK','\u2022 Delivered the migration within the approved limit of','six sites.','SKILLS','Tools: Python, SQL','PROJECTS','\u2022 Built a personal release checklist for an independent project.']);
  const values=items(state),work=from(values,'p3'),independent=from(values,'p8');assert.match(work.statement,/limit of six sites\.$/);assert.equal(work.sourceRefs.length,2);assert.equal(independent.employerRole,null);assert.equal(independent.period,null);assert.ok(!from(values,'p6'));
});

test('non-PDF paragraphs are not joined by PDF wrapping heuristics',()=>{
  const {state}=fixture(['WORK EXPERIENCE','Lake Systems  January 2022 - Present','Project Manager | London, UK','\u2022 Managed the delivery reporting process with accurate records','and maintained a separate source paragraph for review.'],{mime:'text/plain'});
  const work=from(items(state),'p3');assert.equal(work.sourceRefs.length,1);assert.doesNotMatch(work.statement,/separate source/);
});

test('same-line record selection disambiguates Analyst from Senior Analyst within one source segment',()=>{
  const {state}=fixture(['WORK EXPERIENCE','Lake Systems | London, UK','Senior Analyst  January 2022 - Present\n\u2022 Prepared current programme delivery reports.\nAnalyst  January 2018 - December 2021\n\u2022 Maintained older project control records.']);
  const values=items(state),recent=values.find(item=>/current programme/.test(item.statement)),older=values.find(item=>/older project/.test(item.statement));
  assert.match(recent.employerRole,/Senior Analyst/);assert.deepEqual(recent.period,{start:'January 2022',end:'Present'});assert.match(older.employerRole,/Analyst/);assert.doesNotMatch(older.employerRole,/Senior Analyst/);assert.deepEqual(older.period,{start:'January 2018',end:'December 2021'});
});

test('repeated same titles in a combined source segment stay bound to their own dates',()=>{
  const {state}=fixture(['WORK EXPERIENCE','Lake Systems | London, UK','Project Manager  January 2022 - Present\n\u2022 Managed current delivery milestones.\nProject Manager  January 2018 - December 2021\n\u2022 Managed earlier supplier handovers.']);
  const values=items(state);assert.deepEqual(values.find(item=>/current delivery/.test(item.statement)).period,{start:'January 2022',end:'Present'});assert.deepEqual(values.find(item=>/earlier supplier/.test(item.statement)).period,{start:'January 2018',end:'December 2021'});
});

test('an old same-line header can retain literal inline work after its date range',()=>{
  const {state}=fixture(['WORK EXPERIENCE','Lake Systems | London, UK','Project Manager  January 2022 - Present; Delivered migration controls and recorded project decisions.']);
  const work=items(state).find(item=>/Delivered migration/.test(item.statement));assert.ok(work);assert.equal(work.statement,'Delivered migration controls and recorded project decisions.');assert.deepEqual(work.period,{start:'January 2022',end:'Present'});
});
