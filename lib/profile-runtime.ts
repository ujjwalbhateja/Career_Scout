import { AsyncLocalStorage } from 'node:async_hooks';
export type ProfileEnvironment = {
  SUPABASE_URL?: string; SUPABASE_SECRET_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string;
  PINECONE_API_KEY?: string; PINECONE_INDEX_HOST?: string; PINECONE_INDEX_NAME?: string;
  PROFILE_MODEL_URL?: string; PROFILE_MODEL_NAME?: string; PROFILE_MODEL_API_KEY?: string;
  OPENAI_API_KEY?: string;
  PROFILE_EMBEDDING_API_KEY?: string;
};
const profileEnvironment = new AsyncLocalStorage<ProfileEnvironment>();
const profileScheduler=new AsyncLocalStorage<((work:Promise<unknown>)=>void)|undefined>();
export function runWithProfileEnvironment<T>(env: ProfileEnvironment, callback:()=>T, schedule?:(work:Promise<unknown>)=>void):T {
  return profileScheduler.run(schedule,()=>profileEnvironment.run(Object.fromEntries(Object.entries(env).filter(([key])=>
    ['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','PINECONE_API_KEY','PINECONE_INDEX_HOST','PINECONE_INDEX_NAME','PROFILE_MODEL_URL','PROFILE_MODEL_NAME','PROFILE_MODEL_API_KEY','OPENAI_API_KEY','PROFILE_EMBEDDING_API_KEY'].includes(key))),callback));
}
export function getProfileEnvironment():ProfileEnvironment { return profileEnvironment.getStore()||{}; }
export function scheduleProfileWork(work:()=>Promise<unknown>):void {
  const schedule=profileScheduler.getStore();if(schedule)schedule(work().catch(()=>undefined));
}
