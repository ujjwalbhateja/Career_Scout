'use client';
import './completion.css';

export type HandoffReceipt={
  id:string;stage:string;at:string;profileVersion:string;roleId:string;roleName:string;planHash:string;snapshotSavedAt?:string;
  persistence?:{saved:boolean;savedAt?:string};
  summary:{questionnaireFactCount?:number;resumeFactCount?:number;approvedFactCount:number;professionalFactCount:number;sourceCategories:{category:string;count:number}[];titles:string[];responsibilities:string[];industries:string[];specialistSkills:string[];functionName:string;qualifications:string[];preferences:Record<string,unknown>;gaps:{missingSearchContext?:string[];unsupportedRoleRequirements?:number;unresolvedQuestionCount?:number;pendingFactCount?:number};plannedRoutes:string[];recency:string};
  audit?:{from:string;to:string;kind:string}[];result?:{jobs:number};
};
const routeLabels:Record<string,string>={titles:'Target and alternative job titles',responsibilities_industry:'Responsibilities and industry knowledge',skills_function:'Specialist skills, tools and function'};
export default function HandoffReview({handoff}:{handoff:HandoffReceipt}){
  const {summary,stage}=handoff;
  const terms=(label:string,values:string[])=> <div><dt>{label}</dt><dd>{values.length?values.join(' · '):'No approved source terms available'}</dd></div>;
  return <article className="cw-handoff-review" aria-label="Profile to Master to Scout handoff">
    <h3>{stage==='preview'?'What Master will send to Scout':stage==='completed'?'Scout research completed':stage==='failed'?'Scout research did not finish':'Master sent this profile to Scout'}</h3>
    <p><strong>{handoff.profileVersion}</strong> · {handoff.roleName}</p>
    <ol className="cw-handoff-path" aria-label="Agent handoff path"><li>Profile: saved evidence</li><li>Master: coordinates research</li><li>Scout: searches relevant vacancies</li></ol>
    <p>{summary.professionalFactCount} approved professional facts provide the search context. {summary.questionnaireFactCount??0} come from approved questionnaire answers and {summary.resumeFactCount??0} from resume evidence.</p>
    <dl>{terms('Titles present in resume or selected JD sources',summary.titles)}{terms('Responsibilities',summary.responsibilities)}{terms('Industry knowledge',summary.industries)}{terms('Specialist skills and tools',summary.specialistSkills)}{terms('Education and certifications',summary.qualifications)}
      <div><dt>Function</dt><dd>{summary.functionName||'Missing / Not Provided'}</dd></div>
      <div><dt>Location and preferences</dt><dd>{Object.entries(summary.preferences).filter(([,value])=>value!==''&&value!==false&&value!=null).map(([key,value])=>`${key.replace(/([A-Z])/g,' $1')}: ${String(value)}`).join(' · ')||'Open preferences'}</dd></div>
    </dl>
    <p><strong>Search routes:</strong> {[...new Set(summary.plannedRoutes)].map(route=>routeLabels[route]||route).join('; ')}.</p><p>{summary.recency}. Vacancy-specific eligibility is checked separately.</p>
    {!!summary.gaps.missingSearchContext?.length&&<div className="cw-handoff-gaps"><strong>Search context still missing</strong>{summary.gaps.missingSearchContext.map(gap=><p key={gap}>{gap}</p>)}</div>}
    {!!summary.gaps.unsupportedRoleRequirements&&<p>{summary.gaps.unsupportedRoleRequirements} role requirements remain unsupported and will be treated as gaps.</p>}
    <p role="status">{stage==='preview'?'Preview only. Start job research to dispatch this saved profile.':stage==='completed'?`${handoff.result?.jobs||0} vacancies returned for this profile.`:stage==='failed'?'The dispatched profile is recorded; review the search error and retry when ready.':'Scout is researching jobs using this context.'}{stage!=='preview'&&(handoff.persistence?.saved?' Dispatch receipt saved.':' Dispatch receipt could not be saved.')}</p>
    <details><summary>Source coverage and handoff record</summary><p>{summary.sourceCategories.map(item=>`${item.category.replaceAll('_',' ')}: ${item.count}`).join(' · ')}</p><p>Saved profile: {handoff.snapshotSavedAt?new Date(handoff.snapshotSavedAt).toLocaleString():'Date unavailable'}</p><p>Handoff: {handoff.at?new Date(handoff.at).toLocaleString():''}</p><small>Plan reference: {handoff.planHash}</small>{handoff.audit?.map((entry,i)=><p key={i}>{entry.from} → {entry.to}: {entry.kind.replaceAll('-',' ')}</p>)}</details>
  </article>;
}
