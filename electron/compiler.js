// LaTeX compilation via the local TeX Live toolchain (latexmk).
const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');
const { findTool, runProcess } = require('./tex-tools');

function detectEngine(mainFile) {
  let content = '';
  try { content = fs.readFileSync(mainFile, 'utf8'); } catch { return null; }
  const lines = content.split(/\r?\n/).slice(0, 80);
  for (const line of lines) {
    const m = line.match(/^\s*%\s*!TEX\s+(?:TS-)?program\s*=\s*(\S+)/i);
    if (m) {
      const prog = m[1].toLowerCase();
      if (prog.includes('xelatex')) return 'xelatex';
      if (prog.includes('lualatex')) return 'lualatex';
      if (prog.includes('pdflatex')) return 'pdflatex';
    }
  }
  return null;
}

function resolveFile(p, mainFile) {
  let f = p.replace(/^\.\//, '').replace(/^\(/, '').trim();
  if (!f) return mainFile;
  if (path.isAbsolute(f)) return f;
  const abs = path.resolve(path.dirname(mainFile), f);
  return abs;
}

function parseLog(log, mainFile) {
  const diags = [];
  if (!log) return diags;
  const lines = log.split(/\r?\n/);
  const seen = new Set();
  for (const raw of lines) {
    const line = raw;
    // file:line: error (produced by -file-line-error)
    const m = line.match(/^(?:\.\/|\.\.\/)?(.+?):(\d+):\s*(.*)$/);
    if (m && /error|undefined|missing|runaway|emergency|capacity|fatal|not found|file `|undefined control/i.test(line)) {
      const file = resolveFile(m[1], mainFile);
      const lnum = parseInt(m[2], 10);
      const key = file + ':' + lnum + ':' + m[3];
      if (seen.has(key)) continue;
      seen.add(key);
      diags.push({ severity: 'error', file, line: lnum, message: m[3].trim(), raw });
      continue;
    }
    // traditional "! message" errors (fallback)
    if (line.trimStart().startsWith('!')) {
      const lm = line.match(/l\.(\d+)/);
      const lnum = lm ? parseInt(lm[1], 10) : 0;
      const msg = line.trimStart().replace(/^!\s*/, '');
      const key = mainFile + ':' + lnum + ':' + msg;
      if (!seen.has(key)) {
        seen.add(key);
        diags.push({ severity: 'error', file: mainFile, line: lnum, message: msg, raw });
      }
      continue;
    }
    // LaTeX / Package / Class warnings
    const wm = line.match(/^(LaTeX|Class|Package)(?:\s+[^\s:]+)?\s+Warning:\s*(.*)$/);
    if (wm) {
      let lnum = 0;
      const nlm = line.match(/on input line\s+(\d+)/);
      if (nlm) lnum = parseInt(nlm[1], 10);
      const msg = wm[2].trim();
      const key = mainFile + ':w:' + lnum + ':' + msg;
      if (!seen.has(key)) {
        seen.add(key);
        diags.push({ severity: 'warning', file: mainFile, line: lnum, message: msg, raw });
      }
      continue;
    }
    if (/Overfull|Underfull/.test(line)) {
      const key = mainFile + ':of:' + line.trim();
      if (!seen.has(key)) {
        seen.add(key);
        diags.push({ severity: 'warning', file: mainFile, line: 0, message: line.trim(), raw });
      }
    }
  }
  return diags;
}

async function compile({ mainFile, rootDir, buildDir, engine }) {
  const latexmk = findTool('latexmk');
  const effEngine = detectEngine(mainFile) || engine || 'xelatex';
  await fsp.mkdir(buildDir, { recursive: true });
  const base = path.basename(mainFile, path.extname(mainFile));
  const args = [
    '-pdf',
    '-' + effEngine,
    '-synctex=1',
    '-interaction=nonstopmode',
    '-file-line-error',
    '-f',
    '-outdir=' + buildDir,
    '-cd',
    mainFile,
  ];
  const res = await runProcess(latexmk, args, { cwd: rootDir, timeout: 240000 });
  const logPath = path.join(buildDir, base + '.log');
  const pdfPath = path.join(buildDir, base + '.pdf');
  const synctexPath = path.join(buildDir, base + '.synctex.gz');
  let log = '';
  try { log = await fsp.readFile(logPath, 'utf8'); } catch {}
  const pdfExists = fs.existsSync(pdfPath);
  const diagnostics = parseLog(log, mainFile);
  return {
    success: res.code === 0 && pdfExists,
    exitCode: res.code,
    timedOut: res.timedOut,
    output: (res.stdout || '') + '\n' + (res.stderr || ''),
    log,
    logPath,
    pdfPath,
    synctexPath,
    diagnostics,
    engine: effEngine,
    error: res.error || null,
  };
}

module.exports = { compile, detectEngine, parseLog };
