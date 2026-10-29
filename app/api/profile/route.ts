import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getProfileEnvironment, scheduleProfileWork } from '@/lib/profile-runtime';
import { ProfileService } from '@/lib/profile/service.mjs';
import { ProfileError, LIMITS } from '@/lib/profile/domain.mjs';
import { providerStatus } from '@/lib/profile/providers.mjs';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie, Origin'};
function errorResponse(error:unknown){
  return Response.json({error:error instanceof ProfileError?error.message:'Profile operation failed. Your saved approvals have not been replaced.'},{status:error instanceof ProfileError?error.status:500,headers});
}
async function service(){
  const user=await getChatGPTUser();if(!user)throw new ProfileError('Sign in to access your private profile.',401);
  return new ProfileService(getProfileEnvironment(),user.userId);
}
export async function GET(request:Request){
  try{
    const profile=await service(),env=getProfileEnvironment();
    if(new URL(request.url).searchParams.has('status'))return Response.json({providers:providerStatus(env)},{headers});
    const download=new URL(request.url).searchParams.get('download');
    if(download){
      const {state}=await profile.memory.load(),doc=state.documents.find((d:{id:string;deleted?:boolean;objectPath?:string})=>d.id===download&&!d.deleted);
      if(!doc?.objectPath||state.deletion)throw new ProfileError('Document not found.',404);
      const original=await profile.memory.download(doc.objectPath);
      const filename=String(doc.filename||'document').replace(/[^\w.\- ]/g,'_');
      return new Response(original.body,{headers:{...headers,'Content-Type':doc.mime||'application/octet-stream','Content-Disposition':'attachment; filename="'+filename+'"'}});
    }
    return Response.json(await profile.read(),{headers});
  }catch(error){return errorResponse(error);}
}
export async function POST(request:Request){
  try{
    const origin=request.headers.get('origin');
    if(!origin||origin!==new URL(request.url).origin)throw new ProfileError('Use the Profile form on this site.',403);
    const profile=await service(),contentType=request.headers.get('content-type')||'';
    const maximum=contentType.startsWith('multipart/form-data')?LIMITS.fileBytes+20000:180000;
    if(Number(request.headers.get('content-length'))>maximum)throw new ProfileError('Profile request is too large.',413);
    const reader=request.body?.getReader();if(!reader)throw new ProfileError('Request body is required.');
    const parts:Uint8Array[]=[];let size=0;
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximum){await reader.cancel();throw new ProfileError('Profile request is too large.',413);}parts.push(part.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
    let result;
    if(contentType.startsWith('multipart/form-data')){
      const form=await new Response(bytes,{headers:{'Content-Type':contentType}}).formData();
      const file=form.get('file');
      if(!file||typeof file==='string')throw new ProfileError('Choose a document.');
      result=await profile.upload(file,{kind:form.get('kind'),title:form.get('title'),selected:form.get('selected')==='true',revision:form.get('revision')});
    }else if(contentType.startsWith('application/json')){
      let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ProfileError('Use valid JSON.');}
      if(!body||Array.isArray(body)||typeof body!=='object')throw new ProfileError('Invalid request.');
      if('owner_id' in body||'owner' in body||'namespace' in body)throw new ProfileError('Ownership is determined by your signed-in account.',403);
      result=await profile.action(body);
    }else throw new ProfileError('Use JSON or a document upload.',415);
    if(result.state?.outbox.some((event:{kind:string;status:string})=>event.kind==='reindex'&&event.status==='pending'))scheduleProfileWork(()=>profile.drainBackground());
    return Response.json(result,{headers});
  }catch(error){return errorResponse(error);}
}
