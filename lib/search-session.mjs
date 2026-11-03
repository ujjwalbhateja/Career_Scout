// Completed search evidence is browser-local; never relabel it with edited filters.
export const SEARCH_SESSION_KEY='career-scout.completed-search.v1';
export function safeJobLink(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}}
export function readSearchSession(value){
  if(!value||value.schemaVersion!==1||value.result?.phase!=='complete'||!Number.isFinite(Date.parse(value.result.searchedAt))||!value.criteria||typeof value.criteria.roles!=='string'||!Array.isArray(value.result.jobs)||value.result.jobs.length>200)return null;
  if(!value.result.jobs.every(job=>job&&typeof job.id==='string'&&typeof job.title==='string'&&typeof job.company==='string'&&typeof job.description==='string'&&job.salary&&job.sponsorship&&safeJobLink(job.url)))return null;
  return value;
}
export function completeSearchSession(criteria,result,selection){
  return readSearchSession({schemaVersion:1,criteria:structuredClone(criteria),result:structuredClone(result),profileVersion:selection?.version||null});
}
