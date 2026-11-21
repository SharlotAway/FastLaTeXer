const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app, dialog, ipcMain } = require('electron');

const execute = promisify(execFile);
const imageTypes = ['png', 'jpg', 'jpeg', 'pdf'];
const imageFilter = [{ name: 'PNG, JPEG, PDF', extensions: imageTypes }];
const ignored = new Set(['.git', '.build', '.latexbuild', 'node_modules', '.npm-cache']);

function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function extension(file) { return path.extname(file).slice(1).toLowerCase(); }

async function downloadImage(address) {
  const source = new URL(address);
  if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) throw new Error('Enter an HTTP or HTTPS image URL.');
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
  const mime = response.headers.get('content-type')?.split(';')[0];
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' }[mime];
  if (!response.ok || !response.body || !ext) throw new Error('The URL must return a PNG, JPEG, or PDF file.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) throw new Error('Image download exceeds 20 MB.');
    chunks.push(chunk);
  }
  const stem = path.basename(source.pathname, path.extname(source.pathname)).replace(/[^a-z0-9_-]/gi, '_').slice(0, 60) || 'image';
  return { name: `${stem}.${ext}`, bytes: Buffer.concat(chunks) };
}

async function storeImage(root, name, bytes) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext).replace(/[^a-z0-9_-]/gi, '_') || 'image';
  for (let index = 0; ; index++) {
    const target = path.join(root, `${stem}${index ? '-' + index : ''}${ext}`);
    try {
      await fs.writeFile(target, bytes, { flag: 'wx' });
      return target;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}

function registerProjectTools({ getRoot, getWindow, resolveDirectory, translate }) {
  const requireRoot = (event) => {
    const root = getRoot(event);
    if (!root) throw new Error(translate('请先打开项目。', 'Open a project first.'));
    return root;
  };
  const git = async (root, args) => (await execute('git', args, {
    cwd: root, windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  })).stdout;
  async function isRepository(root) {
    try { return path.relative(root, (await git(root, ['rev-parse', '--show-toplevel'])).trim()) === ''; }
    catch (error) { if (error.code === 128) return false; throw error; }
  }
  ipcMain.handle('workspace:upload', async (event, directory) => {
    const target = await resolveDirectory(event, directory);
    const picked = await dialog.showOpenDialog(getWindow(event), { title: translate('上传文件', 'Upload files'), properties: ['openFile', 'multiSelections'] });
    if (picked.canceled) return null;
    return { target, sources: picked.filePaths };
  });
  ipcMain.handle('workspace:image', async (event, { source, value, file }) => {
    const root = await fs.realpath(requireRoot(event));
    let image;
    if (source === 'project') {
      image = await fs.realpath(value);
      if (!within(root, image) || !imageTypes.includes(extension(image)) || !(await fs.stat(image)).isFile()) throw new Error('Select a PNG, JPEG, or PDF from this project.');
    } else if (source === 'url') {
      const { name, bytes } = await downloadImage(value);
      image = await storeImage(root, name, bytes);
    } else {
      const another = source === 'another';
      let preferred = undefined;
      if (another) {
        const folder = await dialog.showOpenDialog(getWindow(event), { title: translate('选择另一个项目', 'Choose another project'), properties: ['openDirectory'] });
        if (folder.canceled) return null;
        preferred = folder.filePaths[0];
      }
      const picked = await dialog.showOpenDialog(getWindow(event), { title: translate('选择图像', 'Choose an image'), defaultPath: preferred, properties: ['openFile'], filters: imageFilter });
      if (picked.canceled) return null;
      const candidate = picked.filePaths[0];
      if (!imageTypes.includes(extension(candidate)) || (await fs.stat(candidate)).size > 20 * 1024 * 1024) throw new Error('Choose a PNG, JPEG, or PDF up to 20 MB.');
      image = await storeImage(root, path.basename(candidate), await fs.readFile(candidate));
    }
    return path.relative(path.dirname(file), image).split(path.sep).join('/');
  });
  ipcMain.handle('workspace:copy', async (event) => {
    const root = await fs.realpath(requireRoot(event));
    const choice = await dialog.showOpenDialog(getWindow(event), { title: translate('选择项目副本的上级目录', 'Choose parent folder for project copy'), properties: ['openDirectory'] });
    if (choice.canceled) return null;
    const parent = await fs.realpath(choice.filePaths[0]);
    const copyName = path.basename(root) + '-copy';
    if (within(root, parent)) throw new Error('Choose a folder outside the source project.');
    const staging = await fs.mkdtemp(path.join(parent, '.fastlatexer-copy-'));
    const payload = path.join(staging, 'project');
    try {
      await fs.cp(root, payload, { recursive: true, force: false, errorOnExist: true,
        filter: async (source) => source === root || (!ignored.has(path.basename(source)) && !(await fs.lstat(source)).isSymbolicLink()) });
      for (let index = 1; ; index++) {
        const target = path.join(parent, copyName + (index === 1 ? '' : '-' + index));
        const existing = await fs.lstat(target).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
        if (existing) continue;
        await fs.rename(payload, target);
        return target;
      }
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  });
  ipcMain.handle('workspace:archive', async (event, submission) => {
    const root = requireRoot(event);
    const choice = await dialog.showSaveDialog(getWindow(event), {
      title: submission ? translate('准备提交 ZIP', 'Prepare submission ZIP') : translate('下载项目 ZIP', 'Download project ZIP'),
      defaultPath: path.join(path.dirname(root), path.basename(root) + (submission ? '-submission.zip' : '.zip')),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (choice.canceled || !choice.filePath) return null;
    const target = /\.zip$/i.test(choice.filePath) ? choice.filePath : choice.filePath + '.zip';
    const staging = await fs.mkdtemp(path.join(app.getPath('temp') || os.tmpdir(), 'fastlatexer-archive-'));
    const archive = path.join(staging, 'project.zip');
    try {
      const exclusions = [...ignored];
      if (within(root, target)) exclusions.push('./' + path.relative(root, target).split(path.sep).join('/'));
      await execute('tar', ['-a', '-c', '-f', archive, ...exclusions.map((name) => '--exclude=' + name), '-C', root, '.'], { windowsHide: true, timeout: 120_000 });
      await fs.copyFile(archive, target);
      return target;
    } finally {
      await fs.unlink(archive).catch(() => {});
      await fs.rmdir(staging).catch(() => {});
    }
  });
  ipcMain.handle('workspace:git', async (event, action, value) => {
    const root = requireRoot(event);
    const exists = await isRepository(root);
    if (action === 'init') {
      if (!exists) await git(root, ['init']);
      return null;
    }
    if (action === 'status') {
      if (!exists) return { exists, remote: '', branch: '', commits: [] };
      const [remotes, branch, history] = await Promise.all([
        git(root, ['remote', '-v']), git(root, ['branch', '--show-current']),
        git(root, ['log', '--all', '-100', '-z', '--format=%H%x00%h%x00%as%x00%an%x00%s']),
      ]);
      const remote = remotes.match(/^origin\s+(\S+)\s+\(fetch\)/m)?.[1] ?? '';
      const parts = history.split('\0');
      const commits = [];
      for (let i = 0; i + 4 < parts.length; i += 5) {
        const [hash, short, date, author, subject] = parts.slice(i, i + 5);
        commits.push({ hash, short, date, author, subject });
      }
      return { exists, remote, branch: branch.trim(), commits };
    }
    if (!exists) throw new Error('Initialize Git in this project first.');
    if (action === 'connect') {
      const remote = String(value).trim();
      if (!/^(?:https?:\/\/[^\s]+|ssh:\/\/[^\s]+|[\w.-]+@[\w.-]+:[^\s]+)$/i.test(remote)) throw new Error('Enter an HTTPS or SSH Git remote URL.');
      const names = (await git(root, ['remote'])).split(/\r?\n/);
      await git(root, names.includes('origin') ? ['remote', 'set-url', 'origin', remote] : ['remote', 'add', 'origin', remote]);
      return null;
    }
    if (action === 'fetch') { await git(root, ['fetch', '--no-recurse-submodules', 'origin']); return null; }
    if (action === 'commit' && /^[a-f0-9]{40,64}$/i.test(value)) return git(root, ['show', '--no-ext-diff', '--no-textconv', '--stat', '--patch', value, '--']);
    throw new Error('Unknown Git operation.');
  });
}

module.exports = { registerProjectTools };
