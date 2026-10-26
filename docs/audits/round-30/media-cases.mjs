// PDF 32000-1 7.3.5 permits the empty Name '/'; both composite forms are valid.
import {makePdf,pdfTree} from '../round-25/media-cases.mjs';
export function createR30MediaCases() {
  return [['nested-empty-name','<< /Value / >>'],['array-empty-name','[/]'],
    ['nested-name-control','<< /Value /Nonempty >>'],['array-name-control','[/Nonempty]']].map(([label,value])=>{
      const t=pdfTree(),rawDictionary='<< /Type /Pages /Kids [3 0 R] /Count 1 /Other '+value+' >>';
      return {id:'R30-01-pdf-'+label,buf:makePdf([t[0],[2,0,rawDictionary],t[2]]),expected:'PARSED',decode:false,ext:'pdf',rawDictionary};
    });
}
