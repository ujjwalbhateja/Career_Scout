// Explicit bounded live verification: synthetic resume/profile/job only.
// Six base Gemini requests, at most two critique/revision cycles. No Keenable
// credits or real user profile are used. Synthetic Supabase records are purged.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFileSync,mkdirSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {ProfileService} from '../lib/profile/service.mjs';
import {ProfileError} from '../lib/profile/domain.mjs';
if(!process.argv.includes('--live'))throw new Error('Pass --live to authorize the bounded synthetic provider check.');
try{process.loadEnvFile(new URL('../.env.local',import.meta.url));}catch{}
const root=fileURLToPath(new URL('../',import.meta.url));
const owner='pipeline-smoke-'+randomUUID(),runId=randomUUID(),token=randomBytes(32).toString('hex');
const service=new ProfileService(process.env,owner);
const report={checkedAt:new Date().toISOString(),syntheticOnly:true,syntheticOwner:owner,provider:'gemini',openAICalls:0,keenableCalls:0,ok:false};
let backend;
const post=async(path,body={})=>{
  const response=await fetch('http://127.0.0.1:8766/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Pipeline HTTP '+response.status);
  return path==='download'?new Uint8Array(await response.arrayBuffer()):response.json();
};
try{
  let record=await service.memory.load();
  record=await service.action({action:'paste',revision:record.revision,kind:'resume',title:'Synthetic pipeline check',text:'Taylor Example\nReporting Analyst at Example Employer, January 2020 to December 2022.\nPrepared monthly portfolio reports for institutional clients.\nUsed Excel to compile monthly portfolio reporting tables.\nSkills: Excel, portfolio reporting, client reporting.'});
  record=await service.action({action:'prepare',revision:record.revision});
  report.factProposals=record.state.facts.length;
  if(!record.state.facts.length)throw new Error('No synthetic fact proposals.');
  // Explicit fixture-only decisions; never target a real account/profile.
  record=await service.action({action:'decideFacts',revision:record.revision,decisions:record.state.facts.map(f=>({id:f.id,version:f.version,decision:'approved'}))});
  record=await service.action({action:'finalize',revision:record.revision});
  report.profileVersion=record.state.snapshots.at(-1).version;
  const python=fileURLToPath(new URL(process.platform==='win32'?'../backend/.venv/Scripts/python.exe':'../backend/.venv/bin/python',import.meta.url));
  backend=spawn(python,['-m','career_scout.service'],{cwd:root,env:{...process.env,CAREER_AGENT_TOKEN:token,CAREER_AGENT_PORT:'8766',CAREER_AGENT_STORE:fileURLToPath(new URL('../.local/pipeline-smoke/'+owner+'.sqlite3',import.meta.url)),CAREER_NODE:process.execPath,PYTHONPATH:fileURLToPath(new URL('../backend/src',import.meta.url))},stdio:['ignore','ignore','ignore'],windowsHide:true});
  backend.on('error',()=>{});
  let ready=false;
  for(let i=0;i<40;i++){try{await post('health');ready=true;break;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
  if(!ready)throw new Error('Synthetic Python service did not start.');
  let result=await post('start',{owner,request_id:runId,package_date:'2026-10-30',request:{intent:'prepare_application',saved_profile_version:report.profileVersion,selected_role_id:'master-profile',selected_job:{id:'synthetic-reporting-job',title:'Reporting Analyst',company:'Synthetic Employer',description:'Synthetic evaluation vacancy only. The Reporting Analyst prepares monthly portfolio reports for institutional clients and compiles reporting tables using Excel. Required experience: monthly client reporting and Excel. No additional degree, certification, coding, management or tenure requirement is specified.',application_url:'https://example.com/synthetic-evaluation-only'}}});
  const deadline=Date.now()+570000;
  while(['queued','running'].includes(result.status)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1500));result=await post('get',{owner,request_id:runId});}
  report.runStatus=result.status;report.outcome=result.result?.status;report.toolCalls=result.result?.tool_calls;report.revisions=result.result?.revisions;
  if(report.outcome!=='ready_to_apply'){report.failure=result.result?.error?.message||result.result?.feedback||result.result?.assessment?.reasons||'No completed package';throw new Error('Live application preparation did not pass.');}
  const archive=await post('download',{owner,request_id:runId});
  report.zipBytes=archive.length;report.zipSignature=archive[0]===80&&archive[1]===75;
  report.independentChecksPassed=result.result.review.profile_facts.passed&&result.result.review.job_alignment.passed;
  report.storageReceiptConfirmed=result.result.receipt.stored===true;
  report.routeAudit=result.result.audit;
  report.ok=report.zipSignature&&report.independentChecksPassed&&report.storageReceiptConfirmed;
}catch(error){report.error=error instanceof ProfileError?error.message:error.message.startsWith('Pipeline HTTP')?error.message:'Synthetic live pipeline check did not complete. See the redacted failure field.';process.exitCode=1;}
finally{
  if(backend)backend.kill();
  try{let record=await service.memory.load();if(record.revision){record.state.deletion={status:'pending',requestedAt:new Date().toISOString()};record=await service.memory.save(record.revision,record.state);await service.memory.purge(record.state,record.revision);}report.syntheticProfilePurged=true;}catch(error){report.syntheticProfilePurged=false;report.cleanupError=error instanceof ProfileError?error.message:'Synthetic cleanup failed.';process.exitCode=1;}
  mkdirSync(new URL('../.local/',import.meta.url),{recursive:true});
  writeFileSync(new URL('../.local/pipeline-smoke-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}
