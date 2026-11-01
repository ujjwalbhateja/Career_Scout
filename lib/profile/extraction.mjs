import {Unzip,UnzipInflate,strFromU8} from 'fflate/browser';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {ProfileError,LIMITS,clean,id} from './domain.mjs';

function segmentsFromText(text,prefix,locator){
  return text.replace(/\r\n?/g,'\n').split(/\n+/).map(t=>t.trim()).filter(Boolean).map((text,i)=>({id:prefix+'.p'+(i+1),text,locator:locator+' paragraph '+(i+1)}));
}
function validateSegments(segments){
  if(!segments.length||segments.reduce((n,p)=>n+p.text.length,0)<40)throw new ProfileError('No readable text was found. Scanned PDFs need OCR; upload a text-based document or paste the text.');
  if(segments.length>LIMITS.segments||segments.reduce((n,p)=>n+p.text.length,0)>LIMITS.textChars)throw new ProfileError('Document text exceeds the intake limit. Split it into smaller documents.');
  return segments;
}
// Inspect the ZIP central directory before streaming any textual XML.
function zipDirectory(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new ProfileError('The DOCX archive is incomplete.');
  const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true),size=view.getUint32(end+12,true);
  if(count>256||count===65535||offset+size>end)throw new ProfileError('Unsupported or oversized DOCX archive.');
  const entries=new Map();let cursor=offset,total=0;
  for(let n=0;n<count;n++){
    if(cursor+46>end||view.getUint32(cursor,true)!==0x02014b50)throw new ProfileError('Invalid DOCX directory.');
    const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),compressed=view.getUint32(cursor+20,true),original=view.getUint32(cursor+24,true),nameLength=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),local=view.getUint32(cursor+42,true);
    if(cursor+46+nameLength+extra+comment>end)throw new ProfileError('Invalid DOCX entry.');
    const name=strFromU8(bytes.subarray(cursor+46,cursor+46+nameLength));
    if(flags&1||![0,8].includes(method)||original===0xffffffff||compressed===0xffffffff||local+30>offset||name.includes('..')||name.includes('\\')||name.startsWith('/')||entries.has(name))throw new ProfileError('Unsupported or unsafe DOCX entry.');
    const wanted=/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name);
    if(wanted){total+=original;if(original>2_000_000||total>6_000_000)throw new ProfileError('DOCX text is too large to unpack safely.');}
    entries.set(name,{original,wanted});cursor+=46+nameLength+extra+comment;
  }
  if(!entries.has('word/document.xml')||!entries.has('[Content_Types].xml'))throw new ProfileError('This ZIP is not a DOCX document.');
  return entries;
}
function docxSegments(bytes,documentId){
  const entries=zipDirectory(bytes),parts=new Map();let total=0,failure;
  const unzip=new Unzip(file=>{
    const entry=entries.get(file.name);
    if(!entry?.wanted)return;
    const data=[];let actual=0;
    file.ondata=(error,chunk,final)=>{
      if(error){failure=error;return;}
      actual+=chunk.length;total+=chunk.length;
      if(actual>2_000_000||total>6_000_000||actual>entry.original)throw new ProfileError('DOCX expanded beyond its declared safe limit.');
      data.push(chunk);
      if(final){if(actual!==entry.original)throw new ProfileError('DOCX text size is inconsistent.');const value=new Uint8Array(actual);let offset=0;for(const piece of data){value.set(piece,offset);offset+=piece.length;}parts.set(file.name,strFromU8(value));}
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try{for(let i=0;i<bytes.length;i+=1024)unzip.push(bytes.subarray(i,i+1024),i+1024>=bytes.length);}
  catch(e){throw e instanceof ProfileError?e:new ProfileError('The DOCX archive could not be read.');}
  if(failure||!parts.has('word/document.xml'))throw new ProfileError('DOCX text extraction failed.');
  const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,parseTagValue:false,trimValues:false,processEntities:true});
  const segments=[];
  for(const [part,xml] of [...parts].sort(([a],[b])=>a==='word/document.xml'?-1:b==='word/document.xml'?1:a.localeCompare(b))){
    if(/<!DOCTYPE|<!ENTITY|<w:(?:ins|del|moveFrom|moveTo)\b/i.test(xml))throw new ProfileError('Resolve tracked changes or unsupported XML declarations before uploading this DOCX.');
    if(XMLValidator.validate(xml)!==true)throw new ProfileError('The DOCX contains invalid XML.');
    const nodes=parser.parse(xml);let paragraph=0;
    const text=items=>(items||[]).map(node=>Object.entries(node).map(([key,value])=>key==='#text'?String(value):['w:tab','w:br','w:cr'].includes(key)?' ':key==='w:instrText'?'':Array.isArray(value)?text(value):'').join('')).join('');
    const visit=items=>{for(const node of items||[])for(const [key,value] of Object.entries(node)){if(key==='w:p'){paragraph++;const valueText=text(value).trim();if(valueText)segments.push({id:documentId+'.'+part.replace(/\W/g,'_')+'.p'+paragraph,text:valueText,locator:part+' paragraph '+paragraph});}else if(Array.isArray(value))visit(value);}};
    visit(nodes);
  }
  return validateSegments(segments);
}
export async function extractDocument(bytes,{name,mime,documentId=id('doc')}){
  if(bytes.length>LIMITS.fileBytes||!bytes.length)throw new ProfileError('Upload a file under 2 MB.',413);
  const filename=clean(name,180),extension=filename.split('.').at(-1)?.toLowerCase();
  let segments,contentType;
  if(extension==='docx'){
    if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new ProfileError('This file is not a DOCX archive.');
    segments=docxSegments(bytes,documentId);contentType='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }else if(extension==='pdf'){
    if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new ProfileError('This file is not a PDF.');
    const {getDocumentProxy,extractText}=await import('unpdf');
    let pdf;
    // PDF.js transfers its input buffer. Keep the caller's original bytes intact
    // for the content hash and private-file upload that follow extraction.
    try{pdf=await getDocumentProxy(new Uint8Array(bytes),{maxImageSize:1_000_000,isEvalSupported:false});if(pdf.numPages>25)throw new ProfileError('Upload a PDF with at most 25 pages.');const result=await extractText(pdf);if(result.text.some(page=>!page.trim()))throw new ProfileError('A PDF page has no extractable text. Check for scanned or blank pages and upload a complete text-based document.');segments=validateSegments(result.text.flatMap((page,i)=>segmentsFromText(page,documentId+'.page'+(i+1),'page '+(i+1))));}
    catch(e){throw e instanceof ProfileError?e:new ProfileError('PDF extraction failed. Use an unlocked text-based PDF or DOCX.');}
    finally{if(pdf)await pdf.destroy();}
    contentType='application/pdf';
  }else if(extension==='txt'||mime==='text/plain'){
    segments=validateSegments(segmentsFromText(new TextDecoder('utf-8',{fatal:true}).decode(bytes),documentId,'text'));contentType='text/plain';
  }else throw new ProfileError('Use a DOCX, text-based PDF or UTF-8 TXT file.');
  return {id:documentId,segments,mime:contentType,filename};
}
