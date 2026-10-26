// R29: explicit PDF byte syntax. No product parser is used to set expectations.
import {makePdf,pdfTree} from '../round-25/media-cases.mjs';
export function createR29MediaCases() {
  const cases=[], tree=pdfTree();
  const add=(label,objects,expected='PARSE_ERROR',trailer='<< /Size 12 /Root 1 0 R >>')=>cases.push({id:'R29-01-pdf-'+label,buf:makePdf(objects,trailer),expected,decode:false,ext:'pdf'});
  const stream=body=>`<< ${body} >>\nstream\nABCDEFGH\nendstream`;
  const page=body=>[tree[0],[2,0,`<< /Type /Pages /Kids [3 0 R] ${body} >>`],tree[2]];
  for(const [label,value] of [['signed-plus','+8'],['leading-zero','008']])add('length-'+label,[...tree,[4,0,stream('/Length '+value)]],'PARSED');
  for(const [label,value] of [['fraction','8.25'],['real-dot','8.'],['real-plus','+8.0'],['exponent','8e0'],['suffix','8foo'],['two-values','8 9'],['missing',''],['bool','true'],['null','null'],['name','/Eight']])add('length-token-'+label,[...tree,[4,0,stream('/Length '+value)]]);
  for(const [label,extra] of [['int','/Other 1'],['real','/Other 1.25'],['bool','/Other true'],['null','/Other null'],['name','/Other /Value'],['string','/Other (hello)'],['hex','/Other <4142>'],['array','/Other [1 2]'],['dict','/Other << /N 2 >>']]) {
    add('length-extra-'+label,[...tree,[4,0,stream('/Length 8 '+extra)]],'PARSED');
    add('count-extra-'+label,page('/Count 1 '+extra),'PARSED');
  }
  for(const [label,ws] of [['nul','\x00'],['tab','\t'],['formfeed','\f'],['cr','\r'],['lf','\n']]) {
    add('length-whitespace-'+label,[...tree,[4,0,stream('/Length 8'+ws)]],'PARSED');
    add('count-whitespace-'+label,page('/Count 1'+ws),'PARSED');
  }
  for(const [label,suffix] of [['lone-gt','>'],['brace-open','{'],['brace-close','}']]) {
    add('length-delimiter-'+label,[...tree,[4,0,stream('/Length 8'+suffix)]]);
    add('count-delimiter-'+label,page('/Count 1'+suffix));
  }
  for(const [label,extra] of [['missing-last','/Other'],['name-value-control','/Other /Dangling'],['unknown','/Other junk'],['duplicate','/Other 1 /Other 2']]) {
    const expected=label==='name-value-control'?'PARSED':'PARSE_ERROR';
    add('length-extra-'+label,[...tree,[4,0,stream('/Length 8 '+extra)]],expected);
    add('count-extra-'+label,page('/Count 1 '+extra),expected);
  }
  return cases;
}
