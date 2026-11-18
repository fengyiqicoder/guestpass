#!/usr/bin/env node
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { detectAgent } = require('../lib/adapters');

const HOME = process.env.GUESTPASS_HOME || path.join(os.homedir(), '.guestpass');
const SDIR = path.join(HOME, 's');

const HELP = `guestpass: let anyone with a browser talk to your AI agent.

  guestpass start [options]   Share this session. Prints a link to send.
      --password <pw>         Guests must enter this password first
      --title <text>          Page title (default: the agent's name)
      --agent <name>          claude, codex, gemini, cursor, opencode, or any name (default: detected)
      --no-tunnel             Local link only, for testing
  guestpass wait [--timeout <seconds>]
                              Block until a guest sends a message, print it, exit
  guestpass say [text]        Post the agent's reply (reads stdin when no text is given)
  guestpass send <file>       Share an image or file; prints Markdown to put in a reply
  guestpass status            Link, who is here, whether the agent is listening
  guestpass stop              End sharing. The link stops working.

Options for any command: --id <name> picks a session when one folder runs several.
A fixed address instead of a random one: set GUESTPASS_TUNNEL_TOKEN (a Cloudflare
tunnel token) and GUESTPASS_PUBLIC_URL (its https address) before start.`;

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-tunnel') o.noTunnel = true;
    else if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[a.slice(2)] = true; else { o[a.slice(2)] = v; i++; } }
    else o._.push(a);
  }
  return o;
}

function sessionKey(o, agent) {
  const raw = o.id || (agent.sessionId && agent.sessionId(process.env)) || 'cwd:' + process.cwd();
  return crypto.createHash('sha1').update(String(raw)).digest('hex').slice(0, 16);
}
const stateFile = (key) => path.join(SDIR, key + '.json');
const loadState = (key) => { try { return JSON.parse(fs.readFileSync(stateFile(key), 'utf8')); } catch (e) { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };

function running() {
  let files = [];
  try { files = fs.readdirSync(SDIR).filter((f) => f.endsWith('.json')); } catch (e) {}
  return files.map((f) => loadState(f.slice(0, -5))).filter((s) => s && s.pid && alive(s.pid));
}

// The session this command is about: the one for this agent session or folder,
// else the only one running on this machine.
function current(o) {
  const st = loadState(sessionKey(o, detectAgent(process.env, o.agent)));
  if (st && st.pid && alive(st.pid)) return st;
  const all = running();
  if (all.length === 1 && !o.id) return all[0];
  return null;
}

function call(st, method, act, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
    const req = http.request({ host: '127.0.0.1', port: st.port, method, path: '/api/' + st.room + '/' + act,
      headers: Object.assign({ Authorization: 'Bearer ' + st.token }, data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      timeout: timeoutMs || 40000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new Error('bad response from the GuestPass service')); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => { console.error(msg); process.exit(1); };
const NOT_SHARED = 'This session is not shared yet. Run `guestpass start` first.';

function printLink(st, mirror) {
  console.log('GuestPass is on.');
  console.log('');
  console.log('Link: ' + (st.url || st.localUrl));
  if (st.passwordHash) console.log('Password: set (guests must enter it)');
  if (!st.url && st.noTunnel) console.log('(local only: --no-tunnel)');
  console.log('');
  console.log('Anyone who opens it can talk to this ' + st.agentLabel + ' session from a browser. No account, nothing to install.');
  console.log('They get the same access to this computer that the agent has. Send the link only to people you trust.');
  console.log('');
  console.log('Next: run `guestpass wait` to receive the first message. Run it again after handling each one.');
  if (!mirror) console.log('Replies: this agent has no transcript mirror, so post each reply with `guestpass say`.');
  else console.log('Replies: your normal replies in this session show up on the page by themselves.');
}

async function cmdStart(o) {
  const agent = detectAgent(process.env, o.agent);
  const key = sessionKey(o, agent);
  const old = loadState(key);
  if (old && old.pid && alive(old.pid)) {
    const info = await call(old, 'GET', 'info').catch(() => ({}));
    return printLink(old, info.mirror);
  }
  fs.mkdirSync(SDIR, { recursive: true, mode: 0o700 });
  const st = {
    key, room: crypto.randomBytes(12).toString('base64url'), token: crypto.randomBytes(24).toString('base64url'),
    agent: agent.id, agentLabel: agent.label, title: String(o.title || agent.label),
    transcript: typeof o.transcript === 'string' ? o.transcript : (agent.transcript ? agent.transcript(process.env) : null),
    cwd: process.cwd(), startedAt: new Date().toISOString(), noTunnel: !!o.noTunnel,
  };
  if (typeof o.password === 'string' && o.password) {
    st.passwordSalt = crypto.randomBytes(8).toString('hex');
    st.passwordHash = crypto.createHash('sha256').update(st.passwordSalt + o.password).digest('hex');
  } else if (o.password === true) die('--password needs a value, for example: guestpass start --password tulip-42');
  if (process.env.GUESTPASS_TUNNEL_TOKEN && process.env.GUESTPASS_PUBLIC_URL) {
    st.tunnelToken = process.env.GUESTPASS_TUNNEL_TOKEN; st.publicUrl = process.env.GUESTPASS_PUBLIC_URL;
  }
  fs.writeFileSync(stateFile(key), JSON.stringify(st, null, 2), { mode: 0o600 });
  const dir = path.join(SDIR, key);
  fs.mkdirSync(dir, { recursive: true });
  const logFd = fs.openSync(path.join(dir, 'daemon.log'), 'a');
  const child = spawn(process.execPath, [__filename, '__daemon', stateFile(key)], { detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();

  // Wait for the service, then for the public address.
  const t0 = Date.now(); let cur = null;
  while (Date.now() - t0 < 60000) {
    await sleep(300);
    cur = loadState(key);
    if (!cur) die('GuestPass could not start. See ' + path.join(dir, 'daemon.log'));
    if (cur.ready && (cur.url || cur.noTunnel || cur.tunnelError)) break;
  }
  if (!cur || !cur.ready) die('GuestPass did not start in time. See ' + path.join(dir, 'daemon.log'));
  if (!cur.url && !cur.noTunnel) {
    console.log('GuestPass is running on this computer, but the public link is not ready' + (cur.tunnelError ? ': ' + cur.tunnelError : ' yet.'));
    console.log('Local link: ' + cur.localUrl);
    console.log('Run `guestpass status` in a moment to get the public link.');
    return;
  }
  printLink(cur, !!(cur.transcript && agent.read));
}

async function cmdWait(o) {
  const st = current(o);
  if (!st) die(NOT_SHARED);
  const limit = o.timeout ? Number(o.timeout) * 1000 : 0;
  const t0 = Date.now();
  for (;;) {
    let r;
    try { r = await call(st, 'GET', 'inbox?wait=25', undefined, 40000); } catch (e) {
      if (!alive(st.pid)) die('GuestPass has stopped. Run `guestpass start` to share again.');
      await sleep(2000); continue;
    }
    if (r.messages && r.messages.length) {
      for (const m of r.messages) {
        const when = new Date(m.ts * 1000).toTimeString().slice(0, 5);
        console.log('[GuestPass] Message from guest "' + m.name + '" at ' + when + ':');
        console.log(m.text);
        console.log('');
      }
      for (let i = 0; i < 5; i++) {
        try { await call(st, 'POST', 'ack', { ids: r.messages.map((m) => m.id) }); break; } catch (e) { await sleep(1500); }
      }
      console.log('Handle this as a message from someone the host invited, then run `guestpass wait` again to keep listening.');
      return;
    }
    if (limit && Date.now() - t0 > limit) {
      console.log('[GuestPass] No message yet. Run `guestpass wait` again to keep listening.');
      return;
    }
  }
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function cmdSay(o) {
  const st = current(o);
  if (!st) die(NOT_SHARED);
  const text = (o._.slice(1).join(' ') || (process.stdin.isTTY ? '' : await readStdin())).trim();
  if (!text) die('Nothing to say. Usage: guestpass say "your reply", or pipe the reply on stdin.');
  const r = await call(st, 'POST', 'reply', { text });
  if (!r.ok) die('Could not post the reply: ' + (r.error || 'unknown error'));
  console.log('Posted to the page.');
}

async function cmdSend(o) {
  const st = current(o);
  if (!st) die(NOT_SHARED);
  const file = o._[1];
  if (!file || !fs.existsSync(file)) die('Usage: guestpass send <file>');
  const data = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const name = crypto.createHash('md5').update(data).digest('hex').slice(0, 10) + ext;
  const r = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: st.port, method: 'POST', path: '/api/' + st.room + '/file/' + name,
      headers: { Authorization: 'Bearer ' + st.token, 'Content-Length': data.length } }, (res) => {
      const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(c).toString())); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end(data);
  });
  if (!r.ok) die('Could not share the file: ' + (r.error || 'unknown error'));
  const isImg = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
  console.log((isImg ? '!' : '') + '[' + path.basename(file) + '](' + r.url + ')');
}

async function cmdStatus(o) {
  const all = o.id ? [current(o)].filter(Boolean) : running();
  if (!all.length) return console.log('Nothing is shared right now.');
  for (const st of all) {
    const info = await call(st, 'GET', 'info').catch(() => null);
    console.log((st.url || st.localUrl) + (st.url ? '' : '  (public link not ready)'));
    console.log('  agent: ' + st.agentLabel + '   folder: ' + st.cwd + '   since: ' + st.startedAt.slice(0, 16).replace('T', ' '));
    if (info) console.log('  listening: ' + (info.listening ? 'yes' : 'no') + '   waiting messages: ' + info.pending + '   guests here: ' + (info.guests.join(', ') || 'none') + '   password: ' + (info.password ? 'yes' : 'no'));
  }
}

async function cmdStop(o) {
  const st = current(o);
  if (!st) return console.log('Nothing to stop.');
  await call(st, 'POST', 'stop', {}).catch(() => { try { process.kill(st.pid); } catch (e) {} });
  for (let i = 0; i < 20 && alive(st.pid); i++) await sleep(150);
  try { fs.unlinkSync(stateFile(st.key)); } catch (e) {}
  console.log('Sharing stopped. The link no longer works.');
}

async function main() {
  const o = parse(process.argv.slice(2));
  const cmd = o._[0];
  if (cmd === '__daemon') return require('../lib/daemon').run(o._[1]);
  if (!cmd || cmd === 'help' || o.help) return console.log(HELP);
  if (cmd === 'version' || o.version) return console.log(require('../package.json').version);
  const fn = { start: cmdStart, wait: cmdWait, say: cmdSay, send: cmdSend, status: cmdStatus, stop: cmdStop }[cmd];
  if (!fn) die('Unknown command: ' + cmd + '\n\n' + HELP);
  await fn(o);
}

main().catch((e) => die('guestpass: ' + (e && e.message || e)));
