// SyncTeX forward / inverse mapping via the TeX Live `synctex` CLI.
const { findTool, runProcess } = require('./tex-tools');
const path = require('node:path');
const { existsSync } = require('node:fs');

async function synctexForward({ pdfPath, line, column, inputFile }) {
  const tool = findTool('synctex');
  const res = await runProcess(tool, ['view', '-i', `${line}:${column || 0}:${inputFile}`, '-o', pdfPath], { timeout: 20000 });
  if (res.code !== 0) return null;
  const out = (res.stdout || '') + '\n' + (res.stderr || '');
  const page = parseInt((out.match(/Page:\s*(\d+)/i) || [])[1], 10);
  if (!page || isNaN(page)) return null;
  let x = parseFloat((out.match(/x:\s*([\d.]+)/i) || [])[1]);
  let y = parseFloat((out.match(/y:\s*([\d.]+)/i) || [])[1]);
  if (isNaN(x)) x = 0;
  if (isNaN(y)) y = 0;
  return { page, x, y };
}

async function synctexInverse({ pdfPath, page, x, y, rootDir, mainFile }) {
  const tool = findTool('synctex');
  // Correct CLI form: `synctex edit -o page:x:y:file`
  const res = await runProcess(tool, ['edit', '-o', `${page}:${x}:${y}:${pdfPath}`], { cwd: rootDir || undefined, timeout: 20000 });
  if (res.code !== 0) return null;
  const out = (res.stdout || '') + '\n' + (res.stderr || '');
  let line = parseInt((out.match(/Line:\s*(\d+)/i) || [])[1], 10);
  let column = parseInt((out.match(/Column:\s*(\d+)/i) || [])[1], 10);
  if (isNaN(line)) line = 0;
  if (isNaN(column)) column = 0;
  const input = out.match(/^Input:[ \t]*([^\r\n]+)/im)?.[1].trim();
  if (!input || !line) return null;
  const pdfDir = path.dirname(pdfPath);
  const sourceDir = mainFile ? path.dirname(mainFile) : rootDir || pdfDir;
  const candidates = [sourceDir, rootDir || pdfDir, pdfDir].map((dir) => path.resolve(dir, input));
  return { line, column, file: candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] };
}

module.exports = { synctexForward, synctexInverse };
