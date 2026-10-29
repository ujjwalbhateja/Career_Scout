import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PROFILE_LAYERS,architectureTasks,layerTasks,layerState} from '../lib/profile/architecture.mjs';
import {validateProgress} from '../lib/project-progress.mjs';
const record=JSON.parse(readFileSync(new URL('../data/scout-progress.json',import.meta.url),'utf8'));
test('Profile diagram covers all Profile-family tasks without inflating shared counts',()=>{
  validateProgress(record);
  const tasks=architectureTasks(record),ids=new Set(tasks.map(task=>task.id));
  assert.equal(ids.size,tasks.length);
  for(const task of record.tasks.filter(task=>['profile','fact','profile-builder','memory'].includes(task.owner)))assert.ok(ids.has(task.id),task.id);
  assert.ok(PROFILE_LAYERS.flatMap(layer=>layer.tasks).length>tasks.length);
  assert.throws(()=>layerTasks(record,'missing'),/Unknown/);
  const broken=structuredClone(record);broken.tasks=broken.tasks.filter(task=>task.id!=='profile-provider-activation');assert.throws(()=>architectureTasks(broken),/missing task/);
});
test('diagram updates a layer when the reviewed record changes and distinguishes pending activation',()=>{
  const changed=structuredClone(record);
  for(const task of layerTasks(changed,'analysis'))task.status='complete';
  assert.equal(layerState(changed,'analysis'),'complete');
  changed.tasks.find(task=>task.id==='profile-provider-activation').status='blocked';
  assert.equal(layerState(changed,'analysis'),'blocked');
  assert.equal(layerState(record,'master'),'not_started');
});
