// Smoke test for the pure logic in the main process (no Electron needed).
const { parseLog, detectEngine } = require('../electron/compiler');

const log = [
  './main.tex:12: Undefined control sequence.',
  "LaTeX Warning: Reference `x' undefined on input line 5.",
  'Overfull \\hbox (12.3pt too wide) in paragraph at lines 20--21',
  '! Missing $ inserted.',
  "./sections/intro.tex:3: LaTeX Error: File `foo' not found.",
].join('\n');

const d = parseLog(log, 'D:/proj/main.tex');
console.log(JSON.stringify(d, null, 1));

console.log('detect xelatex:', detectEngineFrom('% !TEX program = xelatex\n\\documentclass{article}'));
console.log('detect default:', detectEngineFrom('\\documentclass{article}'));

function detectEngineFrom(content) {
  // detectEngine reads a file; reimplement a tiny inline check by writing a temp file.
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmp = path.join(os.tmpdir(), 'flx-engine-detect.tex');
  fs.writeFileSync(tmp, content);
  const r = detectEngine(tmp);
  fs.unlinkSync(tmp);
  return r;
}
