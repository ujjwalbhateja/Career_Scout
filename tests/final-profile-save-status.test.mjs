import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const output=ts.transpileModule(fs.readFileSync(new URL('../app/profile/final-profile-save-status.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};new Function('require','module','exports',output)(require,module,module.exports);
const render=props=>renderToStaticMarkup(React.createElement(module.exports.default,{loaded:true,...props}));
const latest={version:'profile-test',createdAt:'2026-10-30T20:05:27.295Z',stale:false};

test('historical save remains visible and outdated without a validated current snapshot',()=>{
  const html=render({latest});
  assert.match(html,/Last successful Final Profile save/);
  assert.match(html,/October 30, 2026 at 4:05:27 PM EDT/);
  assert.match(html,/New York/);assert.match(html,/Outdated/);
  assert.doesNotMatch(html,/button|Up to date|clicked/);
});
test('current status requires a matching validated version and no stale flag',()=>{
  assert.match(render({latest,currentVersion:latest.version}),/Up to date/);
  assert.match(render({latest:{...latest,stale:true},currentVersion:latest.version}),/Outdated/);
  assert.match(render({latest,currentVersion:'another-version'}),/Outdated/);
});
test('loading, never saved and unavailable dates remain distinct',()=>{
  assert.match(render({loaded:false}),/Loading/);
  assert.match(render({}),/No Final Profile saved yet/);
  assert.match(render({latest:{...latest,createdAt:'invalid'}}),/Save time unavailable/);
});
test('New York timezone observes standard time after daylight saving ends',()=>{
  assert.match(render({latest:{...latest,createdAt:'2026-11-01T20:05:27.295Z'}}),/3:05:27 PM EST/);
});
