// Audit guard: no TCP or DNS, including loopback. Named pipes used by tsx/Next are allowed.
const net = require('node:net');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let a = args[0];
  if (Array.isArray(a)) a = a[0];
  const pipe = typeof a === 'string' && !/^\d+$/.test(a) || a && typeof a === 'object' && a.path && !a.port;
  if (!pipe) throw Error('AUDIT_R30_TCP_FORBIDDEN');
  return original.apply(this, args);
};
const dns = require('node:dns');
dns.lookup = dns.resolve = () => { throw Error('AUDIT_R30_DNS_FORBIDDEN'); };
globalThis.fetch = async () => { throw Error('AUDIT_R30_FETCH_FORBIDDEN'); };
