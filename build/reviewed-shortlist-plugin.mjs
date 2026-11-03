import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Optional, public job evidence reviewed locally. Never bundle local research in a deployment.
export function reviewedShortlist(){
  let local=false,root='';
  return {name:'career-scout-local-reviewed-shortlist',
    configResolved(config){local=config.command==='serve'&&[undefined,false,'localhost','127.0.0.1','::1'].includes(config.server.host);root=config.root;},
    resolveId(id){if(id==='virtual:reviewed-shortlist')return '\0virtual:reviewed-shortlist';},
    async load(id){
      if(id!=='\0virtual:reviewed-shortlist')return;
      let data=null;
      if(local){try{data=JSON.parse(await readFile(path.join(root,'research','step4-shortlist.json'),'utf8'));}catch{}}
      return `export default ${JSON.stringify(data)};`;
    },
  };
}
