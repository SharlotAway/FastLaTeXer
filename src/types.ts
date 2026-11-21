import type { Theme } from '../@themes';

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  children: TreeNode[];
  editable?: boolean;
  ext?: string;
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  file: string;
  line: number;
  message: string;
  raw: string;
}

export interface CompileResult {
  success: boolean;
  exitCode: number;
  timedOut?: boolean;
  output: string;
  log: string;
  logPath: string;
  pdfPath: string;
  synctexPath: string;
  diagnostics: Diagnostic[];
  engine: string;
  error: string | null;
}

export interface CompileOptions {
  mainFile: string;
  rootDir: string;
  buildDir: string;
  engine: string;
}

export interface SyncForwardResult {
  page: number;
  x: number;
  y: number;
}

export interface SyncInverseResult {
  line: number;
  column: number;
  file: string | null;
}

export type EntryKind = 'file' | 'dir';
export type OpenMode = 'current' | 'new';
export interface AppMenuItem {
  label: string;
  type: string;
  enabled: boolean;
  visible: boolean;
  accelerator?: string;
  role?: string;
  items?: AppMenuItem[];
}
export type AppMenu = { revision: number; items: AppMenuItem[] };
export type Language = 'zh' | 'en';
export type ImageSource = 'local' | 'project' | 'another' | 'url';
export type GitCommit = { hash: string; short: string; date: string; author: string; subject: string };
export type GitStatus = { exists: boolean; remote: string; branch: string; commits: GitCommit[] };

export type FileCommand =
  | { type: 'open' | 'openCurrent' | 'openNew' | 'save' | 'saveAs' | 'exportPdf' | 'newFile' | 'newFolder' | 'upload' | 'copy' | 'history' | 'wordCount' | 'submit' | 'archive' | 'settings' }
  | { type: 'recent'; project: string };

export interface WindowApi {
  openFolder: (mode?: OpenMode) => Promise<{ root: string; tree: TreeNode[] } | null>;
  openRecent: (root: string, mode?: OpenMode) => Promise<{ root: string; tree: TreeNode[] } | null>;
  getCurrentProject: () => Promise<{ root: string; tree: TreeNode[] } | null>;
  listRecentProjects: () => Promise<string[]>;
  onRecentProjects: (callback: (projects: string[]) => void) => () => void;
  openWorkspace: (root: string) => Promise<{ root: string; tree: TreeNode[] }>;
  closeWorkspace: () => Promise<void>;
  setMenuLanguage: (language: Language) => Promise<void>;
  initialTheme?: Theme;
  applyWindowTheme: (palette: { theme: Theme }) => Promise<void>;
  getApplicationMenu: () => Promise<AppMenu | null>;
  activateMenuItem: (revision: number, indices: number[]) => Promise<void>;
  onApplicationMenu: (callback: (menu: AppMenu | null) => void) => () => void;
  uploadFiles: (directory: string) => Promise<{ copied: number; failures: string[] } | null>;
  insertImage: (source: ImageSource, value: string, file: string) => Promise<string | null>;
  copyProject: () => Promise<string | null>;
  archiveProject: (submission: boolean) => Promise<string | null>;
  git: {
    (action: 'status'): Promise<GitStatus>;
    (action: 'commit', value: string): Promise<string>;
    (action: 'init' | 'fetch' | 'connect', value?: string): Promise<null>;
  };
  createEntry: (directory: string, name: string, kind: EntryKind) => Promise<string>;
  importFiles: (directory: string, files: File[]) => Promise<{ copied: number; failures: string[] }>;
  saveAs: (file: string, content: string) => Promise<string | null>;
  exportPdf: (pdfPath: string, bytes: ArrayBuffer) => Promise<string | null>;
  onFileCommand: (cb: (command: FileCommand) => void) => () => void;
  getRoot: () => Promise<string | null>;
  readTree: (dir: string) => Promise<TreeNode[]>;
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, content: string) => Promise<boolean>;
  readBinary: (p: string) => Promise<ArrayBuffer>;
  readPdfAsset: (kind: string, filename: string) => Promise<ArrayBuffer>;
  revealInFolder: (p: string) => Promise<boolean>;
  openPdfLink: (url: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  compile: (opts: CompileOptions) => Promise<CompileResult>;
  synctexForward: (opts: { pdfPath: string; line: number; column: number; inputFile: string }) => Promise<SyncForwardResult | null>;
  synctexInverse: (opts: { pdfPath: string; mainFile?: string; page: number; x: number; y: number }) => Promise<SyncInverseResult | null>;
  onFileChanged: (cb: (data: { event: string; path: string }) => void) => () => void;
  onCompileProgress: (cb: (data: { phase: string; mainFile?: string; success?: boolean }) => void) => () => void;
}
