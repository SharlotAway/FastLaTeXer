import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import appIcon from './assets/fastlatexer.png';
import Toolbar from './components/Toolbar';
import FileTree from './components/FileTree';
import EditorPane, { type EditorHandle } from './components/EditorPane';
import PreviewPane, { type PreviewHandle } from './components/PreviewPane';
import ProblemsPanel from './components/ProblemsPanel';
import type { CompileResult, Diagnostic, EntryKind, ImageSource, Language, OpenMode, TreeNode } from './types';
import { basename, projectRelativePath, resolveAgainst } from './path';
import { LanguageContext, readPreference, useText } from './preferences';
import { resolveTheme, type Theme } from '../@themes';
import { applyMonacoTheme } from '../@themes/monaco';
import monaco from './latex/monacoSetup';
import { insertSource, formatSource } from './latex/editCommands';
import { bibliographyKeys, bibliographyNames, forwardSyncTarget, labels, words } from './latex/documentTools';
import { FileOutline, filesIn, GitHistory, Panel, ProjectSearch, Settings, WorkbenchMenus, type FormatAction, type InsertAction } from './components/Workbench';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const workspaceKey = 'fastlatexer-workspace';
const themeKey = 'fastlatexer-theme';
const imageMimeTypes: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
  avif: 'image/avif', ico: 'image/x-icon', apng: 'image/apng',
};

function previewMimeType(file: string) {
  const extension = file.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  return extension && Object.hasOwn(imageMimeTypes, extension) ? imageMimeTypes[extension] : undefined;
}

const samePath = (a: string | null, b: string) =>
  a?.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

async function readDiskFile(file: string): Promise<string | null> {
  try { return await window.api.readFile(file); }
  catch (error) {
    if (error instanceof Error && /\bENOENT\b/.test(error.message)) return null;
    throw error;
  }
}

function readWorkspace(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(workspaceKey) ?? '[]');
    return Array.isArray(saved) ? saved.filter((entry) => typeof entry === 'string') : [];
  } catch { return []; }
}

function startDrag(e: React.PointerEvent<HTMLDivElement>, onDelta: (dx: number) => void) {
  if (e.button !== 0 || !e.isPrimary) return;
  e.preventDefault();
  const divider = e.currentTarget;
  const pointerId = e.pointerId;
  const startX = e.clientX;
  const move = (ev: PointerEvent) => {
    if (ev.pointerId === pointerId) onDelta(ev.clientX - startX);
  };
  const finish = () => {
    divider.removeEventListener('pointermove', move);
    divider.removeEventListener('pointerup', move);
    divider.removeEventListener('lostpointercapture', finish);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  divider.setPointerCapture(pointerId);
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', move);
  divider.addEventListener('lostpointercapture', finish);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function Welcome({ recentProjects, onOpen, onRecent }: {
  recentProjects: string[];
  onOpen: (mode: OpenMode) => void;
  onRecent: (project: string) => void;
}) {
  const t = useText();
  return (
    <div className="welcome">
      <div className="welcome-box">
        <h1>FastLaTeXer</h1>
        <p>{t('本机 TeX Live 快速编译的 LaTeX 编辑器', 'LaTeX editor with local TeX Live compilation')}</p>
        <div className="welcome-actions">
          <button className="tb-btn tb-primary" onClick={() => onOpen('current')}>
            {t('在当前窗口打开', 'Open in Current Window')}
          </button>
          <button className="tb-btn welcome-secondary" onClick={() => onOpen('new')}>
            {t('在新窗口打开', 'Open in New Window')}
          </button>
        </div>
        {recentProjects.length > 0 && <section className="welcome-recent">
          <h2>{t('最近打开的项目', 'Recent Projects')}</h2>
          <ul>
            {recentProjects.map((project) => <li key={project}>
              <button title={project} onClick={() => onRecent(project)}>
                <strong>{basename(project)}</strong>
                <span>{project}</span>
              </button>
            </li>)}
          </ul>
        </section>}
      </div>
    </div>
  );
}

export default function App() {
  const [language, setLanguage] = useState<Language>(() => readPreference('fastlatexer-language', 'zh', 'en'));
  const [theme, setTheme] = useState<Theme>(() => {
    const startupTheme = sessionStorage.getItem(themeKey) ? undefined : window.api.initialTheme;
    return resolveTheme(startupTheme ?? localStorage.getItem(themeKey));
  });
  const t = useCallback((zh: string, en: string) => language === 'en' ? en : zh, [language]);
  const [root, setRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [fileConflict, setFileConflict] = useState<{ file: string; disk: string | null } | null>(null);
  const contentRef = useRef('');
  const diskBaseline = useRef<string | null>(null);
  const saveInProgress = useRef<Promise<void> | null>(null);
  const diskCheck = useRef(0);
  const waitForManualSave = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [lastResult, setLastResult] = useState<CompileResult | null>(null);
  const [preview, setPreview] = useState<{ bytes: ArrayBuffer; pdfPath: string; mainFile: string } | null>(null);
  const currentPreview = useRef(preview);
  currentPreview.current = preview;
  const forwardRequest = useRef(0);
  const [engine, setEngine] = useState('xelatex');
  const [autoCompile, setAutoCompile] = useState(true);
  const [leftWidth, setLeftWidth] = useState(260);
  const [rightWidth, setRightWidth] = useState(560);
  const [showProblems, setShowProblems] = useState(false);
  const [mainFile, setMainFile] = useState<string | null>(null);
  const [sourceJump, setSourceJump] = useState<{ file: string; line: number; column: number } | null>(null);
  const [dropRow, setDropRow] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<{ kind: 'search' | 'settings' | 'history' | 'words' | 'symbol' | 'project' | 'url'; path?: string } | null>(null);
  const [assetPreview, setAssetPreview] = useState<
    { kind: 'image'; path: string; url: string } | { kind: 'pdf'; path: string; bytes: ArrayBuffer } | null
  >(null);
  const assetRequest = useRef(0);
  const displayedPdf = assetPreview ? (assetPreview.kind === 'pdf' ? assetPreview : null) : preview;
  const currentDisplayedPdf = useRef(displayedPdf);
  currentDisplayedPdf.current = displayedPdf;
  const inverseRequest = useRef(0);
  const [imageValue, setImageValue] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState('');
  const [entryRequest, setEntryRequest] = useState<{ directory: string; kind: EntryKind }>();
  const [workspace, setWorkspace] = useState(readWorkspace);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [openChoice, setOpenChoice] = useState<{ location?: string } | null>(null);
  const [context, setContext] = useState<{ x: number; y: number; path: string; directory: string } | null>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const openingProject = useRef(false);

  const leftPaneRef = useRef<HTMLDivElement>(null);
  const editorPaneRef = useRef<HTMLDivElement>(null);
  const previewPaneRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);

  // Refs for values used inside once-subscribed effects.
  const rootRef = useRef(root);
  rootRef.current = root;
  const currentFileRef = useRef(currentFile);
  currentFileRef.current = currentFile;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    localStorage.setItem('fastlatexer-language', language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    void window.api.setMenuLanguage?.(language);
  }, [language]);
  useLayoutEffect(() => {
    const rootElement = document.documentElement;
    rootElement.dataset.theme = theme;
    applyMonacoTheme(monaco, theme, getComputedStyle(rootElement));
    sessionStorage.setItem(themeKey, theme);
    localStorage.setItem(themeKey, theme);
    void window.api.applyWindowTheme?.({ theme }).catch(console.error);
  }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === workspaceKey) setWorkspace(readWorkspace());
      if (event.key === themeKey) setTheme(resolveTheme(localStorage.getItem(themeKey)));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    let active = true;
    let updated = false;
    const unsubscribe = window.api.onRecentProjects?.((projects) => {
      updated = true;
      setRecentProjects(projects);
    });
    void window.api.listRecentProjects?.().then((projects) => {
      if (active && !updated) setRecentProjects(projects);
    }).catch(console.error);
    return () => { active = false; unsubscribe?.(); };
  }, []);
  const imageUrl = assetPreview?.kind === 'image' ? assetPreview.url : undefined;
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);
  useEffect(() => {
    if (!context) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !contextRef.current?.contains(event.target)) setContext(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setContext(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, [context]);

  const reportError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(error);
    setNotice(message);
  }, []);

  const refreshTree = useCallback(async (project: string) => {
    const updated = await window.api.readTree(project);
    if (rootRef.current === project) setTree(updated);
  }, []);

  const loadDiskContent = useCallback((text: string) => {
    waitForManualSave.current = false;
    diskBaseline.current = text;
    contentRef.current = text;
    dirtyRef.current = false;
    editorRef.current?.setContent(text);
    setContent(text);
    setDirty(false);
    setFileConflict(null);
  }, []);

  const saveCurrent = useCallback(async () => {
    const file = currentFileRef.current;
    if (!file) return;
    while (saveInProgress.current) await saveInProgress.current;
    if (currentFileRef.current !== file) return;
    const operation = (async () => {
      const disk = await readDiskFile(file);
      if (currentFileRef.current !== file) return;
      if (disk !== diskBaseline.current) {
        if (!dirtyRef.current && disk !== null) {
          loadDiskContent(disk);
          return;
        }
        setFileConflict({ file, disk });
        throw new Error(t('文件已在外部发生变化，请先处理版本冲突。', 'The file changed on disk. Resolve the conflict before saving.'));
      }
      if (!dirtyRef.current) return;
      const text = contentRef.current;
      await window.api.writeFile(file, text);
      if (currentFileRef.current !== file) return;
      waitForManualSave.current = false;
      diskBaseline.current = text;
      if (contentRef.current === text) {
        dirtyRef.current = false;
        setDirty(false);
      }
      setFileConflict(null);
    })();
    saveInProgress.current = operation;
    try { await operation; }
    finally { if (saveInProgress.current === operation) saveInProgress.current = null; }
  }, [loadDiskContent, t]);

  const runCompile = useCallback(async () => {
    const r = rootRef.current;
    if (!r) return;
    const main = currentFileRef.current?.endsWith('.tex') ? currentFileRef.current : mainFile;
    if (!main) return;
    if (currentFileRef.current === main) await saveCurrent();
    setMainFile(main);
    setCompiling(true);
    try {
      const buildDir = `${r}\\.build`;
      const result = await window.api.compile({ mainFile: main, rootDir: r, buildDir, engine });
      if (rootRef.current !== r) return;
      setLastResult(result);
      if (result.diagnostics.some((d) => d.severity === 'error')) setShowProblems(true);
      if (result.pdfPath) {
        try {
          const bytes = await window.api.readBinary(result.pdfPath);
          if (rootRef.current === r) setPreview({ bytes, pdfPath: result.pdfPath, mainFile: main });
        } catch {
          /* ignore */
        }
      }
    } finally {
      setCompiling(false);
    }
  }, [mainFile, engine, saveCurrent]);

  const saveRef = useRef(saveCurrent);
  saveRef.current = saveCurrent;
  const compileRef = useRef(runCompile);
  compileRef.current = runCompile;

  const openFileByPath = useCallback(
    async (p: string) => {
      if (samePath(currentFileRef.current, p)) return true;
      if (currentFileRef.current && currentFileRef.current !== p && dirtyRef.current) {
        try { await saveRef.current(); }
        catch { return false; }
      }
      try {
        const text = await window.api.readFile(p);
        diskCheck.current++;
        waitForManualSave.current = false;
        diskBaseline.current = text;
        contentRef.current = text;
        dirtyRef.current = false;
        currentFileRef.current = p;
        setCurrentFile(p);
        setContent(text);
        setDirty(false);
        setFileConflict(null);
        if (p.endsWith('.tex')) setMainFile((m) => m || p);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const closeAssetPreview = useCallback(() => {
    assetRequest.current++;
    setAssetPreview(null);
  }, []);

  const openAssetPreview = useCallback(async (path: string, mime: string) => {
    const request = ++assetRequest.current;
    try {
      const bytes = await window.api.readBinary(path);
      if (request !== assetRequest.current) return;
      forwardRequest.current++;
      setAssetPreview(mime === 'application/pdf'
        ? { kind: 'pdf', path, bytes }
        : { kind: 'image', path, url: URL.createObjectURL(new Blob([bytes], { type: mime })) });
      setRightWidth((width) => width < 100 ? 320 : width);
    } catch (error) {
      if (request === assetRequest.current) reportError(error);
    }
  }, [reportError]);

  const openNode = useCallback(
    async (node: TreeNode) => {
      const mime = previewMimeType(node.path);
      if (mime) {
        await openAssetPreview(node.path, mime);
      } else if (node.editable) {
        closeAssetPreview();
        await openFileByPath(node.path);
      }
    },
    [closeAssetPreview, openAssetPreview, openFileByPath],
  );

  const applyProject = useCallback((res: { root: string; tree: TreeNode[] } | null) => {
      rootRef.current = res?.root ?? null;
      diskCheck.current++;
      waitForManualSave.current = false;
      currentFileRef.current = null;
      diskBaseline.current = null;
      contentRef.current = '';
      dirtyRef.current = false;
      setRoot(rootRef.current);
      setTree(res?.tree ?? []);
      setCurrentFile(null);
      setContent('');
      setDirty(false);
      setFileConflict(null);
      setLastResult(null);
      setPreview(null);
    closeAssetPreview();
      setMainFile(null);
      setSourceJump(null);
      setShowProblems(false);
      setNotice('');
      setEntryRequest(undefined);
  }, [closeAssetPreview]);

  const rememberProject = useCallback((project: string) => {
    const items = readWorkspace();
    const next = items.some((item) => item.toLowerCase() === project.toLowerCase()) ? items : [...items, project];
    localStorage.setItem(workspaceKey, JSON.stringify(next));
    setWorkspace(next);
  }, []);

  useEffect(() => {
    let active = true;
    void window.api.getCurrentProject?.().then((project) => {
      if (!active || openingProject.current || !project || rootRef.current) return;
      rememberProject(project.root);
      applyProject(project);
    }).catch(reportError);
    return () => { active = false; };
  }, [applyProject, rememberProject, reportError]);

  const openProject = useCallback(async (location?: string, fromWorkspace = false, mode: OpenMode = 'current') => {
    if (openingProject.current) return;
    openingProject.current = true;
    try {
      if (mode === 'current' && dirtyRef.current) await saveRef.current();
      const res = location ? (fromWorkspace ? await window.api.openWorkspace(location) : await window.api.openRecent(location, mode)) : await window.api.openFolder(mode);
      if (!res) return;
      rememberProject(res.root);
      if (res.root !== rootRef.current) applyProject(res);
    } catch (error) {
      reportError(error);
    } finally {
      openingProject.current = false;
    }
  }, [applyProject, rememberProject, reportError]);

  const handleOpenFolder = (mode: OpenMode) => void openProject(undefined, false, mode);
  const addWorkspaceFolder = () => void openProject();

  function chooseOpenMode(mode: OpenMode) {
    if (!openChoice) return;
    const { location } = openChoice;
    setOpenChoice(null);
    void openProject(location, false, mode);
  }

  const saveAs = useCallback(async () => {
    if (!currentFile) return;
    try {
      const target = await window.api.saveAs(currentFile, content);
      if (!target) return;
      if (currentFileRef.current === currentFile) {
        diskCheck.current++;
        waitForManualSave.current = false;
        diskBaseline.current = content;
        currentFileRef.current = target;
        setCurrentFile(target);
        if (contentRef.current === content) {
          dirtyRef.current = false;
          setDirty(false);
        }
        setFileConflict(null);
        if (currentFile === mainFile && /\.tex$/i.test(target)) setMainFile(target);
      }
      if (rootRef.current) await refreshTree(rootRef.current);
      setNotice(t(`已保存 ${basename(target)}`, `Saved ${basename(target)}`));
    } catch (error) {
      reportError(error);
    }
  }, [content, currentFile, mainFile, refreshTree, reportError, t]);

  const exportPdf = useCallback(async () => {
    if (!displayedPdf) {
      setNotice(t('请先打开或编译生成 PDF。', 'Open or compile a PDF first.'));
      return;
    }
    try {
      const target = await window.api.exportPdf('pdfPath' in displayedPdf ? displayedPdf.pdfPath : displayedPdf.path, displayedPdf.bytes);
      if (target) setNotice(t(`已导出 ${basename(target)}`, `Exported ${basename(target)}`));
    } catch (error) {
      reportError(error);
    }
  }, [displayedPdf, reportError, t]);

  const createEntry = async (directory: string, name: string, kind: EntryKind) => {
    if (!root) return false;
    try {
      const target = await window.api.createEntry(directory, name, kind);
      await refreshTree(root);
      if (kind === 'file' && rootRef.current === root) await openFileByPath(target);
      setNotice(t(`已创建 ${name}`, `Created ${name}`));
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  };

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = root ? 'copy' : 'none';
    const row = (event.target as Element).closest<HTMLElement>('[data-drop-row]');
    setDropRow(root ? row?.dataset.dropRow ?? null : null);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    setDropRow(null);
    if (!root) {
      setNotice(t('请先打开项目文件夹再导入。', 'Open a project before importing files.'));
      return;
    }
    const row = (event.target as Element).closest<HTMLElement>('[data-drop-directory]');
    const directory = row?.dataset.dropDirectory ?? root;
    try {
      const { copied, failures } = await window.api.importFiles(directory, Array.from(event.dataTransfer.files));
      await refreshTree(root);
      if (rootRef.current !== root) return;
      const destination = directory === root ? t('项目根目录', 'project root') : basename(directory);
      setNotice(t(`已导入 ${copied} 个文件至${destination}`, `Imported ${copied} files to ${destination}`) +
        (failures.length ? t(`，未导入 ${failures.join('、')}`, `. Skipped ${failures.join(', ')}`) : ''));
    } catch (error) {
      reportError(error);
    }
  }

  const handleChange = useCallback((c: string) => {
    contentRef.current = c;
    dirtyRef.current = true;
    setContent(c);
    setDirty(true);
  }, []);

  const syncToPdf = useCallback(async (line: number, column: number) => {
    if (!preview || assetPreview) return;
    const file = currentFileRef.current;
    if (!file || !/\.(?:tex|ltx)$/i.test(file)) return;
    const request = ++forwardRequest.current;
    const target = forwardSyncTarget(contentRef.current, line);
    const result = await window.api.synctexForward({
      pdfPath: preview.pdfPath,
      line: target.line,
      column: target.line === line ? column : 0,
      inputFile: file,
    });
    if (!result || request !== forwardRequest.current || currentPreview.current !== preview || currentFileRef.current !== file) return;
    if ((previewPaneRef.current?.clientWidth ?? 0) < 100) {
      const left = leftPaneRef.current?.clientWidth ?? 0;
      const editor = editorPaneRef.current?.clientWidth ?? 0;
      const available = left + editor;
      const width = Math.min(480, available / 2);
      setLeftWidth(Math.min(left, Math.max(0, available - width)));
      setRightWidth(width);
    }
    previewRef.current?.jumpTo(result.page, result.x, result.y, target.image);
  }, [preview, assetPreview]);

  const doSync = useCallback(() => {
    const pos = editorRef.current?.getPosition();
    if (pos) void syncToPdf(pos.line, pos.column).catch(reportError);
  }, [reportError, syncToPdf]);

  const handlePdfDoubleClick = useCallback(
    async (page: number, x: number, y: number, image?: { x: number; y: number }) => {
      const project = rootRef.current;
      if (!project || !displayedPdf || currentDisplayedPdf.current !== displayedPdf) return;
      const request = ++inverseRequest.current;
      const pdfPath = 'pdfPath' in displayedPdf ? displayedPdf.pdfPath : displayedPdf.path;
      const isCurrent = () => request === inverseRequest.current &&
        currentDisplayedPdf.current === displayedPdf && rootRef.current === project;
      const mainFile = 'mainFile' in displayedPdf ? displayedPdf.mainFile : undefined;
      const r = await window.api.synctexInverse({ pdfPath, mainFile, page, x: image?.x ?? x, y: image?.y ?? y });
      if (!isCurrent()) return;
      if (!r?.file || r.line < 1) {
        setNotice(t('此位置没有可用的 SyncTeX 源码映射。', 'No SyncTeX source mapping is available at this position.'));
        return;
      }
      if (!(await openFileByPath(r.file)) || !isCurrent()) return;
      const source = image ? forwardSyncTarget(contentRef.current, r.line).source : undefined;

      const editorWidth = editorPaneRef.current?.getBoundingClientRect().width ?? 0;
      const previewWidth = previewPaneRef.current?.getBoundingClientRect().width ?? 0;
      if (editorWidth < 280 && previewWidth > 0) {
        // Make space for the source while keeping the clicked PDF visible.
        setRightWidth(previewWidth - Math.min(280 - editorWidth, previewWidth / 2));
      }
      setSourceJump({
        file: currentFileRef.current ?? r.file,
        line: source?.line ?? r.line,
        column: source?.column ?? Math.max(1, r.column),
      });
    },
    [displayedPdf, openFileByPath, t],
  );

  useEffect(() => {
    if (!sourceJump || sourceJump.file !== currentFile) return;
    editorRef.current?.revealLine(sourceJump.line, sourceJump.column);
    setSourceJump(null);
  }, [sourceJump, currentFile]);

  const handleProblemJump = useCallback(
    async (d: Diagnostic) => {
      if (!d.file) return;
      if (d.file !== currentFileRef.current) {
        await openFileByPath(d.file);
      }
      setTimeout(() => editorRef.current?.revealLine(d.line || 1, 1), 80);
    },
    [openFileByPath],
  );

  const allFiles = useMemo(() => filesIn(tree), [tree]);
  const [referenceSources, setReferenceSources] = useState<{ root: string | null; files: [string, string][] }>({ root: null, files: [] });
  useEffect(() => {
    let active = true;
    void Promise.all(allFiles.filter((file) => /\.(?:tex|ltx|bib)$/i.test(file.path)).map(async (file) => {
      try { return [file.path, await window.api.readFile(file.path)] as [string, string]; }
      catch { return null; }
    })).then((files) => {
      if (active) setReferenceSources({ root, files: files.filter((file) => file !== null) });
    });
    return () => { active = false; };
  }, [allFiles, root]);

  const referenceKeys = useMemo(() => {
    const files = new Map(referenceSources.root === root ? referenceSources.files : []);
    if (currentFile) files.set(currentFile, content);
    const citationFiles = new Set<string>();
    const projectFile = root && root + '\\main.tex';
    const normalize = (file: string) => file.replace(/\\/g, '/').toLowerCase();
    const labelKeys = new Set<string>();
    const citations = new Set<string>();
    for (const [file, source] of files) {
      if (!/\.(?:tex|ltx)$/i.test(file)) continue;
      for (const label of labels(source)) labelKeys.add(label.text);
      for (const name of bibliographyNames(source)) {
        const bib = /\.bib$/i.test(name) ? name : name + '.bib';
        citationFiles.add(normalize(resolveAgainst(file, bib)));
        if (projectFile) citationFiles.add(normalize(resolveAgainst(projectFile, bib)));
      }
    }
    for (const [file, source] of files) {
      if (citationFiles.has(normalize(file))) for (const key of bibliographyKeys(source)) citations.add(key);
    }
    return { citations: [...citations].sort(), labels: [...labelKeys].sort() };
  }, [content, currentFile, referenceSources, root]);
  const completionPaths = useMemo(() => {
    if (!root) return [];
    return allFiles.flatMap((file) => {
      if (!file.editable || file.path === currentFile) return [];
      const path = projectRelativePath(root, file.path);
      return path ? [path] : [];
    });
  }, [root, allFiles, currentFile]);

  function requestEntry(kind: EntryKind, directory = root) {
    if (!directory) { setNotice(t('请先打开项目。', 'Open a project first.')); return; }
    if (leftWidth < 190) setLeftWidth(260);
    setEntryRequest({ directory, kind });
  }

  async function upload(directory = root) {
    if (!directory || !root) { setNotice(t('请先打开项目。', 'Open a project first.')); return; }
    try {
      const result = await window.api.uploadFiles(directory);
      if (!result) return;
      await refreshTree(root);
      setNotice(t(`已导入 ${result.copied} 个文件`, `Imported ${result.copied} files`) +
        (result.failures.length ? ' · ' + result.failures.join('、') : ''));
    } catch (error) { reportError(error); }
  }

  async function projectOutput(action: 'copy' | 'archive' | 'submit') {
    try {
      if (dirtyRef.current) await saveRef.current();
      const target = action === 'copy' ? await window.api.copyProject() : await window.api.archiveProject(action === 'submit');
      if (target) setNotice(t(`已保存到 ${target}`, `Saved to ${target}`));
    } catch (error) { reportError(error); }
  }

  function showPanel(kind: NonNullable<typeof panel>['kind'], path?: string) {
    setImageValue(''); setImageError('');
    setPanel({ kind, path });
  }

  function editFormat(action: FormatAction) {
    if (editorRef.current) formatSource(editorRef.current, action);
  }

  async function insertFigure(source: ImageSource, value = '') {
    const file = currentFileRef.current;
    if (!file || !root || imageLoading) return;
    setImageLoading(true);
    try {
      const target = await window.api.insertImage(source, value, file);
      if (!target) return;
      if (currentFileRef.current === file && editorRef.current) insertSource(editorRef.current, source, target);
      await refreshTree(root);
      setPanel(null);
      requestAnimationFrame(() => editorRef.current?.focus());
    } catch (error) {
      if (source === 'project' || source === 'url') setImageError(error instanceof Error ? error.message : String(error));
      else reportError(error);
    } finally { setImageLoading(false); }
  }

  function editInsert(action: InsertAction) {
    if (!editorRef.current) return;
    switch (action) {
      case 'symbol': case 'project': case 'url': showPanel(action); break;
      case 'local': case 'another': void insertFigure(action); break;
      default: insertSource(editorRef.current, action);
    }
  }

  async function jumpToSource(file: string, line: number, column: number) {
    setPanel(null);
    if (file !== currentFileRef.current && !(await openFileByPath(file))) return;
    const width = editorPaneRef.current?.clientWidth ?? 0;
    if (width < 200) {
      const right = previewPaneRef.current?.clientWidth ?? 0;
      if (right > 0) setRightWidth(Math.max(0, right - (240 - width)));
      else setLeftWidth((left) => Math.max(0, left - (240 - width)));
    }
    setSourceJump({ file, line, column });
  }

  async function removeWorkspace() {
    if (!root || openingProject.current) return;
    try {
      if (dirtyRef.current) await saveRef.current();
      const remaining = readWorkspace().filter((entry) => entry.toLowerCase() !== root.toLowerCase());
      await window.api.closeWorkspace();
      applyProject(null);
      localStorage.setItem(workspaceKey, JSON.stringify(remaining));
      setWorkspace(remaining);
      if (remaining.length) await openProject(remaining[0], true);
    } catch (error) { reportError(error); }
  }

  function showContext(event: MouseEvent<HTMLDivElement>) {
    if (!root) return;
    event.preventDefault();
    const row = (event.target as Element).closest<HTMLElement>('[data-drop-row]');
    setContext({
      x: Math.min(event.clientX, window.innerWidth - 290), y: Math.min(event.clientY, window.innerHeight - 295),
      path: row?.dataset.dropRow ?? root, directory: row?.dataset.dropDirectory ?? root,
    });
  }

  function closePanel() { setPanel(null); }
  const contextFilePath = root && context && context.path !== context.directory ? projectRelativePath(root, context.path) : null;
  const searchFolder = panel?.kind === 'search' ? panel.path : undefined;
  const eligibleImages = allFiles.filter((node) => /\.(?:png|jpe?g|pdf)$/i.test(node.path));
  const wordCount = panel?.kind === 'words' ? words(content) : null;

  useEffect(() => window.api.onFileCommand?.((command) => {
    switch (command.type) {
      case 'open': setOpenChoice({}); break;
      case 'openCurrent': void openProject(); break;
      case 'openNew': void openProject(undefined, false, 'new'); break;
      case 'recent': setOpenChoice({ location: command.project }); break;
      case 'save': void saveCurrent().catch(reportError); break;
      case 'saveAs': void saveAs(); break;
      case 'exportPdf': void exportPdf(); break;
      case 'newFile': requestEntry('file'); break;
      case 'newFolder': requestEntry('dir'); break;
      case 'upload': void upload(); break;
      case 'copy': case 'archive': case 'submit': void projectOutput(command.type); break;
      case 'history': if (root) showPanel('history'); break;
      case 'wordCount': if (currentFile) showPanel('words'); break;
      case 'settings': showPanel('settings'); break;
    }
  }));

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && !e.shiftKey && key === 'o') {
        e.preventDefault();
        if (!e.repeat) setOpenChoice({});
      } else if (mod && !e.altKey && e.shiftKey && key === 's') {
        e.preventDefault();
        if (!e.repeat) void saveAs();
      } else if (mod && !e.shiftKey && key === 's') {
        e.preventDefault();
        const file = currentFileRef.current;
        if (e.repeat || !file) return;
        if (file.endsWith('.tex')) {
          // Compilation saves pending changes to the TeX source first.
          void compileRef.current().catch(reportError);
        } else {
          void saveRef.current().then(() => {
            if (currentFileRef.current === file) return compileRef.current();
          }).catch(reportError);
        }
      } else if (mod && e.shiftKey && key === 'b') {
        e.preventDefault();
        void compileRef.current().catch(reportError);
      } else if (mod && e.shiftKey && key === 'f' && rootRef.current) {
        e.preventDefault();
        setPanel({ kind: 'search' });
      } else if (editorRef.current && mod && !e.shiftKey && !e.altKey && ['b', 'i', '[', ']'].includes(key)) {
        e.preventDefault();
        const format = { b: 'bold', i: 'italic', '[': 'outdent', ']': 'indent' } as const;
        formatSource(editorRef.current, format[key as keyof typeof format]);
      } else if (e.altKey && e.shiftKey && rootRef.current) {
        if (key === 'r') {
          e.preventDefault();
          void window.api.revealInFolder(currentFileRef.current ?? rootRef.current).catch(reportError);
        } else if (key === 'f') {
          e.preventDefault();
          setPanel({ kind: 'search', path: rootRef.current });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reportError, saveAs]);

  // File watcher: refresh tree + reload externally-changed current file.
  useEffect(() => {
    const off = window.api.onFileChanged((data) => {
      const r = rootRef.current;
      if (r) void refreshTree(r).catch(reportError);
      const file = currentFileRef.current;
      if (!file || !samePath(file, data.path)) return;
      const check = ++diskCheck.current;
      void (async () => {
        await saveInProgress.current?.catch(() => {});
        const disk = await readDiskFile(file);
        if (check !== diskCheck.current || currentFileRef.current !== file) return;
        if (disk === diskBaseline.current) {
          setFileConflict(null);
        } else if (disk !== null && (!dirtyRef.current || disk === contentRef.current)) {
          loadDiskContent(disk);
          setNotice(t('已同步磁盘上的修改。', 'Reloaded changes from disk.'));
        } else {
          setFileConflict({ file, disk });
        }
      })().catch(reportError);
    });
    return off;
  }, [loadDiskContent, refreshTree, reportError, t]);

  async function resolveFileConflict(keepEditor: boolean) {
    if (!fileConflict || currentFileRef.current !== fileConflict.file) return;
    const { file } = fileConflict;
    try {
      const disk = await readDiskFile(file);
      if (currentFileRef.current !== file) return;
      if (keepEditor) {
        waitForManualSave.current = true;
        diskBaseline.current = disk;
        dirtyRef.current = true;
        setDirty(true);
        setNotice(t('已保留编辑器版本。', 'Kept the editor version.'));
      } else if (disk !== null) {
        loadDiskContent(disk);
        setNotice(t('已载入磁盘版本。', 'Loaded the disk version.'));
      } else {
        setFileConflict({ file, disk });
        return;
      }
      setFileConflict(null);
      requestAnimationFrame(() => editorRef.current?.focus());
    } catch (error) { reportError(error); }
  }

  // Auto-compile (debounced) when editing a .tex file.
  useEffect(() => {
    if (!autoCompile) return;
    if (!dirty || fileConflict || waitForManualSave.current) return;
    if (!currentFile?.endsWith('.tex')) return;
    const t = setTimeout(() => void compileRef.current().catch(reportError), 1000);
    return () => clearTimeout(t);
  }, [content, dirty, fileConflict, autoCompile, currentFile, reportError]);

  const projectName = root ? root.split(/[\\/]/).filter(Boolean).pop() || root : 'FastLaTeXer';
  const diagnostics = lastResult?.diagnostics ?? [];
  const errCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity === 'warning').length;

  return (
    <LanguageContext.Provider value={language}>
    <div className="app" onDragOverCapture={handleDragOver} onDropCapture={handleDrop} onDragLeave={(event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropRow(null);
    }}>
      <header className="window-titlebar"><img src={appIcon} alt="" width="16" height="16" />FastLaTeXer</header>
      <Toolbar
        projectName={projectName}
        currentFile={currentFile}
        engine={engine}
        onEngineChange={setEngine}
        compiling={compiling}
        lastResult={lastResult}
        autoCompile={autoCompile}
        onAutoCompileChange={setAutoCompile}
        onEditorMenuAction={(role) => {
          const focused = document.activeElement;
          if (focused?.matches('input, textarea, [contenteditable=true]') && !focused.closest('.monaco-editor')) return false;
          return editorRef.current?.runEditMenuAction(role) ?? false;
        }}
        onSave={() => void saveCurrent().catch(reportError)}
        onCompile={() => void runCompile().catch(reportError)}
        onSync={doSync}
        canSync={!!preview && !assetPreview}
      >
        <WorkbenchMenus editor={!!currentFile} project={!!root} onInsert={editInsert} onFormat={editFormat}
          onSearch={() => showPanel('search')} onSettings={() => showPanel('settings')} onHistory={() => showPanel('history')} />
      </Toolbar>

      <div
        className="main"
        style={{
          gridTemplateColumns: `min(${leftWidth}px, var(--pane-space)) var(--divider-width) minmax(0, 1fr) var(--divider-width) min(${rightWidth}px, max(0px, calc(var(--pane-space) - ${leftWidth}px)))`,
        }}
      >
        <div className="pane pane-left" ref={leftPaneRef} onContextMenu={showContext}>
          {(root || workspace.length > 0) && <div className="workspace-picker">
            <select aria-label={t('工作区项目', 'Workspace project')} value={root ?? ''} onChange={(event) => {
              if (event.target.value) void openProject(event.target.value, true);
            }}>
              <option value="" disabled>{t('打开工作区项目', 'Open workspace project')}</option>
              {root && !workspace.includes(root) && <option value={root}>{basename(root)}</option>}
              {workspace.map((project) => <option title={project} key={project} value={project}>{basename(project)}</option>)}
            </select>
            <button className="pane-btn" title={t('将文件夹添加到工作区', 'Add Folder to Workspace')} onClick={addWorkspaceFolder}>+</button>
          </div>}
          <FileTree key={root} root={root} nodes={tree} currentFile={assetPreview?.path ?? currentFile} onOpen={openNode} onCreate={createEntry} dropRow={dropRow} request={entryRequest} />
          <FileOutline content={content} hasFile={!!currentFile} onJump={(line, column) => {
            if (currentFile) void jumpToSource(currentFile, line, column);
          }} />
        </div>

        <div
          className="divider"
          onPointerDown={(e) => {
            const width = leftPaneRef.current!.getBoundingClientRect().width;
            const available = width + editorPaneRef.current!.getBoundingClientRect().width;
            startDrag(e, (dx) => setLeftWidth(clamp(width + dx, 0, available)));
          }}
        />

        <div className="pane pane-editor" ref={editorPaneRef}>
          {fileConflict && <div className="file-conflict" role="alert">
            <span>{fileConflict.disk === null
              ? t('磁盘上的文件已删除或移走。', 'The file was moved or removed from disk.')
              : t('磁盘和编辑区都发生了修改。', 'The file changed both on disk and in the editor.')}</span>
            {fileConflict.disk !== null && <button className="pane-btn" onClick={() => void resolveFileConflict(false)}>{t('载入磁盘版本', 'Load Disk Version')}</button>}
            <button className="pane-btn" onClick={() => void resolveFileConflict(true)}>{t('保留编辑器版本', 'Keep Editor Version')}</button>
          </div>}
          {currentFile ? (
            <EditorPane
              ref={editorRef}
              filePath={currentFile}
              content={content}
              onChange={handleChange}
              onDoubleClick={(line, column) => void syncToPdf(line, column).catch(reportError)}
              diagnostics={diagnostics}
              projectPaths={completionPaths}
              referenceKeys={referenceKeys}
            />
          ) : (
            <Welcome recentProjects={recentProjects} onOpen={handleOpenFolder} onRecent={(project) => void openProject(project)} />
          )}
        </div>

        <div
          className="divider"
          onPointerDown={(e) => {
            const width = previewPaneRef.current!.getBoundingClientRect().width;
            const available = width + editorPaneRef.current!.getBoundingClientRect().width;
            startDrag(e, (dx) => setRightWidth(clamp(width - dx, 0, available)));
          }}
        />

        <div className="pane pane-preview" ref={previewPaneRef}>
          <div className="pane-title pane-actions">
            <span>{assetPreview ? basename(assetPreview.path) : t('预览', 'Preview')}</span>
            {assetPreview && <button className="pane-btn" onClick={closeAssetPreview}>{t('关闭文件预览', 'Close file preview')}</button>}
            <button className="pane-btn zoom-btn" title={t('缩小 (Ctrl + 滚轮)', 'Zoom out (Ctrl + Wheel)')} aria-label={t('缩小预览', 'Zoom out')} disabled={!displayedPdf}
              onClick={() => previewRef.current?.zoomOut()}><span className="magnifier" aria-hidden="true">−</span></button>
            <button className="pane-btn zoom-btn" title={t('放大 (Ctrl + 滚轮)', 'Zoom in (Ctrl + Wheel)')} aria-label={t('放大预览', 'Zoom in')} disabled={!displayedPdf}
              onClick={() => previewRef.current?.zoomIn()}><span className="magnifier" aria-hidden="true">+</span></button>
            <button className="pane-btn" disabled={!displayedPdf} onClick={exportPdf}>{t('导出 PDF', 'Export PDF')}</button>
          </div>
          {assetPreview?.kind === 'image'
            ? <div className="preview preview-image"><img src={assetPreview.url} alt={basename(assetPreview.path)}
                onError={() => setNotice(t('无法显示此图片。', 'Unable to display this image.'))} /></div>
            : <PreviewPane ref={previewRef} pdfBytes={displayedPdf?.bytes ?? null} onDoubleClick={(page, x, y, image) => {
                void handlePdfDoubleClick(page, x, y, image).catch(reportError);
              }} />}
        </div>
      </div>

      {showProblems && (
        <div className="problems-panel">
          <div className="problems-header">
            <span>
              {t(`问题（${errCount} 错误 · ${warnCount} 警告）`, `Problems (${errCount} errors · ${warnCount} warnings)`)}
            </span>
            <button className="problems-close" onClick={() => setShowProblems(false)}>
              ✕
            </button>
          </div>
          <ProblemsPanel diagnostics={diagnostics} onJump={handleProblemJump} />
        </div>
      )}

      <div className="statusbar">
        <span className="status-left">
          {compiling
            ? t('⏳ 编译中…', '⏳ Compiling…')
            : lastResult?.success
              ? t(`✓ 已编译（${lastResult.engine}）`, `✓ Compiled (${lastResult.engine})`)
              : lastResult
                ? t(`✗ 编译失败（${lastResult.engine}）`, `✗ Compilation failed (${lastResult.engine})`)
                : t('未编译', 'Not compiled')}
        </span>
        {notice && <span className="status-notice" role="status" title={notice}>{notice}</span>}
        <span className="status-right">
          {errCount > 0 && <span className="sb err">✖ {errCount} {t('错误', 'errors')}</span>}
          {warnCount > 0 && <span className="sb warn">⚠ {warnCount} {t('警告', 'warnings')}</span>}
          {!showProblems && (errCount > 0 || warnCount > 0) && (
            <button className="status-toggle" onClick={() => setShowProblems(true)}>
              {t('显示问题', 'Show Problems')}
            </button>
          )}
        </span>
      </div>
      {context && <div className="workbench-dropdown tree-context" ref={contextRef} style={{ left: context.x, top: context.y }}
        onClick={(event) => { if ((event.target as Element).closest('button')) setContext(null); }}>
        <button onClick={() => requestEntry('file', context.directory)}>{t('新建文件…', 'New File…')}</button>
        <button onClick={() => requestEntry('dir', context.directory)}>{t('新建文件夹…', 'New Folder…')}</button>
        <button onClick={() => void window.api.revealInFolder(context.path).catch(reportError)}>{t('在文件资源管理器中显示', 'Reveal in File Explorer')}<kbd>Shift+Alt+R</kbd></button>
        {contextFilePath && <button onClick={() => {
          void (window.api.copyText?.(contextFilePath) ?? navigator.clipboard.writeText(contextFilePath)).then(() => {
            setNotice(t(`已复制 ${contextFilePath}`, `Copied ${contextFilePath}`));
          }).catch(reportError);
        }}>{t('复制文件相对路径', 'Copy Relative File Path')}</button>}
        <button disabled={!contextFilePath || !previewMimeType(context.path)} onClick={() => {
          const mime = previewMimeType(context.path);
          if (mime) void openAssetPreview(context.path, mime);
        }}>{t('在预览中打开', 'Open in Preview')}</button>
        <hr />
        <button onClick={addWorkspaceFolder}>{t('将文件夹添加到工作区…', 'Add Folder to Workspace…')}</button>
        <button onClick={() => showPanel('settings', context.directory)}>{t('打开文件夹设置', 'Open Folder Settings')}</button>
        <button disabled={context.path !== root} onClick={() => void removeWorkspace()}>{t('将文件夹从工作区移除', 'Remove Folder from Workspace')}</button>
        <hr />
        <button onClick={() => showPanel('search', context.directory)}>{t('在文件夹中查找…', 'Find in Folder…')}<kbd>Shift+Alt+F</kbd></button>
      </div>}
      {openChoice && <Panel title={t('打开项目文件夹', 'Open Project Folder')} onClose={() => setOpenChoice(null)}>
        {openChoice.location && <p className="folder-location">{openChoice.location}</p>}
        <div className="workbench-form open-mode">
          <button className="tb-btn tb-primary" onClick={() => chooseOpenMode('current')}>{t('在当前窗口打开', 'Open in Current Window')}</button>
          <button className="tb-btn" onClick={() => chooseOpenMode('new')}>{t('在新窗口打开', 'Open in New Window')}</button>
        </div>
      </Panel>}
      {panel?.kind === 'settings' && <Panel title={t('设置', 'Settings')} onClose={closePanel}>
        <Settings path={panel.path} language={language} theme={theme} onLanguage={setLanguage} onTheme={setTheme} />
      </Panel>}
      {panel?.kind === 'search' && <Panel title={t('搜索项目', 'Search Project')} onClose={closePanel}>
        <ProjectSearch files={allFiles} folder={searchFolder} currentFile={currentFile} content={content}
          onJump={(file, line, column) => void jumpToSource(file, line, column)} />
      </Panel>}
      {panel?.kind === 'history' && <Panel title={t('Git 版本历史', 'Git Version History')} onClose={closePanel}><GitHistory /></Panel>}
      {wordCount && <Panel title={t('字数统计', 'Word Count')} onClose={closePanel}>
        <dl className="text-stats">
          <div><dt>{t('词数', 'Words')}</dt><dd>{wordCount.words}</dd></div>
          <div><dt>{t('字符数', 'Characters')}</dt><dd>{wordCount.characters}</dd></div>
          <div><dt>{t('行数', 'Lines')}</dt><dd>{wordCount.lines}</dd></div>
        </dl>
      </Panel>}
      {panel?.kind === 'symbol' && <Panel title={t('插入符号', 'Insert Symbol')} onClose={closePanel}>
        <div className="symbol-grid">
          {Object.entries({ 'α': '\\alpha', 'β': '\\beta', 'π': '\\pi', 'θ': '\\theta', '∞': '\\infty', '∫': '\\int', '∑': '\\sum', '√': '\\sqrt{}', '×': '\\times', '≤': '\\leq', '≥': '\\geq', '→': '\\to' }).map(([symbol, command]) => (
            <button className="tb-btn" title={command} key={symbol} onClick={() => {
              closePanel();
              if (editorRef.current) insertSource(editorRef.current, 'symbol', command);
              requestAnimationFrame(() => editorRef.current?.focus());
            }}>{symbol}</button>
          ))}
        </div>
      </Panel>}
      {(panel?.kind === 'project' || panel?.kind === 'url') && <Panel title={t('插入图像', 'Insert Figure')} onClose={closePanel}>
        <form className="workbench-form" onSubmit={(event) => {
          event.preventDefault();
          if (imageValue.trim()) void insertFigure(panel.kind === 'url' ? 'url' : 'project', imageValue.trim());
        }}>
          {panel.kind === 'project' ? <select autoFocus aria-label={t('项目图像', 'Project image')} value={imageValue} onChange={(event) => setImageValue(event.target.value)}>
            <option value="">{t('选择项目中的图像', 'Choose a project image')}</option>
            {eligibleImages.map((node) => <option key={node.path} value={node.path}>{root ? node.path.slice(root.length + 1) : node.name}</option>)}
          </select> : <input type="url" autoFocus aria-label={t('图像网址', 'Image URL')} placeholder="https://…" value={imageValue} onChange={(event) => setImageValue(event.target.value)} />}
          <button className="tb-btn tb-primary" disabled={!imageValue.trim() || imageLoading}>{t('插入', 'Insert')}</button>
        </form>
        {imageError && <p className="panel-status">{imageError}</p>}
      </Panel>}
    </div>
    </LanguageContext.Provider>
  );
}
