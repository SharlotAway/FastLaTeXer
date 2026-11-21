// Shared helpers for locating TeX Live tools and running child processes.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FALLBACK_TEX_BINS = [
  'D:\\Apps\\texlive\\2026\\bin\\windows',
  'C:\\texlive\\2026\\bin\\windows',
  'C:\\texlive\\2025\\bin\\windows',
];

const cache = {};

function findTool(name) {
  if (cache[name]) return cache[name];
  const exe = process.platform === 'win32' ? name + '.exe' : name;
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) {
      cache[name] = p;
      return p;
    }
  }
  for (const dir of FALLBACK_TEX_BINS) {
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) {
      cache[name] = p;
      return p;
    }
  }
  cache[name] = name;
  return name;
}

function runProcess(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: process.env,
        windowsHide: true,
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: '', error: e.message, timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch {}
    }, opts.timeout || 180000);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => finish({ code: -1, stdout, stderr, error: e.message, timedOut: false }));
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut, error: null }));
  });
}

module.exports = { findTool, runProcess };
