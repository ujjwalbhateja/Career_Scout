import {ProfileError} from '../profile/domain.mjs';
export async function pipelineCall(env,action,payload={},fetcher=fetch){
  if(!env.CAREER_AGENT_URL||!env.CAREER_AGENT_TOKEN)throw new ProfileError('The local Python pipeline is not running. Start Career Scout with Start-Scout.cmd.',503);
  const url=new URL(env.CAREER_AGENT_URL);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new ProfileError('The local pipeline address is invalid.',503);
  if(!['health','prompt','start','get','list','retry','cancel','download','delete'].includes(action))throw new ProfileError('Unknown pipeline action.');
  let response;
  try{response=await fetcher(url.origin+'/'+action,{method:'POST',headers:{Authorization:'Bearer '+env.CAREER_AGENT_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(15000)});}
  catch(error){console.error(JSON.stringify({event:'pipeline_transport_failed',kind:error?.name||'network',code:error?.cause?.code||error?.code||'unavailable'}));throw new ProfileError('The local Python pipeline is unavailable. Restart with Start-Scout.cmd. Saved runs are kept.',503);}
  if(response.status>=300&&response.status<400)throw new ProfileError('Pipeline redirects are not permitted.',502);
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new ProfileError(error.error||'Pipeline request failed.',response.status);}
  return response;
}
export function applicationRequest(body){
  const selection=body.profileSelection;
  if(!selection||!/^profile-\d+$/.test(selection.version)||typeof selection.roleId!=='string'||!selection.roleId||selection.roleId.length>180)throw new ProfileError('Build and save the validated master profile first.');
  const request={intent:'prepare_application',saved_profile_version:selection.version,selected_role_id:selection.roleId};
  if(body.job){
    const job=body.job;
    for(const name of ['id','title','company','description','application_url'])if(typeof job[name]!=='string'||!job[name].trim())throw new ProfileError('Provide a job title, company, full description and application URL.');
    if(job.description.trim().length<80||job.description.length>60000||job.id.length>180||job.title.length>250||job.company.length>250)throw new ProfileError('Provide a readable job description between 80 and 60,000 characters.');
    let url;try{url=new URL(job.application_url);}catch{throw new ProfileError('Enter the HTTPS application URL.');}
    if(url.protocol!=='https:'||url.username||url.password)throw new ProfileError('Enter the HTTPS application URL.');
    request.selected_job=Object.fromEntries(['id','title','company','description','application_url'].map(key=>[key,job[key].trim()]));
  }
  return request;
}
