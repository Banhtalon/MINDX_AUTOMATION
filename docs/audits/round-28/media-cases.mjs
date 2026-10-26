import {makePdf,pdfTree} from '../round-25/media-cases.mjs';
export function createR28MediaCases() {
  const cases=[], tree=pdfTree();
  const add=(label,objects,expected='PARSE_ERROR',trailer='<< /Size 12 /Root 1 0 R >>')=>cases.push({id:'R28-01-pdf-'+label,buf:makePdf(objects,trailer),expected,decode:false,ext:'pdf'});
  const stream=(length,body='ABCDEFGH',tail='\nendstream',eol='\n')=>`<< /Length ${length} >>\nstream${eol}${body}${tail}`;
  for(const [label,length,expected] of [['direct-eight','8','PARSED'],['direct-short','7','PARSE_ERROR'],['direct-long','10','PARSE_ERROR'],['direct-fraction','8.5','PARSE_ERROR'],['direct-real-integral','8.0','PARSE_ERROR'],['direct-junk','8/foo','PARSE_ERROR'],['direct-array','[8]','PARSE_ERROR'],['direct-negative','-8','PARSE_ERROR']])add('length-'+label,[...tree,[4,0,stream(length)]],expected);
  for(const [label,eol,tail] of [['lf','\n','\nendstream'],['crlf','\r\n','\r\nendstream'],['cr','\r','\rendstream'],['no-extra-eol','\n','endstream']])add('valid-stream-'+label,[...tree,[4,0,stream('8','ABCDEFGH',tail,eol)]],'PARSED');
  add('length-zero-control',[...tree,[4,0,stream('0','')]],'PARSED');
  add('length-extra-key-control',[...tree,[4,0,stream('8 /Other 1')]],'PARSED');
  add('count-extra-key-control',[tree[0],[2,0,'<< /Type /Pages /Kids [3 0 R] /Count 1 /Other 2 >>'],tree[2]],'PARSED');
  for(const before of [true,false])add('length-ref-'+(before?'before':'after'),before?[...tree,[5,2,'8'],[4,0,stream('5 2 R')]]:[...tree,[4,0,stream('5 2 R')],[5,2,'8']],'PARSED');
  for(const [label,value,gen] of [['wrong-generation','8',0],['fractional','8.5',2],['negative','-8',2],['array','[8]',2],['dict','<< /N 8 >>',2]])add('length-ref-'+label,[...tree,[5,gen,value],[4,0,stream('5 2 R')]]);
  add('length-ref-missing',[...tree,[4,0,stream('5 2 R')]]);
  add('length-duplicate',[...tree,[4,0,stream('8 /Length 8')]]);
  add('endstream-wrong-token',[...tree,[4,0,stream('8','ABCDEFGH','\nendstreamX')]]);
  add('endobj-extra-token',[...tree,[4,0,stream('8')+'\nOTHER']]);
  for(const [label,kids]of [['scalar','3 0 R 1'],['name','3 0 R /Other'],['boolean','3 0 R true'],['null','3 0 R null'],['string','3 0 R (4 0 R)'],['hex','3 0 R <3420302052>'],['array','3 0 R [4 0 R]'],['missing-r','3 0'],['duplicate','3 0 R 3 0 R']])add('kids-'+label,[tree[0],[2,0,`<< /Type /Pages /Kids [${kids}] /Count 1 >>`],tree[2]]);
  for(const count of ['0','2','1.5','1.0','1/foo','1 0 R'])add('count-'+count.replace(/[^a-z0-9]/gi,'_'),[tree[0],[2,0,`<< /Type /Pages /Kids [3 0 R] /Count ${count} >>`],tree[2]]);
  const nested=[[1,0,'<< /Type /Catalog /Pages 2 0 R >>'],[2,0,'<< /Type /Pages /Kids [5 0 R 4 0 R] /Count 2 >>'],[5,0,'<< /Type /Pages /Parent 2 0 R /Kids [3 0 R] /Count 1 >>'],[3,0,'<< /Type /Page /Parent 5 0 R /MediaBox [0 0 72 72] >>'],[4,0,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>']];
  add('nested-count-control',nested,'PARSED');
  add('nested-count-wrong',nested.map(o=>o[0]===5?[5,0,o[2].replace('/Count 1','/Count 2')]:o));
  return cases;
}
