import builder from '../../backend/src/career_scout/agents/profile_builder/prompt.md?raw';
import fact from '../../backend/src/career_scout/agents/fact/prompt.md?raw';
import scout from '../../backend/src/career_scout/agents/scout/prompt.md?raw';
import {getPipelineEnvironment} from '../pipeline-runtime';
import {pipelineCall} from '../workflow/pipeline-client.mjs';
import {ProfileError} from './domain.mjs';
const bundled={'profile-builder':builder,fact,scout};
export type AgentPolicy=keyof typeof bundled;
export async function loadAgentPrompt(agent:AgentPolicy):Promise<string>{
  const env=getPipelineEnvironment();
  if(!env.CAREER_AGENT_URL)return bundled[agent];
  const response=await pipelineCall(env,'prompt',{agent});
  const result=await response.json() as {agent?:string;prompt?:string};
  if(result.agent!==agent||typeof result.prompt!=='string'||!result.prompt.trim())throw new ProfileError('Restart Career Scout to load the current agent instructions.',503);
  return result.prompt;
}
