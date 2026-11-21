// End-to-end test of the compile + synctex pipeline using the real main-process
// modules (no Electron needed). Run: node scripts/e2e.js
const { compile } = require('../electron/compiler');
const { synctexForward, synctexInverse } = require('../electron/synctex');

(async () => {
  const main = 'D:/Code/projects/FastLaTeXer/samples/demo/main.tex';
  const root = 'D:/Code/projects/FastLaTeXer/samples/demo';
  const build = 'D:/Code/projects/FastLaTeXer/samples/demo/.build';

  const r = await compile({ mainFile: main, rootDir: root, buildDir: build, engine: 'xelatex' });
  console.log('compile success:', r.success, '| exit:', r.exitCode, '| engine:', r.engine);
  console.log('compile error:', r.error, '| timedOut:', r.timedOut);
  console.log('pdf:', r.pdfPath);
  console.log('diagnostics:', JSON.stringify(r.diagnostics));

  if (r.success) {
    const f = await synctexForward({ pdfPath: r.pdfPath, line: 16, column: 0, inputFile: main });
    console.log('forward (line 16):', JSON.stringify(f));
    if (f) {
      const inv = await synctexInverse({ pdfPath: r.pdfPath, page: f.page, x: f.x, y: f.y });
      console.log('inverse:', JSON.stringify(inv));
    }
  }
})().catch((e) => {
  console.error('ERROR:', e && e.message ? e.message : e);
  process.exit(1);
});
