import {safeURL,assertPublicHost,extractJobs,text} from '../scout.mjs';
import {extractDocument} from './extraction.mjs';
import {ProfileError,LIMITS,id,digest} from './domain.mjs';

// Public sources only. Validate every redirect before contacting its destination;
// never forward visitor cookies, provider credentials or a browser session.
export async function readJDLink(value){
  let url;try{url=safeURL(value);}catch{throw new ProfileError('Enter a public HTTPS job-description link.');}
  const documentId=id('doc');
  try{
    for(let n=0;n<4;n++){
      await assertPublicHost(url.hostname);
      const response=await fetch(url.href,{redirect:'manual',headers:{Accept:'text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain','User-Agent':'CareerScout/1.0'},signal:AbortSignal.timeout(20000)});
      if(response.status>=300&&response.status<400){const target=response.headers.get('location');if(!target)throw new ProfileError('The page redirected without a destination. Upload the JD instead.');try{url=safeURL(new URL(target,url).href);}catch{throw new ProfileError('This link redirects to an unsupported address. Upload the JD instead.');}continue;}
      if(!response.ok)throw new ProfileError('The job page could not be read (HTTP '+response.status+'). Upload the JD or paste its text instead.');
      const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if(!['text/html','application/xhtml+xml','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'].includes(mime))throw new ProfileError('Use a readable job page, PDF, DOCX or TXT link.');
      const limit=mime.includes('html')?2500000:LIMITS.fileBytes;
      if(Number(response.headers.get('content-length'))>limit)throw new ProfileError('The linked document is too large. Upload a smaller JD.');
      const reader=response.body?.getReader();if(!reader)throw new ProfileError('The linked page is empty.');
      const pieces=[];let size=0;
      try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw new ProfileError('The linked document is too large.');pieces.push(part.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}
      const bytes=new Uint8Array(size);let at=0;for(const part of pieces){bytes.set(part,at);at+=part.length;}
      let parsed,title;
      if(mime.includes('html')){
        const html=new TextDecoder().decode(bytes),jobs=extractJobs(html,url.href);
        if(jobs.length>1)throw new ProfileError('This page lists multiple jobs. Use the link to one specific role.');
        const stripped=html.replace(/<(script|style|nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
        const body=stripped.match(/<(?:main|article)\b[^>]*>([\s\S]*?)<\/(?:main|article)>/i)?.[1]||stripped.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]||stripped;
        const content=jobs[0]?.description||text(body);
        if(content.length<100||/^(?:access denied|verify you are human|just a moment|sign in to continue)/i.test(content.trim())||!/(responsibil|qualificat|requirements|experience|job description|about the role)/i.test(content))throw new ProfileError('This page does not expose a readable JD. Upload the document or paste its text instead.');
        if(content.length>LIMITS.textChars)throw new ProfileError('The job page is too long. Upload just the job description.');
        title=jobs[0]?.title||text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||url.hostname).slice(0,180);
        parsed=await extractDocument(new TextEncoder().encode(content),{name:'linked-jd.txt',mime:'text/plain',documentId});
      }else{
        const ext=mime==='application/pdf'?'pdf':mime==='text/plain'?'txt':'docx';
        title=decodeURIComponent(url.pathname.split('/').pop()||'Linked job description').slice(0,180);
        parsed=await extractDocument(bytes,{name:'linked-jd.'+ext,mime,documentId});
      }
      return {id:documentId,kind:'jd',title,hash:await digest(parsed.segments.map(p=>p.text).join('\n')),segments:parsed.segments,selected:true,sourceURL:url.href,sourceType:'public_link',mime,objectPath:null};
    }
    throw new ProfileError('Too many redirects. Upload the JD instead.');
  }catch(error){if(error instanceof ProfileError)throw error;throw new ProfileError('This public link could not be read. Upload the JD or paste its text instead.',502);}
}
