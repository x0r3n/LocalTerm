'use strict';
const net = require('node:net');

function validateRule(rule) {
  if (!rule || typeof rule.id !== 'string' || typeof rule.label !== 'string' || typeof rule.hostId !== 'string' || !rule.hostId || !['local', 'remote', 'dynamic'].includes(rule.type)) throw Error('Invalid forwarding rule.');
  if (typeof rule.bindAddress !== 'string' || !rule.bindAddress.trim() || rule.bindAddress.length > 253 || /[\s\0]/.test(rule.bindAddress)) throw Error('Enter a valid listening address.');
  if (!Number.isInteger(Number(rule.bindPort)) || Number(rule.bindPort) < 1 || Number(rule.bindPort) > 65535) throw Error('Listening port must be between 1 and 65535.');
  if (rule.type !== 'dynamic' && (typeof rule.targetAddress !== 'string' || !rule.targetAddress.trim() || rule.targetAddress.length > 253 || /[\s\0]/.test(rule.targetAddress) || !Number.isInteger(Number(rule.targetPort)) || Number(rule.targetPort) < 1 || Number(rule.targetPort) > 65535)) throw Error('Enter a destination address and port between 1 and 65535.');
  return { ...rule, bindPort: Number(rule.bindPort), ...(rule.type !== 'dynamic' ? { targetPort: Number(rule.targetPort) } : {}) };
}

// A CONNECT-only SOCKS5 handshake. The target is opened by SSH, so domain names
// are resolved on the SSH server rather than on this computer.
function socksHandshake(socket, openTarget) {
  let buffer = Buffer.alloc(0), stage = 'greeting';
  const timer = setTimeout(() => socket.destroy(), 10000); timer.unref();
  const finish = () => { clearTimeout(timer); socket.removeListener('data', read); };
  socket.once('close', finish);
  const fail = code => { finish(); socket.end(Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0])); };
  function read(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 65536) return socket.destroy();
    if (stage === 'greeting') {
      if (buffer.length < 2) return;
      if (buffer[0] !== 5 || buffer[1] === 0) return socket.destroy();
      const count = buffer[1]; if (buffer.length < 2 + count) return;
      if (!buffer.subarray(2, 2 + count).includes(0)) { finish(); socket.end(Buffer.from([5, 255])); return; }
      socket.write(Buffer.from([5, 0])); buffer = buffer.subarray(2 + count); stage = 'request';
    }
    if (stage !== 'request' || buffer.length < 4) return;
    if (buffer[0] !== 5 || buffer[2] !== 0) return fail(1);
    if (buffer[1] !== 1) return fail(7);
    let length, address;
    if (buffer[3] === 1) { length = 10; if (buffer.length < length) return; address = [...buffer.subarray(4, 8)].join('.'); }
    else if (buffer[3] === 3) { if (buffer.length < 5) return; length = 7 + buffer[4]; if (buffer.length < length) return; address = buffer.subarray(5, length - 2).toString('utf8'); if (!address || /[\s\0]/.test(address)) return fail(8); }
    else if (buffer[3] === 4) { length = 22; if (buffer.length < length) return; address = Array.from({ length: 8 }, (_, i) => buffer.readUInt16BE(4 + i * 2).toString(16)).join(':'); }
    else return fail(8);
    const port = buffer.readUInt16BE(length - 2); if (!port) return fail(1);
    stage = 'connecting'; socket.pause(); finish();
    const remainder = buffer.subarray(length); buffer = Buffer.alloc(0);
    openTarget(address, port, (error, stream) => {
      if (socket.destroyed) { stream?.destroy(); return; }
      if (error) return fail(5);
      socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
      if (remainder.length) socket.unshift(remainder);
      bridge(socket, stream); socket.resume();
    });
  }
  socket.on('data', read);
}
function bridge(a, b) {
  a.on('error', () => b.destroy()); b.on('error', () => a.destroy());
  a.once('close', () => b.destroy()); b.once('close', () => a.destroy());
  a.pipe(b); b.pipe(a);
}
class ForwardManager {
  constructor({ openSSH, emit = () => {} }) { this.openSSH = openSSH; this.emit = emit; this.entries = new Map(); }
  list() { return [...this.entries.values()].map(e => ({ ruleId: e.rule.id, status: e.status, bindAddress: e.rule.bindAddress, bindPort: e.port || e.rule.bindPort })); }
  status(e, status, message) { e.status = status; this.emit({ ruleId: e.rule.id, status, bindAddress: e.rule.bindAddress, bindPort: e.port || e.rule.bindPort, ...(message ? { message } : {}) }); }
  stop(ruleId, message) {
    const e = this.entries.get(ruleId); if (!e) return { ruleId, status: 'stopped' };
    this.entries.delete(ruleId); e.stopped = true;
    e.server?.close(); for (const socket of e.sockets) socket.destroy();
    if (e.rule.type === 'remote' && e.status === 'running') { try { e.ssh?.client.unforwardIn(e.rule.bindAddress, e.port, () => {}); } catch {} }
    e.ssh?.close(); this.status(e, message ? 'error' : 'stopped', message);
    return { ruleId, status: message ? 'error' : 'stopped' };
  }
  stopAll() { for (const id of [...this.entries.keys()]) this.stop(id); }
  async start(input) {
    const rule = validateRule(input);
    if (this.entries.has(rule.id)) throw Error('This forwarding rule is already running or connecting.');
    const e = { rule, sockets: new Set(), stopped: false, status: 'connecting' }; this.entries.set(rule.id, e);
    try {
      e.ssh = await this.openSSH(rule.hostId);
      if (e.stopped) { e.ssh.close(); throw Error('Forwarding was stopped.'); }
      e.ssh.client.once('close', () => { if (!e.stopped) this.stop(rule.id, 'SSH connection closed.'); });
      e.ssh.client.on('error', error => { if (!e.stopped) this.stop(rule.id, error.message); });
      const track = socket => { e.sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => e.sockets.delete(socket)); return socket; };
      if (rule.type === 'remote') {
        e.ssh.client.on('tcp connection', (info, accept, reject) => {
          if (e.stopped || info.destPort !== e.port || info.destIP !== rule.bindAddress) return reject();
          const channel = track(accept()); const socket = track(net.connect({ host: rule.targetAddress, port: rule.targetPort, allowHalfOpen: true }));
          socket.setTimeout(20000, () => socket.destroy()); socket.once('connect', () => { socket.setTimeout(0); bridge(socket, channel); });
          socket.once('error', () => channel.destroy()); channel.once('close', () => socket.destroy());
        });
        e.port = await new Promise((resolve, reject) => e.ssh.client.forwardIn(rule.bindAddress, rule.bindPort, (error, port) => error ? reject(error) : resolve(port || rule.bindPort)));
      } else {
        e.server = net.createServer({ allowHalfOpen: true }, socket => {
          track(socket); if (e.stopped) return socket.destroy();
          const open = (address, port, callback) => e.ssh.client.forwardOut(socket.remoteAddress || '127.0.0.1', socket.remotePort || 0, address, port, (error, channel) => { if (channel) track(channel); if (e.stopped || socket.destroyed) { channel?.destroy(); return; } callback(error, channel); });
          if (rule.type === 'dynamic') socksHandshake(socket, open);
          else { socket.pause(); open(rule.targetAddress, rule.targetPort, (error, channel) => { if (error) return socket.destroy(); bridge(socket, channel); socket.resume(); }); }
        });
        await new Promise((resolve, reject) => {
          const fail = error => reject(error); e.server.once('error', fail);
          e.server.listen(rule.bindPort, rule.bindAddress, () => { e.server.removeListener('error', fail); resolve(); });
        });
        e.port = e.server.address().port;
        e.server.on('error', error => { if (!e.stopped) this.stop(rule.id, error.message); });
      }
      if (e.stopped) { e.server?.close(); e.ssh.close(); throw Error('Forwarding was stopped.'); }
      this.status(e, 'running'); return this.list().find(item => item.ruleId === rule.id);
    } catch (error) { if (!e.stopped) this.stop(rule.id, error.message); throw error; }
  }
}
module.exports = { ForwardManager, validateRule, socksHandshake };
