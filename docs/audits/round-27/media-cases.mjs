// R27 deterministic synthetic corpus. Full pixel decoding is independent of product parsing.
import sharp from 'sharp';
import {chunk,riff,makePdf,pdfTree} from '../round-25/media-cases.mjs';
export async function createR27MediaCases() {
  const cases=[];
  const add=(label,buf,expected,decode=false,ext='webp')=>cases.push({id:'R27-01-'+label,buf,expected,decode,ext});
  for(const [w,h] of [[2,3],[9,17],[31,18],[48,65]])for(const pattern of ['gradient','noise','checker','alpha']) {
    const channels=pattern==='alpha'?4:3,raw=Buffer.alloc(w*h*channels);let rng=0x719b2341;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let c=0;c<channels;c++) {
      rng=(Math.imul(rng,1664525)+1013904223)>>>0;
      raw[(y*w+x)*channels+c]=pattern==='noise'?rng>>>24:pattern==='checker'?((x+y)%2)*255:c===3?(x*41+y*71)%256:(x*17+y*37+c*53)%256;
    }
    for(const [lossless,quality] of [[false,15],[false,73],[false,95],[true,73]]) {
      const buf=await sharp(raw,{raw:{width:w,height:h,channels}}).webp({lossless,quality,effort:4}).toBuffer();
      const label=`${w}x${h}-${pattern}-${lossless}-${quality}`;
      add('valid-'+label,buf,'PARSED',true);
      if(w===31&&quality===73)for(const drop of [1,2,3,5,11]) {
        const kind=buf.subarray(12,16).toString('ascii');let b;
        if(['VP8 ','VP8L'].includes(kind)) {
          const payload=buf.subarray(20,20+buf.readUInt32LE(16));
          b=riff(chunk(kind,payload.subarray(0,Math.max(0,payload.length-drop))));
        }else {b=Buffer.from(buf.subarray(0,buf.length-drop));b.writeUInt32LE(b.length-8,4);}
        let decodes=true;try{await sharp(b).raw().toBuffer();}catch{decodes=false;}
        add(`truncate-${label}-${drop}`,b,decodes?'PARSED':'PARSE_ERROR',true);
      }
    }
  }
  const tree=pdfTree();
  const pdf=(label,objects,trailer,expected='PARSE_ERROR')=>add('pdf-'+label,makePdf(objects,trailer),expected,false,'pdf');
  pdf('control',tree,'<< /Size 4 /Root 1 0 R >>','PARSED');
  for(const [label,body]of [
    ['literal-markers','(escaped \\( trailer << /Root 9 0 R >> endobj 9 0 obj)'],
    ['nested-literal','(one (two (trailer << /Root 9 0 R >>)) endobj)'],
  ])pdf('valid-'+label,[...tree,[4,0,body]],'<< /Size 5 /Root 1 0 R >>','PARSED');
  // endstream inside stream payload is data. /Length defines the real boundary.
  for(const marker of ['endstream','endstream\r','endstream\n']) {
    const payload=marker+'\nendobj\n9 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailing-payload';
    const body=`<< /Length ${Buffer.byteLength(payload,'latin1')} >>\nstream\n${payload}\nendstream`;
    pdf('stream-early-marker-'+JSON.stringify(marker).replace(/[^a-z0-9]/gi,'_'),[...tree,[4,0,body]],'<< /Size 10 /Root 9 0 R >>');
    pdf('valid-stream-marker-'+JSON.stringify(marker).replace(/[^a-z0-9]/gi,'_'),[...tree,[4,0,body]],'<< /Size 5 /Root 1 0 R >>','PARSED');
  }
  for(const [label,node]of [
    ['kids-foreign-scalar','<< /Type /Pages /Kids [3 0 R 999] /Count 1 >>'],
    ['kids-nested-reference','<< /Type /Pages /Kids [[3 0 R]] /Count 1 >>'],
    ['kids-dictionary-reference','<< /Type /Pages /Kids [<< /Hint 3 0 R >>] /Count 1 >>'],
    ['duplicate-kids','<< /Type /Pages /Kids [3 0 R] /Kids [9 0 R] /Count 1 >>'],
    ['duplicate-type','<< /Type /Pages /Type /Page /Kids [3 0 R] /Count 1 >>'],
  ])pdf(label,[tree[0],[2,0,node],tree[2]],'<< /Size 4 /Root 1 0 R >>');
  for(const key of ['Pages','Parent']) {
    const objects=key==='Pages'?[[1,0,'<< /Type /Catalog /Pages 2 0 R /Pages 9 0 R >>'],...tree.slice(1)]:[...tree.slice(0,2),[3,0,'<< /Type /Page /Parent 2 0 R /Parent 9 0 R >>']];
    pdf('duplicate-'+key,objects,'<< /Size 4 /Root 1 0 R >>');
  }
  return cases;
}
