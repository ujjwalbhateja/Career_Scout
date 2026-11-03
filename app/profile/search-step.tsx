'use client';
import {useState} from 'react';
import {ArrowUpRight,MapPin,Search,ShieldCheck} from 'lucide-react';
import Scout from '../scout';
import type {ApplicationJob} from '../applications';
import review from 'virtual:reviewed-shortlist';
import {safeJobLink} from '@/lib/search-session.mjs';
import './search-step.css';

export default function SearchStep({version,onPrepare}:{version:string;onPrepare:(job:ApplicationJob)=>void}){
  const [panel,setPanel]=useState<'review'|'search'>(review?'review':'search');
  return <div className="search-step">
    <div className="ss-heading"><div><p className="ss-eyebrow">YOUR PROFILE → MASTER → SCOUT</p><h2>Your next opportunities.</h2><p>Review the requirements, compare the roles, and search using your latest saved profile.</p></div><span className="ss-connected"><ShieldCheck size={16}/>Saved profile connected</span></div>
    {review&&<nav className="ss-tabs" aria-label="Step 4 results"><button aria-pressed={panel==='review'} onClick={()=>setPanel('review')}>Reviewed shortlist <span>{review.jobs.length}</span></button><button aria-pressed={panel==='search'} onClick={()=>setPanel('search')}><Search size={16}/>Search with my profile</button></nav>}
    {panel==='review'&&review&&<>
      <section className="ss-requirements" aria-label="Requirements used for reviewed shortlist"><div className="ss-section-title"><h3>Requirements used</h3><span>Research reviewed {review.reviewedOn}</span></div><dl>
        <div><dt>Role direction</dt><dd>{review.roles}</dd></div><div><dt>Locations</dt><dd>{review.location}</dd></div><div><dt>Minimum salary</dt><dd>$180,000 USD / year <small>Includes ranges that reach $180k; the offer is not guaranteed.</small></dd></div><div><dt>Visa preference</dt><dd>Exclude explicit sponsorship refusals <small>Unstated policies remain for review.</small></dd></div>
      </dl><p className="ss-disclosure">This is the earlier research snapshot, not a new automated search or a match score for your current profile. Open a posting to confirm availability and eligibility.</p></section>
      <div className="ss-section-title ss-results-title"><div><h3>{review.jobs.length} shortlisted opportunities</h3><p>Newest stated dates first · undated roles follow</p></div><button className="cw-secondary" onClick={()=>setPanel('search')}>Edit requirements & search</button></div>
      <p className="ss-disclosure">Posting dates may be updates or reposts. All sponsorship policies below are unstated; none is a confirmed sponsorship offer.</p>
      <ol className="ss-jobs">{review.jobs.map((job,index)=><li key={job.url}><article className="ss-job"><div className="ss-job-top"><span className="ss-rank">{String(index+1).padStart(2,'0')}</span><div><span className="ss-company">{job.company}</span><h3><a href={safeJobLink(job.url)} target="_blank" rel="noreferrer">{job.title}<ArrowUpRight size={18}/></a></h3><p className="ss-location"><MapPin size={14}/>{job.location}</p></div><span className="ss-date">{job.date?'Listed '+job.date:'Posting date not stated'}</span></div><div className="ss-job-meta"><strong>{job.salary}</strong><span>{job.salaryMin>=180000?'Full range meets minimum':'Upper range meets minimum'}</span><span>Sponsorship not stated</span></div><div className="ss-fit"><div><h4>Relevant areas</h4><p>{job.fit}</p></div><div><h4>Check before applying</h4><p>{job.gap}</p></div></div>{job.note&&<p className="ss-disclosure">{job.note} {job.salarySource&&<a href={safeJobLink(job.salarySource)} target="_blank" rel="noreferrer">Salary source</a>}</p>}<a className="ss-source" href={safeJobLink(job.url)} target="_blank" rel="noreferrer">View employer posting <ArrowUpRight size={15}/></a></article></li>)}</ol>
    </>}
    <div hidden={panel!=='search'}><Scout embedded profileSelection={{roleId:'master-profile',version}} initialCriteria={review?{location:'New York, New Jersey, San Francisco Bay Area, US remote',minSalary:'180000',currency:'USD',period:'year',arrangement:'any',onWorkVisa:true}:undefined} onPrepare={onPrepare}/></div>
  </div>;
}
