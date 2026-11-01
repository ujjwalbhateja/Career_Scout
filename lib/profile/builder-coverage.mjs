import {ProfileError} from './domain.mjs';

// Account for omitted requirements conservatively. This never invents support:
// unassessed requirements get empty evidence refs and enter the gap interview.
// Malformed/unknown references still fail domain validation before persistence.
export function completeBuilderCoverage(result,context){
  if(!Array.isArray(result.profiles)||!Array.isArray(result.questions))throw new ProfileError('Profile Builder returned an invalid comparison.',502);
  const output=structuredClone(result),requirements=context.requirements;
  if(!output.profiles.length){
    output.profiles=[{roleName:context.selectedJDs[0]?.roleName||'Selected JD requirements review',summary:'Requirements review only. Suitability is not established until supported experience is reviewed.',keywords:[],mappings:[]}];
  }
  for(const profile of output.profiles)if(!Array.isArray(profile.mappings))throw new ProfileError('Profile Builder omitted the requirement mapping structure.',502);
  const seen=new Set(output.profiles.flatMap(p=>p.mappings.map(m=>m.requirementId)));
  const byId=new Map(requirements.map(r=>[r.id,r]));
  const missing=requirements.filter(r=>!seen.has(r.id));
  for(const requirement of missing){
    const role=context.selectedJDs.find(d=>d.id===requirement.documentId)?.roleName;
    const profile=output.profiles.find(p=>p.roleName===role)||output.profiles.find(p=>p.mappings.some(m=>byId.get(m.requirementId)?.documentId===requirement.documentId))||output.profiles[0];
    profile.mappings.push({requirementId:requirement.id,factIds:[],explanation:'Evidence has not been assessed for this requirement. Your experience or qualification needs review.'});
  }
  return {output,unassessedRequirementIds:missing.map(r=>r.id)};
}
