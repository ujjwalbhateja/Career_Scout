import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile} from '../lib/profile/domain.mjs';
import {buildEmploymentDurations} from '../lib/profile/employment-duration.mjs';

function fixture() {
  const state=emptyProfile(),document={id:'resume',kind:'resume',version:1,title:'Synthetic employment dates',segments:[]};
  state.documents.push(document);
  const fact=(field,scope,statement,segment,{approval='pending',recordApproval=approval==='approved',version=1,approvalVersion=version,quote=segment.text,...overrides}={})=>{
    const id='fact-'+state.facts.length,approvalRef=approval==='approved'?'approval-'+id:null;
    const value={id,version,category:'employment',field,scope,statement,evidence:[{documentId:document.id,documentVersion:document.version,segmentId:segment.id,quote}],origin:'resume',lifecycle:'active',approval,approvalRef,confirmation:approval==='approved'?'user_confirmed':'resume_stated',conflict:false,...overrides};
    state.facts.push(value);
    if(recordApproval)state.approvals.push({id:approvalRef,kind:'fact',recordId:id,recordVersion:approvalVersion,decision:'approved',actor:'synthetic-owner',at:'2026-10-31T14:00:00Z'});
    return value;
  };
  const segment=text=>{const value={id:'resume.p'+document.segments.length,text};document.segments.push(value);return value;};
  const job=(company,title,start,end)=>{
    const source=segment(`${company} | ${title} | ${start} - ${end}`),scope=[company,title,start,end].join(' | ');
    for(const [field,value] of [['company_name',company],['job_title',title],['start_date',start],['end_date',end]])fact(field,scope,value,source);
    return {company,title,start,end,source,scope};
  };
  const confirm=(job,start,end,options={})=>fact(job.title,job.company,`${job.title} at ${job.company} from ${start} to ${end}.`,job.source,{approval:'approved',...options});
  return {state,document,fact,segment,job,confirm};
}
const titleOf=role=>typeof role.jobTitle==='string'?role.jobTitle:role.jobTitle?.value;
const roleFor=(result,title)=>{const role=result.roles.find(value=>titleOf(value)===title);assert.ok(role,`Missing synthetic role ${title}`);return role;};

test('month plus YY consistently means 20YY without a rolling year pivot',()=>{
  for(const [start,end,expected] of [['Sep 24','Jan 25','2024-09'],['Jan 68','Jan 69','2068-01']]){
    const {state,job}=fixture();job('Example Employer','Senior Analyst',start,end);
    for(const asOf of ['2026-10-31','2030-10-31']){
      const result=buildEmploymentDurations(state,{asOf});
      assert.equal(roleFor(result,'Senior Analyst').duration.start,expected);
      assert.equal(result.total.status,'calculated');
    }
  }
  const {state,job}=fixture();job('Example Employer','Analyst','Jan 99','Jan 00');
  assert.equal(roleFor(buildEmploymentDurations(state),'Analyst').duration.reason,'end_precedes_start');
});

test('same-role source-bound approved full years resolve raw short dates without changing their approval or source',()=>{
  const {state,job,confirm}=fixture(),record=job('Example Employer','Senior Analyst','Sep 24','Jan 25');
  const approved=confirm(record,'September 2024','January 2025'),before=structuredClone(state);
  const result=buildEmploymentDurations(state),duration=roleFor(result,'Senior Analyst').duration;
  assert.equal(duration.status,'calculated');assert.equal(duration.months,4);assert.equal(duration.years,0);assert.equal(duration.remainingMonths,4);
  assert.ok(duration.resolvedFromFactRefs.some(ref=>ref.id===approved.id&&ref.version===approved.version&&ref.approvalRef===approved.approvalRef));
  assert.equal(result.total.months,4);assert.deepEqual(state,before,'derived arithmetic cannot rewrite raw YY source or approve pending date records');
});

test('pending, withdrawn, conflicted or improperly receipted assertions cannot supply year approval',()=>{
  for(const options of [{approval:'pending'},{approval:'withdrawn'},{lifecycle:'superseded'},{conflict:true},{recordApproval:false},{version:2,approvalVersion:1}]){
    const {state,job,confirm}=fixture(),record=job('Example Employer','Senior Analyst','Sep 24','Jan 25');
    confirm(record,'September 2024','January 2025',options);
    const duration=roleFor(buildEmploymentDurations(state),'Senior Analyst').duration;
    if(options.conflict)assert.equal(duration.reason,'conflicting_date');
    else assert.equal(duration.start,'2024-09',JSON.stringify(options));
    assert.deepEqual(duration.resolvedFromFactRefs,[],JSON.stringify(options));
  }
});

test('a valid approval cannot resolve a different role even when the source paragraph is shared',()=>{
  for(const differentTitle of ['Manager','Senior Analyst']){
    const {state,document,fact}=fixture(),source={id:'resume.shared',text:`Example Employer | Analyst | Sep 24 - Jan 25\nExample Employer | ${differentTitle} | Sep 24 - Jan 25`};
    document.segments.push(source);
    for(const [field,value] of [['company_name','Example Employer'],['job_title','Analyst'],['start_date','Sep 24'],['end_date','Jan 25']])fact(field,'Example Employer | Analyst | Sep 24 | Jan 25',value,source);
    fact(differentTitle,'Example Employer',`${differentTitle} at Example Employer from September 2024 to January 2025.`,source,{approval:'approved'});
    const duration=roleFor(buildEmploymentDurations(state),'Analyst').duration;
    assert.equal(duration.start,'2024-09',differentTitle);
    assert.deepEqual(duration.resolvedFromFactRefs,[],differentTitle);
  }
});

test('identical titles and short dates at two employers cannot reuse the other employer approval in a shared paragraph',()=>{
  const {state,document,fact}=fixture();
  const first='Example One | Analyst | Sep 24 - Jan 25',second='Example Two | Analyst | Sep 24 - Jan 25';
  const source={id:'resume.shared-employers',text:first+'\n'+second};document.segments.push(source);
  for(const [company,quote] of [['Example One',first],['Example Two',second]]){
    for(const [field,value] of [['company_name',company],['job_title','Analyst'],['start_date','Sep 24'],['end_date','Jan 25']])
      fact(field,[company,'Analyst','Sep 24','Jan 25'].join(' | '),value,source,{quote});
  }
  const approved=fact('Analyst','Example One','Analyst at Example One from September 2024 to January 2025.',source,{quote:first,approval:'approved'});
  const before=structuredClone(state),result=buildEmploymentDurations(state);
  const own=result.roles.find(role=>role.scope.startsWith('Example One |'));
  const other=result.roles.find(role=>role.scope.startsWith('Example Two |'));
  assert.ok(own);assert.ok(other);assert.equal(own.duration.status,'calculated');assert.equal(own.duration.months,4);
  assert.ok(own.duration.resolvedFromFactRefs.some(ref=>ref.id===approved.id));
  assert.equal(other.duration.status,'calculated');
  assert.equal(other.duration.resolvedFromFactRefs.length,0,'physical paragraph identity cannot transfer a confirmation to another employer record');assert.equal(result.total.status,'calculated');assert.equal(result.total.months,4);
  assert.deepEqual(state,before);
});

test('a year confirmation from a different physical source, a changed source version or a nonexistent quote cannot resolve dates',()=>{
  for(const mutation of ['different_source','stale_version','invalid_quote']){
    const {state,job,confirm,segment}=fixture(),record=job('Example Employer','Senior Analyst','Sep 24','Jan 25');
    const approved=confirm(record,'September 2024','January 2025');
    if(mutation==='different_source'){
      const unrelated=segment('A different record mentions Senior Analyst in Sep 24 - Jan 25.');
      approved.field='period_confirmation';approved.scope='Another employment record';approved.evidence=[{documentId:'resume',documentVersion:1,segmentId:unrelated.id,quote:unrelated.text}];
    }else if(mutation==='stale_version')approved.evidence[0].documentVersion=0;
    else approved.evidence[0].quote='Senior Analyst September 2024 - January 2025';
    const duration=roleFor(buildEmploymentDurations(state),'Senior Analyst').duration;
    assert.equal(duration.start,'2024-09',mutation);
    assert.deepEqual(duration.resolvedFromFactRefs,[],mutation);
  }
});

test('conflicting approved centuries or a mismatching full interval remain unresolved',()=>{
  for(const kind of ['multiple_centuries','different_end_month']){
    const {state,job,confirm}=fixture(),record=job('Example Employer','Senior Analyst','Sep 24','Jan 25');
    if(kind==='multiple_centuries'){
      confirm(record,'September 2024','January 2025');confirm(record,'September 1924','January 1925');
    }else confirm(record,'September 2024','February 2025');
    assert.equal(roleFor(buildEmploymentDurations(state),'Senior Analyst').duration.status,'unavailable',kind);
  }
});

test('durations use end-minus-start month differences, including zero for the same month',()=>{
  const {state,job}=fixture();job('Employer One','Analyst','January 2020','December 2020');job('Employer Two','Associate','June 2021','June 2021');
  const result=buildEmploymentDurations(state);
  assert.equal(roleFor(result,'Analyst').duration.months,11);assert.equal(roleFor(result,'Associate').duration.months,0);
  assert.equal(result.total.months,11);assert.equal(result.total.years,0);assert.equal(result.total.remainingMonths,11);
});

test('total duration unions overlapping and nested periods rather than summing role durations',()=>{
  const {state,job}=fixture();
  job('Employer One','Analyst','January 2020','January 2023');
  job('Employer Two','Manager','June 2022','January 2025');
  job('Employer Three','Consultant','June 2021','September 2021');
  job('Employer Four','Director','February 2025','May 2025');
  const before=structuredClone(state),result=buildEmploymentDurations(state);
  assert.equal(roleFor(result,'Analyst').duration.months,36);assert.equal(roleFor(result,'Manager').duration.months,31);
  assert.equal(result.total.status,'calculated');assert.equal(result.total.months,63);assert.equal(result.total.years,5);assert.equal(result.total.remainingMonths,3);
  assert.equal(result.total.mergedPeriods.length,2);assert.equal(new Set(result.total.includedRoleIds).size,4);
  state.facts.reverse();assert.equal(buildEmploymentDurations(state).total.months,63);state.facts.reverse();assert.deepEqual(state,before);
});

test('ongoing work requires the supplied review date and exposes a partial total when another role remains unresolved',()=>{
  const {state,job,confirm}=fixture(),ongoing=job('Current Employer','Senior Analyst','Sep 24','Pres.');
  confirm(ongoing,'September 2024','Present');
  assert.equal(roleFor(buildEmploymentDurations(state),'Senior Analyst').duration.status,'unavailable');
  const complete=buildEmploymentDurations(state,{asOf:'2026-10-31'});
  assert.equal(roleFor(complete,'Senior Analyst').duration.months,25);assert.equal(complete.total.months,25);assert.equal(complete.total.status,'calculated');
  job('Previous Employer','Research Associate','Jan 18','Unknown');
  const partial=buildEmploymentDurations(state,{asOf:'2026-10-31'});
  assert.equal(partial.total.status,'partial');assert.equal(partial.total.months,25);assert.equal(partial.total.includedRoleIds.length,1);assert.equal(partial.total.excludedRoleIds.length,1);
});

test('explicit approved historical years take precedence over the default 20YY interpretation',()=>{
  const {state,job,confirm}=fixture(),record=job('Example Employer','Analyst','Jan 99','Jan 00');
  confirm(record,'January 1999','January 2000');
  const duration=roleFor(buildEmploymentDurations(state),'Analyst').duration;
  assert.equal(duration.start,'1999-01');assert.equal(duration.end,'2000-01');
  assert.equal(duration.months,12);assert.equal(duration.resolvedFromFactRefs.length,1);
});
