export const AGENT_IDS=['master','profile','fact','profile-builder','scout','matcher','tailor','critic','memory','application-storage'];
export const COMMUNICATION_ROUTES=[
  ['user','master'],
  ...['profile','scout','matcher','tailor','critic'].flatMap(id=>[['master',id],[id,'master']]),
  ...['fact','profile-builder','memory'].flatMap(id=>[['profile',id],[id,'profile']]),
  ['master','application-storage']
];
export function assertCommunication(from,to){
  if(!COMMUNICATION_ROUTES.some(([source,target])=>source===from&&target===to))throw new Error(`Communication denied: ${from} → ${to}. Route through the authorized coordinator.`);
}
export function routingPath(from,to){
  const queue=[[from]],seen=new Set([from]);
  while(queue.length){const path=queue.shift();if(path.at(-1)===to)return path;for(const [source,target]of COMMUNICATION_ROUTES)if(source===path.at(-1)&&!seen.has(target)){seen.add(target);queue.push([...path,target]);}}
  return [];
}
export function auditRoute(from,to,kind){assertCommunication(from,to);return {from,to,kind,at:new Date().toISOString()};}
export function requireJDIntake(input){
  const descriptions=input?.selectedJobDescriptions;
  if(!Array.isArray(descriptions)||descriptions.length<10||descriptions.length>15||descriptions.some(jd=>!jd.id||typeof jd.text!=='string'||jd.text.trim().length<80))throw new Error('Profile Builder intake requires 10–15 user-selected job descriptions with readable text and stable IDs.');
  if(new Set(descriptions.map(jd=>jd.id)).size!==descriptions.length)throw new Error('Selected job descriptions must have unique IDs.');
}
export function requireProfileIntake(input){
  if(input?.mode==='resume'){
    if(typeof input.existingResume!=='string'||input.existingResume.trim().length<80)throw new Error('Resume-only intake requires readable resume text.');
    return;
  }
  if(input?.mode&&input.mode!=='jd')throw new Error('Choose resume or JD intake.');
  requireJDIntake(input);
}
export async function draftFingerprint(draft){
  if(!draft?.jobId||!draft.profileVersion||!draft.content)throw new Error('A draft must identify its job, profile version and content.');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({jobId:draft.jobId,profileVersion:draft.profileVersion,content:draft.content,artifactRef:draft.artifactRef||null})));
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
export async function validationIssues({job,draft,profile,review}){
  const issues=[];
  if(!job?.id||draft?.jobId!==job.id||review?.jobId!==job.id)issues.push('Job-to-resume association does not match.');
  if(profile?.approvalStatus!=='approved'||!profile.approvalRef||!profile.version||draft?.profileVersion!==profile.version||review?.profileVersion!==profile.version)issues.push('An approved matching profile version is required.');
  if(review?.reviewer!=='critic')issues.push('Grounding Critic review is required.');
  if(!review?.draftHash||review.draftHash!==await draftFingerprint(draft))issues.push('Review does not cover the current draft.');
  for(const [key,label]of [['profileFacts','Profile facts'],['jobAlignment','Experience and job alignment']]){
    if(review?.[key]?.passed!==true||!Array.isArray(review[key]?.issues)||review[key].issues.length)issues.push(`${label} review has not passed cleanly.`);
  }
  if(!Array.isArray(review?.unresolvedIssues)||review.unresolvedIssues.length)issues.push('Unresolved validation issues remain.');
  return issues;
}
export async function validatedPackage({job,draft,profile,review,assessment,date}){
  const issues=await validationIssues({job,draft,profile,review});if(issues.length)throw new Error('Package is not Ready to Apply: '+issues.join(' '));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw new Error('Provide the user-local package date.');
  if(!/^https:\/\//.test(job.applicationUrl||'')||!job.description||!job.title||!job.company||!assessment)throw new Error('Application package is missing required job or match details.');
  const slug=value=>String(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,65)||'job';
  return {schemaVersion:1,status:'Validated — awaiting storage',jobId:job.id,profileVersion:profile.version,folder:`${date}/${slug(job.company)}-${slug(job.title)}-${slug(job.id)}`,job:{id:job.id,title:job.title,company:job.company,applicationUrl:job.applicationUrl,description:job.description},assessment,resume:draft,validation:review,unresolvedIssues:[],requiredOutputs:['job.json','job-description.md','application-link.txt','match-assessment.json','tailored-resume','validation.json','manifest.json']};
}
