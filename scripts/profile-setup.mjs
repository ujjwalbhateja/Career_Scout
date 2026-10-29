// Administrative setup only. Never imported by the Worker or sent to browsers.
import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url),envFile=fileURLToPath(new URL('.env.local',root));
try{process.loadEnvFile(envFile);}catch{}
const env=process.env,command=process.argv[2]||'check';
const report=data=>process.stdout.write(JSON.stringify(data)+'\n');
async function request(url,options={}){
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(45000),redirect:'error'});
  if(!response.ok)throw new Error('Provider request failed (HTTP '+response.status+'). No provider response or key is printed.');
  return response.status===204?null:response.json();
}
try{
  if(command==='check'){
    const present=Object.fromEntries(['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN','PINECONE_API_KEY','PINECONE_INDEX_HOST','GEMINI_API_KEY'].map(k=>[k,!!env[k]]));
    report({configured:present});
    if(env.PINECONE_API_KEY){const data=await request('https://api.pinecone.io/indexes',{headers:{'Api-Key':env.PINECONE_API_KEY,'X-Pinecone-Api-Version':'2025-10'}});report({pineconeKeyAccepted:true,indexCount:data.indexes?.length||0});}
    if(env.SUPABASE_URL&&(env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY)){
      const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,h={apikey:key,'Content-Type':'application/json',...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{})};
      const url=new URL(env.SUPABASE_URL);if(!url.hostname.endsWith('.supabase.co')||url.protocol!=='https:')throw new Error('Supabase URL is invalid.');
      await request(url.origin+'/rest/v1/',{headers:h});
      report({supabaseKeyAccepted:true});
      const probe=await fetch(url.origin+'/rest/v1/rpc/career_profile_health',{method:'POST',headers:h,body:'{}',signal:AbortSignal.timeout(20000),redirect:'error'});
      const response=await probe.json().catch(()=>({}));
      if(probe.ok)report({supabaseSchemaReachable:true,migrationRevision:response.migrationRevision,current:response.migrationRevision==='2026-10-29.2'});
      else if(response.code==='PGRST202')report({supabaseSchemaReachable:false,migrationRequired:true});
      else throw new Error('Profile schema probe failed (HTTP '+probe.status+').');
    }
  }else if(command==='migrate'){
    if(!env.SUPABASE_ACCESS_TOKEN||!env.SUPABASE_URL)throw new Error('Add a local Supabase access token and project URL, or run supabase/migrations/202610280001_profile_memory.sql in the SQL Editor.');
    const host=new URL(env.SUPABASE_URL).hostname,ref=host.split('.')[0];
    if(!/^[a-z0-9]{10,40}$/.test(ref)||!host.endsWith('.supabase.co'))throw new Error('Invalid Supabase project URL.');
    const query=readFileSync(new URL('supabase/migrations/202610280001_profile_memory.sql',root),'utf8');
    await request('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});
    report({migrationApplied:true,migration:'202610280001_profile_memory'});
  }else if(command==='pinecone-vectors'){
    if(!env.PINECONE_API_KEY)throw new Error('Add PINECONE_API_KEY to .env.local first.');
    const name='career-scout-profile-3large-v1',headers={'Api-Key':env.PINECONE_API_KEY,'X-Pinecone-Api-Version':'2025-10','Content-Type':'application/json'};
    const list=await request('https://api.pinecone.io/indexes',{headers});
    if(!list.indexes?.some(i=>i.name===name)){
      await request('https://api.pinecone.io/indexes',{method:'POST',headers,body:JSON.stringify({name,dimension:3072,metric:'cosine',spec:{serverless:{cloud:'aws',region:'us-east-1'}}})});
      report({indexCreated:true,name,dimension:3072});
    }
    let index;
    for(let attempt=0;attempt<30;attempt++){index=await request('https://api.pinecone.io/indexes/'+name,{headers});if(index.status?.ready)break;await new Promise(resolve=>setTimeout(resolve,2000));}
    if(!index?.status?.ready)throw new Error('Index is still initializing; run this command again shortly.');
    if(index.dimension!==3072||index.metric!=='cosine'||index.embed)throw new Error('Existing index has an incompatible embedding configuration; it was not modified.');
    const host='https://'+index.host;if(!new URL(host).hostname.endsWith('.pinecone.io'))throw new Error('Unexpected Pinecone host.');
    let current=readFileSync(envFile,'utf8');
    for(const [key,value] of [['PINECONE_INDEX_NAME',name],['PINECONE_INDEX_HOST',host]]){
      const pattern=new RegExp('^\\s*'+key+'\\s*=.*$','m');
      current=pattern.test(current)?current.replace(pattern,key+'='+value):current+'\n'+key+'='+value+'\n';
    }
    writeFileSync(envFile,current);
    report({indexReady:true,name,embeddingModel:'gemini-embedding-001',dimensions:3072,namespaceIsolation:'per-owner Gemini namespace; legacy vectors are not queried',localSettingsSaved:true});
  }else if(command==='pinecone'){
    if(!env.PINECONE_API_KEY)throw new Error('Add PINECONE_API_KEY to .env.local first.');
    const name=env.PINECONE_INDEX_NAME||'career-scout-profile-memory-v1';
    if(!/^[a-z0-9-]{1,45}$/.test(name))throw new Error('Invalid Pinecone index name.');
    const headers={'Api-Key':env.PINECONE_API_KEY,'X-Pinecone-Api-Version':'2025-10','Content-Type':'application/json'};
    const list=await request('https://api.pinecone.io/indexes',{headers});
    if(!list.indexes?.some(i=>i.name===name)){
      await request('https://api.pinecone.io/indexes/create-for-model',{method:'POST',headers,body:JSON.stringify({name,cloud:'aws',region:'us-east-1',embed:{model:'llama-text-embed-v2',field_map:{text:'chunk_text'}}})});
      report({indexCreated:true,name});
    }
    let index;
    for(let attempt=0;attempt<30;attempt++){index=await request('https://api.pinecone.io/indexes/'+name,{headers});if(index.status?.ready)break;await new Promise(resolve=>setTimeout(resolve,2000));}
    if(!index?.status?.ready)throw new Error('Index is still initializing. Run this command again shortly.');
    if(index.embed?.model!=='llama-text-embed-v2'||index.embed?.field_map?.text!=='chunk_text')throw new Error('Existing index has a different embedding configuration; it was not modified.');
    const host='https://'+index.host;if(!new URL(host).hostname.endsWith('.pinecone.io'))throw new Error('Unexpected Pinecone index host.');
    // Append only missing nonsecret settings. Existing credentials are untouched.
    let addition='';
    const current=readFileSync(envFile,'utf8');
    if(!/^\s*PINECONE_INDEX_NAME\s*=\s*\S+/m.test(current))addition+='\nPINECONE_INDEX_NAME='+name;
    if(!/^\s*PINECONE_INDEX_HOST\s*=\s*\S+/m.test(current))addition+='\nPINECONE_INDEX_HOST='+host;
    if(addition)appendFileSync(envFile,addition+'\n');
    report({indexReady:true,name,model:index.embed.model,localSettingsSaved:!!addition});
  }else throw new Error('Use check, migrate or pinecone-vectors.');
}catch(error){report({ok:false,error:error?.message||'Provider setup failed.'});process.exitCode=1;}
