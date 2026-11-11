import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const root=new URL('../',import.meta.url);
const config=await readFile(new URL('vite.config.ts',root),'utf8');
const assetsInclude=JSON.parse(config.match(/assetsInclude:\s*(\[[^\]]+\])/)[1]);
const options={configFile:false,root:fileURLToPath(root),appType:'custom',logLevel:'silent',server:{middlewareMode:true,watch:null},environments:{rsc:{},ssr:{}}};

test('reproduces the bare Markdown import-analysis failure without asset classification',async()=>{
  const server=await createServer(options);
  try{
    await assert.rejects(()=>server.environments.rsc.transformRequest('/backend/src/career_scout/agents/profile_builder/prompt.md'),/Failed to parse source/);
    assert.ok((await server.environments.rsc.transformRequest('/backend/src/career_scout/agents/profile_builder/prompt.md?raw')).code);
  }finally{await server.close();}
});

test('actual Vite config handles bare HMR paths and retains byte-exact raw policies in each environment',async()=>{
  const server=await createServer({...options,assetsInclude});
  try{
    for(const agent of ['profile','profile_builder','fact','scout']){
      const path='/backend/src/career_scout/agents/'+agent+'/prompt.md';
      const source=await readFile(new URL(path.slice(1),root),'utf8');
      for(const environment of Object.values(server.environments)){
        const bare=await environment.transformRequest(path),raw=await environment.transformRequest(path+'?raw');
        assert.ok(bare.code.includes(JSON.stringify(path)));
        assert.ok(raw.code.includes(JSON.stringify(source)));
        // Exercise re-transformation after module cache invalidation, as on save.
        environment.moduleGraph.invalidateAll();
        assert.ok((await environment.transformRequest(path+'?raw')).code.includes(JSON.stringify(source)));
        assert.ok((await environment.transformRequest(path)).code.includes(JSON.stringify(path)));
      }
    }
    assert.equal(server.config.assetsInclude('/unrelated/readme.md'),false);
  }finally{await server.close();}
});
