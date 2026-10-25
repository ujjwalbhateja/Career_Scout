// Executable LangGraph foundation with injected adapters. It is not wired to the hosted
// search UI, a model, permanent memory or a scheduler. No synthetic adapter defaults.
import {Annotation,StateGraph,START,END} from '@langchain/langgraph';
import {auditRoute,requireJDIntake,draftFingerprint,validationIssues,validatedPackage} from './policy.mjs';

const replace=()=>Annotation();
const audit=()=>Annotation({reducer:(previous,next)=>[...previous,...next],default:()=>[]});
const clone=value=>structuredClone(value);
const handlersRequired=(handlers,names)=>{for(const name of names)if(typeof handlers?.[name]!=='function')throw new Error(`Configure the ${name} adapter before running the workflow.`);};
const approvedFacts=facts=>facts?.verified===true&&!!facts.version&&!!facts.approvalRef&&Array.isArray(facts.evidenceRefs)&&facts.evidenceRefs.length>0;
const approvedProfiles=profiles=>Array.isArray(profiles)&&profiles.length>0&&profiles.every(profile=>profile.id&&profile.roleName&&profile.approvalRef&&Array.isArray(profile.supportedTasks));

export function createProfileGraph(handlers){
  handlersRequired(handlers,['fact','profileBuilder']);
  const State=Annotation.Root({request:replace(),facts:replace(),roleProfiles:replace(),phase:replace(),next:replace(),outcome:replace(),audit:audit()});
  return new StateGraph(State)
    .addNode('profile',state=>{
      if(!state.phase){requireJDIntake(state.request);return {next:'fact',audit:[auditRoute('profile','fact','verified-facts-request')]};}
      if(state.phase==='facts')return approvedFacts(state.facts)?{next:'profile_builder',audit:[auditRoute('profile','profile-builder','role-profile-request')]}:{next:'end',outcome:'needs_input'};
      return {next:'end',outcome:approvedProfiles(state.roleProfiles)?'approved':'needs_input'};
    })
    .addNode('fact',async state=>({facts:await handlers.fact(clone({profileInformation:state.request.profileInformation,existingResume:state.request.existingResume,capabilityAnswers:state.request.capabilityAnswers})),phase:'facts',audit:[auditRoute('fact','profile','facts-output')]}))
    .addNode('profile_builder',async state=>({roleProfiles:await handlers.profileBuilder(clone({selectedJobDescriptions:state.request.selectedJobDescriptions,verifiedFacts:state.facts,existingResume:state.request.existingResume,capabilityAnswers:state.request.capabilityAnswers})),phase:'profiles',audit:[auditRoute('profile-builder','profile','role-profiles-output')]}))
    .addEdge(START,'profile').addConditionalEdges('profile',state=>state.next,{fact:'fact',profile_builder:'profile_builder',end:END})
    .addEdge('fact','profile').addEdge('profile_builder','profile').compile();
}

export function createCareerWorkflow(handlers,{maxRevisions=2}={}){
  handlersRequired(handlers,['fact','profileBuilder','scout','matcher','tailor','critic','savePackage']);
  if(!Number.isInteger(maxRevisions)||maxRevisions<0||maxRevisions>5)throw new Error('Use a bounded revision limit between zero and five.');
  const profileGraph=createProfileGraph(handlers);
  const State=Annotation.Root({request:replace(),facts:replace(),roleProfiles:replace(),jobs:replace(),assessment:replace(),job:replace(),draft:replace(),review:replace(),feedback:replace(),phase:replace(),next:replace(),outcome:replace(),packet:replace(),revisions:replace(),audit:audit()});
  const master=async state=>{
    let next;
    if(!state.phase){requireJDIntake(state.request?.profileInput);next='profile';}
    else if(state.phase==='profile')next=state.outcome==='approved'?'scout':'end';
    else if(state.phase==='scout'){if(!state.jobs?.length)return {next:'end',outcome:'no_jobs'};next='matcher';}
    else if(state.phase==='matcher'){if(!state.assessment?.suitable||!state.job)return {next:'end',outcome:'needs_review'};next='tailor';}
    else if(state.phase==='tailor')next='critic';
    else if(state.phase==='critic'){
      const feedback=await validationIssues({job:state.job,draft:state.draft,profile:state.facts,review:state.review});
      if(feedback.length){if((state.revisions||0)>=maxRevisions)return {next:'end',outcome:'needs_review',feedback};return {next:'tailor',feedback,revisions:(state.revisions||0)+1,audit:[auditRoute('master','tailor','revision-request')]};}
      next='save';
    }
    return {next,audit:next==='end'?[]:[auditRoute('master',next==='save'?'application-storage':next,`${next}-request`)]};
  };
  return new StateGraph(State)
    .addNode('master',master)
    .addNode('profile',async state=>{const result=await profileGraph.invoke({request:clone(state.request.profileInput)});return {facts:result.facts,roleProfiles:result.roleProfiles,outcome:result.outcome,phase:'profile',audit:[...result.audit,auditRoute('profile','master','approved-profile-output')]};})
    .addNode('scout',async state=>({jobs:await handlers.scout(clone({roleProfiles:state.roleProfiles,searchRequirements:state.request.searchRequirements})),phase:'scout',audit:[auditRoute('scout','master','shortlisted-jobs-output')]}))
    .addNode('matcher',async state=>{
      const assessment=await handlers.matcher(clone({verifiedFacts:state.facts,roleProfiles:state.roleProfiles,jobs:state.jobs}));
      const job=state.jobs.find(item=>item.id===assessment.selectedJobId);
      if(assessment.suitable&&!job)throw new Error('Matcher selected a job outside the Master shortlist.');
      if(job&&(!job.description||!job.applicationUrl))throw new Error('The selected job needs a full description and application link.');
      return {assessment,job,phase:'matcher',audit:[auditRoute('matcher','master','match-assessment-output')]};
    })
    .addNode('tailor',async state=>{
      const draft=await handlers.tailor(clone({job:state.job,existingResume:state.request.profileInput.existingResume,verifiedFacts:state.facts,roleProfiles:state.roleProfiles,assessment:state.assessment,revisionFeedback:state.feedback||[],previousDraft:state.draft}));
      if(draft.jobId!==state.job.id||draft.profileVersion!==state.facts.version)throw new Error('Tailored draft must retain the selected job and approved profile version.');
      await draftFingerprint(draft);
      return {draft,review:null,phase:'tailor',audit:[auditRoute('tailor','master','resume-draft-output')]};
    })
    .addNode('critic',async state=>({review:await handlers.critic(clone({draft:state.draft,draftHash:await draftFingerprint(state.draft),job:state.job,verifiedFacts:state.facts,roleProfiles:state.roleProfiles,assessment:state.assessment})),phase:'critic',audit:[auditRoute('critic','master','two-part-validation-output')]}))
    .addNode('save',async state=>{
      const packet=await validatedPackage({job:state.job,draft:state.draft,profile:state.facts,review:state.review,assessment:state.assessment,date:state.request.packageDate});
      const receipt=await handlers.savePackage(clone(packet));
      const folder=typeof receipt?.folder==='string'?receipt.folder.replace(/\\/g,'/'):'';
      if(receipt?.saved!==true||receipt.jobId!==packet.jobId||receipt.profileVersion!==packet.profileVersion||receipt.draftHash!==packet.validation.draftHash||!(folder===packet.folder||folder.endsWith('/'+packet.folder)))throw new Error('Storage must confirm the associated job, profile, draft fingerprint and expected saved folder.');
      return {packet:{...packet,status:'Ready to Apply',storage:receipt},phase:'saved',outcome:'ready'};
    })
    .addEdge(START,'master')
    .addConditionalEdges('master',state=>state.next,{profile:'profile',scout:'scout',matcher:'matcher',tailor:'tailor',critic:'critic',save:'save',end:END})
    .addEdge('profile','master').addEdge('scout','master').addEdge('matcher','master').addEdge('tailor','master').addEdge('critic','master').addEdge('save',END).compile();
}
