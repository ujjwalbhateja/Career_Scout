// Local-only launcher. Token is ephemeral and inherited by the two server
// processes. No secret is written to disk or passed on a command line.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
try{process.loadEnvFile(new URL('../.env.local',import.meta.url));}catch(error){if(error.code!=='ENOENT')throw error;}
const python=process.env.CAREER_PYTHON||fileURLToPath(new URL(process.platform==='win32'?'../backend/.venv/Scripts/python.exe':'../backend/.venv/bin/python',import.meta.url));
if(!existsSync(python))throw new Error('Install the backend environment first: cd backend && uv sync --locked. See backend/README.md.');
const port=Number(process.env.CAREER_AGENT_PORT||8765);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use a valid local pipeline port.');
const env={...process.env,CAREER_NODE:process.execPath,PYTHONPATH:fileURLToPath(new URL('../backend/src',import.meta.url)),PYTHONUNBUFFERED:'1',CAREER_AGENT_URL:`http://127.0.0.1:${port}`,CAREER_AGENT_TOKEN:randomBytes(32).toString('hex'),CAREER_AGENT_PORT:String(port)};
const backend=spawn(python,['-m','career_scout.service'],{cwd:root,env,stdio:['ignore','inherit','inherit'],windowsHide:true});
let app,stopping=false;
function stop(code=0){if(stopping)return;stopping=true;app?.kill();backend.kill();process.exitCode=code;}
backend.on('error',()=>{console.error('Could not start the Python pipeline. Check backend/.venv.');stop(1);});
backend.on('exit',code=>{if(!stopping){console.error('Python pipeline stopped. Restart Start-Scout.cmd to recover saved runs.');stop(code||1);}});
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
try{
  let ready=false;
  for(let attempt=0;attempt<40;attempt++){
    if(stopping)break;
    try{const response=await fetch(env.CAREER_AGENT_URL+'/health',{method:'POST',headers:{Authorization:'Bearer '+env.CAREER_AGENT_TOKEN,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!ready)throw new Error('Python pipeline did not become ready.');
  console.log('Python pipeline ready. Private application history is in .local/pipeline/.');
  app=spawn(process.execPath,[fileURLToPath(new URL('./run-framework.mjs',import.meta.url)),'dev'],{cwd:root,env,stdio:'inherit',windowsHide:true});
  app.on('error',()=>{console.error('Could not start the web app.');stop(1);});
  app.on('exit',code=>stop(code||0));
}catch{console.error('Could not launch Career Scout. Check the backend environment and local ports.');stop(1);}
