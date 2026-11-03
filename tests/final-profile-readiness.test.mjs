import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const output=ts.transpileModule(fs.readFileSync(new URL('../app/profile/final-profile-readiness.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};new Function('require','module','exports',output)(require,module,module.exports);
const render=props=>renderToStaticMarkup(React.createElement(module.exports.default,{loaded:true,facts:[],documents:[],handoffs:[],onResume(){},onDecision(){},disabled:false,...props}));
const verification={snapshotId:'saved1',profileVersion:'profile-2',revision:3,verifiedAt:'2026-11-02T12:00:00Z',contentHash:'a'.repeat(64),factCount:8,questionnaireFactCount:2};
const status={approvedAdditions:2,includedAdditions:2,blockers:[],verification,message:'Needs current validation'};

test('saved additions, verified Final Profile, Master loading and Scout execution are distinct states',()=>{
  assert.equal(render({loaded:false}),'');
  const ready=render({status,currentVersion:'profile-2'});
  assert.match(ready,/2 of 2 approved additions included/);assert.match(ready,/Ready to load/);assert.match(ready,/No dispatch recorded/);
  const stale=render({status,currentVersion:'profile-3'});
  assert.doesNotMatch(stale,/reloaded and verified|2 of 2/);assert.match(stale,/Waiting for a current validated/);
});

test('only a stored handoff for the exact verified version and content is reported as dispatched',()=>{
  const handoff={profileVersion:'profile-2',stage:'completed',at:verification.verifiedAt,persistence:{saved:true},profileReceipt:{...verification,loadedAt:verification.verifiedAt}};
  assert.match(render({status,currentVersion:'profile-2',handoffs:[handoff]}),/dispatch recorded; research completed/);
  for(const old of [{...handoff,profileVersion:'profile-1'},{...handoff,persistence:{saved:false}},{...handoff,profileReceipt:{...handoff.profileReceipt,contentHash:'b'.repeat(64)}}]){
    assert.doesNotMatch(render({status,currentVersion:'profile-2',handoffs:[old]}),/dispatch recorded; research completed/);
  }
});

test('pending resume review preserves evidence, requires finished analysis and never repeats approved Builder answers',()=>{
  const pending={id:'f',version:1,category:'skills',field:'tools_technologies',scope:'Skills',statement:'Pending Excel',origin:'resume',approval:'pending',lifecycle:'active',conflict:false,evidence:[{documentId:'cv',quote:'Exact Excel source'}]};
  const facts=[pending,{...pending,id:'answered',origin:'user_answer',approval:'approved',statement:'Already approved Builder skill'}];
  const docs=[{id:'cv',kind:'resume',analysis:'pending'}];
  const before=render({facts,documents:docs});
  assert.match(before,/Go to Your Resume/);assert.match(before,/Review 1 pending resume record/);assert.match(before,/Exact Excel source/);
  assert.doesNotMatch(before,/Already approved Builder skill/);assert.equal((before.match(/ disabled=""/g)||[]).length,2);
  const after=render({facts,documents:[{...docs[0],analysis:'complete'}]});assert.doesNotMatch(after,/ disabled=""/);
  assert.equal((render({facts:[{...pending,conflict:true}],documents:[{...docs[0],analysis:'complete'}]}).match(/ disabled=""/g)||[]).length,1);
});
