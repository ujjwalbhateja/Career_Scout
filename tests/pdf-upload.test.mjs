import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extractDocument} from '../lib/profile/extraction.mjs';
import {ProfileService} from '../lib/profile/service.mjs';
import {emptyProfile} from '../lib/profile/domain.mjs';

// A complete text PDF generated in memory; no private resume or external tool.
function textPDF(){
  const stream='BT /F1 12 Tf 50 740 Td (Synthetic Candidate) Tj 0 -20 Td (A locally generated text PDF for source-preserving upload regression checks.) Tj ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let document='%PDF-1.4\n',offsets=[0];
  for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(document));document+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const start=Buffer.byteLength(document);
  document+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  document+=offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
  document+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(document,'ascii'));
}
const options={name:'synthetic.pdf',mime:'application/pdf',documentId:'synthetic-pdf'};

for(const kind of ['Uint8Array','Uint8Array with offset','Buffer with offset'])test(`PDF extraction leaves the original ${kind} and its backing bytes intact`,async t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('PDF intake must remain local.'));
  const original=textPDF();
  const backing=kind==='Uint8Array'?original:kind==='Buffer with offset'?Buffer.alloc(original.length+64,0x5a):new Uint8Array(original.length+64).fill(0x5a);
  if(kind!=='Uint8Array')backing.set(original,23);
  const input=kind==='Uint8Array'?backing:backing.subarray(23,23+original.length);
  const inputBefore=new Uint8Array(input),backingBefore=new Uint8Array(backing);
  const result=await extractDocument(input,options);
  assert.equal(result.mime,'application/pdf');
  assert.ok(result.segments.some(segment=>segment.text.includes('Synthetic Candidate')));
  assert.equal(input.byteLength,inputBefore.byteLength,'the caller still owns a nonempty original file after parsing');
  assert.deepEqual(new Uint8Array(input),inputBefore,'PDF parsing cannot change the original file bytes');
  assert.deepEqual(new Uint8Array(backing),backingBefore,'PDF parsing cannot detach or change the parent buffer or padding');
});

test('resume PDF upload hashes and stores the exact original file after extraction',async t=>{
  t.mock.method(globalThis,'fetch',()=>assert.fail('This upload uses isolated memory adapters only.'));
  const original=textPDF(),expectedHash=createHash('sha256').update(original).digest('hex');
  const service=new ProfileService({},'synthetic-owner');let uploads=0,saves=0;
  service.memory.load=async()=>({revision:1,state:emptyProfile()});
  service.memory.upload=async(document,bytes,mime)=>{
    uploads++;assert.equal(mime,'application/pdf');
    assert.equal(bytes.byteLength,original.byteLength,'storage must receive the original nonempty PDF, not the parser-owned transferred buffer');
    assert.deepEqual(new Uint8Array(bytes),original);assert.equal(document.hash,expectedHash,'document identity must be the original file digest');
    return 'synthetic/original.pdf';
  };
  service.memory.save=async(revision,state)=>{saves++;assert.equal(revision,1);return {revision:2,state:structuredClone(state)};};
  service.memory.removeFiles=async()=>assert.fail('A successful isolated upload does not remove its original.');
  const result=await service.upload({name:'synthetic.pdf',type:'application/pdf',arrayBuffer:async()=>new Uint8Array(original).buffer},{kind:'resume',revision:1});
  assert.equal(uploads,1);assert.equal(saves,1);
  assert.equal(result.state.documents[0].hash,expectedHash);assert.equal(result.state.documents[0].objectPath,'synthetic/original.pdf');
  assert.ok(result.state.documents[0].segments.some(segment=>segment.text.includes('Synthetic Candidate')));
});
