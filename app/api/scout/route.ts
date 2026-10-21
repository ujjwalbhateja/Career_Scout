import { search, importLink, normalize, safeURL } from '@/lib/scout.mjs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const headers={'Cache-Control':'private, no-store','Content-Type':'application/json'};
  const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
  const origin=request.headers.get('origin');
  if(!origin || origin!==new URL(request.url).origin)return reply({error:'Use the Scout form on this site.'},403);
  if(Number(request.headers.get('content-length'))>150000)return reply({error:'Request is too large.'},413);
  try {
    const raw=await request.text();if(raw.length>150000)return reply({error:'Request is too large.'},413);
    const body=JSON.parse(raw);
    if(body.action==='search')return reply(await search(body));
    if(body.action==='import'){
      const result=await importLink(String(body.url||'').slice(0,3000));
      const total=result.jobs.length;
      return reply({...result,jobs:result.jobs.slice(0,30),totalFound:total,message:total>30?`${total} roles found; the first 30 were imported. The company board is added to Sources so you can search it with your criteria.`:result.message});
    }
    if(body.action==='paste') {
      if(typeof body.description!=='string'||body.description.trim().length<80)return reply({error:'Paste at least 80 characters of the actual job description.'},400);
      if(typeof body.title!=='string'||!body.title.trim())return reply({error:'Enter the job title.'},400);
      const url=body.url?safeURL(body.url).href:'';
      return reply({jobs:[normalize({source:'Manual import',title:body.title,company:body.company,location:body.location,description:body.description,url,imported:true,provenance:'Description pasted by you; not independently verified'})],message:'Job imported from your pasted description.',links:[]});
    }
    return reply({error:'Unknown action.'},400);
  }catch(error){return reply({error:error instanceof Error?error.message:'Request could not be completed.'},400);}
}
