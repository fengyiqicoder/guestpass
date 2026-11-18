'use strict';
// Transcript adapters: read an agent's own session log so the page can show the
// conversation and what the agent is doing, with no extra work from the agent.
// An agent without an adapter still works: it posts replies with `guestpass say`.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SKIP = /^\s*(<task-notification|<command-|<local-command|<bash-|Caveat:|\[Request interrupted|<cross-session|<system-reminder)/;

function clean(text) {
  return String(text || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, '[pasted content]')
    .trim();
}

function readTail(file, bytes) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // first line may be cut in half
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}

// ---------- Claude Code ----------

function findClaudeTranscript(sessionId) {
  if (!sessionId) return null;
  const root = path.join(os.homedir(), '.claude', 'projects');
  let dirs;
  try { dirs = fs.readdirSync(root); } catch (e) { return null; }
  for (const d of dirs) {
    const f = path.join(root, d, sessionId + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function claudeStepLabel(b) {
  const name = b.name || '';
  const inp = b.input || {};
  const base = (p) => path.basename(String(p || ''));
  if (/guestpass(\.js)?["']?\s+wait/.test(String(inp.command || ''))) return null; // the listening loop is plumbing
  if (inp.description) return String(inp.description).slice(0, 120);
  if (name === 'Read') return 'Read ' + base(inp.file_path);
  if (name === 'Edit' || name === 'NotebookEdit') return 'Edit ' + base(inp.file_path);
  if (name === 'Write') return 'Write ' + base(inp.file_path);
  if (name === 'WebSearch' || name === 'WebFetch') return 'Web: ' + String(inp.query || inp.url || '').slice(0, 80);
  if (name === 'Skill') return 'Skill ' + String(inp.skill || '');
  if (name === 'Agent' || name === 'Task') return 'Subagent: ' + String(inp.description || '').slice(0, 80);
  return name;
}

// Returns {items, busy, steps}. One item per thing a person said, plus the agent's
// final text for each turn (text written before a tool call becomes a step instead).
function readClaude(file, n) {
  const lines = readTail(file, 4000000);
  const items = [];
  let buf = [];
  let steps = [];
  let last = null;
  const flush = () => {
    if (buf.length) {
      items.push({ role: 'assistant', text: buf.map((x) => x[0]).join('\n\n'), ts: buf[buf.length - 1][1] });
      buf = [];
    }
  };
  const tsOf = (r) => {
    const t = Date.parse(r.timestamp || '');
    return Math.round((isNaN(t) ? Date.now() : t)) / 1000;
  };
  for (const line of lines) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch (e) { continue; }
    if (r.isSidechain || (r.type !== 'user' && r.type !== 'assistant')) continue;
    last = r;
    const content = (r.message || {}).content;
    let blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : (content || []);
    blocks = blocks.filter((b) => b && typeof b === 'object');
    if (r.type === 'assistant') {
      for (const b of blocks) {
        if (b.type === 'tool_use') {
          for (const x of buf) steps.push(x[0].split('\n')[0].slice(0, 120));
          buf = [];
          const lab = claudeStepLabel(b);
          if (lab) steps.push(lab);
        } else if (b.type === 'text' && clean(b.text)) {
          buf.push([clean(b.text), tsOf(r)]);
        }
      }
      continue;
    }
    if (blocks.some((b) => b.type === 'tool_result') || r.isMeta) continue;
    const text = clean(blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('\n'));
    if (!text) continue;
    flush();
    steps = [];
    if (!SKIP.test(text)) items.push({ role: 'user', text, ts: tsOf(r) });
  }
  flush();
  let busy = true;
  if (last) {
    const msg = last.message || {};
    const hasTool = (Array.isArray(msg.content) ? msg.content : []).some((b) => b && b.type === 'tool_use');
    if (last.type === 'assistant' && !hasTool && [undefined, null, 'end_turn', 'stop_sequence'].includes(msg.stop_reason)) busy = false;
    if (Date.now() - fs.statSync(file).mtimeMs > 180000) busy = false;
  } else {
    busy = false;
  }
  return { items: items.slice(-n), busy, steps: busy ? steps.slice(-15) : [] };
}

// ---------- registry ----------

// detect() looks at the environment of the process that ran `guestpass start`.
const AGENTS = [
  {
    id: 'claude', label: 'Claude',
    detect: (env) => !!(env.CLAUDECODE || env.CLAUDE_CODE_SESSION_ID),
    sessionId: (env) => env.CLAUDE_CODE_SESSION_ID || null,
    transcript: (env) => findClaudeTranscript(env.CLAUDE_CODE_SESSION_ID),
    read: readClaude,
  },
  { id: 'codex', label: 'Codex', detect: (env) => !!(env.CODEX_HOME || env.CODEX_SANDBOX || env.CODEX_THREAD_ID), sessionId: (env) => env.CODEX_THREAD_ID || null },
  { id: 'gemini', label: 'Gemini', detect: (env) => !!env.GEMINI_CLI, sessionId: () => null },
  { id: 'cursor', label: 'Cursor', detect: (env) => !!(env.CURSOR_AGENT || env.CURSOR_TRACE_ID), sessionId: () => null },
  { id: 'opencode', label: 'OpenCode', detect: (env) => !!env.OPENCODE, sessionId: () => null },
];

function detectAgent(env, wanted) {
  if (wanted) {
    const hit = AGENTS.find((a) => a.id === String(wanted).toLowerCase());
    return hit || { id: String(wanted).toLowerCase(), label: String(wanted), detect: () => true, sessionId: () => null };
  }
  return AGENTS.find((a) => a.detect(env)) || { id: 'agent', label: 'Agent', detect: () => true, sessionId: () => null };
}

function reader(agentId) {
  const a = AGENTS.find((x) => x.id === agentId);
  return a && a.read ? a.read : null;
}

module.exports = { detectAgent, reader, readClaude, findClaudeTranscript, AGENTS };
