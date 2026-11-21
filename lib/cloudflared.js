'use strict';
// Finds cloudflared, or downloads the official build into ~/.guestpass/bin the first time.
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BIN_DIR = path.join(os.homedir(), '.guestpass', 'bin');
const RELEASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';

function onPath(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(['/opt/homebrew/bin', '/usr/local/bin']);
  for (const d of dirs) for (const e of exts) {
    const f = path.join(d, name + e);
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch (err) {}
  }
  return null;
}

function asset() {
  const arch = { x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: '386' }[process.arch];
  if (!arch) return null;
  if (process.platform === 'darwin') return { file: 'cloudflared-darwin-' + arch + '.tgz', tgz: true };
  if (process.platform === 'linux') return { file: 'cloudflared-linux-' + arch };
  if (process.platform === 'win32') return { file: 'cloudflared-windows-' + arch + '.exe' };
  return null;
}

function download(url, dest, hops) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'guestpass' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 6) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, (hops || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('download failed: HTTP ' + res.statusCode)); }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function ensureCloudflared(log) {
  if (process.env.GUESTPASS_CLOUDFLARED) return process.env.GUESTPASS_CLOUDFLARED;
  const found = onPath('cloudflared');
  if (found) return found;
  const local = path.join(BIN_DIR, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (fs.existsSync(local)) return local;
  const a = asset();
  if (!a) throw new Error('no cloudflared build for ' + process.platform + '/' + process.arch + '; install it and try again');
  fs.mkdirSync(BIN_DIR, { recursive: true });
  if (log) log('downloading cloudflared (first run only)');
  const tmp = path.join(BIN_DIR, a.file + '.part');
  await download(RELEASE + a.file, tmp);
  if (a.tgz) {
    execFileSync('tar', ['-xzf', tmp, '-C', BIN_DIR]);
    fs.unlinkSync(tmp);
  } else {
    fs.renameSync(tmp, local);
  }
  if (process.platform !== 'win32') fs.chmodSync(local, 0o755);
  return local;
}

module.exports = { ensureCloudflared, onPath };
