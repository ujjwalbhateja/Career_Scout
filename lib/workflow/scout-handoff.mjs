import {createProfileGraph} from './graph.mjs';
import {auditRoute} from './policy.mjs';
import {approvedProfileLoader} from '../profile/service.mjs';
import {ProfileError} from '../profile/domain.mjs';
import {currentProfileVersion} from '../profile/current-profile.mjs';
import {scoutContextFromSearchProfile,normalizeScoutContext,planScoutQueries,SCOUT_LIMITS} from './scout-policy.mjs';

const allowed=['location','requiredKeywords','excludedKeywords','seniority','arrangement','employment','minSalary','currency','period','preferSponsorship','includeUnknown','searchDescriptions','includeUnverified','showClosed','maxAge','stream','batch','refresh'];
const preferenceKeys=['location','requiredKeywords','excludedKeywords','seniority','arrangement','employment','minSalary','currency','period','preferSponsorship'];
const clone=value=>structuredClone(value);
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
async function fingerprint(value){const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(value))));return [...new Uint8Array(data)].map(v=>v.toString(16).padStart(2,'0')).join('');}

function checkedContext(plan,context){
  const base=normalizeScoutContext(plan.scoutContext),selected=normalizeScoutContext(context||base);
  if((selected.resumeFactIds||[]).some(id=>!(base.resumeFactIds||[]).includes(id)))throw new ProfileError('Scout planning introduced an unsupported resume reference.',409);
  if(base.roleName!==selected.roleName||base.functionName!==selected.functionName||base.requiresSponsorship!==selected.requiresSponsorship||JSON.stringify(base.titles)!==JSON.stringify(selected.titles)||selected.approvedFactIds.some(id=>!base.approvedFactIds.includes(id)))throw new ProfileError('Scout planning changed the saved professional profile context.',409);
  for(const kind of ['responsibilities','industries','skills','qualifications','functions'])if(selected[kind].some(term=>!base[kind].some(source=>source.term===term.term&&term.factIds.every(id=>source.factIds.includes(id)))))throw new ProfileError('Scout planning introduced a term outside the approved source context.',409);
  return selected;
}

/** @param {any} plan @param {any[]} audit @param {{stage?:string,context?:any,policy?:any,id?:string,at?:string,result?:any}} options */
export async function createScoutHandoffReceipt(plan,audit,{stage='preview',context,policy={},id=crypto.randomUUID(),at=new Date().toISOString(),result}={}){
  if(!['preview','dispatched','completed','failed'].includes(stage))throw new ProfileError('Invalid Scout handoff stage.');
  const selected=checkedContext(plan,context),queryPlan=planScoutQueries(selected,{now:at}),counts=plan.sourceSummary||{};
  const preferences=Object.fromEntries(preferenceKeys.filter(key=>Object.hasOwn(plan.criteria,key)).map(key=>[key,plan.criteria[key]]));
  const summary={questionnaireFactCount:counts.questionnaireFactCount||0,resumeFactCount:counts.resumeFactCount||0,approvedFactCount:counts.approvedFactCount||0,professionalFactCount:counts.professionalFactCount||0,sourceCategories:counts.sourceCategories||[],titles:selected.titles.map(t=>t.term),titleSources:selected.titles.map(t=>({term:t.term,sourceKind:t.sourceKind})),responsibilities:selected.responsibilities.map(t=>t.term),industries:selected.industries.map(t=>t.term),specialistSkills:selected.skills.map(t=>t.term),functionName:selected.functionName,qualifications:selected.qualifications.map(t=>t.term),preferences,gaps:{missingSearchContext:queryPlan.missing,unsupportedRoleRequirements:counts.unsupportedRoleRequirements||0,...(Number.isInteger(counts.unresolvedQuestionCount)?{unresolvedQuestionCount:counts.unresolvedQuestionCount}:{}),...(Number.isInteger(counts.pendingFactCount)?{pendingFactCount:counts.pendingFactCount}:{})},plannedRoutes:queryPlan.queries.map(q=>q.route),limits:SCOUT_LIMITS,recency:'7 days first, then 30 days if too few suitable recent matches',unknowns:'Unknown original dates and material eligibility gaps remain labeled for review'};
  const receipt={schemaVersion:1,id,stage,at,profileVersion:plan.selection.version,roleId:plan.selection.roleId,roleName:plan.roleName,planHash:await fingerprint({selection:plan.selection,context:selected,preferences}),snapshotId:counts.snapshotId||null,snapshotSavedAt:counts.snapshotSavedAt||null,summary,audit:clone(audit),policy:clone(policy)};
  if(plan.profileReceipt){
    if(plan.profileReceipt.profileVersion!==receipt.profileVersion||plan.profileReceipt.snapshotId!==receipt.snapshotId||!/^[a-f0-9]{64}$/.test(plan.profileReceipt.contentHash||''))throw new ProfileError('Master received a different saved profile version than the Scout handoff.',409);
    receipt.profileReceipt=clone(plan.profileReceipt);
  }
  if(result)receipt.result={jobs:result.jobs?.length||0,groups:(result.groups||[]).map(g=>({id:g.id,count:g.jobs?.length||0})),usage:result.usage||null,historySaved:result.scoutPolicy?.historySaved===true};
  return receipt;
}

export async function persistScoutHandoff(service,receipt){
  if(receipt.stage==='preview')throw new ProfileError('A Scout preview is not an executed handoff.',409);
  const stored=await service.saveScoutHandoff(receipt.profileVersion,clone(receipt));
  if(stored?.saved!==true||stored.id!==receipt.id||stored.profileVersion!==receipt.profileVersion||typeof stored.savedAt!=='string'||!Number.isFinite(Date.parse(stored.savedAt)))throw new ProfileError('The Scout handoff save did not confirm this profile and receipt. Try the search again.',503);
  return {...receipt,persistence:{saved:true,savedAt:stored.savedAt}};
}

// Production Master dispatch for discovery only. Matcher/Tailor/Critic and
// application storage remain separate work. Only Profile accesses memory.
export async function previewProfileScout(service,selection,searchRequirements={}){
  if(!selection||typeof selection.version!=='string'||!(selection.version==='current'||currentProfileVersion(selection.version)||/^profile-\d+$/.test(selection.version)))throw new ProfileError('Load your stored profile before searching.');
  const audit=[auditRoute('user','master','profile-search-request'),auditRoute('master','profile','approved-profile-request')];
  const result=await createProfileGraph({loadApprovedProfile:approvedProfileLoader(service,{requireCurrent:true})}).invoke({request:{savedProfileVersion:selection.version}});
  audit.push(...result.audit,auditRoute('profile','master','approved-profile-output'));
  if(result.outcome!=='approved')throw new ProfileError('Activate an approved profile before searching.',409);
  if(selection.version!=='current'&&result.facts.version!==selection.version)throw new ProfileError('The saved profile version does not match this handoff. Choose your active profile again.',409);
  // No resume text, contact fields or factual records leave Profile for Scout.
  const combined={...result.searchPreferences,...searchRequirements};
  const preferences=Object.fromEntries(allowed.filter(key=>Object.hasOwn(combined,key)&&['string','number','boolean'].includes(typeof combined[key])).map(key=>[key,typeof combined[key]==='string'?combined[key].slice(0,1000):combined[key]]));
  const searchProfile=result.searchProfile||result.snapshot?.searchProfile;
  const scoutContext=scoutContextFromSearchProfile(searchProfile);
  const records=result.facts.records||[],categories=new Map();for(const fact of records)categories.set(fact.category,(categories.get(fact.category)||0)+1);
  const sourceSummary={questionnaireFactCount:records.filter(f=>f.origin==='user_answer'&&!['personal','preferences'].includes(f.category)).length,resumeFactCount:records.filter(f=>f.origin!=='user_answer'&&!['personal','preferences'].includes(f.category)).length,approvedFactCount:records.filter(f=>f.approval==='approved').length,professionalFactCount:records.filter(f=>!['personal','preferences'].includes(f.category)).length,sourceCategories:[...categories].map(([category,count])=>({category,count})),snapshotId:result.snapshot?.id||null,snapshotSavedAt:result.snapshot?.createdAt||null,unsupportedRoleRequirements:result.consolidatedProfile?.counts?.missingRequirements||0,...(Number.isInteger(result.profileSummary?.unresolvedQuestionCount)?{unresolvedQuestionCount:result.profileSummary.unresolvedQuestionCount}:{}),...(Number.isInteger(result.profileSummary?.pendingFactCount)?{pendingFactCount:result.profileSummary.pendingFactCount}:{})};
  const plan={selection:{roleId:'master-profile',version:result.facts.version},roleName:searchProfile.label||'Validated professional profile',basis:'validated_source_data',keywords:[],scoutContext,sourceSummary,previousSeen:result.searchHistory||[],criteria:{...preferences,roles:scoutContext.titles.map(t=>t.term).join(', '),relatedKeywords:'',mode:'exact'}};
  const verified=result.profileSummary?.saveVerification;
  if(verified)plan.profileReceipt={snapshotId:verified.snapshotId,profileVersion:verified.profileVersion,contentHash:verified.contentHash,loadedAt:verified.verifiedAt};
  const handoff=await createScoutHandoffReceipt(plan,audit);
  return {plan,audit,handoff};
}

// Kept for injected graph clients. The HTTP path records the exact selected
// execution context after Scout planning, through Profile-owned persistence.
export async function dispatchProfileScout(service,selection,searchRequirements,scout){
  const preview=await previewProfileScout(service,selection,searchRequirements),{plan}=preview,audit=[...preview.audit];
  audit.push(auditRoute('master','scout','validated-profile-search-request'));
  const output=await scout(structuredClone(plan));
  if(output instanceof Response)return {output,audit,handoff:await createScoutHandoffReceipt(plan,audit,{stage:'dispatched'})};
  audit.push(auditRoute('scout','master','search-output'));
  const handoff=await createScoutHandoffReceipt(plan,audit,{stage:'completed',result:output});
  return {output,audit,handoff};
}
