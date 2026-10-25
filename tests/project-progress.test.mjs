import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateProgress,progressCounts,taskBlockers,stageState} from '../lib/project-progress.mjs';

const record=JSON.parse(fs.readFileSync(new URL('../data/scout-progress.json',import.meta.url),'utf8'));
test('reviewed project record is consistent and does not claim daily or resume features are complete',()=>{
  assert.equal(validateProgress(record),record);
  assert.equal(record.tasks.find(task=>task.id==='keenable').status,'done');
  for(const stage of ['daily','profile','matcher','resume','review'])assert.ok(record.tasks.filter(task=>task.stage===stage).every(task=>task.status==='pending'));
  assert.equal(record.tasks.find(task=>task.id==='visual-qa').status,'partial');
});
test('counts and stage states preserve partial work instead of counting it as done',()=>{
  const counts=progressCounts(record.tasks);
  assert.equal(counts.total,counts.done+counts.partial+counts.pending);
  assert.equal(stageState(record.tasks.filter(task=>task.stage==='discovery')),'done');
  assert.equal(stageState(record.tasks.filter(task=>task.stage==='foundation')),'partial');
  assert.equal(stageState(record.tasks.filter(task=>task.stage==='resume')),'pending');
  assert.equal(stageState([]),'pending');
});
test('ready tasks depend on actual completion, not partial prerequisite progress',()=>{
  const task=record.tasks.find(task=>task.id==='scheduler');
  assert.deepEqual(taskBlockers(task,record.tasks).map(item=>item.id),['job-storage','daily-quota']);
  const changed=structuredClone(record.tasks);changed.find(item=>item.id==='job-storage').status='done';changed.find(item=>item.id==='daily-quota').status='partial';
  assert.deepEqual(taskBlockers(task,changed).map(item=>item.id),['daily-quota']);
  assert.deepEqual(taskBlockers(record.tasks.find(task=>task.id==='job-storage'),record.tasks),[]);
});
test('invalid dependencies and cycles cannot silently break the capability graph',()=>{
  for(const mutate of [r=>r.tasks[0].dependsOn=['missing'],r=>r.tasks[0].dependsOn=[r.tasks[0].id],r=>r.tasks[0].dependsOn=['roles'],r=>r.tasks.push({...r.tasks[0]})]){
    const invalid=structuredClone(record);mutate(invalid);assert.throws(()=>validateProgress(invalid));
  }
});
test('completed deliverables require evidence and completed prerequisites',()=>{
  const noEvidence=structuredClone(record);delete noEvidence.tasks[0].evidence;
  assert.throws(()=>validateProgress(noEvidence),/evidence/);
  const inconsistent=structuredClone(record);inconsistent.tasks.find(task=>task.id==='roles').status='pending';
  assert.throws(()=>validateProgress(inconsistent),/prerequisites/);
});
