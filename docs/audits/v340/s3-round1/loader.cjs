const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {root,mirror}=require('./paths.json');
const original=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){
 if(name.startsWith('@/'))name=path.join(mirror,'src',name.slice(2));
 try{return original.call(this,name,parent,...rest);}catch(e){
  if(!name.startsWith('.')&&!path.isAbsolute(name))return original.call(this,path.join(root,'node_modules',name),parent,...rest);
  throw e;
 }
};
const swc=require(path.join(root,'node_modules/@next/swc-win32-x64-msvc'));
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(mod,file)=>{
 const result=swc.transformSync(fs.readFileSync(file,'utf8'),false,Buffer.from(JSON.stringify({filename:file,jsc:{parser:{syntax:'typescript',tsx:ext==='.tsx'},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}})));
 mod._compile(result.code,file);
};
// Deny external network before loading any suite; browser routes in suites remain mocked.
const net=require('node:net'); const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const a=args[0];const host=typeof a==='object'?a.host:(typeof args[1]==='string'?args[1]:undefined);if(host&&!['127.0.0.1','localhost','::1'].includes(host))throw new Error('AUDIT_NETWORK_BLOCKED: '+host);return connect.apply(this,args);};
require(path.resolve(process.argv[2]));
