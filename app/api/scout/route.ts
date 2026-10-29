import { importLink, normalize, safeURL } from '@/lib/scout.mjs';
import { searchKeenable, searchCriteria, SearchError, SEARCH_LIMITS, SEARCH_VERSION } from '@/lib/keenable.mjs';
import { getSearchKey } from '@/lib/search-runtime';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getProfileEnvironment} from '@/lib/profile-runtime';
import {ProfileService} from '@/lib/profile/service.mjs';
import {ProfileError} from '@/lib/profile/domain.mjs';
import {dispatchProfileScout} from '@/lib/workflow/scout-handoff.mjs';

export const dynamic = 'force-dynamic';
const responseHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
const active=new Map<string,{started:number;count:number;running:number}>();
function reserve(scope:string){
  const time=Date.now();
  for(const [key,value] of active)if(time-value.started>60000&&!value.running)active.delete(key);
  const state=active.get(scope)||{started:time,count:0,running:0};
  if(time-state.started>60000){state.started=time;state.count=0;}
  if(state.running>=2||state.count>=6)throw new SearchError('Please wait before starting another search. Two searches can run at once; six batches per minute per server instance.',429);
  state.count++;state.running++;active.set(scope,state);
  return ()=>{state.running=Math.max(0,state.running-1);};
}
async function readBody(request:Request){
  const limit=150000;
  if(Number(request.headers.get('content-length'))>limit)throw new SearchError('Request is too large.',413);
  const reader=request.body?.getReader();if(!reader)throw new SearchError('Request body is required.',400);
  let raw='',bytes=0;const decoder=new TextDecoder();
  try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>limit)throw new SearchError('Request is too large.',413);raw+=decoder.decode(chunk.value,{stream:true});}raw+=decoder.decode();}
  catch(e){await reader.cancel().catch(()=>{});throw e;}
  let data;try{data=JSON.parse(raw);}catch{throw new SearchError('Request must contain valid JSON.',400);}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new SearchError('Request must be an object.',400);
  return data;
}
export async function GET(){
  return Response.json({provider:'Keenable',configured:!!getSearchKey(),limits:SEARCH_LIMITS,version:SEARCH_VERSION},{headers:responseHeaders});
}
export async function POST(request:Request){
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:responseHeaders});
  const origin=request.headers.get('origin');
  if(!origin||origin!==new URL(request.url).origin)return reply({error:'Use the Scout form on this site.'},403);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reply({error:'Use a JSON request.'},415);
  try{
    const body=await readBody(request);
    if(body.action==='profilePlan'||(body.action==='search'&&body.profileSelection)){
      const user=await getChatGPTUser();if(!user)throw new ProfileError('Sign in to use your private approved profile.',401);
      const handoff=await dispatchProfileScout(new ProfileService(getProfileEnvironment(),user.userId),body.profileSelection,body,async (plan:{criteria:Record<string,unknown>})=>body.action==='profilePlan'?plan:searchResponse(request,plan.criteria));
      if(body.action==='profilePlan')return reply({...handoff.output,audit:handoff.audit});
      return handoff.output;
    }
    if(body.action==='search')return await searchResponse(request,body);
    if(body.action==='import'){
      const result=await importLink(String(body.url||'').slice(0,3000));
      const total=result.jobs.length;
      const jobs=result.jobs.slice(0,30).map((job:ReturnType<typeof normalize>)=>({...job,verification:{status:'unverified',checkedAt:null,evidence:'Imported job data. Current application availability has not been checked.'}}));
      return reply({...result,jobs,totalFound:total,message:total>30?`${total} roles found; the first 30 were imported.`:result.message});
    }
    if(body.action==='paste'){
      if(typeof body.description!=='string'||body.description.trim().length<80)return reply({error:'Paste at least 80 characters of the actual job description.'},400);
      if(typeof body.title!=='string'||!body.title.trim())return reply({error:'Enter the job title.'},400);
      const url=body.url?safeURL(body.url).href:'';
      return reply({jobs:[{...normalize({source:'Manual import',title:body.title,company:body.company,location:body.location,description:body.description,url,imported:true,provenance:'Description pasted by you; not independently verified'}),verification:{status:'unverified',checkedAt:null,evidence:'Pasted description; current availability is not verified.'}}],message:'Job imported from your pasted description.',links:[]});
    }
    return reply({error:'Unknown action.'},400);
  }catch(error){return reply({error:error instanceof SearchError||error instanceof ProfileError?error.message:error instanceof Error&&bodySafeError(error)?error.message:'Request could not be completed.'},error instanceof SearchError||error instanceof ProfileError?error.status:400);}
}
function bodySafeError(error:Error){return /^(Enter a complete|Only public|This page|Page returned|Use an HTML|Too many page|That role|Company board|Source returned|This page does not resolve)/.test(error.message);}

async function searchResponse(request:Request,body:Record<string,unknown>){
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:responseHeaders});
      searchCriteria(body);
      const key=getSearchKey();if(!key)return reply({error:'Keenable is not configured. Add the server API key before searching.'},503);
      // Hosted access is enforced by the owner-private Sites gate. No client-supplied provider key is accepted.
      const scope=request.headers.get('oai-authenticated-user-id')||'private-owner';
      const release=reserve(scope);
      const cancellation=new AbortController();
      const signal=AbortSignal.any([request.signal,cancellation.signal,AbortSignal.timeout(90000)]);
      if(body.stream===true){
        const encoder=new TextEncoder();let ended=false;
        const stream=new ReadableStream({
          start(controller){
            const send=(event:unknown)=>{if(!ended&&!signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
            void searchKeenable(body,{key,scope,signal,onEvent:send}).catch((e:unknown)=>{
              if(!ended)controller.enqueue(encoder.encode(JSON.stringify({type:'error',error:signal.aborted?'Search stopped. Results already received may be incomplete.':e instanceof SearchError?e.message:'Search could not be completed.'})+'\n'));
            }).finally(()=>{release();if(!ended){ended=true;controller.close();}});
          },
          cancel(){ended=true;cancellation.abort();}
        });
        return new Response(stream,{headers:{...responseHeaders,'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no'}});
      }
      try{return reply(await searchKeenable(body,{key,scope,signal}));}finally{release();}
    }
