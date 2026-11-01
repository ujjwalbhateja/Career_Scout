// Profile-owned review of Builder proposals. JD text never becomes fact evidence.
import {buildExperienceReviewRows} from './experience-review.mjs';
import {ProfileError,canonicalJSON,digest,id,now,norm,approvedFacts,addDocument,proposeFacts,decideFacts,invalidateProfileSnapshots} from './domain.mjs';
import {builderSourceRecords,currentSourceComparison,builderArea} from './builder-source-coverage.mjs';

const list=value=>Array.isArray(value)?value:[];
const same=(a,b)=>norm(a).replace(/[.!?]+$/,'')===norm(b).replace(/[.!?]+$/,'');
const active=f=>f.lifecycle==='active';
const specific=value=>typeof value==='string'&&value.trim().length>=3&&value.length<=1800&&!/^(?:yes|no|somewhat|confirmed|i can|i have|not sure)[.!\s]*$/i.test(value)&&!/\s+or\s+/i.test(value);
const skillField=value=>/^(?:python|sql|r|vba|java|javascript|typescript|c\+\+|c#)$/i.test(value.trim())?'programming_languages':/\b(?:excel|power bi|tableau|sap|salesforce|bloomberg|power query)\b/i.test(value)?'tools_technologies':'other_skills';
const latest=s=>{const rows=new Map();for(const d of list(s.builderExpansion?.decisions)){rows.delete(d.rowId);rows.set(d.rowId,d);}return [...rows.values()];};
function supported(s,statement,category){
  return approvedFacts(s).find(f=>f.category===category&&same(f.statement,statement)&&list(s.approvals).some(a=>a.id===f.approvalRef&&a.recordId===f.id&&a.recordVersion===f.version&&a.decision==='approved')&&f.evidence?.length&&f.evidence.every(e=>s.documents.some(d=>!d.deleted&&['resume','answer'].includes(d.kind)&&d.id===e.documentId&&(e.documentVersion==null||e.documentVersion===d.version)&&d.segments.some(p=>p.id===e.segmentId&&p.text.includes(e.quote)))));
}
function decisionFor(s,row){
  return latest(s).findLast(d=>d.rowId===row.id)||latest(s).findLast(d=>d.category===row.category&&same(d.originalStatement,row.proposedStatement)&&(['approved','rejected'].includes(d.status)||d.documentId===row.documentId&&d.status==='awaiting_approval'));
}

function groupRelatedQuestions(s,rows){
  const groups=new Map(),result=[];
  for(const row of rows){
    if(row.coveragePercent==null||row.status!=='pending'||row.draftVersion){result.push(row);continue;}
    const key=row.section+'|'+row.area+'|'+(row.category==='skills'?skillField(row.proposedStatement):'work');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  for(const [key,items] of groups){
    if(items.length<2){result.push(...items);continue;}
    const statements=[...new Set(items.map(r=>r.proposedStatement))],statement=statements.join('; ');
    if(statement.length>1800){result.push(...items);continue;}
    const union=name=>[...new Map(items.flatMap(r=>r[name]||[]).map(v=>[canonicalJSON(v),v])).values()];
    const row={...items[0],id:items[0].documentId+'::topic:'+encodeURIComponent(key),proposedStatement:statement,groupedStatements:statements,skillStorageField:items[0].category==='skills'?skillField(items[0].proposedStatement):null,requirementIds:union('requirementIds'),parentQuestionIds:union('parentQuestionIds'),questionIds:union('questionIds'),sourceQuotes:union('sourceQuotes'),originalRequirementTexts:union('originalRequirementTexts'),recordedStatements:union('recordedStatements'),requiresDetails:items.some(r=>r.requiresDetails),coveragePercent:null,coverageEstimates:union('coverageEstimates'),comparisonExplanation:[...new Set(items.map(r=>r.comparisonExplanation))].join(' ')};
    const decision=decisionFor(s,row),existing=supported(s,statement,row.category);
    row.status=existing?'already_supported':decision?.status==='approved'&&!supported(s,decision.statement,row.category)?'needs_review':decision?.status||'pending';
    row.revisionText=decision?.revisionText||'';row.draftVersion=decision?.version||0;row.factRefs=decision?.factRefs||[];row.approvedStatement=decision?.status==='approved'?decision.statement:'';
    row.fingerprint=canonicalJSON({id:row.id,children:items.map(r=>r.fingerprint),decision:decision?{id:decision.id,version:decision.version,status:decision.status}:null});
    if(row.fingerprint.length>190000){result.push(...items);continue;}
    result.push(row);
  }
  return result;
}

export function builderQuestionnaireScope(s){
  const selected=s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted).map(d=>d.id);
  const reviews=list(s.builderReviews);
  const newDocumentIds=selected.filter(id=>!reviews.some(review=>list(review.jdIds).includes(id)));
  const recent=reviews.findLast(review=>list(review.jdIds).some(id=>selected.includes(id)));
  return {newDocumentIds,activeDocumentIds:newDocumentIds.length?newDocumentIds:recent?recent.jdIds.filter(id=>selected.includes(id)):selected};
}

export function buildRoleQuestionnaires(s){
  const selected=s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted);
  const sourceRecords=builderSourceRecords(s);
  const approved=approvedFacts(s).filter(f=>!['personal','preferences'].includes(f.category)).map(f=>({id:f.id,version:f.version,approvalRef:f.approvalRef,statement:f.statement}));
  return selected.map(document=>{
    const review=list(s.builderReviews).findLast(r=>r.jdIds?.includes(document.id));
    const scoped={...s,documents:s.documents.map(d=>({...d,selected:d.id===document.id})),builderReviews:review?[{...review,jdIds:[document.id]}]:[]};
    const coverage=new Map(s.requirements.filter(r=>r.documentId===document.id).map(r=>[r.id,currentSourceComparison(r,list(review?.sourceComparisons).find(c=>c.requirementId===r.id),sourceRecords)]));
    // Narrow only discovery questions; approved mappings and profile facts stay intact.
    scoped.requirements=s.requirements.flatMap(r=>{
      const c=coverage.get(r.id);
      if(['covered','unresolved'].includes(c?.status))return [];
      if(['skip_minor','defer_incidental'].includes(c?.questionPolicy?.disposition))return [];
      return c?.status==='partial'?c.missingScopes.map(text=>({...r,text})):[r];
    });
    if(scoped.builderReviews[0])scoped.builderReviews[0]={...scoped.builderReviews[0],mappings:list(review.mappings).filter(m=>!coverage.get(m.requirementId))};
    const rows=buildExperienceReviewRows(scoped,{splitCompounds:false}).filter(r=>!['qualification'].includes(r.kind)&&!['education','certifications'].includes(r.category)).map(r=>{
      const comparison=r.requirementIds.map(id=>coverage.get(id)).find(Boolean);
      const row={...r,id:document.id+'::'+r.id,documentId:document.id,category:r.category==='skills'?'skills':'experience_claims',section:r.category==='skills'?'skills':'experience',area:comparison?.area||builderArea(r.proposedStatement)};
      if(comparison){
        row.comparisonExplanation=comparison.explanation;row.recordedStatements=comparison.records.map(record=>record.statement);
        if(comparison.questionPolicy){row.coveragePercent=comparison.questionPolicy.coveragePercent;row.coverageEstimates=[{requirementId:comparison.requirementId,percent:comparison.questionPolicy.coveragePercent,criticalGap:comparison.questionPolicy.criticalGap,components:comparison.questionPolicy.components}];}
        // A narrowed fragment is read beside the complete employer requirement.
        const originals=s.requirements.filter(requirement=>r.requirementIds.includes(requirement.id));
        row.originalRequirementTexts=originals.map(requirement=>requirement.text);
        row.sourceQuotes=originals.flatMap(requirement=>requirement.evidence);
      }
      const decision=decisionFor(s,row),existing=supported(s,row.proposedStatement,row.category);
      row.status=existing?'already_supported':decision?.status==='approved'&&!supported(s,decision.statement,row.category)?'needs_review':decision?.status||(['declined'].includes(r.status)?'rejected':'pending');
      row.revisionText=decision?.revisionText||'';row.draftVersion=decision?.version||0;row.factRefs=decision?.factRefs||[];
      row.approvedStatement=decision?.status==='approved'?decision.statement:'';
      row.fingerprint=canonicalJSON({schemaVersion:1,id:row.id,proposal:r.fingerprint,approved,sourceComparison:comparison||null,decision:decision?{id:decision.id,version:decision.version,status:decision.status}:null});
      return row;
    });
    rows.splice(0,rows.length,...groupRelatedQuestions(s,rows));
    // Keep completed decisions visible when the now-supported proposal disappears.
    for(const decision of latest(s).filter(d=>d.documentId===document.id)){
      if(rows.some(r=>r.id===decision.rowId)||!['approved','rejected'].includes(decision.status))continue;
      rows.push({...decision.row,id:decision.rowId,status:decision.status==='approved'&&!supported(s,decision.statement,decision.category)?'needs_review':decision.status,approvedStatement:decision.statement||'',revisionText:decision.revisionText||'',draftVersion:decision.version,fingerprint:'',factRefs:decision.factRefs||[],historyOnly:true});
    }
    const recorded=s.requirements.filter(r=>r.documentId===document.id&&coverage.get(r.id)?.status==='covered').map(r=>({requirement:r.text,area:coverage.get(r.id).area,statements:coverage.get(r.id).records.map(record=>record.statement)}));
    const unresolved=s.requirements.filter(r=>r.documentId===document.id&&coverage.get(r.id)?.status==='unresolved').map(r=>({requirement:r.text,area:builderArea(r.text),explanation:coverage.get(r.id).explanation}));
    for(const requirement of s.requirements.filter(r=>r.documentId===document.id&&r.category==='qualification'&&coverage.get(r.id)?.questionPolicy?.criticalGap))unresolved.push({requirement:requirement.text,area:'Required qualification',explanation:'This important qualification is not established by the saved profile. Review it in your factual records; it cannot be added as work experience or a skill.'});
    const skipped=s.requirements.filter(r=>r.documentId===document.id&&['skip_minor','defer_incidental'].includes(coverage.get(r.id)?.questionPolicy?.disposition)).map(r=>{const c=coverage.get(r.id);return {requirement:r.text,area:c.area,percent:c.questionPolicy.coveragePercent,reason:c.questionPolicy.disposition,unconfirmed:c.questionPolicy.components.filter(x=>!x.matched).map(x=>x.scope),statements:c.records.map(x=>x.statement)};});
    return {documentId:document.id,title:document.roleName||document.title,analysis:document.analysis,recorded,skipped,unresolved,experience:rows.filter(r=>r.section==='experience'),skills:rows.filter(r=>r.section==='skills')};
  });
}

function submission(body){
  if(typeof body.submissionId!=='string'||!/^[-\w]{8,80}$/.test(body.submissionId)||!Array.isArray(body.rows)||!body.rows.length||body.rows.length>100)throw new ProfileError('Select 1â€“100 review rows with a valid submission ID.');
  const seen=new Set();
  const rows=body.rows.map(r=>{
    if(!r||typeof r.rowId!=='string'||seen.has(r.rowId)||typeof r.fingerprint!=='string'||!r.fingerprint||r.fingerprint.length>200000||!['approve','reject','somewhat','approve_revision'].includes(r.decision))throw new ProfileError('Invalid role review decision.');
    if(r.text!=null&&(typeof r.text!=='string'||r.text.length>1800))throw new ProfileError('Keep revised wording within 1,800 characters.');
    seen.add(r.rowId);return {rowId:r.rowId,fingerprint:r.fingerprint,decision:r.decision,text:r.text?.trim()||'',draftVersion:r.draftVersion??null,reopen:r.reopen===true};
  });
  return {submissionId:body.submissionId,rows};
}
export async function replayBuilderReview(s,body){
  const input=submission(body),saved=list(s.builderExpansion?.submissions).find(r=>r.submissionId===input.submissionId);
  if(!saved)return null;
  if(saved.hash!==await digest(canonicalJSON(input)))throw new ProfileError('This submission ID was already used for different decisions.',409);
  return structuredClone(saved.result);
}
function opposition(a,b){
  const normalize=t=>norm(t).replace(/\b(?:don't|didn't|haven't|can't|cannot)\b/g,'not').replace(/[^\p{L}\p{N} ]/gu,'');
  const strip=t=>normalize(t).replace(/\b(?:i|we|have|has|had|do|did|not|never|no)\b/g,'').replace(/\s+/g,' ').trim();
  return /\b(?:not|never|no)\b/.test(normalize(a))!==/\b(?:not|never|no)\b/.test(normalize(b))&&strip(a)===strip(b);
}
export async function applyBuilderReview(s,body,actor,{revision}={}){
  const replay=await replayBuilderReview(s,body);if(replay)return replay;
  if(!actor||s.deletion)throw new ProfileError('An active authenticated profile is required.',409);
  if(revision!==body.revision)throw new ProfileError('Your profile changed. Reload the role questionnaires.',409);
  const input=submission(body),visible=buildRoleQuestionnaires(s).flatMap(g=>[...g.experience,...g.skills]);
  const decisions=input.rows.map(request=>{
    const row=visible.find(r=>r.id===request.rowId);
    if(!row||row.historyOnly||row.fingerprint!==request.fingerprint)throw new ProfileError('The role proposal changed. Review the current wording before submitting.',409);
    if(['approved','already_supported'].includes(row.status))throw new ProfileError('This statement is already supported. Existing approvals are preserved.',409);
    if(row.status==='rejected'&&request.decision!=='reject'&&!request.reopen)throw new ProfileError('Explicitly reopen the rejected item before changing it.',409);
    if(request.decision==='approve'&&(row.requiresDetails||row.status==='awaiting_approval'))throw new ProfileError('Review and approve the revised wording separately.',409);
    if(request.decision==='approve'&&request.text&&request.text!==row.proposedStatement)throw new ProfileError('Approve confirms exactly the displayed statement.',409);
    if(request.decision==='somewhat'&&(!specific(request.text)||same(request.text,row.proposedStatement)))throw new ProfileError('Enter the specific, revised wording you can confirm. It will remain a draft.');
    if(request.decision==='approve_revision'&&(row.status!=='awaiting_approval'||request.draftVersion!==row.draftVersion||request.text!==row.revisionText))throw new ProfileError('The draft changed. Approve the exact saved revision.',409);
    return {request,row};
  });
  const draft=structuredClone(s);draft.builderExpansion||={decisions:[],submissions:[]};const outcomes=[];
  for(const {request,row} of decisions){
    const at=now(),status=request.decision==='reject'?'rejected':request.decision==='somewhat'?'awaiting_approval':'approved';
    const statement=status==='approved'?(request.decision==='approve_revision'?row.revisionText:row.proposedStatement):'';
    const decision={id:id('builder_decision'),rowId:row.id,documentId:row.documentId,category:row.category,originalStatement:row.proposedStatement,status,statement,revisionText:request.decision==='somewhat'?request.text:row.revisionText,version:row.draftVersion+1,at,actor,row:structuredClone(row),factRefs:[],submissionId:input.submissionId};
    if(status==='approved'){
      if(!specific(statement))throw new ProfileError('This claim needs specific wording before approval.');
      const conflicts=draft.facts.filter(active).some(f=>opposition(f.statement,statement)||same(f.statement,statement)&&(f.conflict||['rejected','withdrawn'].includes(f.approval)));
      if(conflicts)throw new ProfileError('This statement conflicts with an existing fact or decision. Resolve it before adding it.',409);
      let fact=supported(draft,statement,row.category);
      if(!fact){
        const documentId=id('builder_confirmation'),segmentId=documentId+'.p1';
        addDocument(draft,{id:documentId,kind:'answer',title:'User-approved Profile Builder statement',selected:false,hash:await digest(statement),segments:[{id:segmentId,text:statement,locator:'Explicit approval of role review wording'}]});
        const source=draft.documents.at(-1);source.analysis='complete';source.confirmationActor=actor;
        const added=await proposeFacts(draft,[{category:row.category,field:row.category==='skills'?(request.decision==='approve'?row.skillStorageField||skillField(statement):skillField(statement)):'builder_experience',scope:'Self-confirmed capability: '+row.id,statement,evidence:[{documentId,segmentId,quote:statement}]}],'user_answer');
        fact=added[0];if(!fact)throw new ProfileError('This confirmation could not be saved safely.',409);
        fact.originatingRequirements=[...row.requirementIds];fact.builderDecisionId=decision.id;
        decideFacts(draft,[{id:fact.id,version:fact.version,decision:'approved'}],actor);
      }
      decision.factRefs=[{id:fact.id,version:fact.version,approvalRef:fact.approvalRef}];
    }
    draft.builderExpansion.decisions.push(decision);outcomes.push({rowId:row.id,status,statement,revisionText:decision.revisionText,version:decision.version,factRefs:decision.factRefs,decisionId:decision.id});
  }
  // Existing question gates use explicit decisions; draft revisions remain deferred,
  // never answered or factual. A remaining unanswered sibling still blocks completion.
  const remaining=buildRoleQuestionnaires(draft).flatMap(g=>[...g.experience,...g.skills]);
  for(const q of draft.questions){
    const related=remaining.filter(r=>r.requirementIds?.some(id=>(q.requirementIds||[q.requirementId]).includes(id)));
    if(!related.length)continue;
    if(related.some(r=>r.status==='pending'))continue;
    q.status=related.some(r=>r.status==='awaiting_approval')?'deferred':related.every(r=>r.status==='rejected')?'declined':'answered';
  }
  if(outcomes.some(o=>o.status==='approved'))invalidateProfileSnapshots(draft,'Approved Builder experience or skills changed. Refresh the comparison and save the Final Profile.');
  const result={kind:'builder_review_saved',saved:true,submissionId:input.submissionId,rows:outcomes};
  draft.builderExpansion.submissions.push({submissionId:input.submissionId,hash:await digest(canonicalJSON(input)),result:structuredClone(result),at:now()});
  Object.assign(s,draft);return result;
}

export function builderReviewReceiptMatches(record,body){
  const result=record?.result;
  if(result?.kind!=='builder_review_saved'||!result.saved||result.submissionId!==body.submissionId||result.rows?.length!==body.rows?.length)return false;
  return body.rows.every(request=>{
    const item=result.rows.find(r=>r.rowId===request.rowId),saved=latest(record.state).find(d=>d.id===item?.decisionId);
    if(!item||!saved||saved.submissionId!==body.submissionId||saved.status!==item.status)return false;
    const expected=request.decision==='somewhat'?'awaiting_approval':request.decision==='reject'?'rejected':'approved';
    if(item.status!==expected)return false;
    if(item.status!=='approved')return !item.factRefs.length&&(request.decision!=='somewhat'||item.revisionText===request.text?.trim());
    return item.factRefs.length>0&&item.factRefs.every(ref=>record.state.facts.some(f=>f.id===ref.id&&f.version===ref.version&&f.approval==='approved'&&f.approvalRef===ref.approvalRef&&same(f.statement,item.statement)));
  });
}
