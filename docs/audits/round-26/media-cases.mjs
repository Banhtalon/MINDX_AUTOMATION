// Independent R26 corpus: libwebp via sharp is the WebP decoding oracle.
import sharp from 'sharp';
import {chunk,riff,makePdf,pdfTree} from '../round-25/media-cases.mjs';
export async function createR26MediaCases() {
  const cases=[];
  const add=(label,buf,expected,decode=false,ext='webp')=>cases.push({id:'R26-01-'+label,buf,expected,decode,ext});
  const seeds=[];
  for(const [w,h] of [[1,1],[3,2],[7,5],[16,16],[17,31],[65,33]]) {
    for(const pattern of ['gradient','checker','alpha','noise']) {
      const channels=pattern==='alpha'?4:3,raw=Buffer.alloc(w*h*channels);
      let rng=0x12345678;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<channels;c++) {
        rng=(Math.imul(rng,1664525)+1013904223)>>>0;
        raw[(y*w+x)*channels+c]=pattern==='noise'?rng>>>24:pattern==='checker'?((x+y)%2)*255:c===3?(x*73+y*31)%256:(x*29+y*53+c*83)%256;
      }
      for(const lossless of [false,true]) {
        const buf=await sharp(raw,{raw:{width:w,height:h,channels}}).webp({lossless,quality:73,effort:4}).toBuffer();
        add(`valid-${w}x${h}-${pattern}-${lossless}`,buf,'PARSED',true);
        if(w===17&&pattern!=='checker')seeds.push({label:pattern+'-'+lossless,buf});
      }
    }
  }
  // Sample interior bit flips and physical truncations. Expected status is derived only from the independent decoder.
  for(const {label,buf}of seeds)for(const mode of ['flip25','flip50','flip75','truncate2','truncate7']) {
    let b=Buffer.from(buf);
    if(mode.startsWith('flip'))b[Math.min(b.length-1,20+Math.floor((b.length-20)*Number(mode.slice(4))/100))]^=0x80;
    else {
      const drop=Number(mode.slice(8)),kind=b.subarray(12,16).toString('ascii');
      if(['VP8 ','VP8L'].includes(kind)) {
        const originalPayload=b.subarray(20,20+b.readUInt32LE(16));
        b=riff(chunk(kind,originalPayload.subarray(0,originalPayload.length-drop)));
      } else {
        b=b.subarray(0,b.length-drop);b.writeUInt32LE(b.length-8,4);
      }
    }
    let decodes=true;try{await sharp(b).raw().toBuffer();}catch{decodes=false;}
    add(`differential-${label}-${mode}`,b,decodes?'PARSED':'PARSE_ERROR',true);
  }
  // Direct graph expectations are explicit; these are structural PDF checks, not a PDF rendering oracle.
  const tree=pdfTree();
  add('pdf-valid-direct-graph',makePdf(tree),'PARSED',false,'pdf');
  for(const [label,objects,trailer]of [
    ['root-array-decoy',tree,'<< /Size 4 /Hint [/Root 1 0 R] /Root 9 0 R >>'],
    ['root-nested-array-decoy',tree,'<< /Size 4 /Hint [[ /Root 1 0 R ]] /Root 9 0 R >>'],
    ['root-escaped-string-decoy',tree,'<< /Size 4 /Hint (escaped \\( /Root 1 0 R) /Root 9 0 R >>'],
    ['root-trailer-token-in-string',tree,'<< /Size 4 /Root 9 0 R /Hint (\ntrailer << /Root 1 0 R >>) >>'],
    ['root-duplicate-conflict',tree,'<< /Size 4 /Root 1 0 R /Root 9 0 R >>'],
    ['pages-nested-dict-decoy',[[1,0,'<< /Type /Catalog /Hint << /Pages 2 0 R >> /Pages 9 0 R >>'],...tree.slice(1)],'<< /Size 4 /Root 1 0 R >>'],
    ['pages-array-decoy',[[1,0,'<< /Type /Catalog /Hint [/Pages 2 0 R] /Pages 9 0 R >>'],...tree.slice(1)],'<< /Size 4 /Root 1 0 R >>'],
    ['page-type-string-decoy',[...tree.slice(0,2),[3,0,'<< /Hint (/Type /Page) /Parent 2 0 R >>']],'<< /Size 4 /Root 1 0 R >>'],
    ['parent-array-decoy',[...tree.slice(0,2),[3,0,'<< /Type /Page /Hint [/Parent 2 0 R] /Parent 9 0 R >>']],'<< /Size 4 /Root 1 0 R >>'],
    ['parent-missing',[...tree.slice(0,2),[3,0,'<< /Type /Page /MediaBox [0 0 72 72] >>']],'<< /Size 4 /Root 1 0 R >>'],
    ['kids-wrong-generation',[[1,4,'<< /Type /Catalog /Pages 2 5 R >>'],[2,5,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],[3,6,'<< /Type /Page /Parent 2 5 R >>']],'<< /Size 4 /Root 1 4 R >>'],
    ['root-object-in-string', [...tree,[4,0,'(endobj\n9 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n)']],'<< /Size 10 /Root 9 0 R >>'],
    ['stream-object-decoy',[...tree,[4,0,'<< /Length 75 >>\nstream\n9 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\nendstream']],'<< /Size 10 /Root 9 0 R >>'],
    ['root-generation-conflict',tree,'<< /Size 4 /Root 1 1 R >>'],
  ])add('pdf-'+label,makePdf(objects,trailer),'PARSE_ERROR',false,'pdf');
  const vp8=seeds.find(s=>s.label==='gradient-false').buf;
  if(vp8.subarray(12,16).toString('ascii')==='VP8 ') {
    const vp8x=Buffer.alloc(10);vp8x.writeUIntLE(17,4,3);vp8x.writeUIntLE(30,7,3);
    add('vp8x-canvas-mismatch',riff(chunk('VP8X',vp8x),chunk('VP8 ',vp8.subarray(20,20+vp8.readUInt32LE(16)))),'PARSE_ERROR',false);
  }
  return cases;
}
