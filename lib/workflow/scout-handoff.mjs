import {createProfileGraph} from './graph.mjs';
import {auditRoute} from './policy.mjs';
import {approvedProfileLoader} from '../profile/service.mjs';
import {ProfileError} from '../profile/domain.mjs';

// Production Master dispatch for discovery only. Matcher/Tailor/Critic and
// application storage remain separate work. Only Profile accesses memory.
export async function dispatchProfileScout(service,selection,searchRequirements,scout){
  if(!selection||typeof selection.roleId!=='string'||selection.roleId.length>180||typeof selection.version!=='string'||!/^profile-\d+$/.test(selection.version))throw new ProfileError('Choose an active approved role from Profile first.');
  const audit=[auditRoute('user','master','profile-search-request'),auditRoute('master','profile','approved-profile-request')];
  const result=await createProfileGraph({loadApprovedProfile:approvedProfileLoader(service,{requireCurrent:true})}).invoke({request:{savedProfileVersion:selection.version}});
  audit.push(...result.audit,auditRoute('profile','master','approved-profile-output'));
  if(result.outcome!=='approved')throw new ProfileError('Activate an approved profile before searching.',409);
  const role=result.roleProfiles.find(p=>p.id===selection.roleId);
  if(!role)throw new ProfileError('This role is not in your active approved profile. Return to Profile and choose again.',409);
  // No resume text, contact fields or factual records leave Profile for Scout.
  const allowed=['location','requiredKeywords','excludedKeywords','seniority','arrangement','employment','minSalary','currency','period','preferSponsorship','includeUnknown','searchDescriptions','includeUnverified','showClosed','maxAge','stream','batch','refresh'];
  const combined={...result.searchPreferences,...searchRequirements};
  const preferences=Object.fromEntries(allowed.filter(key=>Object.hasOwn(combined,key)).map(key=>[key,combined[key]]));
  const plan={selection:{roleId:role.id,version:result.facts.version},roleName:role.roleName,basis:role.basis||'jd',keywords:role.keywords,criteria:{...preferences,roles:role.roleName,relatedKeywords:'',mode:'exact'}};
  audit.push(auditRoute('master','scout','approved-role-search-request'));
  const output=await scout(structuredClone(plan));
  audit.push(auditRoute('scout','master','search-output'));
  return {output,audit};
}
