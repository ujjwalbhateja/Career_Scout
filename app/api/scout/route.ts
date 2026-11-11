import { importLink, normalize, safeURL } from '@/lib/scout.mjs';
import { searchKeenable, searchCriteria, SearchError, SEARCH_LIMITS, SEARCH_VERSION } from '@/lib/keenable.mjs';
import { getSearchKey } from '@/lib/search-runtime';
import {profileAccess} from '@/lib/profile-access';
import {reserveVisitorUsage} from '@/lib/profile/visitor-access.mjs';
import {getProfileEnvironment} from '@/lib/profile-runtime';
import {ProfileService} from '@/lib/profile/service.mjs';
import {ProfileError} from '@/lib/profile/domain.mjs';
import {previewProfileScout,createScoutHandoffReceipt,persistScoutHandoff} from '@/lib/workflow/scout-handoff.mjs';
import {auditRoute} from '@/lib/workflow/policy.mjs';
import {searchApprovedProfileJobs} from '@/lib/workflow/scout-policy.mjs';
import {prioritizeScoutContext} from '@/lib/workflow/scout-agent.mjs';
import {loadAgentPrompt} from '@/lib/profile/agent-prompts';

export const dynamic = 'force-dynamic';
const responseHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie, Origin'};
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
    const access=await profileAccess(request);
    if('owner' in body||'owner_id' in body||'namespace' in body)throw new ProfileError('Ownership is determined by your browser session or signed-in account.',403);
    if(body.action==='profilePlan'||(body.action==='search'&&body.profileSelection)){
      const profile=new ProfileService(getProfileEnvironment(),access.owner);
      // Preview always loads today's stored profile, including when an old
      // bookmarked URL names a retired Final Profile. Execution pins that result.
      const preview=await previewProfileScout(profile,body.action==='profilePlan'?{version:'current'}:body.profileSelection,body);
      if(body.action==='profilePlan'){
        const {previousSeen:_history,...publicPlan}=preview.plan;
        return reply({...publicPlan,handoff:preview.handoff,audit:preview.audit});
      }
      return await searchResponse(request,preview.plan.criteria,access.owner,{plan:preview.plan,audit:preview.audit,profile,version:preview.plan.selection.version});
    }
    if(body.action==='search')return await searchResponse(request,body,access.owner);
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

async function searchResponse(request:Request,body:Record<string,unknown>,scope:string,trusted?:{plan:Record<string,any>;audit:any[];profile:InstanceType<typeof ProfileService>;version:string}){
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:responseHeaders});
      if(!trusted)searchCriteria(body);
      const key=getSearchKey();if(!key)return reply({error:'Keenable is not configured. Add the server API key before searching.'},503);
      // Identity is resolved server-side for both public sessions and sign-in.
      await reserveVisitorUsage(getProfileEnvironment(),scope,'search');
      const release=reserve(scope);
      const cancellation=new AbortController();
      const signal=AbortSignal.any([request.signal,cancellation.signal,AbortSignal.timeout(90000)]);
      const execute=async(onEvent:(event:unknown)=>void=()=>{})=>{
        if(!trusted)return searchKeenable(body,{key,scope,signal,onEvent});
        onEvent({type:'progress',message:'Master loaded the saved profile. Scout is selecting approved professional search terms.'});
        const selected=await prioritizeScoutContext(trusted.plan.scoutContext,await loadAgentPrompt('scout'),trusted.profile.env);
        signal.throwIfAborted();
        const dispatchAudit=[...trusted.audit,auditRoute('master','scout','validated-profile-search-request')];
        const dispatched=await createScoutHandoffReceipt(trusted.plan,dispatchAudit,{stage:'dispatched',context:selected.context,policy:selected.policy});
        const storedDispatch=await persistScoutHandoff(trusted.profile,dispatched);
        onEvent({type:'handoff',handoff:storedDispatch});
        try{
          const result=await searchApprovedProfileJobs({criteria:body,context:selected.context,previousSeen:trusted.plan.previousSeen},{key,scope,signal,onEvent:(event:{type:string})=>{if(event.type==='progress')onEvent(event);}});
          Object.assign(result.scoutPolicy,selected.policy);
          try{await trusted.profile.saveScoutHistory(trusted.version,result.seen);Object.assign(result.scoutPolicy,{historySaved:true});}
          catch{Object.assign(result.scoutPolicy,{historySaved:false});result.reports.push({name:'Recommendation history',status:'warning',error:'History could not be saved. Unchanged vacancies may appear again.'});}
          const completed=await createScoutHandoffReceipt(trusted.plan,[...dispatchAudit,auditRoute('scout','master','search-output')],{id:dispatched.id,stage:'completed',context:selected.context,policy:selected.policy,result});
          let completionSaved=false,completedAt:string|null=null;
          try{const stored=await persistScoutHandoff(trusted.profile,completed);completionSaved=stored.persistence.saved;completedAt=stored.persistence.savedAt;}
          catch{result.reports.push({name:'Scout handoff receipt',status:'warning',error:'Search finished, but its completion receipt could not be saved. The dispatched receipt remains available.'});}
          Object.assign(result,{handoff:{...completed,persistence:{saved:completionSaved,savedAt:completedAt}},handoffAudit:completed.audit});
          onEvent({type:'complete',result});return result;
        }catch(error){
          try{const failed=await createScoutHandoffReceipt(trusted.plan,[...dispatchAudit,auditRoute('scout','master','search-failed')],{id:dispatched.id,stage:'failed',context:selected.context,policy:selected.policy});onEvent({type:'handoff',handoff:await persistScoutHandoff(trusted.profile,failed)});}catch{}
          throw error;
        }
      };
      if(body.stream===true){
        const encoder=new TextEncoder();let ended=false;
        const stream=new ReadableStream({
          start(controller){
            const send=(event:unknown)=>{if(!ended&&!signal.aborted)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
            void execute(send).catch((e:unknown)=>{
              if(!ended)controller.enqueue(encoder.encode(JSON.stringify({type:'error',error:signal.aborted?'Search stopped. Results already received may be incomplete.':e instanceof SearchError||e instanceof ProfileError?e.message:'Search could not be completed.'})+'\n'));
            }).finally(()=>{release();if(!ended){ended=true;controller.close();}});
          },
          cancel(){ended=true;cancellation.abort();}
        });
        return new Response(stream,{headers:{...responseHeaders,'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no'}});
      }
      try{return reply(await execute());}finally{release();}
    }
