import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import os from 'node:os';
import AdmZip from 'adm-zip';
const root=path.resolve(process.cwd());
if(!root.startsWith(path.resolve(os.tmpdir())+path.sep)||!root.includes('mindx-round31-'))throw Error('RUN_ONLY_IN_ISOLATED_SNAPSHOT');
const {parseGameMakerBuffer,parseScratchSb3Buffer}=await import(pathToFileURL(path.join(root,'src/lib/file-parsers/game-reader.ts')).href);

const out=path.join(path.dirname(fileURLToPath(import.meta.url)),'evidence');fs.mkdirSync(out,{recursive:true});
const results=[];
const hash=b=>crypto.createHash('md5').update(b).digest('hex');
function scratch(a,b){
  const asset=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>');
  const assetId=hash(asset);
  const costume={assetId,name:'costume1',bitmapResolution:1,md5ext:assetId+'.svg',dataFormat:'svg',rotationCenterX:0,rotationCenterY:0};
  const shared={variables:{},lists:{},broadcasts:{},comments:{},currentCostume:0,costumes:[costume],sounds:[],volume:100,layerOrder:0};
  const stage={...shared,isStage:true,name:'Stage',blocks:{},tempo:60,videoTransparency:50,videoState:'on',textToSpeechLanguage:null};
  const sprite={...shared,isStage:false,name:'Sprite1',visible:true,x:0,y:0,size:100,direction:90,draggable:false,rotationStyle:'all around',layerOrder:1,blocks:{
    hat:{opcode:'event_whenflagclicked',next:'move',parent:null,inputs:{},fields:{},shadow:false,topLevel:true,x:0,y:0},
    move:{opcode:'motion_movesteps',next:null,parent:'hat',inputs:{STEPS:[3,'add',[4,'10']]},fields:{},shadow:false,topLevel:false},
    add:{opcode:'operator_add',next:null,parent:'move',inputs:{NUM1:[1,[4,String(a)]],NUM2:[1,[4,String(b)]]},fields:{},shadow:false,topLevel:false}
  }};
  const zip=new AdmZip();zip.addFile('project.json',Buffer.from(JSON.stringify({targets:[stage,sprite],monitors:[],extensions:[],meta:{semver:'3.0.0',vm:'12.0.0',agent:'independent synthetic audit'}})));zip.addFile(assetId+'.svg',asset);
  return parseScratchSb3Buffer(zip.toBuffer(),'project.sb3');
}
const one=scratch(1,2),two=scratch(100,200);
results.push({id:'R35-SB3-NESTED-ARGS',expected:'Both parse successfully and extracted code distinguishes 1+2 from 100+200',successA:one.success,successB:two.success,sameText:one.extractedText===two.extractedText,textA:one.extractedText,textB:two.extractedText,pass:one.success&&two.success&&one.extractedText!==two.extractedText});

const z=new AdmZip();
z.addFile('Project.yyp',Buffer.from(JSON.stringify({resourceType:'GMProject',resourceVersion:'2.0',name:'Project',resources:[{id:{name:'obj_player',path:'objects/obj_player/obj_player.yy'}}]})));
z.addFile('objects/obj_player/obj_player.yy',Buffer.from(JSON.stringify({resourceType:'GMObject',resourceVersion:'2.0',name:'obj_player',eventList:[{eventType:0,eventNum:0},{eventType:3,eventNum:0}]})));
z.addFile('objects/obj_player/Create_0.gml',Buffer.from('show_debug_message(1);'));
z.addFile('objects/obj_player/Step_0.gml',Buffer.from([0,1,2,3]));
const gm=parseGameMakerBuffer(z.toBuffer(),'project.yyz','.yyz');
results.push({id:'R35-YYZ-PARTIAL-CORRUPTION',expected:'Corrupted required GML returns failure for manual inspection',success:gm.success,text:gm.extractedText,errorReason:gm.errorReason??null,pass:gm.success===false});

const clean=s=>s.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm,'').replace(/\bexport\s+/g,'');
let scrapeCalls=0;
const cid='AUDIT_PTA_CLASS';
const cached={success:true,columns:[{columnId:'L1',lessonId:'L1',sessionNumber:1,colIndex:0,title:'Buoi 1'}],rows:[{studentId:'S1',fullName:'Synthetic Student',cells:{L1:{status:'NOT_SUBMITTED',submissionId:null,attachments:[]}}}]};
const fresh={...cached,rows:[{studentId:'S1',fullName:'Synthetic Student',cells:{L1:{status:'SUBMITTED_UNGRADED',submissionId:'NEW_SUB',attachments:['new.py']}}}]};
const ctx=vm.createContext({console,Buffer,path,fs,process,URL,Date,Set,Map,config:{lmsUrl:'https://lms.invalid'},
  ScoreScraper:{scrapeClassScores:async()=>{scrapeCalls++;return fresh;}},
  scoreMatrixRepo:{findByClass:()=>({matrix:cached})},
  studentRepo:{findByClass:()=>[{studentId:'S1'}]},jobLogRepo:{add(){}},
  homeworkSubmissionRepo:{findBySubmissionId:()=>undefined},
  BrowserManager:{getInstance(){throw Error('SHOULD_REFRESH_MATRIX_BEFORE_BROWSER');}},
  assertPathAllowed:p=>p,
});
const source=fs.readFileSync(path.join(root,'src/lib/playwright/download-submissions.ts'),'utf8');
vm.runInContext(stripTypeScriptTypes(clean(source),{mode:'transform'})+'\nglobalThis.Subject=SubmissionDownloader;',ctx);
const download=await ctx.Subject.downloadLessonSubmissions({classId:cid,classCode:cid,sessionId:cid+'_SESS_01'});
results.push({id:'R35-NEW-SUBMISSION-HIDDEN-BY-CACHE',expected:'Downloading current lesson refreshes LMS so newly submitted homework is discovered',cachedSubmission:null,freshSubmission:fresh.rows[0].cells.L1.submissionId,scrapeCalls,download,pass:scrapeCalls>0});
fs.writeFileSync(path.join(out,'core-repro-results.json'),JSON.stringify({results},null,2));
console.log(JSON.stringify({results},null,2));
process.exitCode=results.every(r=>r.pass)?0:1;
