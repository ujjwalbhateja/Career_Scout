import test from 'node:test';
import assert from 'node:assert/strict';
import {addDocument,decideFacts,emptyProfile,proposeFacts} from '../lib/profile/domain.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
import {buildFactReview} from '../lib/profile/fact-review.mjs';

const toolsLine='Tools: Procore, SharePoint, Excel (Advanced), Power BI, SQL, Tableau, Python, Jira.';
const languageGroup='Python, SQL';
const toolGroup='Procore, SharePoint, Excel (Advanced), Power BI, Tableau, Jira';
const languageItems=['Python','SQL'];
const toolItems=['Procore','SharePoint','Excel (Advanced)','Power BI','Tableau','Jira'];
const skill=(statement,field,quote=statement)=>({category:'skills',field,scope:'Explicitly listed skills',statement,evidence:[{documentId:'resume',segmentId:'resume.page1.p2',quote}]});

async function fixture(t,outputs,{duplicateSource=false}={}){
  const initial=emptyProfile();
  addDocument(initial,{id:'approved',kind:'resume',title:'Existing approved synthetic work',hash:'old-source',segments:[{id:'approved.p1',text:'Previously approved client reporting.'}]});
  const [approved]=await proposeFacts(initial,[{category:'experience_claims',field:'duties',scope:'Example Employer',statement:'Previously approved client reporting.',evidence:[{documentId:'approved',segmentId:'approved.p1',quote:'Previously approved client reporting.'}]}]);
  decideFacts(initial,[{id:approved.id,version:approved.version,decision:'approved'}],'synthetic-owner');
  initial.roleProfiles.push({id:'old-role',version:1,status:'approved',roleName:'Old role',factRefs:[{id:approved.id,version:approved.version}]});
  initial.snapshots.push({id:'old-snapshot',version:'profile-1',stale:false,factRefs:[{id:approved.id,version:approved.version}]});
  const lines=['CORE COMPETENCIES',toolsLine,...(duplicateSource?['Previously approved client reporting.']:[])];
  addDocument(initial,{id:'resume',kind:'resume',title:'Synthetic grouped skill source',mime:'application/pdf',hash:'skills-source',segments:lines.map((text,index)=>({id:`resume.page1.p${index+1}`,text,locator:`page 1 paragraph ${index+1}`}))});
  const before=structuredClone(initial),savedStates=[];let stored={revision:1,state:structuredClone(initial)},responses=0;
  const service=new ProfileService({GEMINI_API_KEY:'synthetic-test-key',PROFILE_SEMANTIC_SEARCH:'disabled'},'synthetic-owner');
  service.memory.load=async()=>structuredClone(stored);
  service.memory.reserve=async()=>({});
  service.memory.save=async(revision,state)=>{assert.equal(revision,stored.revision);savedStates.push(structuredClone(state));stored={revision:revision+1,state:structuredClone(state)};return structuredClone(stored);};
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(new URL(url).hostname,'generativelanguage.googleapis.com');
    const request=JSON.parse(options.body),input=JSON.parse(request.contents[0].parts[0].text);
    assert.equal(input.documentId,'resume');assert.match(request.systemInstruction.parts[0].text,/CURRENT RUNTIME STAGE: facts/);
    const output=outputs[responses++];assert.ok(output,'unexpected additional mocked model response');
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]});
  });
  return {before,service,current:()=>structuredClone(stored),savedStates:()=>structuredClone(savedStates),analyze:async()=>service.analysis(await service.memory.load(),{action:'analyze',id:'resume'})};
}

test('captured grouped language and tool shape creates pending groups with atomic source-backed review items',async t=>{
  const output={facts:[skill(languageGroup,'programming_languages'),skill(toolGroup,'tools_technologies')],passageReview:[{segmentId:'resume.page1.p1',reason:'Section heading.'}]};
  const beforeOutput=structuredClone(output),f=await fixture(t,[output,output]),saved=await f.analyze();
  const added=saved.state.facts.filter(fact=>!f.before.facts.some(old=>old.id===fact.id));
  assert.deepEqual(added.map(fact=>fact.statement),[languageGroup,toolGroup],'repair must preserve proposal count, order and group statements');
  for(const [index,items] of [languageItems,toolItems].entries()){
    assert.equal(added[index].approval,'pending');assert.equal(added[index].approvalRef,null);
    assert.deepEqual(added[index].evidence,items.map(quote=>({documentId:'resume',documentVersion:1,segmentId:'resume.page1.p2',quote})));
  }
  assert.deepEqual(saved.state.approvals,f.before.approvals,'grounding cannot add approval decisions');
  assert.deepEqual(saved.state.facts.filter(fact=>f.before.facts.some(old=>old.id===fact.id)),f.before.facts);
  assert.deepEqual(saved.state.roleProfiles,f.before.roleProfiles);assert.deepEqual(saved.state.snapshots,f.before.snapshots);
  assert.equal(saved.state.documents.find(document=>document.id==='resume').analysis,'complete');
  const review=buildFactReview(saved.state);
  assert.deepEqual(review.skills.programmingLanguages.map(item=>item.value),languageItems);
  assert.deepEqual(review.skills.toolsTechnologies.map(item=>item.value),toolItems);
  assert.equal(review.skills.otherSkills.length,0);
  assert.ok(Object.values(review.skills).flat().every(item=>item.evidenceStatus==='matched_source'&&item.approvalStatus==='pending'));
  const repeated=await f.analyze();assert.deepEqual(repeated.state.facts,saved.state.facts,'retrying the same groups cannot duplicate pending facts or evidence');
  assert.deepEqual(repeated.state.approvals,f.before.approvals);assert.deepEqual(output,beforeOutput);
  for(const document of f.before.documents)assert.deepEqual(repeated.state.documents.find(current=>current.id===document.id).segments,document.segments);
});

const invalidGroups=[
  ['unsupported skill',skill('Python, Java','programming_languages')],
  ['invented proficiency',skill('Expert Python, SQL','programming_languages')],
  ['tool substring',skill('BI, Jira','tools_technologies')],
  ['changed case',skill('python, SQL','programming_languages')],
  ['statement-only extra skill',skill('Python, SQL, Java','programming_languages','Python, SQL')],
  ['wrong canonical bucket',skill('Python, Power BI','programming_languages')],
  ['non-skill narrative grouping',{...skill(languageGroup,'duties'),category:'experience_claims'}]
];
for(const [name,bad] of invalidGroups)test(`grouped skill recovery rejects ${name} without saving partial facts or changing approvals`,async t=>{
  const duplicate={category:'experience_claims',field:'duties',scope:'Example Employer',statement:'Previously approved client reporting.',evidence:[{documentId:'resume',segmentId:'resume.page1.p3',quote:'Previously approved client reporting.'}]};
  const f=await fixture(t,[{facts:[duplicate,bad]}],{duplicateSource:true});
  await assert.rejects(f.analyze(),error=>error.status===502&&/Fact evidence grounding:/.test(error.message));
  const state=f.current().state;
  assert.deepEqual({...state,runs:[]},{...f.before,runs:[]});
  for(const saved of f.savedStates())assert.deepEqual({...saved,runs:[]},{...f.before,runs:[]},'a valid earlier duplicate cannot expand approved evidence in any intermediate save');
  assert.equal(state.runs.at(-1).status,'failed');assert.equal(state.documents.find(document=>document.id==='resume').analysis,'pending');
});
