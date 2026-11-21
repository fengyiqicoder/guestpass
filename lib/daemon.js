'use strict';
// The GuestPass daemon: one per shared session. It serves the guest page, keeps
// the room state, mirrors the agent's transcript when it can, and keeps a
// Cloudflare tunnel open so the page is reachable from any browser.
//
// Guest (browser)  <->  tunnel  <->  this daemon  <->  `guestpass wait` / `say`  <->  the agent
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { reader } = require('./adapters');
const { ensureCloudflared } = require('./cloudflared');

const MAX_TEXT = 8000;
const LISTEN_GRACE = 90; // seconds since the agent last asked for messages before the page says "not listening"

function run(stateFile) {
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const dir = path.join(path.dirname(stateFile), st.key);
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  const dataFile = path.join(dir, 'data.json');
  const PAGE = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  const saveState = () => fs.writeFileSync(stateFile, JSON.stringify(st, null, 2), { mode: 0o600 });

  const s = Object.assign({ ver: 0, snapshot: [], replies: [], visitors: [], chat: [], busy: false, steps: [] },
    fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : {});
  const presence = new Map();
  let waiters = [];
  let lastListen = 0;
  const now = () => Date.now() / 1000;
  const save = () => fs.writeFileSync(dataFile, JSON.stringify(s));
  const bump = () => {
    s.ver += 1; save();
    const w = waiters; waiters = [];
    w.forEach((fn) => fn());
  };
  const waitChange = (ms) => new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    waiters.push(fin);
    setTimeout(fin, ms);
  });

  const read = st.transcript ? reader(st.agent) : null;
  const pending = () => s.visitors.filter((v) => !v.delivered);

  function feed() {
    const session = read ? s.snapshot : s.replies;
    let items = session.map((i) => Object.assign({ kind: 'session' }, i));
    const oldest = items.length ? items[0].ts : 0;
    items = items.concat(s.visitors.filter((v) => v.ts >= oldest - 1).map((v) => (
      { role: 'visitor', name: v.name, text: v.text, ts: v.ts, kind: 'visitor', delivered: v.delivered })));
    items.sort((a, b) => a.ts - b.ts);
    const t = now();
    const people = [...new Set([...presence.values()].filter((p) => t - p.ts < 40).map((p) => p.name))].sort();
    let busy = s.busy;
    if (!read) {
      // No transcript to watch: the agent is "working" from the moment it picks a message up until it replies.
      const lastTaken = Math.max(0, ...s.visitors.filter((v) => v.delivered).map((v) => v.takenAt || v.ts));
      const lastReply = s.replies.length ? s.replies[s.replies.length - 1].ts : 0;
      busy = lastTaken > lastReply && t - lastTaken < 1800;
    }
    return { ver: s.ver, items: items.slice(-40), busy, online: busy || t - lastListen < LISTEN_GRACE,
      steps: busy ? s.steps : [], chat: s.chat.slice(-100), people };
  }

  function send(res, code, body, ctype) {
    const b = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    res.writeHead(code, { 'Content-Type': ctype || 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Length': b.length, 'X-Robots-Tag': 'noindex' });
    res.end(b);
  }
  function body(req, limit) {
    return new Promise((resolve) => {
      const chunks = []; let n = 0; let over = false;
      req.on('data', (c) => { n += c.length; if (n > limit) over = true; else chunks.push(c); });
      req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
      req.on('error', () => resolve(null));
    });
  }
  async function json(req) {
    const b = await body(req, 2000000);
    if (b === null) return null;
    try { return JSON.parse(b.toString('utf8') || '{}'); } catch (e) { return null; }
  }
  const authed = (req) => req.headers.authorization === 'Bearer ' + st.token;
  // Optional password: a guest who knows it gets a cookie; without it the page shows a lock.
  const guestToken = st.passwordHash ? crypto.createHash('sha256').update(st.token + ':guest:' + st.passwordHash).digest('hex') : null;
  const cookieName = 'gp_' + st.room.slice(0, 12);
  const guestOk = (req) => {
    if (!guestToken || authed(req)) return true;
    const hit = String(req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(cookieName + '='));
    return !!hit && hit.slice(cookieName.length + 1) === guestToken;
  };
  let fails = [];
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CTYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf' };

  async function handle(req, res) {
    const u = new URL(req.url, 'http://x');
    const m = u.pathname.match(/^\/(r|api)\/([A-Za-z0-9_-]{8,64})(?:\/(feed|say|chat|file|login|inbox|ack|reply|info|stop))?(?:\/([A-Za-z0-9._-]{1,80}))?\/?$/);
    if (!m || m[2] !== st.room) return send(res, 404, { error: 'not found' });
    const api = m[1] === 'api'; const act = m[3]; const fname = m[4];

    if (api && act === 'login' && req.method === 'POST') {
      const b = await json(req);
      const t = Date.now();
      fails = fails.filter((x) => t - x < 60000);
      if (fails.length >= 8) return send(res, 429, { error: 'too many attempts' });
      const hash = crypto.createHash('sha256').update(st.passwordSalt + String((b && b.password) || '')).digest('hex');
      if (!guestToken || hash !== st.passwordHash) { fails.push(t); return send(res, 401, { error: 'wrong password' }); }
      res.setHeader('Set-Cookie', cookieName + '=' + guestToken + '; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax');
      return send(res, 200, { ok: true });
    }
    if (api && ['feed', 'say', 'chat', 'file'].includes(act) && !guestOk(req)) return send(res, 401, { error: 'password required' });

    if (req.method === 'GET') {
      if (!api && !act) {
        const html = PAGE.replace(/__ROOM__/g, st.room).replace(/__TITLE__/g, esc(st.title)).replace(/__AGENT__/g, esc(st.agentLabel));
        return send(res, 200, html, 'text/html; charset=utf-8');
      }
      if (!api) return send(res, 404, { error: 'not found' });
      if (act === 'feed') {
        const after = parseInt(u.searchParams.get('after') || '-1', 10);
        const cid = (u.searchParams.get('cid') || '').slice(0, 40);
        if (cid) presence.set(cid, { name: (u.searchParams.get('name') || '').trim().slice(0, 24) || 'Guest', ts: now() });
        if (s.ver <= after) await waitChange(25000);
        return send(res, 200, feed());
      }
      if (act === 'file' && fname) {
        const f = path.join(dir, 'files', fname);
        if (!fs.existsSync(f)) return send(res, 404, { error: 'not found' });
        return send(res, 200, fs.readFileSync(f), CTYPES[path.extname(f).slice(1).toLowerCase()] || 'application/octet-stream');
      }
      if (!authed(req)) return send(res, 403, { error: 'forbidden' });
      if (act === 'inbox') {
        // Long-poll for guest messages. They are only marked delivered on `ack`,
        // so a dropped connection never loses one.
        const wait = Math.min(25, Math.max(0, parseInt(u.searchParams.get('wait') || '25', 10)));
        const end = Date.now() + wait * 1000;
        lastListen = now();
        const wasOffline = feed().online === false;
        if (wasOffline) bump();
        while (!pending().length && Date.now() < end) { await waitChange(end - Date.now()); lastListen = now(); }
        return send(res, 200, { messages: pending().map((v) => Object.assign({ id: String(v.ts) }, v)) });
      }
      if (act === 'info') {
        return send(res, 200, { room: st.room, url: st.url, agent: st.agent, mirror: !!read, password: !!guestToken, pending: pending().length,
          listening: now() - lastListen < LISTEN_GRACE, guests: feed().people });
      }
      return send(res, 404, { error: 'not found' });
    }

    if (req.method !== 'POST' || !api) return send(res, 404, { error: 'not found' });
    if (act === 'file' && fname) {
      if (!authed(req)) return send(res, 403, { error: 'forbidden' });
      const b = await body(req, 8000000);
      if (b === null) return send(res, 413, { error: 'too large' });
      fs.writeFileSync(path.join(dir, 'files', fname), b);
      return send(res, 200, { ok: true, url: '/api/' + st.room + '/file/' + fname });
    }
    const b = await json(req);
    if (b === null) return send(res, 400, { error: 'bad body' });
    const name = (String(b.name || '').trim() || 'Guest').slice(0, 24);
    if (act === 'say' || act === 'chat') {
      const text = String(b.text || '').trim().slice(0, act === 'say' ? MAX_TEXT : 2000);
      if (!text) return send(res, 400, { error: 'empty' });
      if (act === 'say') { s.visitors.push({ name, text, ts: now(), delivered: false }); s.visitors = s.visitors.slice(-300); }
      else { s.chat.push({ name, text, ts: now() }); s.chat = s.chat.slice(-300); }
      bump();
      return send(res, 200, { ok: true });
    }
    if (!authed(req)) return send(res, 403, { error: 'forbidden' });
    if (act === 'ack') {
      const ids = new Set((b.ids || []).map(String)); let n = 0;
      for (const v of s.visitors) if (ids.has(String(v.ts)) && !v.delivered) { v.delivered = true; v.takenAt = now(); n += 1; }
      if (n) bump();
      return send(res, 200, { ok: true, acked: n });
    }
    if (act === 'reply') {
      const text = String(b.text || '').trim().slice(0, 20000);
      if (!text) return send(res, 400, { error: 'empty' });
      s.replies.push({ role: 'assistant', text, ts: now() }); s.replies = s.replies.slice(-60);
      bump();
      return send(res, 200, { ok: true });
    }
    if (act === 'stop') {
      send(res, 200, { ok: true });
      return shutdown();
    }
    return send(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => { log('error', e && e.stack || e); try { send(res, 500, { error: 'server error' }); } catch (_) {} });
  });

  // ---------- transcript mirror ----------
  let mirrorTimer = null;
  function mirror() {
    try {
      const r = read(st.transcript, 20);
      const next = JSON.stringify([r.items, r.busy, r.steps]);
      if (next !== JSON.stringify([s.snapshot, s.busy, s.steps])) {
        s.snapshot = r.items; s.busy = r.busy; s.steps = r.steps; bump();
      }
    } catch (e) { log('mirror error', String(e && e.message || e).slice(0, 160)); }
  }

  // ---------- tunnel ----------
  let tunnel = null; let stopping = false; let backoff = 2000;
  async function startTunnel() {
    if (stopping || st.noTunnel) return;
    let bin;
    try { bin = await ensureCloudflared(log); } catch (e) {
      st.tunnelError = 'cloudflared: ' + String(e && e.message || e); saveState(); log(st.tunnelError); return;
    }
    const named = !!st.tunnelToken;
    const args = named
      ? ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:' + st.port, 'run', '--token', st.tunnelToken]
      : ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:' + st.port];
    // http2 (TCP) on purpose: the default QUIC needs UDP, which many networks and proxies drop.
    let quick = null;
    tunnel = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (named) { st.url = st.publicUrl.replace(/\/+$/, '') + '/r/' + st.room; delete st.tunnelError; saveState(); }
    const onData = (d) => {
      const text = d.toString();
      fs.appendFileSync(path.join(dir, 'tunnel.log'), text);
      const hit = !named && text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (hit) quick = hit[0] + '/r/' + st.room;
      // The address is printed before the tunnel is connected; hand it out only once it works.
      if (quick && /Registered tunnel connection/.test(text) && st.url !== quick) {
        st.url = quick; delete st.tunnelError; saveState(); log('link', quick);
        backoff = 2000;
      }
    };
    tunnel.stdout.on('data', onData); tunnel.stderr.on('data', onData);
    tunnel.on('exit', (code) => {
      tunnel = null;
      if (stopping) return;
      log('tunnel exited', code, '- restarting in', backoff / 1000, 's');
      if (!named) { st.url = null; saveState(); } // a quick tunnel gets a new address every time it starts
      setTimeout(startTunnel, backoff); backoff = Math.min(backoff * 2, 60000);
    });
    tunnel.on('error', (e) => { st.tunnelError = String(e.message || e); saveState(); });
  }

  function shutdown() {
    if (stopping) return; stopping = true;
    log('stopping');
    if (mirrorTimer) clearInterval(mirrorTimer);
    if (tunnel) try { tunnel.kill(); } catch (e) {}
    server.close();
    try { fs.unlinkSync(stateFile); } catch (e) {}
    setTimeout(() => process.exit(0), 300);
  }
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

  server.listen(st.port || 0, '127.0.0.1', () => {
    st.port = server.address().port; st.pid = process.pid; st.localUrl = 'http://127.0.0.1:' + st.port + '/r/' + st.room;
    st.ready = true; saveState();
    log('listening on', st.port, 'agent', st.agent, 'mirror', !!read);
    if (read) { mirror(); mirrorTimer = setInterval(mirror, 2000); }
    startTunnel();
  });
}

module.exports = { run };
