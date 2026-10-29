import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
const base=new URL('../',import.meta.url),root=fileURLToPath(base);
const source=[
  "import {ProfileMemory,embedTexts,analyzeWithModel} from './lib/profile/providers.mjs';",
  "export default {async fetch(request){",
  "const path=new URL(request.url).pathname;",
  "const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'fixture-only',PINECONE_API_KEY:'fixture-only',PINECONE_INDEX_HOST:'https://fixture.pinecone.io',OPENAI_API_KEY:'fixture-only'};",
  "const memory=new ProfileMemory(env,'synthetic-worker-owner');",
  "if(path==='/redirect'){memory.env.SUPABASE_URL='https://redirect-fixture.supabase.co';try{await memory.load();return Response.json({blocked:false});}catch(error){return Response.json({blocked:true,status:error.status,message:error.message});}}",
  "let unsupportedRejected=false;try{new Request('https://fixture.invalid/',{redirect:'error'});}catch{unsupportedRejected=true;}",
  "const profile=await memory.load(),health=await memory.connectionHealth();",
  "const original=await memory.download((await memory.namespace())+'/synthetic/original');",
  "const vectors=await embedTexts(env,['Synthetic reporting experience.']);",
  "const pinecone=await memory.pinecone('/query',{namespace:await memory.namespace(),vector:vectors[0],topK:1});",
  "const analysis=await analyzeWithModel(env,'facts',{documentId:'synthetic',segments:[]});",
  "return Response.json({revision:profile.revision,migration:health.migrationRevision,original:await original.text(),dimensions:vectors[0].length,matches:pinecone.matches.length,facts:analysis.facts.length,unsupportedRejected});",
  "}};"
].join('\n');
function worker(requests){
  return new Miniflare({rootPath:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],modules:[
    {type:'ESModule',path:root+'profile-worker-test.mjs',contents:source},
    {type:'ESModule',path:fileURLToPath(new URL('lib/profile/providers.mjs',base))},
    {type:'ESModule',path:fileURLToPath(new URL('lib/profile/domain.mjs',base))}
  ],outboundService:async request=>{
    const url=new URL(request.url);requests.push({host:url.hostname,path:url.pathname});
    if(url.hostname==='redirect-fixture.supabase.co')return new Response('',{status:307,headers:{Location:'https://unexpected.invalid/credential-target'}});
    if(url.pathname.endsWith('/career_profile_load'))return Response.json(null);
    if(url.pathname.endsWith('/career_profile_health')){
      assert.deepEqual(await request.json(),{});return Response.json({migrationRevision:'2026-10-29.2'});
    }
    if(url.pathname.includes('/storage/'))return new Response('synthetic original');
    if(url.pathname==='/v1/embeddings'){const body=await request.json();assert.equal(body.model,'text-embedding-3-large');return Response.json({data:[{index:0,embedding:Array(3072).fill(.01)}]});}
    if(url.pathname==='/v1/chat/completions'){const body=await request.json();assert.equal(body.model,'gpt-6.1-sol');return Response.json({choices:[{finish_reason:'stop',message:{content:'{"facts":[]}'}}]});}
    if(url.hostname==='fixture.pinecone.io')return Response.json({matches:[]});
    return new Response('Unexpected fixture request',{status:500});
  }});
}
test('actual Workers runtime can call profile RPCs, private storage, embedding and model adapters',async t=>{
  const requests=[],mf=worker(requests);t.after(()=>mf.dispose());
  const response=await mf.dispatchFetch('http://localhost/');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{revision:0,migration:'2026-10-29.2',original:'synthetic original',dimensions:3072,matches:0,facts:0,unsupportedRejected:true});
  assert.equal(requests.length,6);
});
test('Workers runtime blocks provider redirects without forwarding credentials to another host',async t=>{
  const requests=[],mf=worker(requests);t.after(()=>mf.dispose());
  const response=await mf.dispatchFetch('http://localhost/redirect'),result=await response.json();
  assert.equal(result.blocked,true);assert.equal(result.status,502);
  assert.deepEqual(requests.map(r=>r.host),['redirect-fixture.supabase.co']);
  assert.ok(!result.message.includes('unexpected.invalid'));
});
