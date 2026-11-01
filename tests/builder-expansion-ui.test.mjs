import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const output=ts.transpileModule(fs.readFileSync(new URL('../app/profile/builder-expansion.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};new Function('require','module','exports',output)(require,module,module.exports);
const Component=module.exports.default;
const row={id:'row1',documentId:'jd1',fingerprint:'version1',proposedStatement:'Prepared risk reports',section:'experience',area:'Risk analytics',status:'pending',revisionText:'',draftVersion:0};
const render=(groups,props={})=>renderToStaticMarkup(React.createElement(Component,{groups,disabled:false,onSubmit:async()=>({ok:true,message:'saved'}),...props}));
test('rendered questionnaire separates roles and work/skill tables with the three requested decisions',()=>{
  const html=render(['Risk Manager','Portfolio Manager'].map((title,i)=>({title,documentId:'jd'+i,analysis:'complete',experience:[{...row,id:'work'+i}],skills:[{...row,id:'skill'+i,section:'skills',area:'programming_languages',proposedStatement:'Python'}]})));
  assert.equal((html.match(/<table /g)||[]).length,4);assert.ok(html.includes('Questionnaire: Risk Manager'));assert.ok(html.includes('Questionnaire: Portfolio Manager'));
  for(const text of ['Professional Work Experience','Skills','Approve','Reject','Somewhat'])assert.ok(html.includes(text));
});
test('saved Somewhat displays exact revision and separate approval; rejection is closed',()=>{
  const html=render([{title:'Risk Manager',documentId:'jd1',analysis:'complete',experience:[{...row,status:'awaiting_approval',revisionText:'Prepared monthly risk reports',draftVersion:1}],skills:[{...row,id:'skill',status:'rejected',section:'skills'}]}]);
  assert.ok(html.includes('Approve revised wording'));assert.ok(html.includes('Prepared monthly risk reports'));assert.ok(html.includes('not yet a fact'));assert.ok(html.includes('Reopen rejected item'));assert.ok(!html.includes('narrower claim saved'));
});

test('recorded capabilities have no approval controls and partial questions show the existing source',()=>{
  const html=render([{title:'Risk Manager',documentId:'jd1',analysis:'complete',recorded:[{area:'Risk Reporting',requirement:'Prepare risk reports',statements:['Built risk reports using VaR']}],experience:[],skills:[{...row,section:'skills',proposedStatement:'beta and volatility',recordedStatements:['Used VaR and Greeks']}]}]);
  assert.ok(html.includes('no repeat questions'));assert.ok(html.includes('Used VaR and Greeks'));assert.ok(html.includes('only the remaining detail'));
  assert.equal((html.match(/>Approve</g)||[]).length,1);assert.ok(html.includes('do not create new facts or change approvals'));
});

test('unresolved comparisons are visibly retained without approval controls or a match claim',()=>{
  const html=render([{title:'Risk Manager',documentId:'jd1',analysis:'complete',experience:[],skills:[],unresolved:[{area:'Risk Reporting',requirement:'Deliver reports',explanation:'Remaining scope could not be safely separated.'}]}]);
  assert.ok(html.includes('Comparison needs clarification (1)'));assert.ok(html.includes('not counted as matched'));assert.ok(!html.includes('>Approve<'));
});

test('threshold skips stay unconfirmed and grouped details have one set of response controls',()=>{
  const html=render([{title:'Risk Manager',documentId:'jd1',analysis:'complete',experience:[],skills:[{...row,section:'skills',groupedStatements:['beta','volatility'],proposedStatement:'beta; volatility',coverageEstimates:[{requirementId:'r',percent:75,criticalGap:true,components:[{scope:'beta',matched:false,weight:1}]}]}],skipped:[{requirement:'Prepare reports with preferred templates',area:'Risk Reporting',percent:75,reason:'skip_minor',unconfirmed:['preferred templates'],statements:['Prepared risk reports']}]}]);
  assert.ok(html.includes('75% estimated coverage'));assert.ok(html.includes('Still unconfirmed: preferred templates'));
  assert.ok(html.includes('One question for these related details'));assert.ok(html.includes('an important gap still needs confirmation'));
  assert.equal((html.match(/>Approve</g)||[]).length,1);assert.ok(html.includes('does not add or approve'));
});

test('completed answers are collapsed while pending and Somewhat items remain visible',()=>{
  const html=render([{title:'Risk Manager',documentId:'jd1',analysis:'complete',experience:[
    {...row,id:'approved',status:'approved',proposedStatement:'Approved duty',approvedStatement:'Approved duty'},
    {...row,id:'rejected',status:'rejected',proposedStatement:'Rejected duty'},
    {...row,id:'draft',status:'awaiting_approval',proposedStatement:'Partial duty',revisionText:'Narrower duty',draftVersion:1},
    {...row,id:'pending',proposedStatement:'Pending duty'}
  ],skills:[]}]);
  const split=html.indexOf('<details class="cw-questionnaire-archive"><summary>Already answered (2)</summary>');assert.ok(split>0);
  assert.ok(html.slice(0,split).includes('Pending duty'));assert.ok(html.slice(0,split).includes('Approve revised wording'));
  assert.ok(!html.slice(0,split).includes('Approved duty'));assert.ok(!html.slice(0,split).includes('Rejected duty'));
  assert.ok(html.slice(split).includes('Approved duty'));assert.ok(html.slice(split).includes('Reopen rejected item'));
});

test('new-role view keeps earlier unfinished questionnaires accessible behind a closed bar',()=>{
  const groups=['old','new'].map(id=>({title:id+' role',documentId:id,analysis:'complete',experience:[{...row,id,documentId:id,proposedStatement:id+' duty'}],skills:[]}));
  const html=render(groups,{activeDocumentIds:['new']});
  const split=html.indexOf('<details class="cw-questionnaire-archive"><summary>Earlier role questionnaires (1)');assert.ok(split>0);
  assert.ok(html.slice(0,split).includes('new duty'));assert.ok(!html.slice(0,split).includes('old duty'));assert.ok(html.slice(split).includes('old duty'));
});
