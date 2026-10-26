// Small deterministic fixtures. No student files or real services.
import sharp from 'sharp';
export function chunk(type, payload) {
  const b=Buffer.alloc(8+payload.length+(payload.length%2));b.write(type);b.writeUInt32LE(payload.length,4);payload.copy(b,8);return b;
}
export function riff(...chunks) {
  const b=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBP'),...chunks]);b.writeUInt32LE(b.length-8,4);return b;
}
function bitWriter(w=64,h=64) {
  const bits=[]; const put=(v,n)=>{for(let i=0;i<n;i++)bits.push((v>>>i)&1);};
  put(0x2f,8);put(w-1,14);put(h-1,14);put(0,1);put(0,3);
  const finish=()=>{const b=Buffer.alloc(Math.max(15,Math.ceil(bits.length/8)));bits.forEach((v,i)=>b[i>>>3]|=v<<(i&7));return b;};
  return {put,finish};
}
export function makePdf(objects, trailer='<< /Size 5 /Root 1 0 R >>') {
  let s='%PDF-1.4\n'; const offsets=[];
  for(const [num,gen,body] of objects){offsets.push([num,gen,Buffer.byteLength(s,'latin1')]);s+=`${num} ${gen} obj\n${body}\nendobj\n`;}
  const xref=Buffer.byteLength(s,'latin1');s+='xref\n0 1\n0000000000 65535 f \n';
  for(const [num,gen,offset]of offsets)s+=`${num} 1\n${String(offset).padStart(10,'0')} ${String(gen).padStart(5,'0')} n \n`;
  return Buffer.from(s+`trailer\n${trailer}\nstartxref\n${xref}\n%%EOF\n`,'latin1');
}
export const pdfTree=()=>[[1,0,'<< /Type /Catalog /Pages 2 0 R >>'],[2,0,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],[3,0,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> >>']];
export async function createMediaCases() {
  const cases=[];const add=(id,buf,expected='PARSE_ERROR',decode=false,ext='webp')=>cases.push({id:'R25-01-'+id,buf,expected,decode,ext});
  const vp8=Buffer.from([0x50,1,0,0x9d,1,0x2a,1,0,1,0,0,1,2,3,4,5,6,7,8,9,1,2,3,4,5,6,7,8]);
  const two=bitWriter();two.put(0,1);two.put(0,1);two.put(0,1);
  for(let i=0;i<5;i++){two.put(1,1);two.put(1,1);two.put(0,1);two.put(0,1);two.put(1,8);}
  const overfull=bitWriter();overfull.put(0,1);overfull.put(0,1);overfull.put(0,1);
  for(let i=0;i<5;i++){overfull.put(0,1);overfull.put(0,4);for(let j=0;j<4;j++)overfull.put(1,3);overfull.put(0,1);}
  const transform=bitWriter();transform.put(1,1);transform.put(0,2);transform.put(0,3);transform.put(0,1);
  transform.put(0,1);transform.put(0,4);for(let i=0;i<4;i++)transform.put(1,3);transform.put(0,1);
  for(let i=1;i<5;i++){transform.put(1,1);transform.put(0,1);transform.put(0,1);transform.put(0,1);}
  for(const [label,kind,payload]of [['vp8-entropy-garbage','VP8 ',vp8],['vp8l-no-pixels','VP8L',two.finish()],['vp8l-overfull-trees','VP8L',overfull.finish()],['vp8l-transform-without-main','VP8L',transform.finish()]])
    for(const extended of [false,true])add(label+'-'+extended,riff(...(extended?[chunk('VP8X',Buffer.from([0,0,0,0,kind==='VP8 '?0:63,0,0,kind==='VP8 '?0:63,0,0]))]:[]),chunk(kind,payload)),'PARSE_ERROR',true);
  for(const [w,h,bg,alpha]of [[1,1,'#000000',false],[2,2,'#ffffff',false],[8,8,'#ff0000',false],[17,11,{r:30,g:100,b:220,alpha:.4},true]])
    for(const lossless of [false,true])add(`valid-${w}x${h}-${lossless}`,await sharp({create:{width:w,height:h,channels:alpha?4:3,background:bg}}).webp({lossless}).toBuffer(),'PARSED',true);
  const t=pdfTree();
  add('pdf-nonzero-generations',makePdf([[1,2,'<< /Type /Catalog /Pages 2 3 R >>'],[2,3,'<< /Type /Pages /Kids [3 4 R] /Count 1 >>'],[3,4,'<< /Type /Page /Parent 2 3 R /MediaBox [0 0 72 72] >>']],'<< /Size 4 /Root 1 2 R >>'),'PARSED',false,'pdf');
  for(const [label,objects,trailer]of [
    ['root-absent',t,'<< /Size 4 >>'],['root-missing-object',t,'<< /Size 4 /Root 9 0 R >>'],
    ['root-wrong-generation',t,'<< /Size 4 /Root 1 1 R >>'],
    ['kid-wrong-generation',[t[0],[2,0,'<< /Type /Pages /Kids [3 1 R] /Count 1 >>'],t[2]],'<< /Size 4 /Root 1 0 R >>'],
    ['parent-wrong-generation',[...t.slice(0,2),[3,0,'<< /Type /Page /Parent 2 1 R >>']],'<< /Size 4 /Root 1 0 R >>'],
    ['root-decoy-string',[...t,[4,0,'<< /Hint (/Root 1 0 R) >>']],'<< /Size 5 /Root 9 0 R >>'],
    ['root-decoy-no-trailer-root',[...t,[4,0,'<< /Hint (/Root 1 0 R) >>']],'<< /Size 5 >>'],
    ['root-decoy-nested-trailer',t,'<< /Size 4 /Info << /Root 1 0 R >> /Root 9 0 R >>']
  ])add('pdf-'+label,makePdf(objects,trailer),'PARSE_ERROR',false,'pdf');
  return cases;
}
