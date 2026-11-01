import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prioritizeScoutContext} from '../lib/workflow/scout-agent.mjs';
const prompt=readFileSync(new URL('../backend/src/career_scout/agents/scout/prompt.md',import.meta.url),'utf8');
const context={profileId:'master-profile',basis:'validated_source_data',roleName:'Validated professional profile',titles:[],functionName:'',functions:[],approvedFactIds:['f1','f2'],responsibilities:[{term:'client reporting',factIds:['f1']}],industries:[],skills:[{term:'Excel',factIds:['f2']}],qualifications:[]};
test('Scout consumes its actual policy while model selection cannot invent professional terms',async()=>{
  const result=await prioritizeScoutContext(context,prompt,{GEMINI_API_KEY:'fixture'},{generate:async(_env,call)=>{
    assert.ok(call.instructions.includes(prompt));assert.equal(call.input.owner,undefined);assert.equal(call.input.facts,undefined);assert.equal(call.input.resume,undefined);assert.equal(call.input.role,undefined);assert.deepEqual(call.input.titles,[]);assert.deepEqual(call.input.functions,[]);
    return {responsibilities:['client reporting','investment authority'],industries:['invented'],skills:['Python'],qualifications:[]};
  }});
  assert.deepEqual(result.context.responsibilities,context.responsibilities);assert.deepEqual(result.context.skills,context.skills);assert.deepEqual(result.context.industries,[]);assert.equal(result.policy.modelPlanning,true);
  assert.deepEqual(result.context.titles,[]);assert.deepEqual(result.context.alternativeTitles,[]);assert.equal(result.context.functionName,'');
});

test('Scout planning preserves only explicitly sourced titles and never accepts generated alternatives',async()=>{
  const sourced={...context,titles:[{term:'Reporting Associate',sourceKind:'employment_title',factIds:['f1']}],alternativeTitles:['Invented Reporting Director']};
  const result=await prioritizeScoutContext(sourced,prompt,{GEMINI_API_KEY:'fixture'},{generate:async(_env,call)=>{assert.deepEqual(call.input.titles,['Reporting Associate']);assert.equal(call.input.role,undefined);assert.equal(call.input.alternativeTitles,undefined);assert.ok(!JSON.stringify(call.input).includes('Invented Reporting Director'));return {titles:['Invented Reporting Director'],alternativeTitles:['Invented Reporting Director'],responsibilities:['client reporting'],industries:[],skills:['Excel'],qualifications:[]};}});
  assert.deepEqual(result.context.titles.map(t=>t.term),['Reporting Associate']);assert.deepEqual(result.context.alternativeTitles,[]);
  assert.ok(!JSON.stringify(result).includes('Invented Reporting Director'));
});
test('Scout reports model planning unavailability while retaining only approved candidates',async()=>{
  const result=await prioritizeScoutContext(context,prompt,{GEMINI_API_KEY:'fixture'},{generate:async()=>{throw new Error('private provider failure');}});
  assert.equal(result.policy.modelPlanning,false);assert.ok(result.policy.planningWarning);assert.ok(!JSON.stringify(result).includes('private provider failure'));assert.deepEqual(result.context.skills,context.skills);
});
