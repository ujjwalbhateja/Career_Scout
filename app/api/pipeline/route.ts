import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getPipelineEnvironment} from '@/lib/pipeline-runtime';
import {ProfileError} from '@/lib/profile/domain.mjs';
import {applicationRequest,pipelineCall} from '@/lib/workflow/pipeline-client.mjs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie, Origin'};
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
const failure=(error:unknown)=>reply({error:error instanceof ProfileError?error.message:'Application operation failed.'},error instanceof ProfileError?error.status:500);
async function owner(){const user=await getChatGPTUser();if(!user)throw new ProfileError('Sign in to use your application packages.',401);return user.userId;}
export async function GET(request:Request){
  try{
    const user=await owner(),params=new URL(request.url).searchParams,env=getPipelineEnvironment();
    const action=params.has('health')?'health':params.has('download')?'download':params.has('id')?'get':'list';
    const response=await pipelineCall(env,action,{owner:user,request_id:params.get('id')||params.get('download')||''});
    if(action==='download')return new Response(response.body,{headers:{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="career-scout-application.zip"'}});
    return reply(await response.json());
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  try{
    if(request.headers.get('origin')!==new URL(request.url).origin)throw new ProfileError('Use the Applications form on this site.',403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ProfileError('Use a JSON request.',415);
    const user=await owner();
    const reader=request.body?.getReader();if(!reader)throw new ProfileError('A request body is required.');
    let size=0,text='';const decoder=new TextDecoder();
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>180000){await reader.cancel();throw new ProfileError('Application request is too large.',413);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();
    let body;try{body=JSON.parse(text);}catch{throw new ProfileError('Use valid JSON.');}
    if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(key=>!['action','id','profileSelection','job'].includes(key)))throw new ProfileError('Invalid application request. Ownership and tools are server-controlled.',403);
    if(!['start','retry','cancel','delete'].includes(body.action))throw new ProfileError('Unknown application action.');
    if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id))throw new ProfileError('A valid run ID is required.');
    const payload:Record<string,unknown>={owner:user,request_id:body.id};
    if(body.action==='start'){
      payload.request=applicationRequest(body);
      payload.package_date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    }
    const response=await pipelineCall(getPipelineEnvironment(),body.action,payload);
    return reply(await response.json(),body.action==='start'?202:200);
  }catch(error){return failure(error);}
}
