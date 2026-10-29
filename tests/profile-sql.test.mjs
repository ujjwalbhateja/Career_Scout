import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {emptyProfile} from '../lib/profile/domain.mjs';
test('actual PostgreSQL migration enforces RPC-only access, owner scoping, revisions and deletion gates',async()=>{
  const db=await PGlite.create();
  try{
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage; create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$; grant usage on schema auth to public; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id text,bucket_id text); alter table storage.objects enable row level security;");
    const migration=readFileSync(new URL('../supabase/migrations/202610280001_profile_memory.sql',import.meta.url),'utf8');
    // Reproduce an installed first revision, then exercise the small upgrade.
    await db.exec(migration.replaceAll("'PT409'","'40001'").replaceAll('2026-10-29.2','2026-10-29.1'));
    const correction=readFileSync(new URL('../supabase/migrations/202610290002_profile_conflict_response.sql',import.meta.url),'utf8');
    await db.exec(correction);await db.exec(correction);
    await db.exec(migration); // Setup is repeatable without losing records.
    await db.exec("set role anon; select set_config('request.jwt.claim.role','anon',false);");
    await assert.rejects(db.query("select public.career_profile_load('owner-a')"),/permission denied/);
    await assert.rejects(db.query('select * from public.career_profile_states'),/permission denied/);
    await db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false);");
    await assert.rejects(db.query('select * from public.career_profile_states'),/permission denied/);
    let result=await db.query('select public.career_profile_save($1,$2,$3::jsonb) as saved',['owner-a',0,JSON.stringify(emptyProfile())]);
    assert.equal(result.rows[0].saved.revision,1);
    await assert.rejects(db.query('select public.career_profile_save($1,$2,$3::jsonb)',['owner-a',0,JSON.stringify(emptyProfile())]),error=>error.code==='PT409'&&/profile_revision_conflict/.test(error.message));
    result=await db.query('select public.career_profile_load($1) as loaded',['owner-b']);assert.equal(result.rows[0].loaded,null);
    await assert.rejects(db.query('select public.career_profile_purge($1,$2)',['owner-a',1]),/deletion not requested/);
    const state=emptyProfile();state.deletion={status:'pending'};
    await db.query('select public.career_profile_save($1,$2,$3::jsonb)',['owner-a',1,JSON.stringify(state)]);
    result=await db.query('select public.career_profile_purge($1,$2) as purged',['owner-a',2]);assert.equal(result.rows[0].purged,true);
    result=await db.query('select public.career_profile_load($1) as loaded',['owner-a']);assert.equal(result.rows[0].loaded.revision,3);assert.deepEqual(result.rows[0].loaded.state.facts,[]);
    await assert.rejects(db.query('select public.career_profile_save($1,$2,$3::jsonb)',['owner-a',0,JSON.stringify(emptyProfile())]),/profile_revision_conflict/);
    await db.exec("reset role;");
    const bucket=await db.query("select public from storage.buckets where id='career-profile-private'");assert.equal(bucket.rows[0].public,false);
  }finally{await db.close();}
});
