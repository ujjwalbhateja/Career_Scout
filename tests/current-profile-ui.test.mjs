import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as domain from '../lib/profile/domain.mjs';
import * as client from '../lib/profile/client-state.mjs';
import * as builder from '../lib/profile/builder-expansion.mjs';
import * as demo from '../lib/profile/demo-samples.mjs';
const require=createRequire(import.meta.url);
const output=ts.transpileModule(fs.readFileSync(new URL('../app/profile/workspace.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function render(step,publicDemo=false){
  const state=domain.emptyProfile(),data={revision:1,state,currentProfile:{ready:true,version:'current-'+'a'.repeat(64),searchProfile:{basis:'validated_source_data',context:{titles:[]}}}};
  state.facts.push({id:'resume',category:'skills',field:'tools',statement:'Excel',origin:'resume',approval:'pending',lifecycle:'active',evidence:[]});
  let booleanCount=0;
  const custom=name=>{
    if(name==='react')return {...React,useEffect(){},useState(value){if(value==='Documents')value=step;else if(value?.state&&value.revision===0)value=data;else if(value?.supabase===false)value={supabase:true,model:true,pinecone:false};else if(value===false&&booleanCount++===0)value=true;return React.useState(value);}};
    if(name==='@/lib/profile/domain.mjs')return domain;
    if(name==='@/lib/profile/client-state.mjs')return client;
    if(name==='@/lib/profile/builder-expansion.mjs')return builder;
    if(name==='@/lib/profile/demo-samples.mjs')return demo;
    if(name==='@/data/scout-progress.json')return {default:{tasks:[]}};
    if(name.endsWith('.css'))return {};
    if(name==='./search-step')return {default:props=>React.createElement('div',{'data-profile-version':props.version},'Your next opportunities.')};
    if(name.startsWith('./')||name.startsWith('../'))return {default:()=>null};
    return require(name);
  };
  const module={exports:{}};new Function('require','module','exports',output)(custom,module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default,{publicDemo}));
}
test('Builder offers direct continuation from stored profile without Final Profile controls or resume approval gate',()=>{
  const html=render('Builder');
  assert.match(html,/Approved additions are saved directly to your profile/);
  assert.match(html,/Continue to Master &amp; Scout/);
  assert.doesNotMatch(html,/One Final Profile|Save Final Profile|Last successful Final Profile save|pending resume records/);
  assert.match(html,/<button class="cw-primary">Continue to Master/);
});
test('research view accepts a current stored profile with no saved snapshots',()=>{
  const html=render('Search');
  assert.match(html,/Your next opportunities/);
  assert.match(html,/data-profile-version="current-a{64}"/);
  assert.match(html,/STEP 04 OF 04/);
  assert.doesNotMatch(html,/Save the Final Profile|One Final Profile/);
});

test('public mode offers fictional samples and explains browser access without changing the private workspace',()=>{
  const publicResume=render('Documents',true),publicBuilder=render('Builder',true),privateResume=render('Documents');
  assert.match(publicResume,/No sign-in needed/);assert.match(publicResume,/Each browser gets a separate saved profile/);
  assert.match(publicResume,/Try a sample resume/);assert.match(publicBuilder,/Try a sample job description/);
  assert.doesNotMatch(privateResume,/No sign-in needed|Try a sample resume/);
});
