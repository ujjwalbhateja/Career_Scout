export const PROGRESS_POLL_SECONDS = 30;
export const PROGRESS_STATUSES = ['done','partial','pending'];

/** Reject inconsistent records before displaying a misleading dependency graph. */
export function validateProgress(record) {
  if(record?.schemaVersion!==1||!record.revision||!/^\d{4}-\d{2}-\d{2}$/.test(record.reviewedOn)||!Array.isArray(record.stages)||!record.stages.length||!Array.isArray(record.tasks)||!record.tasks.length)throw new Error('Unsupported progress record.');
  const stages=new Set(record.stages.map(stage=>stage.id));
  const ids=new Set(record.tasks.map(task=>task.id));
  if(stages.size!==record.stages.length||ids.size!==record.tasks.length)throw new Error('Progress IDs must be unique.');
  for(const task of record.tasks){
    if(!stages.has(task.stage)||!PROGRESS_STATUSES.includes(task.status)||!task.title||!task.acceptance||!Array.isArray(task.dependsOn))throw new Error('Invalid progress task.');
    if(task.status==='done'&&!task.evidence)throw new Error('Completed work requires evidence.');
    if(task.dependsOn.some(id=>!ids.has(id)||id===task.id))throw new Error('Unknown or self-referencing dependency.');
  }
  const visiting=new Set(),visited=new Set(),byId=new Map(record.tasks.map(task=>[task.id,task]));
  function visit(id){if(visiting.has(id))throw new Error('Dependency cycle in progress record.');if(visited.has(id))return;visiting.add(id);for(const dependency of byId.get(id).dependsOn)visit(dependency);visiting.delete(id);visited.add(id);}
  for(const id of ids)visit(id);
  for(const task of record.tasks)if(task.status==='done'&&task.dependsOn.some(id=>byId.get(id).status!=='done'))throw new Error('Completed work has incomplete prerequisites.');
  return record;
}

export function progressCounts(tasks){
  return tasks.reduce((counts,task)=>{counts[task.status]++;counts.total++;return counts;},{done:0,partial:0,pending:0,total:0});
}

export function taskBlockers(task,tasks){
  const byId=new Map(tasks.map(item=>[item.id,item]));
  return task.dependsOn.map(id=>byId.get(id)).filter(dependency=>dependency&&dependency.status!=='done');
}

export function stageState(tasks){
  const counts=progressCounts(tasks);
  return counts.total>0&&counts.done===counts.total?'done':counts.done>0||counts.partial>0?'partial':'pending';
}
