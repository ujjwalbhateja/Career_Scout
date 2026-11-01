'use client';
export type BuilderReviewData={id:string;createdAt:string;jdIds:string[];factRefs:{id:string;version:number}[];profileIds?:string[];requirements:number;supported:number;missing:number;questionIds:string[];unaskedRequirements:number;unassessedRequirementIds?:string[];basis?:string;mappings?:{requirementId:string;assessment:string;explanation:string;factRefs:{id:string;version:number}[]}[]};
type Document={id:string;title:string;analysis:string};
type Requirement={id:string;documentId?:string;text:string;importance:string};
export default function BuilderReview({documents,requirements,review,pendingQuestions,onQuestions}:{documents:Document[];requirements:Requirement[];review?:BuilderReviewData;pendingQuestions:number;onQuestions:()=>void}){
  if(!documents.length)return null;
  const matches=!!review&&JSON.stringify([...review.jdIds].sort())===JSON.stringify(documents.map(d=>d.id).sort());
  return <section className="cw-builder-review" aria-label="Profile Builder JD analysis">
    <h3>Profile Builder’s review of your JDs</h3>
    <p>{documents.filter(d=>d.analysis==='complete').length} of {documents.length} selected job descriptions analyzed.{!matches?' Run “Analyze JDs & compare experience” to compare this set with your approved experience.':''}</p>
    <ul>{documents.map(d=><li key={d.id}><strong>{d.title}</strong><span>{d.analysis==='complete'?requirements.filter(r=>r.documentId===d.id).length+' requirements extracted':'Waiting for analysis'}</span></li>)}</ul>
    {matches&&<><div className="cw-review-counts"><span><strong>{review.requirements}</strong> requirements compared</span><span><strong>{review.supported}</strong> with profile evidence</span><span><strong>{review.missing}</strong> missing experience or qualifications</span></div>
      <p>{pendingQuestions?`${pendingQuestions} missing-experience rows need your decision. Use Approve, Decline or Somewhat in the table.`:review.missing?'Your previous responses are saved. Any unsupported requirements remain gaps until supported facts are approved.':'No missing experience was identified in this comparison.'}</p>
      {!!review.unassessedRequirementIds?.length&&<p>{review.unassessedRequirementIds.length} requirements still need an evidence assessment. They remain gaps for your review.</p>}
      {review.unaskedRequirements>0&&<p>{review.unaskedRequirements} gaps remain available in the JD review table, subject to your earlier decisions and disclosure preferences.</p>}
      {review.questionIds.length>0&&<button className="cw-secondary" onClick={onQuestions}>Review missing experience ({pendingQuestions})</button>}
    </>}
  </section>;
}
