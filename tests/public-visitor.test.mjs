import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {resolveVisitor,reserveVisitorUsage,VISITOR_LIMITS} from '../lib/profile/visitor-access.mjs';
import * as domain from '../lib/profile/domain.mjs';
import * as providers from '../lib/profile/providers.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
import {dispatchProfileOperation} from '../lib/workflow/profile-intake.mjs';
import {DEMO_RESUME} from '../lib/profile/demo-samples.mjs';
import {Miniflare} from 'miniflare';
import {fileURLToPath} from 'node:url';

const origin='https://public.example.test';
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const migrations=readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql'));
  assert.ok(migrations.length,'the checked-in migration must create the session schema');
  for(const file of migrations)db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const DB={prepare(sql){return {bind(...args){
    const statement=db.prepare(sql);
    return {async first(){return statement.get(...args)||null;},async run(){return statement.run(...args);}};
  }};}};
  return {db,env:{PUBLIC_DEMO_ENABLED:'true',DB,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'synthetic-test-only'}};
}
const request=(cookie='',path='/api/profile',options={})=>new Request(origin+path,{...options,headers:{...(cookie?{Cookie:cookie}:{}),...options.headers}});
const cookieOf=access=>access.setCookie.split(';')[0];
function moduleFrom(file,imports){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',output)(name=>{if(!(name in imports))throw Error('Unexpected import '+name);return imports[name];},module,module.exports);
  return module.exports;
}

test('independent browser cookies retain separate server-created owners and keep raw handles out of storage',async t=>{
  const {env,db}=fixture(t),a=await resolveVisitor(request(),env,{create:true}),b=await resolveVisitor(request(),env,{create:true});
  assert.notEqual(a.owner,b.owner);assert.notEqual(a.setCookie,b.setCookie);
  assert.match(a.setCookie,/^__Host-career_scout_visitor=/);assert.match(a.setCookie,/HttpOnly; SameSite=Lax; Max-Age=31536000; Secure$/);
  assert.equal((await resolveVisitor(request(cookieOf(a)),env)).owner,a.owner);
  const raw=cookieOf(a).split('=')[1];
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM career_visitor_sessions').all()).includes(raw));
});

test('forged, duplicate, expired and missing cookies cannot select an owner or authorize writes',async t=>{
  const {env,db}=fixture(t),a=await resolveVisitor(request(),env,{create:true});
  for(const cookie of ['',`__Host-career_scout_visitor=${'a'.repeat(64)}`,cookieOf(a)+'; '+cookieOf(a),'__Host-career_scout_visitor='+a.owner]){
    await assert.rejects(()=>resolveVisitor(request(cookie),env),e=>e.status===401);
  }
  db.prepare('UPDATE career_visitor_sessions SET expires_at = 0').run();
  await assert.rejects(()=>resolveVisitor(request(cookieOf(a)),env),e=>e.status===401);
  const fresh=await resolveVisitor(request(cookieOf(a)),env,{create:true});assert.notEqual(fresh.owner,a.owner);
});

test('persistent visitor and shared quotas prevent extra calls, survive new visitors and reset by time window',async t=>{
  const {env}=fixture(t),a=await resolveVisitor(request(),env,{create:true}),now=Date.UTC(2026,0,2);
  const attempts=await Promise.allSettled(Array.from({length:12},()=>reserveVisitorUsage(env,a.owner,'search',{now})));
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,VISITOR_LIMITS.search.visitor);
  assert.ok(attempts.filter(x=>x.status==='rejected').every(x=>x.reason.status===429));
  for(let n=0;n<7;n++)for(let i=0;i<5;i++)await reserveVisitorUsage(env,'visitor-'+crypto.randomUUID(),'search',{now});
  await assert.rejects(()=>reserveVisitorUsage(env,'visitor-'+crypto.randomUUID(),'search',{now}),e=>e.status===429&&/shared/.test(e.message));
  await reserveVisitorUsage(env,a.owner,'search',{now:now+86400000});
  await assert.rejects(()=>reserveVisitorUsage(env,'signed-in-private-owner','model'),e=>e.status===401);
});

test('missing anonymous storage fails closed and private mode keeps the existing authenticated owner',async t=>{
  const {env}=fixture(t);let signInReads=0;
  const imports={'@/app/chatgpt-auth':{getChatGPTUser:async()=>{signInReads++;return {userId:'existing-private-owner'};}},'@/lib/profile-runtime':{getProfileEnvironment:()=>env},'@/lib/profile/domain.mjs':domain,'@/lib/profile/visitor-access.mjs':{resolveVisitor,reserveVisitorUsage,publicDemoEnabled:value=>value.PUBLIC_DEMO_ENABLED==='true'}};
  const access=moduleFrom('lib/profile-access.ts',imports);
  const guest=await access.profileAccess(request('',undefined,{headers:{'oai-authenticated-user-id':'existing-private-owner'}}),{create:true});
  assert.match(guest.owner,/^visitor-/);assert.equal(signInReads,0);
  delete env.DB;await assert.rejects(()=>access.profileAccess(request(),{create:true}),e=>e.status===503);
  env.PUBLIC_DEMO_ENABLED='false';assert.equal((await access.profileAccess(request())).owner,'existing-private-owner');assert.equal(signInReads,1);
});

test('document byte budgets reject oversized increments without overflowing persistent counters',async t=>{
  const {env,db}=fixture(t),owner='visitor-'+crypto.randomUUID(),now=Date.UTC(2026,0,2);
  await reserveVisitorUsage(env,owner,'upload',{now,units:VISITOR_LIMITS.upload.visitor});
  await assert.rejects(()=>reserveVisitorUsage(env,owner,'upload',{now,units:1}),e=>e.status===429);
  const bucket=`upload:${Math.floor(now/86400000)}:shared`;
  assert.equal(db.prepare('SELECT used FROM career_visitor_usage WHERE bucket = ?').get(bucket).used,VISITOR_LIMITS.upload.visitor);
  await assert.rejects(()=>reserveVisitorUsage(env,'visitor-'+crypto.randomUUID(),'upload',{now,units:VISITOR_LIMITS.upload.visitor+1}),e=>e.status===429);
  assert.equal(db.prepare('SELECT used FROM career_visitor_usage WHERE bucket = ?').get(bucket).used,VISITOR_LIMITS.upload.visitor);
});

test('actual Profile API saves and reloads only the current browser and rejects owner injection and cross-site writes',async t=>{
  const {env}=fixture(t),saved=new Map(),oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=oldFetch;});
  globalThis.fetch=async(url,options)=>{
    assert.equal(new URL(url).origin,'https://fixture.supabase.co');const body=JSON.parse(options.body),owner=body.p_owner;
    if(String(url).endsWith('/career_profile_load'))return Response.json(saved.get(owner)||null);
    if(String(url).endsWith('/career_profile_save')){assert.equal(body.p_revision,saved.get(owner)?.revision||0);const record={revision:body.p_revision+1,state:body.p_state};saved.set(owner,record);return Response.json(record);}
    throw Error('Unexpected provider call '+new URL(url).pathname);
  };
  const runtime={getProfileEnvironment:()=>env,scheduleProfileWork:()=>{}};
  const access=moduleFrom('lib/profile-access.ts',{'@/app/chatgpt-auth':{getChatGPTUser:async()=>({userId:'private-owner-must-not-be-used'})},'@/lib/profile-runtime':runtime,'@/lib/profile/domain.mjs':domain,'@/lib/profile/visitor-access.mjs':{resolveVisitor,reserveVisitorUsage,publicDemoEnabled:value=>value.PUBLIC_DEMO_ENABLED==='true'}});
  const api=moduleFrom('app/api/profile/route.ts',{'@/lib/profile/visitor-access.mjs':{reserveVisitorUsage},'@/lib/profile-access':access,'@/lib/profile-runtime':runtime,'@/lib/profile/service.mjs':{ProfileService},'@/lib/profile/domain.mjs':domain,'@/lib/profile/providers.mjs':providers,'@/lib/workflow/profile-intake.mjs':{dispatchProfileOperation},'@/lib/profile/agent-prompts':{loadAgentPrompt:async()=>''}});
  const a=await api.GET(request()),b=await api.GET(request());assert.equal(a.status,200);assert.equal(b.status,200);
  const ca=a.headers.get('set-cookie').split(';')[0],cb=b.headers.get('set-cookie').split(';')[0];
  const post=(cookie,body,from=origin)=>api.POST(request(cookie,'/api/profile',{method:'POST',headers:{Origin:from,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  const added=await post(ca,{action:'paste',kind:'resume',text:DEMO_RESUME,revision:0});assert.equal(added.status,200,await added.clone().text());
  const data=await added.json();assert.equal(data.state.documents.length,1);
  assert.equal((await (await api.GET(request(ca))).json()).revision,data.revision);
  assert.equal((await (await api.GET(request(cb))).json()).state.documents.length,0);
  assert.equal((await api.GET(request(cb,'/api/profile?download='+data.state.documents[0].id))).status,404);
  for(const field of ['owner','owner_id','namespace'])assert.equal((await post(cb,{action:'export',revision:0,[field]:'private-owner-must-not-be-used'})).status,403);
  assert.equal((await post(ca,{action:'export',revision:data.revision},'https://attacker.example.test')).status,403);
  assert.equal((await post('',{action:'export',revision:0})).status,401);
  assert.ok([...saved.keys()].every(owner=>owner.startsWith('visitor-')));
});

test('all Gemini entry points enforce public allowance before any external model call',async t=>{
  const {env,db}=fixture(t),guest=await resolveVisitor(request(),env,{create:true});
  env.GEMINI_API_KEY='synthetic-test-only';env.PUBLIC_VISITOR_OWNER=guest.owner;
  const day=Math.floor(Date.now()/86400000);
  db.prepare('INSERT INTO career_visitor_usage VALUES (?, ?, ?)').run(`model:${day}:${guest.owner}`,VISITOR_LIMITS.model.visitor,Date.now()+86400000);
  const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Must not reach provider');};t.after(()=>{globalThis.fetch=oldFetch;});
  for(const run of [()=>providers.analyzeWithModel(env,'facts',{}),()=>providers.embedTexts(env,['Fictional source passage']),()=>providers.generateAgentJSON(env,{instructions:'test',input:{},schema:{}})])await assert.rejects(run,e=>e.status===429);
  assert.equal(calls,0);
});

test('Scout requires the same visitor session and applies shared search limits to direct searches too',async t=>{
  const {env}=fixture(t),guest=await resolveVisitor(request(),env,{create:true}),calls=[];
  const runtime={getProfileEnvironment:()=>env};
  const access=moduleFrom('lib/profile-access.ts',{'@/app/chatgpt-auth':{getChatGPTUser:async()=>null},'@/lib/profile-runtime':runtime,'@/lib/profile/domain.mjs':domain,'@/lib/profile/visitor-access.mjs':{resolveVisitor,reserveVisitorUsage,publicDemoEnabled:value=>value.PUBLIC_DEMO_ENABLED==='true'}});
  const api=moduleFrom('app/api/scout/route.ts',{
    '@/lib/profile-access':access,'@/lib/profile/visitor-access.mjs':{reserveVisitorUsage},'@/lib/profile-runtime':runtime,
    '@/lib/profile/service.mjs':{ProfileService},'@/lib/profile/domain.mjs':domain,
    '@/lib/scout.mjs':{},'@/lib/search-runtime':{getSearchKey:()=> 'fixture-only'},
    '@/lib/keenable.mjs':{SearchError:domain.ProfileError,searchCriteria:()=>{},searchKeenable:async(body,options)=>{calls.push(options.scope);return {jobs:[]};}},
    '@/lib/workflow/scout-handoff.mjs':{},'@/lib/workflow/policy.mjs':{},'@/lib/workflow/scout-policy.mjs':{},'@/lib/workflow/scout-agent.mjs':{},'@/lib/profile/agent-prompts':{},
  });
  const post=(cookie,extra={})=>api.POST(request(cookie,'/api/scout',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','oai-authenticated-user-id':'private-owner'},body:JSON.stringify({action:'search',...extra})}));
  assert.equal((await post('')).status,401);
  assert.equal((await post(cookieOf(guest),{owner:'private-owner'})).status,403);
  for(let i=0;i<VISITOR_LIMITS.search.visitor;i++)assert.equal((await post(cookieOf(guest))).status,200);
  assert.equal((await post(cookieOf(guest))).status,429);
  assert.deepEqual(calls,Array(VISITOR_LIMITS.search.visitor).fill(guest.owner));
});

test('actual Workers D1 runtime preserves visitor isolation and atomic concurrent quotas',async t=>{
  const base=new URL('../',import.meta.url),root=fileURLToPath(base);
  const source=`import {resolveVisitor,reserveVisitorUsage} from './lib/profile/visitor-access.mjs';
export default {async fetch(request,env){try{const search=new URL(request.url).pathname==='/search';const a=await resolveVisitor(request,env,{create:!search});if(search)await reserveVisitorUsage(env,a.owner,'search');return Response.json({owner:a.owner},{headers:a.setCookie?{'Set-Cookie':a.setCookie}:{}});}catch(e){return Response.json({error:e.message},{status:e.status||500});}}};`;
  const modules=['visitor-access','domain','search-profile','source-records','experience-review','jd-content'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('lib/profile/'+name+'.mjs',base))}));
  const mf=new Miniflare({rootPath:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],bindings:{PUBLIC_DEMO_ENABLED:'true'},d1Databases:['DB'],modules:[{type:'ESModule',path:root+'public-visitor-worker-test.mjs',contents:source},...modules]});
  t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql'))){for(const sql of readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').split('--> statement-breakpoint').filter(x=>x.trim()))await db.prepare(sql).run();}
  const a=await mf.dispatchFetch('https://public.example.test/'),b=await mf.dispatchFetch('https://public.example.test/');
  assert.equal(a.status,200);assert.equal(b.status,200);
  const cookie=a.headers.get('set-cookie').split(';')[0],owner=(await a.json()).owner;
  assert.notEqual(owner,(await b.json()).owner);
  assert.equal((await (await mf.dispatchFetch('https://public.example.test/',{headers:{Cookie:cookie}})).json()).owner,owner);
  const attempts=await Promise.all(Array.from({length:10},()=>mf.dispatchFetch('https://public.example.test/search',{headers:{Cookie:cookie}})));
  assert.equal(attempts.filter(r=>r.status===200).length,5);assert.equal(attempts.filter(r=>r.status===429).length,5);
});
