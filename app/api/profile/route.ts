import {profileAccess,accessHeaders,type ProfileAccess} from '@/lib/profile-access';
import { getProfileEnvironment, scheduleProfileWork } from '@/lib/profile-runtime';
import { ProfileService } from '@/lib/profile/service.mjs';
import { ProfileError, LIMITS } from '@/lib/profile/domain.mjs';
import { providerStatus } from '@/lib/profile/providers.mjs';
import {dispatchProfileOperation} from '@/lib/workflow/profile-intake.mjs';
import {loadAgentPrompt} from '@/lib/profile/agent-prompts';
import {reserveVisitorUsage} from '@/lib/profile/visitor-access.mjs';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie, Origin'};
function errorResponse(error:unknown,access?:ProfileAccess){
  return Response.json({error:error instanceof ProfileError?error.message:'Profile operation failed. Your saved approvals have not been replaced.'},{status:error instanceof ProfileError?error.status:500,headers:accessHeaders(headers,access)});
}
function service(access:ProfileAccess){
  return new ProfileService(getProfileEnvironment(),access.owner,{builderPrompt:()=>loadAgentPrompt('profile-builder'),factPrompt:()=>loadAgentPrompt('fact')});
}
export async function GET(request:Request){
  let access:ProfileAccess|undefined;
  try{
    access=await profileAccess(request,{create:!new URL(request.url).searchParams.has('download')});
    const profile=service(access),env=getProfileEnvironment(),replyHeaders=accessHeaders(headers,access);
    if(new URL(request.url).searchParams.has('status'))return Response.json({providers:providerStatus(env)},{headers:replyHeaders});
    const download=new URL(request.url).searchParams.get('download');
    if(download){
      const {state}=await profile.memory.load(),doc=state.documents.find((d:{id:string;deleted?:boolean;objectPath?:string})=>d.id===download&&!d.deleted);
      if(!doc?.objectPath||state.deletion)throw new ProfileError('Document not found.',404);
      const original=await profile.memory.download(doc.objectPath);
      const filename=String(doc.filename||'document').replace(/[^\w.\- ]/g,'_');
      return new Response(original.body,{headers:{...replyHeaders,'Content-Type':doc.mime||'application/octet-stream','Content-Disposition':'attachment; filename="'+filename+'"'}});
    }
    return Response.json(await profile.read(),{headers:replyHeaders});
  }catch(error){return errorResponse(error,access);}
}
export async function POST(request:Request){
  let access:ProfileAccess|undefined;
  try{
    const origin=request.headers.get('origin');
    if(!origin||origin!==new URL(request.url).origin)throw new ProfileError('Use the Profile form on this site.',403);
    access=await profileAccess(request);
    const profile=service(access),contentType=request.headers.get('content-type')||'';
    const maximum=contentType.startsWith('multipart/form-data')?LIMITS.fileBytes+20000:1200000;
    if(Number(request.headers.get('content-length'))>maximum)throw new ProfileError('Profile request is too large.',413);
    const reader=request.body?.getReader();if(!reader)throw new ProfileError('Request body is required.');
    const parts:Uint8Array[]=[];let size=0;
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum){await reader.cancel();throw new ProfileError('Profile request is too large.',413);}parts.push(part.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
    let result,allowBackground=true;
    if(contentType.startsWith('multipart/form-data')){
      const form=await new Response(bytes,{headers:{'Content-Type':contentType}}).formData();
      const file=form.get('file');
      if(!file||typeof file==='string')throw new ProfileError('Choose a document.');
      await reserveVisitorUsage(getProfileEnvironment(),profile.owner,'upload',{units:Math.max(1,file.size)});
      result=await dispatchProfileOperation(profile,{file,body:{kind:form.get('kind'),title:form.get('title'),selected:form.get('selected')==='true',revision:form.get('revision')}});
    }else if(contentType.startsWith('application/json')){
      let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ProfileError('Use valid JSON.');}
      if(!body||Array.isArray(body)||typeof body!=='object')throw new ProfileError('Invalid request.');
      if('owner_id' in body||'owner' in body||'namespace' in body)throw new ProfileError('Ownership is determined by your browser session or signed-in account.',403);
      if(body.action==='paste'||body.action==='importJD')await reserveVisitorUsage(getProfileEnvironment(),profile.owner,'upload',{units:body.action==='importJD'?LIMITS.fileBytes:Math.max(1,new TextEncoder().encode(String(body.text||'')).length)});
      allowBackground=!['answer','analyzeAnswer','reviewExperience','reviewBuilder','extractSection1'].includes(body.action);
      result=await dispatchProfileOperation(profile,{body});
    }else throw new ProfileError('Use JSON or a document upload.',415);
    if(allowBackground&&result.result?.kind!=='final_profile_needs_review'&&result.state?.outbox.some((event:{kind:string;status:string})=>event.kind==='reindex'&&event.status==='pending'))scheduleProfileWork(()=>profile.drainBackground());
    return Response.json(result,{headers:accessHeaders(headers,access)});
  }catch(error){return errorResponse(error,access);}
}
