// SyncTeX forward / inverse mapping via the TeX Live `synctex` CLI.
const { findTool, runProcess } = require('./tex-tools');

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

async function synctexInverse({ pdfPath, page, x, y }) {
  const tool = findTool('synctex');
  // Correct CLI form: `synctex edit -o page:x:y:file`
  const res = await runProcess(tool, ['edit', '-o', `${page}:${x}:${y}:${pdfPath}`], { timeout: 20000 });
  if (res.code !== 0) return null;
  const out = (res.stdout || '') + '\n' + (res.stderr || '');
  let line = parseInt((out.match(/Line:\s*(\d+)/i) || [])[1], 10);
  let column = parseInt((out.match(/Column:\s*(\d+)/i) || [])[1], 10);
  if (isNaN(line)) line = 0;
  if (isNaN(column)) column = 0;
  const im = out.match(/Input:\s*([^\r\n]+)/i);
  return { line, column, file: im ? im[1].trim() : null };
}

module.exports = { synctexForward, synctexInverse };
