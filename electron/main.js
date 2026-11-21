const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const chokidar = require('chokidar');
const { compile } = require('./compiler');
const { synctexForward, synctexInverse } = require('./synctex');
const { registerProjectTools } = require('./project-tools');

function logLine(msg) {
  try {
    const directory = app.isPackaged ? app.getPath('userData') : path.join(__dirname, '..');
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(path.join(directory, 'fastlatexer.log'), new Date().toISOString() + ' ' + msg + '\n');
  } catch {}
}
process.on('uncaughtException', (e) => { logLine('UNCAUGHT: ' + ((e && e.stack) || e)); });
process.on('unhandledRejection', (e) => { logLine('UNHANDLED: ' + ((e && e.stack) || e)); });

// Work around GPU-process startup crashes (exit 0x80000003 / STATUS_BREAKPOINT)
// on this Windows setup: run GPU code inside the browser process and fall back
// to software rendering, avoiding the crashing GPU child process entirely.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');

const windows = new Map();
let recentProjects = [];
let recentWrite = Promise.resolve();
let menuLanguage = 'zh';
let menuRevision = 0;
let savedTheme = null;
const translate = (zh, en) => menuLanguage === 'en' ? en : zh;

function validTheme(value) {
  return value && ['dark', 'light', 'yoimiya', 'furina'].includes(value.theme) &&
    [value.color, value.symbolColor, value.background].every((color) => typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color));
}

function themePath() {
  return path.join(app.getPath('userData'), 'window-theme.json');
}

async function loadWindowTheme() {
  try {
    const value = JSON.parse(await fsp.readFile(themePath(), 'utf8'));
    if (validTheme(value)) savedTheme = value;
  } catch (error) {
    if (error.code !== 'ENOENT') logLine(String(error));
  }
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.build', '.npm-cache', '.latexbuild', 'dist', '.vscode', '.idea']);
const TEXT_EXTS = new Set(['', '.tex', '.bib', '.sty', '.cls', '.bst', '.ltx', '.txt', '.md', '.markdown', '.json', '.yml', '.yaml', '.cfg', '.log', '.aux', '.m']);

function isIgnoredDir(name) {
  return IGNORED_DIRS.has(name);
}

async function readTree(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes = [];
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (isIgnoredDir(ent.name)) continue;
      const children = await readTree(full);
      nodes.push({ name: ent.name, path: full, type: 'dir', children, editable: false });
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      const editable = TEXT_EXTS.has(ext);
      nodes.push({ name: ent.name, path: full, type: 'file', ext, editable, children: [] });
    }
  }
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return nodes;
}

function send(window, channel, payload) {
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, payload);
  }
}

function projectWindow(event) {
  const state = windows.get(event.sender.id);
  if (!state) throw new Error('Project window is no longer available.');
  return state;
}

function recentProjectsPath() {
  return path.join(app.getPath('userData'), 'recent-projects.json');
}

async function loadRecentProjects() {
  try {
    const entries = JSON.parse(await fsp.readFile(recentProjectsPath(), 'utf8'));
    if (Array.isArray(entries)) recentProjects = entries.filter((entry) => typeof entry === 'string' && path.isAbsolute(entry)).slice(0, 10);
  } catch (error) {
    if (error.code !== 'ENOENT') logLine(String(error));
  }
}

function menuSnapshot() {
  if (process.platform !== 'win32') return null;
  const describe = (menu) => menu.items.map((item) => ({
    label: item.label,
    type: item.type,
    enabled: item.enabled,
    visible: item.visible,
    accelerator: item.accelerator,
    role: item.role,
    items: item.submenu ? describe(item.submenu) : undefined,
  }));
  const menu = Menu.getApplicationMenu();
  return menu ? { revision: menuRevision, items: describe(menu) } : null;
}

function updateMenu() {
  const command = (window, type, project) => send(window, 'file:command', { type, project });
  const t = translate;
  const entry = (zh, en, type) => ({ label: t(zh, en), click: (_item, window) => command(window, type) });
  const role = (name, zh, en, accelerator) => ({ role: name, label: t(zh, en), accelerator });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: t('文件', 'File'),
      submenu: [
        { ...entry('打开项目文件夹…', 'Open Project…', 'open'), accelerator: 'CmdOrCtrl+O' },
        {
          label: t('打开最近项目', 'Open Recent'),
          submenu: recentProjects.length ? recentProjects.map((project) => ({
            label: project,
            click: (_item, window) => command(window, 'recent', project),
          })) : [{ label: t('暂无最近项目', 'No recent projects'), enabled: false }],
        },
        { type: 'separator' },
        entry('新建文件…', 'New File…', 'newFile'),
        entry('新建文件夹…', 'New Folder…', 'newFolder'),
        entry('上传文件…', 'Upload Files…', 'upload'),
        entry('复制项目…', 'Make a Project Copy…', 'copy'),
        { type: 'separator' },
        entry('保存', 'Save', 'save'),
        { ...entry('另存为…', 'Save As…', 'saveAs'), accelerator: 'CmdOrCtrl+Shift+S' },
        entry('查看版本历史', 'Show Version History', 'history'),
        entry('字数统计', 'Word Count', 'wordCount'),
        entry('准备提交…', 'Prepare Submission…', 'submit'),
        { label: t('下载', 'Download'), submenu: [
          entry('项目 ZIP…', 'Project ZIP…', 'archive'),
          entry('导出 PDF…', 'Export PDF…', 'exportPdf'),
        ] },
        entry('设置', 'Settings', 'settings'),
        { type: 'separator' },
        { role: 'close', label: t('关闭窗口', 'Close Window') },
      ],
    },
    { label: t('编辑', 'Edit'), submenu: [
      role('undo', '撤销', 'Undo', 'CmdOrCtrl+Z'), role('redo', '重做', 'Redo', 'CmdOrCtrl+Y'),
      { type: 'separator' },
      role('cut', '剪切', 'Cut', 'CmdOrCtrl+X'), role('copy', '复制', 'Copy', 'CmdOrCtrl+C'),
      role('paste', '粘贴', 'Paste', 'CmdOrCtrl+V'), role('delete', '删除', 'Delete'),
      role('selectAll', '全选', 'Select All', 'CmdOrCtrl+A'),
    ] },
    { label: t('视图', 'View'), submenu: [
      role('reload', '重新加载', 'Reload', 'CmdOrCtrl+R'), role('forceReload', '强制重新加载', 'Force Reload', 'CmdOrCtrl+Shift+R'),
      role('toggleDevTools', '开发者工具', 'Developer Tools', 'CmdOrCtrl+Shift+I'),
      { type: 'separator' },
      role('resetZoom', '实际大小', 'Actual Size', 'CmdOrCtrl+0'), role('zoomIn', '放大界面', 'Zoom In'),
      role('zoomOut', '缩小界面', 'Zoom Out'), { type: 'separator' },
      role('togglefullscreen', '切换全屏', 'Toggle Full Screen', 'F11'),
    ] },
    { label: t('窗口', 'Window'), submenu: [
      role('minimize', '最小化', 'Minimize'),
      { label: t('最大化或还原', 'Maximize or Restore'), click: (_item, window) => {
        if (window?.isMaximized()) window.unmaximize();
        else window?.maximize();
      } },
      role('close', '关闭窗口', 'Close Window'),
    ] },
  ]));
  menuRevision++;
  if (process.platform === 'win32') {
    const snapshot = menuSnapshot();
    for (const { window } of windows.values()) {
      window.setMenuBarVisibility(false);
      send(window, 'menu:changed', snapshot);
    }
  }
}

async function openProject(state, root, mode = 'current') {
  if (!(await fsp.stat(root)).isDirectory()) throw new Error('项目文件夹不存在。');
  if (state.window.isDestroyed()) return null;
  if (mode === 'new') {
    createWindow(root);
  } else {
    await stopWatcher(state);
    if (state.window.isDestroyed()) return null;
    state.root = root;
    startWatcher(state, root);
  }
  recentProjects = [root, ...recentProjects.filter((entry) => path.relative(entry, root) !== '')].slice(0, 10);
  updateMenu();
  for (const { window } of windows.values()) send(window, 'project:recent', recentProjects);
  const entries = JSON.stringify(recentProjects);
  recentWrite = recentWrite.then(() => fsp.writeFile(recentProjectsPath(), entries, 'utf8')).catch((error) => logLine(String(error)));
  if (mode === 'new') return null;
  return { root, tree: await readTree(root) };
}

async function projectDirectory({ root: projectRoot }, directory) {
  if (!projectRoot) throw new Error('请先打开项目文件夹。');
  const [root, target] = await Promise.all([fsp.realpath(projectRoot), fsp.realpath(directory)]);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('目标文件夹必须位于当前项目内。');
  }
  return target;
}

function validateName(name) {
  if (!name || name.startsWith('.') || /[<>:"/\\|?*\x00-\x1f]|[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) {
    throw new Error('请输入有效的文件或文件夹名称。');
  }
}

async function stopWatcher(state) {
  const watcher = state.watcher;
  state.watcher = null;
  if (watcher) await watcher.close().catch(() => {});
}

function startWatcher(state, root) {
  const watcher = chokidar.watch(root, {
    ignored: (p) => {
      const rel = path.relative(root, p);
      return rel.split(path.sep).some((seg) => seg && (seg.startsWith('.') || isIgnoredDir(seg)));
    },
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  state.watcher = watcher;
  for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir']) {
    watcher.on(event, (file) => {
      if (state.watcher === watcher) send(state.window, 'fs:changed', { event, path: file });
    });
  }
  watcher.on('error', (error) => logLine(String(error)));
}

function createWindow(root = null) {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 620,
    title: 'FastLaTeXer',
    backgroundColor: savedTheme?.background ?? '#1e1e1e',
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: savedTheme?.color ?? '#252526',
        symbolColor: savedTheme?.symbolColor ?? '#d4d4d4',
        height: 32,
      },
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: savedTheme ? ['--fastlatexer-theme=' + savedTheme.theme] : [],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const id = window.webContents.id;
  const state = { window, root, watcher: null };
  windows.set(id, state);
  if (process.platform === 'win32') window.setMenuBarVisibility(false);
  if (root) startWatcher(state, root);
  window.on('closed', () => {
    windows.delete(id);
    void stopWatcher(state);
  });

  // Surface renderer errors in the terminal so startup failures are diagnosable.
  window.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logLine('did-fail-load ' + code + ' ' + desc + ' ' + url);
  });
  window.webContents.on('render-process-gone', (_e, details) => {
    logLine('render-process-gone ' + (details && details.reason));
  });
  window.webContents.on('did-finish-load', () => {
    logLine('did-finish-load');
  });
  window.webContents.on('console-message', (_e, ...rest) => {
    const detail = rest[0] && typeof rest[0] === 'object' && 'message' in rest[0] ? rest[0] : null;
    const msg = detail ? detail.message : (rest[1] ?? '');
    console.log('[renderer]', msg);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    logLine('loadURL dev ' + devUrl);
    window.loadURL(devUrl);
  } else {
    const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');
    logLine('loadFile ' + indexHtml);
    window.loadFile(indexHtml);
  }
}

function registerIpc() {
  registerProjectTools({
    getRoot: (event) => projectWindow(event).root,
    getWindow: (event) => projectWindow(event).window,
    resolveDirectory: (event, directory) => projectDirectory(projectWindow(event), directory),
    translate,
  });
  ipcMain.handle('workspace:open', (event, root) => openProject(projectWindow(event), root));
  ipcMain.handle('workspace:close', async (event) => {
    const state = projectWindow(event);
    state.root = null;
    await stopWatcher(state);
  });
  ipcMain.handle('menu:language', (_event, language) => {
    menuLanguage = language === 'en' ? 'en' : 'zh';
    updateMenu();
  });
  ipcMain.handle('window:theme', (event, palette) => {
    if (!validTheme(palette)) return;
    const { window } = projectWindow(event);
    const { theme, color, symbolColor, background } = palette;
    if (process.platform === 'win32') window.setTitleBarOverlay({ color, symbolColor });
    window.setBackgroundColor(background);
    const next = { theme, color, symbolColor, background };
    if (JSON.stringify(savedTheme) === JSON.stringify(next)) return;
    try {
      const target = themePath();
      const temporary = target + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(next), 'utf8');
      fs.renameSync(temporary, target);
      savedTheme = next;
    } catch (error) {
      logLine(String(error));
    }
  });
  ipcMain.handle('menu:get', menuSnapshot);
  ipcMain.handle('menu:activate', (event, revision, indices) => {
    if (revision !== menuRevision || !Array.isArray(indices) || indices.length === 0) return;
    let menu = Menu.getApplicationMenu();
    let item;
    for (const index of indices) {
      item = Number.isInteger(index) ? menu?.items[index] : undefined;
      if (!item || !item.enabled || !item.visible) return;
      menu = item.submenu;
    }
    if (item.submenu || item.type === 'separator') return;
    const { window } = projectWindow(event);
    item.click({}, window, event.sender);
  });
  ipcMain.handle('dialog:openFolder', async (event, mode) => {
    const state = projectWindow(event);
    const res = await dialog.showOpenDialog(state.window, {
      title: translate('打开 LaTeX 项目文件夹', 'Open LaTeX project'),
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return openProject(state, res.filePaths[0], mode);
  });

  ipcMain.handle('project:openRecent', (event, root, mode) => {
    if (!recentProjects.includes(root)) throw new Error('此项目不在最近项目列表中。');
    return openProject(projectWindow(event), root, mode);
  });

  ipcMain.handle('fs:createEntry', async (event, { directory, name, kind }) => {
    validateName(name);
    if (kind === 'dir' && isIgnoredDir(name.toLowerCase())) throw new Error('此文件夹名称由项目保留。');
    const target = path.join(await projectDirectory(projectWindow(event), directory), name);
    if (kind === 'dir') await fsp.mkdir(target);
    else await fsp.writeFile(target, '', { flag: 'wx' });
    return target;
  });

  ipcMain.handle('fs:importFiles', async (event, { directory, sources }) => {
    const target = await projectDirectory(projectWindow(event), directory);
    const failures = [];
    let copied = 0;
    for (const source of sources) {
      const name = path.basename(source);
      try {
        if (!(await fsp.stat(source)).isFile()) throw new Error('请选择文件。');
        await fsp.copyFile(source, path.join(target, name), fs.constants.COPYFILE_EXCL);
        copied++;
      } catch (error) {
        failures.push(`${name}（${error.code === 'EEXIST' ? '已存在同名文件' : error.message}）`);
      }
    }
    return { copied, failures };
  });

  ipcMain.handle('dialog:saveAs', async (event, { file, content }) => {
    const ext = path.extname(file).slice(1);
    const result = await dialog.showSaveDialog(projectWindow(event).window, {
      title: translate('另存为', 'Save As'),
      defaultPath: file,
      filters: ext ? [{ name: translate(`${ext.toUpperCase()} 文件`, `${ext.toUpperCase()} files`), extensions: [ext] }, { name: translate('所有文件', 'All files'), extensions: ['*'] }] : undefined,
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });

  ipcMain.handle('dialog:exportPdf', async (event, { pdfPath, bytes }) => {
    const { window, root } = projectWindow(event);
    if (!root) return null;
    const result = await dialog.showSaveDialog(window, {
      title: translate('导出 PDF', 'Export PDF'),
      defaultPath: path.join(root, path.basename(pdfPath)),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const target = /\.pdf$/i.test(result.filePath) ? result.filePath : result.filePath + '.pdf';
    await fsp.writeFile(target, new Uint8Array(bytes));
    return target;
  });

  ipcMain.handle('project:getRoot', (event) => projectWindow(event).root);
  ipcMain.handle('project:listRecent', () => recentProjects);
  ipcMain.handle('project:getCurrent', async (event) => {
    const { root } = projectWindow(event);
    return root ? { root, tree: await readTree(root) } : null;
  });

  ipcMain.handle('fs:readTree', (_e, dir) => readTree(dir));

  ipcMain.handle('fs:readFile', async (_e, p) => {
    return fsp.readFile(p, 'utf8');
  });

  ipcMain.handle('fs:writeFile', async (_e, p, content) => {
    await fsp.writeFile(p, content, 'utf8');
    return true;
  });

  ipcMain.handle('fs:readBinary', async (_e, p) => {
    const buf = await fsp.readFile(p);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });
  ipcMain.handle('pdf:asset', async (_event, kind, filename) => {
    const directory = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' }[kind];
    if (!directory || !/^[a-zA-Z0-9_.-]+$/.test(filename) || filename === '.' || filename === '..') throw new Error('Invalid PDF asset.');
    const base = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const bytes = await fsp.readFile(path.join(base, directory, filename));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });

  ipcMain.handle('shell:reveal', (_e, p) => {
    shell.showItemInFolder(p);
    return true;
  });
  ipcMain.handle('clipboard:writeText', (_event, text) => clipboard.writeText(text));

  ipcMain.handle('compile', async (event, opts) => {
    const { window } = projectWindow(event);
    send(window, 'compile:progress', { phase: 'started', mainFile: opts.mainFile });
    let result;
    try {
      result = await compile(opts);
    } catch (e) {
      result = { success: false, exitCode: -1, output: '', log: '', diagnostics: [], error: String(e && e.message ? e.message : e) };
    }
    send(window, 'compile:progress', { phase: 'done', mainFile: opts.mainFile, success: result.success });
    return result;
  });

  ipcMain.handle('synctex:forward', async (_e, opts) => synctexForward(opts));
  ipcMain.handle('synctex:inverse', async (_e, opts) => synctexInverse(opts));
}

app.whenReady().then(async () => {
  logLine('app ready reached');
  await Promise.all([loadRecentProjects(), loadWindowTheme()]);
  updateMenu();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((e) => {
  logLine('whenReady FAILED: ' + ((e && e.stack) || e));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
