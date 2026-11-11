import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {emptyProfile,addDocument,proposeFacts,decideFacts,addJDAnalysis,buildProfiles} from '../lib/profile/domain.mjs';
import {buildRoleQuestionnaires} from '../lib/profile/builder-expansion.mjs';
import {buildProfessionalExperience} from '../lib/profile/professional-experience.mjs';
import {currentProfilePacket} from '../lib/profile/current-profile.mjs';
import {ProfileService} from '../lib/profile/service.mjs';

const require=createRequire(import.meta.url);
const output=ts.transpileModule(readFileSync(new URL('../app/profile/professional-experience.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function('require','module','exports',output)(name=>name==='@/lib/profile/professional-experience.mjs'?{buildProfessionalExperience}:name.endsWith('.css')?{}:require(name),module,module.exports);
const Component=module.exports.default;
const render=state=>renderToStaticMarkup(React.createElement(Component,{state}));

test('approved questionnaire statements survive save/reload and all appear in the profile before collapsed details',async()=>{
  const state=emptyProfile(),owner='test-owner';
  addDocument(state,{id:'resume',kind:'resume',title:'Synthetic resume',hash:'resume',segments:[{id:'resume.p1',text:'Excel'}]});state.documents[0].analysis='complete';
  await proposeFacts(state,[{category:'skills',field:'tools_technologies',scope:'Listed skills',statement:'Excel',evidence:[{documentId:'resume',segmentId:'resume.p1',quote:'Excel'}]}]);
  decideFacts(state,[{id:state.facts[0].id,version:1,decision:'approved'}],owner);
  const statements=['Prepared daily market risk reports for the investment committee using position-level exposures','Monitored liquidity risk limits across the trading portfolios','Reviewed scenario risk reports for senior investment stakeholders'];
  addDocument(state,{id:'jd',kind:'jd',title:'Risk Manager',hash:'jd',selected:true,segments:[{id:'jd.p1',text:statements.join('\n')}]});
  await addJDAnalysis(state,'jd',{roleName:'Risk Manager',requirements:statements.map(text=>({text,category:'task',importance:'required',evidence:[{documentId:'jd',segmentId:'jd.p1',quote:text}]}))});
  await buildProfiles(state,{questions:[],mappings:state.requirements.map(r=>({requirementId:r.id,factIds:[],evidenceStatus:'not_established',explanation:'No matching source statement.'}))},'analysis');
  let stored={revision:1,state},writes=0;
  const service=new ProfileService({},owner);
  service.memory.load=async()=>structuredClone(stored);
  service.memory.save=async(revision,state)=>{assert.equal(revision,stored.revision);writes++;stored={revision:revision+1,state:structuredClone(state)};return structuredClone(stored);};
  for(const statement of statements){
    const row=buildRoleQuestionnaires(stored.state).flatMap(g=>g.experience).find(r=>r.proposedStatement===statement);assert.ok(row,statement);
    const receipt=await service.action({action:'reviewBuilder',revision:stored.revision,submissionId:crypto.randomUUID(),rows:[{rowId:row.id,fingerprint:row.fingerprint,decision:'approve'}]});
    assert.equal(receipt.result.storageVerified,true);
  }
  assert.equal(writes,3);
  const reloaded=await service.memory.load(),before=structuredClone(reloaded.state),html=render(reloaded.state);
  const visible=html.replace(/<details>[\s\S]*?<\/details>/g,'');
  for(const statement of statements)assert.ok(visible.includes(statement),statement);
  assert.equal((visible.match(/Approved addition:/g)||[]).length,3);
  assert.ok(html.includes('id="professional-work-experience"'));
  const packet=await currentProfilePacket(reloaded,owner);
  for(const statement of statements)assert.ok(packet.facts.records.some(f=>f.statement===statement&&f.approval==='approved'));
  const relabeled=structuredClone(reloaded);
  relabeled.state.builderExpansion.decisions[0].row.area='Risk oversight and reporting';
  assert.equal((await currentProfilePacket(relabeled,owner)).facts.version,packet.facts.version,'organizational headings cannot change the search profile or claims');
  assert.deepEqual(reloaded.state,before,'rendering and profile loading cannot alter saved decisions');
});

test('approved additions keep their full wording while unapproved answer text stays out of the profile',()=>{
  const state=emptyProfile(),statement='Prepared risk reports covering portfolio exposures for senior management; documented the individual risk exceptions and their follow-up actions.';
  addDocument(state,{id:'answer',kind:'answer',title:'Synthetic confirmation',hash:'answer',segments:[{id:'answer.p1',text:statement+' I approved every investment decision.'}]});
  state.facts.push({id:'fact',version:1,category:'experience_claims',field:'builder_experience',scope:'Self-confirmed capability',statement,approval:'approved',approvalRef:'approval',lifecycle:'active',origin:'user_answer',evidence:[{documentId:'answer',documentVersion:1,segmentId:'answer.p1',quote:statement}]});
  state.approvals.push({id:'approval',kind:'fact',recordId:'fact',recordVersion:1,decision:'approved',actor:'test-owner'});
  const html=render(state),visible=html.replace(/<details>[\s\S]*?<\/details>/g,'');
  assert.ok(visible.includes(statement));assert.ok(!html.includes('I approved every investment decision.'));
  state.facts[0].approval='pending';
  assert.ok(!render(state).includes(statement));
});

function areaFixture(){
  const state=emptyProfile(),statement='Explained the drivers and changes';
  addDocument(state,{id:'answer',kind:'answer',title:'Synthetic confirmation',hash:'answer',segments:[{id:'answer.p1',text:statement}]});
  state.facts.push({id:'fact',version:1,category:'experience_claims',field:'builder_experience',scope:'Self-confirmed capability',statement,approval:'approved',approvalRef:'approval',lifecycle:'active',origin:'user_answer',builderDecisionId:'decision',evidence:[{documentId:'answer',documentVersion:1,segmentId:'answer.p1',quote:statement}]});
  state.approvals.push({id:'approval',kind:'fact',recordId:'fact',recordVersion:1,decision:'approved',actor:'test-owner'});
  state.builderExpansion={decisions:[{id:'decision',status:'approved',category:'experience_claims',statement,row:{area:'Market Risk Oversight & Reporting'},factRefs:[{id:'fact',version:1,approvalRef:'approval'}]}],submissions:[]};
  return state;
}

test('a narrowed approved answer keeps its questionnaire heading and exposes a stable profile link',()=>{
  const state=areaFixture(),before=structuredClone(state),view=buildProfessionalExperience(state),html=render(state);
  assert.equal(view.rows[0].area,'Market Risk Oversight & Reporting');
  assert.equal(view.rows[0].items[0].statement,'Explained the drivers and changes');
  assert.equal(view.rows[0].items[0].employerRole,null);
  assert.equal(view.rows[0].items[0].period,null);
  assert.ok(html.includes('id="professional-area-market-risk-oversight-reporting"'));
  assert.ok(html.includes('Market Risk Oversight &amp; Reporting'));
  assert.ok(html.includes('Approved addition:'));
  assert.deepEqual(state,before);
});

test('a different or outdated decision cannot assign its heading to an approved answer',()=>{
  for(const mutation of ['decision_id','fact_id','version','approval','status','category','statement','heading']){
    const state=areaFixture(),decision=state.builderExpansion.decisions[0];
    if(mutation==='decision_id')decision.id='unrelated';
    if(mutation==='fact_id')decision.factRefs[0].id='unrelated';
    if(mutation==='version')decision.factRefs[0].version=2;
    if(mutation==='approval')decision.factRefs[0].approvalRef='other';
    if(mutation==='status')decision.status='awaiting_approval';
    if(mutation==='category')decision.category='skills';
    if(mutation==='statement')decision.statement='A different claim';
    if(mutation==='heading')decision.row.area='Risk\nReporting';
    assert.equal(buildProfessionalExperience(state).rows[0].area,'Professional work and delivery',mutation);
  }
});
