const net=require('node:net');const orig=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const a=args[0];const host=typeof a==='object'?a.host:(typeof args[1]==='string'?args[1]:undefined);if(host&&!['127.0.0.1','localhost','::1'].includes(host))throw new Error('AUDIT_NETWORK_BLOCKED: '+host);return orig.apply(this,args);};
const path=require('node:path');const {root}=require('./paths.json');
const {chromium}=require(path.join(root,'node_modules/playwright'));const launch=chromium.launch.bind(chromium);
chromium.launch=(options={})=>launch({...options,proxy:{server:'http://127.0.0.1:9'}});
