// One bounded discovery batch, no resume or profile data, no model calls.
import {runProvider} from '../lib/workflow/agent-providers.mjs';
import {ProfileError,emptyProfile,addDocument,proposeFacts,decideFacts} from '../lib/profile/domain.mjs';
import {buildValidatedSearchProfile} from '../lib/profile/search-profile.mjs';
import {SearchError} from '../lib/keenable.mjs';
import {writeFileSync} from 'node:fs';
if(!process.argv.includes('--live'))throw new Error('Pass --live to run one bounded Keenable batch.');
try{process.loadEnvFile(new URL('../.env.local',import.meta.url));}catch{}
const report={checkedAt:new Date().toISOString(),syntheticCriteriaOnly:true,modelCalls:0,maxSearchRequests:6,maxPageChecks:10};
try{
  const state=emptyProfile(),sources=[['employment','job_title','Reporting Analyst'],['experience_claims','responsibilities','client reporting'],['skills','tools_technologies','Excel'],['employment','industry','financial services']];
  addDocument(state,{id:'synthetic-resume',kind:'resume',title:'Synthetic source fixture',hash:'synthetic-only',segments:sources.map(([, ,text],i)=>({id:'source-'+i,text}))});
  await proposeFacts(state,sources.map(([category,field,statement],i)=>({category,field,scope:'Synthetic fixture',statement,evidence:[{documentId:'synthetic-resume',segmentId:'source-'+i,quote:statement}]})));
  decideFacts(state,state.facts.map(f=>({id:f.id,version:f.version,decision:'approved'})),'synthetic-pipeline-discovery');
  const profile=buildValidatedSearchProfile(state);
  const result=await runProvider({name:'search_jobs',owner:'synthetic-pipeline-discovery',prompt:'',payload:{role_name:'',keywords:[],scout_context:profile.context,preferences:{location:'United States',arrangement:'any',employment:'any',seniority:'any',prefer_sponsorship:false}}},process.env);
  report.jobs=result.jobs.length;report.validPackets=result.jobs.every(j=>j.id&&j.title&&j.company&&j.description.length>=80&&j.application_url.startsWith('https://'));report.ok=report.validPackets;
}catch(error){report.ok=false;report.error=error instanceof ProfileError||error instanceof SearchError?error.message:'Bounded discovery check failed.';process.exitCode=1;}
writeFileSync(new URL('../.local/pipeline-scout-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
