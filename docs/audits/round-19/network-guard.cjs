// Audit only: block outbound Node sockets; no credentials are inherited.
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = a && typeof a === 'object' ? a.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw Error('AUDIT_EXTERNAL_NETWORK_BLOCKED: ' + host);
  return connect.apply(this, args);
};
