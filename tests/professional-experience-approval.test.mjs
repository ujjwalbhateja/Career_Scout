import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile} from '../lib/profile/domain.mjs';
import {buildProfessionalExperience} from '../lib/profile/professional-experience.mjs';

function fixture(){
  const state=emptyProfile();
  const document=(id,kind,segments)=>{const item={id,version:1,kind,title:'Synthetic '+kind,hash:'synthetic-'+id,analysis:'complete',segments:segments.map((text,index)=>({id:id+'.p'+index,text,locator:'paragraph '+index}))};state.documents.push(item);return item;};
  const approve=(doc,segmentIndex,statement,{quote=doc.segments[segmentIndex].text,category='experience_claims',field='duties',version=1,approvalVersion=version,lifecycle='active',approval='approved',recordApproval=true}={})=>{
    const id='fact-'+state.facts.length,ref='approval-'+id;
    const fact={id,version,category,field,scope:'Example Employer',statement,origin:doc.kind==='answer'?'user_answer':'resume',evidence:[{documentId:doc.id,documentVersion:doc.version,segmentId:doc.segments[segmentIndex].id,quote}],approval,approvalRef:approval==='approved'?ref:null,confirmation:approval==='approved'?'user_confirmed':'source_stated',lifecycle,conflict:false};
    state.facts.push(fact);if(recordApproval&&approval==='approved')state.approvals.push({id:ref,kind:'fact',recordId:id,recordVersion:approvalVersion,decision:'approved',actor:'synthetic-owner',at:'2026-10-31T14:00:00Z'});return fact;
  };
  return {state,document,approve};
}
const items=projection=>projection.rows.flatMap(row=>row.items);
const fromSegment=(projection,documentId,segmentId)=>items(projection).filter(item=>item.sourceRefs.some(ref=>ref.documentId===documentId&&ref.segmentId===segmentId));

test('approving book size with a broad quote cannot approve the other work in that paragraph',()=>{
  const {state,document,approve}=fixture();
  const passage='Managed a £400 million book, built cash-flow models, and prepared investment committee papers.';
  const resume=document('resume','resume',['PROFESSIONAL EXPERIENCE','Example Employer | Investment Analyst',passage]);
  approve(resume,2,'Managed a £400 million book',{category:'quantitative_claims',field:'book_size',quote:passage});
  const projected=buildProfessionalExperience(state),work=fromSegment(projected,'resume','resume.p2');assert.ok(work.length);
  assert.ok(work.some(item=>item.statement.includes('cash-flow models')));
  assert.ok(work.filter(item=>item.statement.includes('cash-flow models')||item.statement.includes('committee papers')).every(item=>item.approvalStatus!=='approved'));
  assert.ok(work.some(item=>item.approvalStatus==='partial'||item.approvalStatus==='needs_review'));
  assert.ok(work.every(item=>!(item.coveredQuotes||[]).some(value=>(typeof value==='string'?value:value.quote)===passage)),'a broad evidence quote is not the scope of the narrow approved assertion');
  assert.ok(projected.rows.flatMap(row=>row.highlights||[]).filter(item=>item.statement.includes('cash-flow models')||item.statement.includes('committee papers')).every(item=>item.approvalStatus!=='approved'));
});

test('an approved team-size assertion does not approve a whole operating paragraph',()=>{
  const {state,document,approve}=fixture(),passage='Managed a six-person team, rebuilt forecasting templates, and advised regional clients.';
  const resume=document('resume','resume',['WORK EXPERIENCE','Example Employer | Operations Manager',passage]);
  approve(resume,2,'Managed a six-person team',{category:'quantitative_claims',field:'team_size',quote:'Managed a six-person team'});
  const work=fromSegment(buildProfessionalExperience(state),'resume','resume.p2');assert.ok(work.length);
  assert.ok(work.filter(item=>item.statement.includes('forecasting templates')||item.statement.includes('regional clients')).every(item=>item.approvalStatus!=='approved'));
});

test('exact whole work assertion with a matching approval is approved without claiming independent verification',()=>{
  const {state,document,approve}=fixture(),passage='Prepared monthly reconciliations and resolved settlement breaks.';
  const resume=document('resume','resume',['PROFESSIONAL EXPERIENCE','Example Employer | Reconciliation Analyst',passage]);
  const fact=approve(resume,2,passage);
  const work=fromSegment(buildProfessionalExperience(state),'resume','resume.p2');assert.ok(work.length);
  assert.ok(work.some(item=>item.statement===passage&&item.approvalStatus==='approved'&&item.approvedFactRefs.some(ref=>ref.id===fact.id&&ref.version===fact.version)));
  assert.ok(work.every(item=>item.independentlyVerified!==true));
});

test('approval is bound to the actual source passage rather than repeated text at another employer',()=>{
  const {state,document,approve}=fixture(),passage='Prepared monthly client reports.';
  const resume=document('resume','resume',['PROFESSIONAL EXPERIENCE','New Example Employer | Analyst',passage,'Older Example Employer | Associate',passage]);
  approve(resume,2,passage);
  const projected=buildProfessionalExperience(state),older=fromSegment(projected,'resume','resume.p4');assert.ok(older.length);
  assert.ok(older.every(item=>item.approvalStatus!=='approved'),'an approval for the newer stint cannot confirm an otherwise identical old-stint assertion');
});

test('title and employer approvals cannot approve work simply because their evidence quotes include it',()=>{
  const {state,document,approve}=fixture(),combined='Example Employer | Research Analyst\nBuilt liquidity forecasts and reconciled market data.';
  const resume=document('resume','resume',['PROFESSIONAL EXPERIENCE',combined]);
  approve(resume,1,'Research Analyst',{category:'employment',field:'job_title',quote:combined});
  approve(resume,1,'Example Employer',{category:'employment',field:'company_name',quote:combined});
  const work=fromSegment(buildProfessionalExperience(state),'resume','resume.p1').filter(item=>item.statement.includes('liquidity forecasts'));
  assert.ok(work.length);assert.ok(work.every(item=>item.approvalStatus!=='approved'));
});

test('wrong versions, missing approval receipts and withdrawn facts cannot approve source work',()=>{
  for(const options of [{version:2,approvalVersion:1},{recordApproval:false},{approval:'withdrawn'},{lifecycle:'superseded'}]){
    const {state,document,approve}=fixture(),passage='Developed stress scenarios for portfolio reporting.';
    const resume=document('resume','resume',['PROFESSIONAL EXPERIENCE','Example Employer | Portfolio Analyst',passage]);
    approve(resume,2,passage,options);
    const work=fromSegment(buildProfessionalExperience(state),'resume','resume.p2');assert.ok(work.length);
    assert.ok(work.every(item=>item.approvalStatus!=='approved'),JSON.stringify(options));
  }
});

test('approved answer entry uses only the exact approved assertion, not the rest of an unapproved answer paragraph',()=>{
  const {state,document,approve}=fixture();
  const answer=document('answer','answer',['Prepared domestic risk reports. I also owned every investment decision.']);
  const fact=approve(answer,0,'Prepared domestic risk reports.',{quote:answer.segments[0].text});
  const projected=buildProfessionalExperience(state),work=items(projected);
  assert.ok(work.some(item=>item.statement==='Prepared domestic risk reports.'&&item.approvalStatus==='approved'&&item.approvedFactRefs.some(ref=>ref.id===fact.id)));
  assert.ok(!work.some(item=>item.statement.includes('owned every investment decision')));
  assert.ok(work.every(item=>!(item.coveredQuotes||[]).some(value=>(typeof value==='string'?value:value.quote).includes('owned every investment decision'))),'approved answer coverage cannot include the rest of a broad evidence quote');
});

test('unapproved answers and employer JDs never become experience entries',()=>{
  const {state,document,approve}=fixture();
  const answer=document('answer','answer',['Managed a global derivatives programme.']);approve(answer,0,answer.segments[0].text,{approval:'pending'});
  const jd=document('jd','jd',['PROFESSIONAL EXPERIENCE','Lead a global trading desk and control investment decisions.']);jd.selected=true;
  const projected=buildProfessionalExperience(state);assert.ok(!items(projected).some(item=>/global derivatives|global trading|investment decisions/i.test(item.statement)));
});

test('the complete resume contributes older work while personal, education and bare skills remain outside work claims',()=>{
  const {state,document}=fixture();
  const resume=document('resume','resume',['Example Candidate','candidate@example.test','PROFESSIONAL EXPERIENCE','Current Example Employer | Client Analyst','Prepared client onboarding packs.','Previous Example Employer | Research Associate','Built economic scenarios and analysed regional demand.','EDUCATION','Master of Science; completed coursework in applied mathematics.','SKILLS','Python, SQL']);
  const before=structuredClone(state),projected=buildProfessionalExperience(state),statements=items(projected).map(item=>item.statement).join('\n');
  assert.match(statements,/onboarding packs/);assert.match(statements,/economic scenarios/);assert.ok(!/candidate@example|coursework|Python, SQL/.test(statements));
  assert.ok(fromSegment(projected,'resume',resume.segments[6].id).length);assert.deepEqual(state,before,'the presentation helper cannot create facts, decisions or new source records');
});
