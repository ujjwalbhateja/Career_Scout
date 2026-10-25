export const PROGRESS_POLL_SECONDS = 30;
import {AGENT_IDS,COMMUNICATION_ROUTES,assertCommunication} from './workflow/policy.mjs';
export const PROGRESS_STATUSES = ['not_started','in_progress','blocked','in_review','complete'];
export const STATUS_LABELS={not_started:'Not Started',in_progress:'In Progress',blocked:'Blocked',in_review:'In Review',complete:'Complete'};

/** Reject inconsistent records before displaying a misleading dependency graph. */
export function validateProgress(record) {
  if(record?.schemaVersion!==2||!record.revision||!/^\d{4}-\d{2}-\d{2}$/.test(record.reviewedOn)||!Array.isArray(record.agents)||!Array.isArray(record.stages)||!Array.isArray(record.validation)||!record.framework?.name||!Array.isArray(record.tasks)||!record.tasks.length)throw new Error('Unsupported progress record.');
  const agents=new Set(record.agents.map(agent=>agent.id));
  const ids=new Set(record.tasks.map(task=>task.id));
  if(agents.size!==record.agents.length||ids.size!==record.tasks.length||AGENT_IDS.some(id=>!agents.has(id))||agents.size!==AGENT_IDS.length)throw new Error('Progress IDs must be unique and include all workflow owners.');
  for(const task of record.tasks){
    if(!agents.has(task.owner)||!PROGRESS_STATUSES.includes(task.status)||!task.title||!task.acceptance||!Array.isArray(task.dependsOn)||!Array.isArray(task.notes)||!Array.isArray(task.blockers)||!Array.isArray(task.outputLinks))throw new Error('Invalid progress task.');
    if(task.status==='complete'&&!task.evidence)throw new Error('Completed work requires evidence.');
    if(task.outputLinks.some(link=>!link.label||!(/^(?:\/(?!\/)|https:\/\/)/.test(link.url||''))))throw new Error('Invalid output link.');
    if(task.legacy&&(!task.originalStatus||!Array.isArray(task.ownerHistory)||task.originalOwner!=='scout'))throw new Error('Preserve original tracking history.');
    if(task.dependsOn.some(id=>!ids.has(id)||id===task.id))throw new Error('Unknown or self-referencing dependency.');
  }
  const visiting=new Set(),visited=new Set(),byId=new Map(record.tasks.map(task=>[task.id,task]));
  function visit(id){if(visiting.has(id))throw new Error('Dependency cycle in progress record.');if(visited.has(id))return;visiting.add(id);for(const dependency of byId.get(id).dependsOn)visit(dependency);visiting.delete(id);visited.add(id);}
  for(const id of ids)visit(id);
  for(const task of record.tasks)if(task.status==='complete'&&task.dependsOn.some(id=>byId.get(id).status!=='complete'))throw new Error('Completed work has incomplete prerequisites.');
  if(!Array.isArray(record.communication)||record.communication.length!==COMMUNICATION_ROUTES.length||new Set(record.communication.map(edge=>edge.from+'>'+edge.to)).size!==COMMUNICATION_ROUTES.length)throw new Error('Missing or duplicate communication routes.');
  for(const edge of record.communication)assertCommunication(edge.from,edge.to);
  return record;
}

export function progressCounts(tasks){
  return tasks.reduce((counts,task)=>{counts[task.status]++;counts.total++;return counts;},{not_started:0,in_progress:0,blocked:0,in_review:0,complete:0,total:0});
}

export function taskBlockers(task,tasks){
  const byId=new Map(tasks.map(item=>[item.id,item]));
  return task.dependsOn.map(id=>byId.get(id)).filter(dependency=>dependency&&dependency.status!=='complete');
}

export function stageState(tasks){
  const counts=progressCounts(tasks);
  return counts.total>0&&counts.complete===counts.total?'complete':counts.complete>0||counts.in_progress>0?'in_progress':counts.in_review>0?'in_review':counts.blocked>0?'blocked':'not_started';
}
