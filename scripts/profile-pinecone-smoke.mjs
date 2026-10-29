// Synthetic vectors only: verifies index transport, not embedding/model quality.
import {ProfileMemory} from '../lib/profile/providers.mjs';
try{process.loadEnvFile(new URL('../.env.local',import.meta.url));}catch{}
const memory=new ProfileMemory(process.env,'synthetic-test-'+crypto.randomUUID()),namespace=await memory.namespace();
const vector=Array(3072).fill(1/Math.sqrt(3072));let cleanup=false;
try{
  await memory.pinecone('/vectors/upsert',{namespace,vectors:[{id:'fixture-only',values:vector,metadata:{record_type:'transport_fixture'}}]});
  let found=false;
  for(let i=0;i<8;i++){const result=await memory.pinecone('/query',{namespace,vector,topK:1,includeValues:false});if(result.matches?.[0]?.id==='fixture-only'){found=true;break;}await new Promise(resolve=>setTimeout(resolve,1000));}
  if(!found)throw new Error('Synthetic vector not yet queryable.');
  console.log(JSON.stringify({vectorTransportPassed:true,dimensions:3072,personalDocumentsUploaded:0,embeddingAPICalls:0}));
}catch(error){console.log(JSON.stringify({vectorTransportPassed:false,error:error?.message||'Transport test failed'}));process.exitCode=1;}
finally{
  try{await memory.pinecone('/vectors/delete',{namespace,deleteAll:true});cleanup=true;}catch{process.exitCode=1;}
  console.log(JSON.stringify({syntheticNamespaceCleanupRequested:cleanup}));
}
