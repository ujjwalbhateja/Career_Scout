// Fixed stdin/stdout protocol, invoked only by the Python server. No shell tools.
import {runProvider} from '../lib/workflow/agent-providers.mjs';
import {ProfileError} from '../lib/profile/domain.mjs';
import {SearchError} from '../lib/keenable.mjs';
try{
  let input='',size=0;
  for await(const part of process.stdin){size+=part.length;if(size>400000)throw new Error('size');input+=part;}
  const message=JSON.parse(input);
  const result=await runProvider(message,process.env);
  process.stdout.write(JSON.stringify({result}));
}catch(error){
  process.stdout.write(JSON.stringify({error:error instanceof ProfileError||error instanceof SearchError?error.message:'The provider adapter failed. Check local server configuration.'}));
  process.exitCode=1;
}
