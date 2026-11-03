import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as matching from '../lib/matching.mjs';
import * as evidence from '../lib/job-evidence.mjs';
import * as sessions from '../lib/search-session.mjs';
const require=createRequire(import.meta.url);
const code=ts.transpileModule(fs.readFileSync(new URL('../app/scout.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function render(onWorkVisa){
  const custom=name=>{
    if(name==='react')return {...React,useEffect(){},useState(value){return React.useState(value&&typeof value==='object'&&Object.hasOwn(value,'onWorkVisa')?{...value,onWorkVisa}:value);}};
    if(name==='@/lib/matching.mjs')return matching;
    if(name==='@/lib/job-evidence.mjs')return evidence;
    if(name==='@/lib/search-session.mjs')return sessions;
    if(name==='./profile/handoff-review')return {default:()=>null};
    return require(name);
  };
  const module={exports:{}};new Function('require','module','exports',code)(custom,module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default));
}
test('Scout shows a separate optional work-visa checkbox with explicit-refusal wording',()=>{
  const html=render(false);
  assert.match(html,/<input type="checkbox"\/><span><strong>I am on a work visa/);
  assert.match(html,/Exclude jobs explicitly stating no visa sponsorship/);
  assert.match(html,/Unstated or conflicting policies remain visible for review/);
  assert.match(html,/Prefer visa sponsorship/);
});
test('Scout displays the selected work-visa preference without selecting the ranking preference',()=>{
  const html=render(true);
  assert.match(html,/<input type="checkbox" checked=""\/><span><strong>I am on a work visa/);
  assert.match(html,/<input type="checkbox"\/><span><strong>Prefer visa sponsorship/);
});
