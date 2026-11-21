const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Arch, Platform, build } = require('electron-builder');
const { version } = require('../package.json');

async function packageWindows() {
  const projectDir = path.join(__dirname, '..');
  // NSIS runs an intermediate executable. Use the system temp volume for it.
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'fastlatexer-release-'));
  try {
    await build({
      projectDir,
      targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
      publish: 'never',
      config: { directories: { output: staging } },
    });
    const name = `FastLaTeXer-Setup-${version}-x64.exe`;
    const release = path.join(projectDir, 'release');
    await fs.mkdir(release, { recursive: true });
    await fs.copyFile(path.join(staging, name), path.join(release, name));
    console.log(path.join(release, name));
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

packageWindows().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
