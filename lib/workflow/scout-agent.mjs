import {generateAgentJSON} from '../profile/providers.mjs';
import {normalizeScoutContext} from './scout-policy.mjs';
import {digest} from '../profile/domain.mjs';

// Select only source-checked professional terms; never send a resume or contacts.
export async function prioritizeScoutContext(context,prompt,env,{generate=generateAgentJSON}={}){
  const base=normalizeScoutContext(context),kinds=['responsibilities','industries','skills','qualifications'];
  const metadata={promptSource:'agents/scout/prompt.md',promptHash:await digest(prompt||''),modelPlanning:false};
  if(!env.GEMINI_API_KEY||!prompt||!kinds.some(k=>base[k].length))return {context:base,policy:metadata};
  const properties=Object.fromEntries(kinds.map(k=>[k,{type:'ARRAY',items:{type:'STRING'}}]));
  let selected;
  try{selected=await generate(env,{instructions:prompt+'\nCURRENT STAGE: select relevant supplied approved search terms from the saved professional profile, across responsibilities/industry and specialist skills/function. Return exact supplied strings only in the four arrays. Source titles are literal employment titles or selected employer JD titles; a selected JD title is a search target, never evidence of user experience. Titles/functions may be absent: use approved responsibilities and skills without inventing a role, alternative title or function. Do not create qualifications, facts or vacancies. Only configured provider discovery can return actual job openings. Bounded code performs discovery, recency, verification and duplicate checks after this planning step.',input:{titles:base.titles.map(t=>t.term),titleSources:base.titles.map(t=>({term:t.term,sourceKind:t.sourceKind})),functions:base.functions.map(t=>t.term),candidates:Object.fromEntries(kinds.map(k=>[k,base[k].map(t=>t.term)]))},schema:{type:'OBJECT',properties,required:kinds}});}
  catch{return {context:base,policy:{...metadata,planningWarning:'Scout term selection could not finish; source-checked terms and bounded search rules are used.'}};}
  const narrowed={...base};
  for(const kind of kinds){const matches=base[kind].filter(t=>Array.isArray(selected[kind])&&selected[kind].includes(t.term));narrowed[kind]=matches.length?matches:base[kind];}
  return {context:narrowed,policy:{...metadata,modelPlanning:true}};
}
