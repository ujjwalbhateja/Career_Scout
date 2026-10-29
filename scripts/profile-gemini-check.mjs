// Bounded live check. Synthetic evidence only; never reads a stored user profile.
import {writeFileSync} from 'node:fs';
import {analyzeWithModel,embedTexts,ProfileMemory,ANALYSIS_MODEL,EMBEDDING_MODEL,EMBEDDING_DIMENSIONS} from '../lib/profile/providers.mjs';
import {emptyProfile,addDocument,proposeFacts,decideFacts,addJDAnalysis,buildProfiles,approvedFacts,ProfileError} from '../lib/profile/domain.mjs';
try{process.loadEnvFile(new URL('../.env.local',import.meta.url));}catch{}
const report={checkedAt:new Date().toISOString(),provider:'gemini',analysisModel:ANALYSIS_MODEL,embeddingModel:EMBEDDING_MODEL,dimensions:EMBEDDING_DIMENSIONS,syntheticOnly:true,openAICalls:0,completedRequests:0};
const cosine=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0)/(Math.hypot(...a)*Math.hypot(...b));
try{
  if(!process.env.GEMINI_API_KEY)throw new ProfileError('Save GEMINI_API_KEY in ignored .env.local before running this check.',503);
  const segments=[
    {id:'synthetic.p1',text:'At Example Employer, Portfolio Analyst, January 2020 to December 2022.',locator:'synthetic paragraph 1'},
    {id:'synthetic.p2',text:'Prepared monthly portfolio reports for institutional clients.',locator:'synthetic paragraph 2'},
    {id:'synthetic.p3',text:'Python is listed as a skill. No project details are supplied.',locator:'synthetic paragraph 3'}
  ];
  const result=await analyzeWithModel(process.env,'facts',{documentId:'synthetic',kind:'resume',title:'Synthetic evaluation',segments});report.completedRequests++;
  const state=emptyProfile();addDocument(state,{id:'synthetic',kind:'resume',title:'Synthetic evaluation',hash:'synthetic-gemini-evaluation-v1',segments});
  await proposeFacts(state,result.facts);
  const assertions=state.facts.map(f=>f.statement).join(' ');
  report.extraction={facts:state.facts.length,sourceReferencesValidated:true,allUnapproved:state.facts.every(f=>f.approval==='pending'),reportingRetained:/report/i.test(assertions),unlistedSQLNotInvented:!(/\bSQL\b/i.test(assertions))};
  if(!state.facts.length||!report.extraction.allUnapproved||!report.extraction.reportingRetained||!report.extraction.unlistedSQLNotInvented)throw new ProfileError('Synthetic extraction acceptance checks failed.',502);
  const documents=await embedTexts(process.env,['Prepared monthly portfolio reports for institutional clients.','Compiled recurring investment performance reports for clients.','Serviced commercial refrigeration equipment.']);report.completedRequests++;
  const [query]=await embedTexts(process.env,['client investment reporting experience'],undefined,'RETRIEVAL_QUERY');report.completedRequests++;
  const scores=documents.map(vector=>cosine(query,vector));
  report.retrieval={dimensionsValidated:true,relatedScores:scores.slice(0,2),unrelatedScore:scores[2],relatedAboveUnrelated:Math.max(...scores.slice(0,2))>scores[2]};
  if(!report.retrieval.relatedAboveUnrelated)throw new ProfileError('Synthetic semantic-retrieval acceptance check failed.',502);
  if(process.argv.includes('--workflow')){
    // These are disposable synthetic approvals, not decisions on a user profile.
    decideFacts(state,state.facts.map(f=>({id:f.id,version:f.version,decision:'approved'})),'synthetic-evaluation-only');
    const jdText='Portfolio Analyst. Required: prepare monthly portfolio reports for institutional clients. Preferred: SQL. Vacancy reference: ';
    const first={documentId:'jd0',kind:'jd',title:'Synthetic JD',segments:[{id:'jd0.p1',text:jdText+'0',locator:'synthetic paragraph 1'}]};
    const jd=await analyzeWithModel(process.env,'jd',first);report.completedRequests++;
    // One live JD extraction is copied onto ten distinct synthetic fixture IDs to
    // exercise the existing onboarding contract without ten extra model calls.
    for(let i=0;i<10;i++){
      const id='jd'+i;addDocument(state,{id,kind:'jd',title:'Synthetic JD '+i,hash:'synthetic-jd-'+i,selected:true,segments:[{id:id+'.p1',text:jdText+i}]});
      const analysis=structuredClone(jd);for(const r of analysis.requirements)for(const ref of r.evidence){ref.documentId=id;ref.segmentId=id+'.p1';}
      await addJDAnalysis(state,id,analysis);
    }
    const facts=approvedFacts(state).filter(f=>!['personal','preferences'].includes(f.category)).map(f=>({id:f.id,version:f.version,category:f.category,field:f.field,scope:f.scope,statement:f.statement}));
    const requirements=state.requirements.map(r=>({id:r.id,text:r.text,category:r.category,importance:r.importance}));
    const built=await analyzeWithModel(process.env,'builder',{selectedJDs:state.documents.filter(d=>d.kind==='jd').map(d=>({id:d.id,roleName:d.roleName,sector:d.sector})),requirements,approvedFacts:facts,answerHistory:[],disclosurePreferences:[]});report.completedRequests++;
    await buildProfiles(state,built);
    const selected=requirements.filter(r=>state.requirements.find(item=>item.id===r.id).documentId==='jd0');
    const assessment=await analyzeWithModel(process.env,'assessment',{requirements:selected,approvedFacts:facts,roleProfiles:state.roleProfiles.map(p=>({id:p.id,roleName:p.roleName}))});report.completedRequests++;
    const seen=new Set();for(const m of assessment.mappings){if(seen.has(m.requirementId)||!selected.some(r=>r.id===m.requirementId)||m.factIds.some(id=>!facts.some(f=>f.id===id)))throw new ProfileError('Synthetic assessment returned invalid references.',502);seen.add(m.requirementId);}
    const sqlIds=new Set(requirements.filter(r=>/\bSQL\b/i.test(r.text)).map(r=>r.id));
    report.workflow={jdRequirements:jd.requirements.length,syntheticOnboardingDocuments:10,liveJDExtractions:1,roleProposals:state.roleProfiles.length,allRolesUnapproved:state.roleProfiles.every(p=>p.status==='proposed'),assessmentCoverage:seen.size===selected.length,unsupportedSQLHasNoFact:state.roleProfiles.every(p=>p.mappings.every(m=>!sqlIds.has(m.requirementId)||m.factRefs.length===0))&&assessment.mappings.every(m=>!sqlIds.has(m.requirementId)||m.factIds.length===0)};
    if(!report.workflow.roleProposals||!report.workflow.allRolesUnapproved||!report.workflow.assessmentCoverage||!report.workflow.unsupportedSQLHasNoFact)throw new ProfileError('Synthetic Builder/assessment acceptance checks failed.',502);
    if(process.env.PINECONE_API_KEY&&process.env.PINECONE_INDEX_HOST){
      const memory=new ProfileMemory(process.env,'synthetic-gemini-check-'+crypto.randomUUID()),namespace=await memory.vectorNamespace();let wrote=false;
      try{
        await memory.pinecone('/vectors/upsert',{namespace,vectors:documents.map((values,i)=>({id:'synthetic-'+i,values,metadata:{embedding_model:EMBEDDING_MODEL}}))});wrote=true;
        let found;
        for(let attempt=0;attempt<4;attempt++){
          found=await memory.pinecone('/query',{namespace,vector:query,topK:3,includeValues:false,includeMetadata:false});
          if(found.matches?.length===3)break;
          if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1000));
        }
        report.pinecone={geminiNamespaceIsolated:true,matches:found.matches?.length||0,relatedFirst:['synthetic-0','synthetic-1'].includes(found.matches?.[0]?.id)};
        if(!report.pinecone.relatedFirst)throw new ProfileError('Synthetic Pinecone semantic check did not return the related passage first.',502);
      }finally{if(wrote){await memory.pinecone('/vectors/delete',{namespace,deleteAll:true});report.syntheticVectorCleanupRequested=true;}}
    }
  }
  report.ok=true;
}catch(error){report.ok=false;report.status=error instanceof ProfileError?error.status:503;report.error=error instanceof ProfileError?error.message:'Live check could not complete. No credentials or provider response are printed.';process.exitCode=1;}
const args=process.argv.slice(2),reportIndex=args.indexOf('--report');if(reportIndex!==-1&&args[reportIndex+1])writeFileSync(args[reportIndex+1],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
