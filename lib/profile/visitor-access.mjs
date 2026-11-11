import {ProfileError} from './domain.mjs';

const DAY=86400000,SESSION_AGE=365*DAY;
export const VISITOR_LIMITS={model:{visitor:60,shared:300},search:{visitor:5,shared:40},request:{visitor:120,shared:6000},upload:{visitor:10_000_000,shared:100_000_000},session:{shared:500}};
export const publicDemoEnabled=env=>env.PUBLIC_DEMO_ENABLED==='true';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const hash=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
function database(env){if(!env.DB?.prepare)throw new ProfileError('The public workspace is not ready yet. Please try again shortly.',503);return env.DB;}
const cookieName=request=>new URL(request.url).protocol==='https:'?'__Host-career_scout_visitor':'career_scout_visitor';

async function increment(db,bucket,limit,expiresAt,units=1){
  if(units>limit)return false;
  const row=await db.prepare('INSERT INTO career_visitor_usage (bucket, used, expires_at) VALUES (?, ?, ?) ON CONFLICT(bucket) DO UPDATE SET used = used + ? WHERE used <= ? RETURNING used').bind(bucket,units,expiresAt,units,limit-units).first();
  return !!row;
}
export async function reserveVisitorUsage(env,owner,kind,{now=Date.now(),units=1}={}){
  if(!publicDemoEnabled(env))return;
  if(!/^visitor-[a-f0-9-]{36}$/.test(owner||''))throw new ProfileError('Open your own public workspace before continuing.',401);
  const db=database(env),limits=VISITOR_LIMITS[kind];
  if(!limits)throw new Error('Unknown visitor usage category');
  if(!Number.isSafeInteger(units)||units<1)throw new Error('Invalid visitor usage amount');
  const period=kind==='request'?60000:DAY,window=Math.floor(now/period),expiresAt=(window+2)*period;
  if(limits.visitor&&!await increment(db,`${kind}:${window}:${owner}`,limits.visitor,expiresAt,units))throw new ProfileError(kind==='request'?'Please wait a minute before trying again.':`This browser has reached its daily ${kind==='model'?'analysis':kind==='upload'?'document upload':'search'} allowance. Your profile is saved; try again after midnight UTC.`,429);
  if(!await increment(db,`${kind}:${window}:shared`,limits.shared,expiresAt,units))throw new ProfileError(kind==='request'?'The public demo is busy. Please try again shortly.':'The shared public demo allowance is used for today. Your profile is saved; please try again after midnight UTC.',429);
}

export async function resolveVisitor(request,env,{create=false,now=Date.now()}={}){
  const db=database(env),name=cookieName(request);
  const values=(request.headers.get('cookie')||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(name+'=')).map(part=>part.slice(name.length+1));
  if(values.length===1&&/^[a-f0-9]{64}$/.test(values[0])){
    const row=await db.prepare('SELECT owner, expires_at FROM career_visitor_sessions WHERE token_hash = ? AND expires_at > ?').bind(await hash(values[0]),now).first();
    if(row&&/^visitor-[a-f0-9-]{36}$/.test(row.owner))return {owner:row.owner,visitor:true,expiresAt:row.expires_at};
  }
  if(!create)throw new ProfileError('Open or refresh Career Scout in this browser to start your private workspace.',401);
  const day=Math.floor(now/DAY);
  if(!await increment(db,`session:${day}:shared`,VISITOR_LIMITS.session.shared,(day+2)*DAY))throw new ProfileError('The public demo has reached today\'s new-workspace allowance. Please try again after midnight UTC.',429);
  const token=hex(crypto.getRandomValues(new Uint8Array(32))),owner='visitor-'+crypto.randomUUID(),expiresAt=now+SESSION_AGE;
  await db.prepare('INSERT INTO career_visitor_sessions (token_hash, owner, expires_at) VALUES (?, ?, ?)').bind(await hash(token),owner,expiresAt).run();
  // Bounded metadata maintenance; profile data is deleted only by its owner.
  await db.prepare('DELETE FROM career_visitor_usage WHERE bucket IN (SELECT bucket FROM career_visitor_usage WHERE expires_at < ? LIMIT 100)').bind(now).run();
  return {owner,visitor:true,expiresAt,setCookie:`${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_AGE/1000}${new URL(request.url).protocol==='https:'?'; Secure':''}`};
}

export async function reservePublicModelCall(env){
  if(publicDemoEnabled(env))await reserveVisitorUsage(env,env.PUBLIC_VISITOR_OWNER,'model');
}
