import {safeURL,assertPublicHost,extractJobs,text} from '../scout.mjs';
import {extractDocument} from './extraction.mjs';
import {ProfileError,LIMITS,id,digest} from './domain.mjs';
import {PRIMARY_JD_HEADING as primaryHeading,AI_JD_HEADING as aiHeading,RECOMMENDATION_JD_HEADING as recommendationHeading} from './jd-content.mjs';
export {primaryJDSegments} from './jd-content.mjs';

/** Clean pasted/publisher text without treating board summaries as employer requirements. */
export function cleanJDText(value){
  const lines=text(value).split(/\n+/).map(line=>line.trim()).filter(Boolean),out=[];let skippingAI=false,seenPrimary=false;
  for(const line of lines){
    if(aiHeading.test(line)){skippingAI=true;continue;}
    if(primaryHeading.test(line)){skippingAI=false;seenPrimary=true;out.push(line);continue;}
    if(recommendationHeading.test(line)){if(seenPrimary||out.length)break;continue;}
    if(skippingAI)continue;
    if(/^(?:sign in|log in|sign up|save job|save|share|apply now|apply|menu|search jobs|browse jobs|job alerts|privacy policy|cookie preferences|accept all cookies|reject all cookies)$/i.test(line))continue;
    out.push(line);
  }
  return out.join('\n\n').trim();
}

function stripNonEmployerBlocks(html){
  const source=String(html).replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
  const noiseTags=new Set(['nav','header','footer','aside','form','button']),voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const noiseAttribute=/\b(?:ai[-_ ]?(?:generated|summary|overview|insights?)|(?:job[-_ ]?)?recommend(?:ation|ed)|(?:similar|related)[-_ ]?(?:jobs|roles)|navbar|navigation|breadcrumbs?|cookie[-_ ]?(?:banner|consent)|job[-_ ]?alerts?|sidebar|site[-_ ]?footer)\b/i;
  const stack=[];let output='',last=0;
  for(const match of source.matchAll(/<\/?([A-Za-z][\w:-]*)\b[^>]*>/g)){
    const tag=match[1].toLowerCase(),closing=/^<\//.test(match[0]),blocked=stack.at(-1)?.blocked===true;
    if(!blocked)output+=source.slice(last,match.index);
    if(closing){
      const index=stack.map(entry=>entry.tag).lastIndexOf(tag),entry=index<0?null:stack[index];
      if(index>=0)stack.splice(index);
      if(!entry?.blocked&&!stack.at(-1)?.blocked)output+=match[0];
    }else{
      const attributes=match[0].slice(tag.length+1,-1),hidden=/(?:^|\s)hidden(?:\s|=|$)|\baria-hidden\s*=\s*["']true["']/i.test(attributes);
      const ownBlocked=noiseTags.has(tag)||noiseAttribute.test(attributes)||hidden,nextBlocked=blocked||ownBlocked;
      if(!nextBlocked)output+=match[0];
      if(!voidTags.has(tag)&&! /\/\s*>$/.test(match[0]))stack.push({tag,blocked:nextBlocked});
    }
    last=match.index+match[0].length;
  }
  if(!stack.at(-1)?.blocked)output+=source.slice(last);
  return output;
}
function canonicalSource(value){try{const url=new URL(value);url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_|^(?:ref|source|src)$/i.test(key))url.searchParams.delete(key);return url.href.replace(/\/$/,'');}catch{return '';}}
function elementBody(html,pattern){
  const opening=pattern.exec(html);if(!opening)return '';
  const tag=opening[1],start=opening.index+opening[0].length;let depth=1;
  for(const match of html.slice(start).matchAll(new RegExp('<\\/?'+tag+'\\b[^>]*>','gi'))){if(/^<\//.test(match[0]))depth--;else if(!/\/\s*>$/.test(match[0]))depth++;if(!depth)return html.slice(start,start+match.index);}
  return '';
}

/** Keep one primary publisher JD even when a board includes recommendation cards/JSON-LD. */
export function extractPrimaryJDContent(html,url){
  const jobs=extractJobs(html,url),pageURL=canonicalSource(url),heading=text(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'');
  const byURL=jobs.filter(job=>canonicalSource(job.url)===pageURL),byTitle=jobs.filter(job=>heading&&job.title.toLowerCase()===heading.toLowerCase());
  let primary=byURL.length===1?byURL[0]:jobs.length===1?jobs[0]:byTitle.length===1?byTitle[0]:null;
  if(jobs.length>1&&!primary)throw new ProfileError('This page lists multiple jobs. Use the link to one specific role.');
  const stripped=stripNonEmployerBlocks(html),description=elementBody(stripped,/<([a-z][\w:-]*)\b[^>]*(?:id|class|data-testid|itemprop)\s*=\s*["'][^"']*(?:job[-_ ]?description|jobdescription|description[-_ ]?body)[^"']*["'][^>]*>/i);
  const body=description||elementBody(stripped,/<(main|article)\b[^>]*>/i)||elementBody(stripped,/<(body)\b[^>]*>/i)||stripped;
  const content=cleanJDText(primary?.description||body),title=primary?.title||heading||text(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||new URL(url).hostname).slice(0,180);
  // Preserve a literal primary title for later JD-title source validation.
  const withTitle=(primary?.title||heading)&&!content.includes(title)?title+'\n\n'+content:content;
  return {title,content:withTitle,sourceFiltering:{primarySource:primary?'publisher_jobposting':'primary_description',excludedSections:['navigation','AI summaries','recommendations','similar jobs'],descriptionOnly:true}};
}

// Public sources only. Validate every redirect before contacting its destination;
// never forward visitor cookies, provider credentials or a browser session.
export function normalizeJDLink(value){
  let url;try{url=safeURL(value);}catch{throw new ProfileError('Enter a public HTTPS job-description link.');}
  const linkedin=url.hostname==='linkedin.com'||url.hostname.endsWith('.linkedin.com');
  if(linkedin&&/^\/jobs\/(?:search|search-results)\/?$/.test(url.pathname)){
    const ids=[...new Set(url.searchParams.getAll('currentJobId'))];
    if(ids.length!==1||!/^\d{1,20}$/.test(ids[0]))throw new ProfileError('This LinkedIn link is a search page without one selected job. Open a specific role and copy its job link.');
    return new URL('https://www.linkedin.com/jobs/view/'+ids[0]+'/');
  }
  return url;
}

export async function readJDLink(value){
  let url=normalizeJDLink(value);
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
        const html=new TextDecoder().decode(bytes),primary=extractPrimaryJDContent(html,url.href),content=primary.content;
        if(content.length<100||/^(?:access denied|verify you are human|just a moment|sign in to continue)/i.test(content.trim())||!/(responsibil|qualificat|requirements|experience|job description|about the role)/i.test(content))throw new ProfileError('This page does not expose a readable JD. Upload the document or paste its text instead.');
        if(content.length>LIMITS.textChars)throw new ProfileError('The job page is too long. Upload just the job description.');
        title=primary.title;
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
