import {AsyncLocalStorage} from 'node:async_hooks';
export type PipelineEnvironment={CAREER_AGENT_URL?:string;CAREER_AGENT_TOKEN?:string};
const environment=new AsyncLocalStorage<PipelineEnvironment>();
export function runWithPipelineEnvironment<T>(env:PipelineEnvironment,callback:()=>T):T{
  return environment.run({CAREER_AGENT_URL:env.CAREER_AGENT_URL,CAREER_AGENT_TOKEN:env.CAREER_AGENT_TOKEN},callback);
}
export function getPipelineEnvironment():PipelineEnvironment{return environment.getStore()||{};}
