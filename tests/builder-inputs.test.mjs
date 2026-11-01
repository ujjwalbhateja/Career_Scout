import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProfile,addDocument,addJDAnalysis} from '../lib/profile/domain.mjs';
import {supplementBuilderRequirements,normalizeBuilderAssessment} from '../lib/profile/builder-inputs.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
test('uncited partial support becomes a full unconfirmed review, never narrowed evidence',()=>{
  const requirement={id:'r',text:'Python used in research',evidence:[{quote:'Python used in research'}]};
  const normalized=normalizeBuilderAssessment(requirement,{factIds:[],evidenceStatus:'partial',missingScope:'invented scope',explanation:'Pending resume information'},[]);
  assert.equal(normalized.evidenceStatus,'missing');assert.equal(normalized.missingScope,'');assert.equal(normalized.proposedStatement,'');assert.deepEqual(normalized.factIds,[]);
  const invalidRef=normalizeBuilderAssessment(requirement,{factIds:['unapproved'],evidenceStatus:'supported'},[]);
  assert.deepEqual(invalidRef.factIds,[]);assert.equal(invalidRef.evidenceStatus,'missing');
  const sourceOnly=normalizeBuilderAssessment(requirement,{factIds:[],evidenceStatus:'supported'},[]);
  assert.equal(sourceOnly.evidenceStatus,'missing');assert.deepEqual(sourceOnly.factIds,[]);
  const paraphrase=normalizeBuilderAssessment(requirement,{factIds:[],evidenceStatus:'not_established',proposedStatement:'Invented expanded task'},[]);
  assert.equal(paraphrase.proposedStatement,'');assert.deepEqual(paraphrase.factIds,[]);
  const fact={id:'approved',category:'skills',statement:'Python',approval:'approved'};
  const narrowed=normalizeBuilderAssessment(requirement,{factIds:['approved'],evidenceStatus:'partial',missingScope:'Invented narrowed wording'},[fact]);
  assert.equal(narrowed.missingScope,'');assert.equal(narrowed.proposedStatement,'');assert.equal(narrowed.evidenceStatus,'missing');
});
test('duty and skill bullets omitted by the model are retained verbatim once, without changing facts',async()=>{
  const s=emptyProfile();const text='Roles and Responsibilities:\n- Monitor risk across portfolios\n- Prepare investor reports\nSkills and Attributes:\n- Excellent analytical skills\n## Benefits\n- Free meals and a bonus\n## Similar jobs\n- Manage a factory';
  addDocument(s,{id:'jd',kind:'jd',title:'Risk Manager',hash:'jd',selected:true,segments:[{id:'jd.1',text}]});
  await addJDAnalysis(s,'jd',{roleName:'Risk Manager',sector:'',requirements:[{category:'task',text:'Monitor risk across portfolios',importance:'required',evidence:[{documentId:'jd',segmentId:'jd.1',quote:'Monitor risk across portfolios'}]}]});
  assert.equal(await supplementBuilderRequirements(s,s.documents[0]),2);
  assert.deepEqual(s.requirements.map(r=>r.text).sort(),['Excellent analytical skills','Monitor risk across portfolios','Prepare investor reports']);
  assert.equal(await supplementBuilderRequirements(s,s.documents[0]),0);assert.deepEqual(s.facts,[]);assert.deepEqual(s.approvals,[]);
  assert.ok(s.requirements.every(r=>r.evidence.every(e=>text.includes(e.quote))));
});
test('expansion mode survives Profile dispatch to the comparison stage',async()=>{
  const s=emptyProfile();s.facts.push({id:'f',version:1,category:'skills',statement:'Excel',lifecycle:'active',approval:'approved'});
  const service=new ProfileService({},'test-owner');service.memory.load=async()=>({revision:1,state:s});
  service.analysis=async(record,body)=>{assert.equal(body.mode,'expansion');return record;};
  await service.action({action:'buildProfiles',revision:1,mode:'expansion'});
});
