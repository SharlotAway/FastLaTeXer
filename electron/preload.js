const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFolder: (mode) => ipcRenderer.invoke('dialog:openFolder', mode),
  openRecent: (root, mode) => ipcRenderer.invoke('project:openRecent', root, mode),
  getCurrentProject: () => ipcRenderer.invoke('project:getCurrent'),
  listRecentProjects: () => ipcRenderer.invoke('project:listRecent'),
  onRecentProjects: (callback) => {
    const listener = (_event, projects) => callback(projects);
    ipcRenderer.on('project:recent', listener);
    return () => ipcRenderer.removeListener('project:recent', listener);
  },
  openWorkspace: (root) => ipcRenderer.invoke('workspace:open', root),
  closeWorkspace: () => ipcRenderer.invoke('workspace:close'),
  setMenuLanguage: (language) => ipcRenderer.invoke('menu:language', language),
  initialTheme: process.argv.find((argument) => argument.startsWith('--fastlatexer-theme='))?.split('=')[1],
  applyWindowTheme: (palette) => ipcRenderer.invoke('window:theme', palette),
  getApplicationMenu: () => ipcRenderer.invoke('menu:get'),
  activateMenuItem: (revision, indices) => ipcRenderer.invoke('menu:activate', revision, indices),
  onApplicationMenu: (callback) => {
    const listener = (_event, menu) => callback(menu);
    ipcRenderer.on('menu:changed', listener);
    return () => ipcRenderer.removeListener('menu:changed', listener);
  },
  uploadFiles: async (directory) => {
    const choice = await ipcRenderer.invoke('workspace:upload', directory);
    return choice ? ipcRenderer.invoke('fs:importFiles', { directory: choice.target, sources: choice.sources }) : null;
  },
  insertImage: (source, value, file) => ipcRenderer.invoke('workspace:image', { source, value, file }),
  copyProject: () => ipcRenderer.invoke('workspace:copy'),
  archiveProject: (submission) => ipcRenderer.invoke('workspace:archive', submission),
  git: (action, value) => ipcRenderer.invoke('workspace:git', action, value),
  createEntry: (directory, name, kind) => ipcRenderer.invoke('fs:createEntry', { directory, name, kind }),
  importFiles: (directory, files) => ipcRenderer.invoke('fs:importFiles', {
    directory,
    sources: files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  }),
  saveAs: (file, content) => ipcRenderer.invoke('dialog:saveAs', { file, content }),
  exportPdf: (pdfPath, bytes) => ipcRenderer.invoke('dialog:exportPdf', { pdfPath, bytes }),
  getRoot: () => ipcRenderer.invoke('project:getRoot'),
  readTree: (dir) => ipcRenderer.invoke('fs:readTree', dir),
  readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
  writeFile: (p, content) => ipcRenderer.invoke('fs:writeFile', p, content),
  readBinary: (p) => ipcRenderer.invoke('fs:readBinary', p),
  readPdfAsset: (kind, filename) => ipcRenderer.invoke('pdf:asset', kind, filename),
  revealInFolder: (p) => ipcRenderer.invoke('shell:reveal', p),
  copyText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  compile: (opts) => ipcRenderer.invoke('compile', opts),
  synctexForward: (opts) => ipcRenderer.invoke('synctex:forward', opts),
  synctexInverse: (opts) => ipcRenderer.invoke('synctex:inverse', opts),
  onFileChanged: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('fs:changed', h);
    return () => ipcRenderer.removeListener('fs:changed', h);
  },
  onCompileProgress: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('compile:progress', h);
    return () => ipcRenderer.removeListener('compile:progress', h);
  },
  onFileCommand: (cb) => {
    const h = (_e, command) => cb(command);
    ipcRenderer.on('file:command', h);
    return () => ipcRenderer.removeListener('file:command', h);
  },
});
