import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as sessions from '../lib/search-session.mjs';
import {reviewedShortlist} from '../build/reviewed-shortlist-plugin.mjs';
const require=createRequire(import.meta.url);
const criteria={roles:'Risk manager',location:'New York',minSalary:'180000',onWorkVisa:true};
const job={id:'one',title:'Risk manager',company:'Example employer',description:'Portfolio risk',salary:{text:'$180k'},sponsorship:{status:'unknown'},url:'https://example.com/job/1'};
const result={phase:'complete',searchedAt:'2026-11-03T12:00:00Z',jobs:[job]};
test('completed results preserve exact criteria and profile version independently of later edits',()=>{
  const input=structuredClone(criteria),data=structuredClone(result);
  const saved=sessions.completeSearchSession(input,data,{version:'current-one'});
  input.location='California';data.jobs[0].title='Different role';
  assert.equal(saved.criteria.location,'New York');assert.equal(saved.result.jobs[0].title,'Risk manager');assert.equal(saved.profileVersion,'current-one');
  assert.deepEqual(sessions.readSearchSession(JSON.parse(JSON.stringify(saved))),saved);
});
test('partial, corrupt and unsafe results cannot be restored as completed searches',()=>{
  for(const invalid of [null,{}, {...result,phase:'verifying'},{...result,searchedAt:'invalid'},{...result,jobs:[{...job,url:'javascript:alert(1)'}]},{...result,jobs:[{...job,url:'https://user:secret@example.com'}]}])assert.equal(sessions.completeSearchSession(criteria,invalid,null),null);
  assert.equal(sessions.safeJobLink('data:text/html,unsafe'),'');
  assert.equal(sessions.safeJobLink('https://example.com/job/1'),'https://example.com/job/1');
});
const code=ts.transpileModule(fs.readFileSync(new URL('../app/profile/search-step.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function render(review){
  const module={exports:{}};
  new Function('require','module','exports',code)(name=>{
    if(name==='virtual:reviewed-shortlist')return {default:review};
    if(name==='@/lib/search-session.mjs')return sessions;
    if(name.endsWith('.css'))return {};
    if(name==='../scout')return {default:props=>React.createElement('section',{'data-version':props.profileSelection.version,'data-minimum':props.initialCriteria?.minSalary},'Scout controls')};
    return require(name);
  },module,module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default,{version:'current-test',onPrepare(){}}));
}
test('without local research Step 4 opens real search controls using the current profile',()=>{
  const html=render(null);assert.match(html,/data-version="current-test"/);assert.match(html,/Scout controls/);assert.doesNotMatch(html,/Reviewed shortlist|reviewed 2026|shortlisted opportunities/);
});
test('reviewed cards distinguish unknown sponsorship, partial salary ranges and gaps from verified eligibility',()=>{
  const html=render({reviewedOn:'2026-11-03',roles:'Risk',location:'New York',jobs:[{...job,location:'New York',salary:'$150,000–$200,000',salaryMin:150000,date:null,fit:'Portfolio reporting',gap:'Counterparty risk needs checking.'}]});
  for(const label of ['Requirements used','not a new automated search','Upper range meets minimum','Sponsorship not stated','Posting date not stated','Counterparty risk needs checking','View employer posting'])assert.ok(html.includes(label),label);
  assert.match(html,/target="_blank" rel="noreferrer"/);assert.match(html,/data-minimum="180000"/);
});
test('production build excludes local research; local preview can load an optional snapshot',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'scout-step4-'));
  try{
    fs.mkdirSync(path.join(root,'research'));fs.writeFileSync(path.join(root,'research','step4-shortlist.json'),JSON.stringify({reviewedOn:'2026-11-03',jobs:[]}));
    const plugin=reviewedShortlist(),id=plugin.resolveId('virtual:reviewed-shortlist');
    plugin.configResolved({command:'build',root,server:{}});assert.equal(await plugin.load(id),'export default null;');
    plugin.configResolved({command:'serve',root,server:{host:'0.0.0.0'}});assert.equal(await plugin.load(id),'export default null;');
    plugin.configResolved({command:'serve',root,server:{}});assert.match(await plugin.load(id),/2026-11-03/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
