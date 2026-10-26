// R32: no Node TCP/DNS/fetch. Named pipes for local compiler IPC remain available.
const net = require('node:net');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let a = args[0];
  if (Array.isArray(a)) a = a[0];
  const pipe = typeof a === 'string' && !/^\d+$/.test(a) || a && typeof a === 'object' && a.path && !a.port;
  if (!pipe) throw Error('AUDIT_R32_TCP_FORBIDDEN');
  return original.apply(this, args);
};
const dns = require('node:dns');
dns.lookup = dns.resolve = () => { throw Error('AUDIT_R32_DNS_FORBIDDEN'); };
globalThis.fetch = async () => { throw Error('AUDIT_R32_FETCH_FORBIDDEN'); };
