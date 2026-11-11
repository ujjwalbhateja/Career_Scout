'use client';

import {buildProfessionalExperience} from '@/lib/profile/professional-experience.mjs';
import './professional-experience.css';

type ExperienceItem={id:string;statement:string;questionnaireAddition?:boolean;employerRole?:string|null;period?:string|{start:string;end:string}|null};
type ExperienceRow={id:string;area:string;items:ExperienceItem[];highlights?:{statement:string;sourceItemId?:string;questionnaireAddition?:boolean}[]};
type ExperienceView={rows:ExperienceRow[]};

function periodLabel(period:ExperienceItem['period']){
  return typeof period==='string'?period:period?[period.start,period.end].filter(Boolean).join(' – '):'';
}

export default function ProfessionalExperience({state}:{state:unknown}){
  const view=buildProfessionalExperience(state) as unknown as ExperienceView;
  return <section id="professional-work-experience" tabIndex={-1} className="cw-professional-experience" aria-label="Professional work experience category">
    <h3>Professional work experience category</h3>
    <p>Main areas of work described in your résumé and questionnaire answers.</p>
    {!view.rows.length?<p>No work statements are available yet. They will appear here when a résumé with work experience is ingested.</p>:<div className="cw-professional-experience-scroll"><table>
      <thead><tr><th scope="col">Area</th><th scope="col">Source-supported experience</th></tr></thead>
      <tbody>{view.rows.map(row=>{
        const shown=row.highlights?.length?row.highlights:row.items.slice(0,2);
        const showDetails=row.items.some(item=>!shown.some(highlight=>highlight.statement===item.statement)||item.employerRole||item.period);
        return <tr key={row.id} id={'professional-area-'+row.id} tabIndex={-1}><th scope="row">{row.area}</th><td>
          {shown.map((item,index)=><p key={'id' in item?String(item.id):item.sourceItemId||row.id+':'+index}>{item.questionnaireAddition&&<><strong>Approved addition:</strong>{' '}</>}{item.statement}</p>)}
          {showDetails&&<details><summary>More experience</summary>{row.items.map(item=><article key={item.id}>
            <p>{item.statement}</p>
            {(item.employerRole||item.period)&&<p><small>{[item.employerRole,periodLabel(item.period)].filter(Boolean).join(' · ')}</small></p>}
          </article>)}</details>}
        </td></tr>;
      })}</tbody>
    </table></div>}
  </section>;
}
