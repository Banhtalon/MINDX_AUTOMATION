// Audit process only. Never loaded by the original application.
const net = require('node:net');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const a = args[0];
  const opts = Array.isArray(a) ? a[0] : a;
  const host = opts && typeof opts === 'object' ? opts.host : (typeof args[1] === 'string' ? args[1] : undefined);
  if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('AUDIT_EXTERNAL_NETWORK_BLOCKED: ' + host);
  }
  return original.apply(this, args);
};
