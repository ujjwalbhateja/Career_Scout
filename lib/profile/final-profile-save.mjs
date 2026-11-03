// Orchestrates checks only. This module cannot approve facts or call a model.
import {canonicalJSON,digest,approvedFacts,builderReviewCurrentForDocument,finalizationReadiness} from './domain.mjs';
import {builderSourceRecords,currentSourceComparison} from './builder-source-coverage.mjs';
import {QUESTIONNAIRE_POLICY} from './builder-question-policy.mjs';
import {primaryJDSegments} from './jd-content.mjs';
import {finalProfileInputBlockers} from './final-profile-integrity.mjs';

export const AUTOMATIC_FINAL_CHECKS=new Set(['selected_jd_analysis_pending','builder_comparison_required']);
export async function comparisonSaveBasis(s,documentIds,promptHash){
  const contextHash=await digest(canonicalJSON({version:1,promptHash,policy:QUESTIONNAIRE_POLICY,sources:builderSourceRecords(s),approvedFacts:approvedFacts(s),answers:s.answers,decisions:s.builderExpansion?.decisions||[],disclosure:s.preferences.disclosure||[]}));
  const documents=await Promise.all(documentIds.map(async id=>{
    const d=s.documents.find(d=>d.id===id&&!d.deleted);
    return {id,hash:await digest(canonicalJSON({document:d?{id:d.id,version:d.version,hash:d.hash,analysis:d.analysis,roleName:d.roleName,segments:primaryJDSegments(d.segments)}:null,requirements:s.requirements.filter(r=>r.documentId===id)}))};
  }));
  return {version:1,contextHash,documents};
}
export async function finalProfileSavePlan(s,promptHash){
  const docs=s.documents.filter(d=>d.kind==='jd'&&d.selected&&!d.deleted),ids=docs.map(d=>d.id),basis=await comparisonSaveBasis(s,ids,promptHash),records=builderSourceRecords(s);
  const staleDocumentIds=[],reviews=[],comparisonBlockers=[];
  for(const document of docs){
    const review=(s.builderReviews||[]).findLast(r=>r.jdIds?.includes(document.id)),requirements=s.requirements.filter(r=>r.documentId===document.id);
    const current=review&&builderReviewCurrentForDocument(s,review,document.id)&&review.comparisonSaveBasis?.contextHash===basis.contextHash&&review.comparisonSaveBasis?.documents?.some(d=>d.id===document.id&&d.hash===basis.documents.find(b=>b.id===document.id).hash)&&requirements.length>0&&requirements.every(r=>review.mappings?.some(m=>m.requirementId===r.id)&&currentSourceComparison(r,review.sourceComparisons?.find(c=>c.requirementId===r.id),records));
    if(!current){staleDocumentIds.push(document.id);continue;}
    reviews.push(review);
    if(requirements.some(r=>review.sourceComparisons.find(c=>c.requirementId===r.id)?.status==='unresolved'))comparisonBlockers.push({code:'comparison_unresolved',documentId:document.id,message:'A job comparison could not be validated. Review the comparison needing clarification before saving the Final Profile.'});
  }
  const original=finalizationReadiness(s),extra=finalProfileInputBlockers(s);
  const readiness={...original,ready:original.ready&&!extra.length,blockers:[...extra,...original.blockers]};
  return {basis,staleDocumentIds,reviews:[...new Set(reviews)],comparisonBlockers,readiness,manualBlockers:readiness.blockers.filter(b=>!AUTOMATIC_FINAL_CHECKS.has(b.code))};
}
