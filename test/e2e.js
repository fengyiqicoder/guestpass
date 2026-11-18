'use strict';
// End-to-end test with no tunnel: start, guest says something, agent waits, agent replies, password, stop.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'guestpass.js');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-test-'));
const env = Object.assign({}, process.env, { GUESTPASS_HOME: home });
for (const k of Object.keys(env)) if (/^CLAUDE|^CODEX|^AI_AGENT/.test(k)) delete env[k];
const gp = (args, input) => execFileSync(process.execPath, [BIN].concat(args), { env, input, encoding: 'utf8' });
const state = (id) => { const f = fs.readdirSync(path.join(home, 's')).filter((x) => x.endsWith('.json')); assert(f.length >= 1); return f.map((x) => JSON.parse(fs.readFileSync(path.join(home, 's', x)))).find((s) => !id || s.title === id); };
const req = async (st, method, act, body, headers) => {
  const r = await fetch('http://127.0.0.1:' + st.port + '/api/' + st.room + '/' + act, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null), cookie: r.headers.get('set-cookie') };
};

(async () => {
  // 1. generic agent, no mirror
  let out = gp(['start', '--no-tunnel', '--id', 'a', '--agent', 'testbot', '--title', 'A']);
  assert(/GuestPass is on/.test(out) && /guestpass say/.test(out), out);
  let st = state('A');
  const page = await (await fetch(st.localUrl)).text();
  assert(page.includes("AGENT = 'testbot'") && !page.includes('__ROOM__'), 'page placeholders');
  assert.strictEqual((await req(st, 'GET', 'inbox?wait=0')).status, 403, 'inbox needs the token');
  assert.strictEqual((await req(st, 'POST', 'say', { name: 'Mia', text: 'hello agent' })).status, 200);
  let feed = (await req(st, 'GET', 'feed?after=-1')).json;
  assert(feed.items.some((i) => i.kind === 'visitor' && !i.delivered));
  out = gp(['wait', '--id', 'a', '--timeout', '5']);
  assert(/Message from guest "Mia"/.test(out) && /hello agent/.test(out), out);
  feed = (await req(st, 'GET', 'feed?after=-1')).json;
  assert(feed.items.find((i) => i.kind === 'visitor').delivered && feed.busy && feed.online, 'delivered + busy');
  gp(['say', '--id', 'a'], 'hi Mia, **done**');
  feed = (await req(st, 'GET', 'feed?after=-1')).json;
  assert(feed.items.some((i) => i.role === 'assistant' && /done/.test(i.text)) && !feed.busy, 'reply shown');
  out = gp(['wait', '--id', 'a', '--timeout', '1']);
  assert(/No message yet/.test(out), out);
  // a waiting agent is woken by a new message
  const w = spawn(process.execPath, [BIN, 'wait', '--id', 'a'], { env }); let got = '';
  w.stdout.on('data', (d) => { got += d; });
  await new Promise((r) => setTimeout(r, 600));
  await req(st, 'POST', 'say', { name: 'Leo', text: 'second' });
  await new Promise((r) => w.on('exit', r));
  assert(/second/.test(got), got);
  // file sharing
  const img = path.join(home, 'x.png'); fs.writeFileSync(img, Buffer.from('89504e470d0a1a0a', 'hex'));
  out = gp(['send', img, '--id', 'a']);
  const url = out.match(/\((\/api\/[^)]+)\)/)[1];
  assert.strictEqual((await fetch('http://127.0.0.1:' + st.port + url)).status, 200);

  // 2. password
  gp(['start', '--no-tunnel', '--id', 'b', '--agent', 'testbot', '--title', 'B', '--password', 'tulip-42']);
  const sb = state('B');
  assert.strictEqual((await req(sb, 'GET', 'feed?after=-1')).status, 401);
  assert.strictEqual((await req(sb, 'POST', 'say', { text: 'x' })).status, 401);
  assert.strictEqual((await req(sb, 'POST', 'login', { password: 'nope' })).status, 401);
  const ok = await req(sb, 'POST', 'login', { password: 'tulip-42' });
  assert.strictEqual(ok.status, 200);
  const cookie = ok.cookie.split(';')[0];
  assert.strictEqual((await req(sb, 'GET', 'feed?after=-1', null, { Cookie: cookie })).status, 200);
  assert.strictEqual((await req(sb, 'POST', 'say', { text: 'with pw' }, { Cookie: cookie })).status, 200);

  // 3. status + stop
  out = gp(['status']);
  assert(out.split('\n').filter((l) => /127\.0\.0\.1/.test(l)).length === 2, out);
  gp(['stop', '--id', 'a']); gp(['stop', '--id', 'b']);
  assert(/Nothing is shared/.test(gp(['status'])));
  await fetch(st.localUrl).then(() => assert.fail('still up'), () => {});
  console.log('e2e: all passed');
})().catch((e) => { console.error(e); try { gp(['stop', '--id', 'a']); gp(['stop', '--id', 'b']); } catch (_) {} process.exit(1); });
