import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useText } from '../preferences';
import { basename } from '../path';
import { labels, outline, searchPattern, textMatches, type MatchMode, type SourceLocation } from '../latex/documentTools';
import type { AppMenu, AppMenuItem, GitStatus, ImageSource, Language, Theme, TreeNode } from '../types';

export type FormatAction = 'bold' | 'italic' | 'bullet' | 'numbered' | 'indent' | 'outdent' |
  'normal' | 'section' | 'subsection' | 'subsubsection' | 'paragraph' | 'subparagraph';
export type InsertAction = 'inlineMath' | 'displayMath' | 'symbol' | 'table' | 'cite' | 'link' | 'ref' |
  'comment' | 'abstract' | 'keywords' | 'title' | ImageSource;

export function Dropdown({ label, children, preserveFocus }: { label: ReactNode; children: ReactNode; preserveFocus?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return <details ref={ref} className="workbench-menu" onMouseDown={preserveFocus ? (event) => {
    if (event.button === 0) event.preventDefault();
  } : undefined} onKeyDown={(event) => {
    if (event.key === 'Escape' && ref.current) ref.current.open = false;
  }}>
    <summary className="tb-btn">{label}</summary>
    <div className="workbench-dropdown" onClick={(event) => {
      if ((event.target as Element).closest('button') && ref.current) ref.current.open = false;
    }}>{children}</div>
  </details>;
}

function MenuEntries({ items, parent, onActivate }: {
  items: AppMenuItem[]; parent: number[]; onActivate: (indices: number[], role?: string) => void;
}) {
  return items.map((item, index) => {
    if (!item.visible) return null;
    if (item.type === 'separator') return <hr key={index} />;
    const indices = [...parent, index];
    if (item.items) return <details key={index}><summary>{item.label}</summary>
      <MenuEntries items={item.items} parent={indices} onActivate={onActivate} />
    </details>;
    return <button key={index} title={item.label} disabled={!item.enabled} onClick={() => onActivate(indices, item.role)}>
      <span className="app-menu-label">{item.label}</span>
      {item.accelerator && <kbd>{item.accelerator.replace('CmdOrCtrl', 'Ctrl')}</kbd>}
    </button>;
  });
}

export function ApplicationMenus({ onEditorAction }: { onEditorAction: (role: string) => boolean }) {
  const [menu, setMenu] = useState<AppMenu | null>(null);
  useEffect(() => {
    let active = true;
    const update = (next: AppMenu | null) => setMenu((previous) => previous && next && previous.revision > next.revision ? previous : next);
    const unsubscribe = window.api.onApplicationMenu?.(update);
    void window.api.getApplicationMenu?.().then((next) => { if (active) update(next); }).catch(console.error);
    return () => { active = false; unsubscribe?.(); };
  }, []);
  return menu?.items.map((item, index) => item.visible && item.items && (
    <Dropdown key={index} label={item.label} preserveFocus>
      <MenuEntries items={item.items} parent={[index]} onActivate={(indices, role) => {
        if (role && onEditorAction(role)) return;
        void window.api.activateMenuItem(menu.revision, indices).catch(console.error);
      }} />
    </Dropdown>
  ));
}

export function WorkbenchMenus({ editor, project, onInsert, onFormat, onSearch, onSettings, onHistory }: {
  editor: boolean; project: boolean; onInsert: (action: InsertAction) => void; onFormat: (action: FormatAction) => void;
  onSearch: () => void; onSettings: () => void; onHistory: () => void;
}) {
  const t = useText();
  const insert = (action: InsertAction, zh: string, en: string) =>
    <button key={action} disabled={!editor} onClick={() => onInsert(action)}>{t(zh, en)}</button>;
  const format = (action: FormatAction, zh: string, en: string, key?: string) =>
    <button key={action} disabled={!editor} onClick={() => onFormat(action)}>{t(zh, en)}{key && <kbd>{key}</kbd>}</button>;
  return <>
    <Dropdown label={t('插入', 'Insert')}>
      <details><summary>{t('数学公式', 'Math')}</summary>
        {insert('inlineMath', '行内公式', 'Inline Math')}{insert('displayMath', '行间公式', 'Display Math')}
      </details>
      {insert('symbol', '符号…', 'Symbol…')}
      <details><summary>{t('图像', 'Figure')}</summary>
        {insert('local', '从电脑上传…', 'Upload from computer…')}
        {insert('project', '从项目文件…', 'From project files…')}
        {insert('another', '从另一个项目…', 'From another project…')}
        {insert('url', '从网址…', 'From URL…')}
      </details>
      {insert('table', '表格', 'Table')}{insert('cite', '引用', 'Citation')}{insert('link', '链接', 'Link')}
      {insert('ref', '交叉引用', 'Cross Reference')}{insert('comment', '评论', 'Comment')}
      <hr />
      {insert('abstract', '摘要', 'Abstract')}{insert('keywords', '关键词', 'Keywords')}{insert('title', '标题', 'Title')}
    </Dropdown>
    <Dropdown label={t('格式', 'Format')}>
      {format('bold', '加粗', 'Bold', 'Ctrl+B')}{format('italic', '斜体', 'Italics', 'Ctrl+I')}
      <hr />
      {format('bullet', '项目符号列表', 'Bullet List')}{format('numbered', '编号列表', 'Numbered List')}
      {format('indent', '增加缩进', 'Increase Indentation', 'Ctrl+]')}{format('outdent', '减少缩进', 'Decrease Indentation', 'Ctrl+[')}
      <hr /><span className="menu-caption">{t('段落样式', 'Paragraph Styles')}</span>
      {format('normal', '正文', 'Normal')}{format('section', '一级标题', 'Section')}
      {format('subsection', '二级标题', 'Subsection')}{format('subsubsection', '三级标题', 'Subsubsection')}
      {format('paragraph', '段落', 'Paragraph')}{format('subparagraph', '子段落', 'Subparagraph')}
    </Dropdown>
    <button className="tb-btn" disabled={!project} onClick={onSearch} title="Ctrl+Shift+F">{t('搜索', 'Search')}</button>
    <button className="tb-btn" disabled={!project} onClick={onHistory}>Git</button>
    <button className="tb-btn" onClick={onSettings}>{t('设置', 'Settings')}</button>
  </>;
}

export function Panel({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('input:not([type=checkbox]), select')?.focus();
  }, []);
  return <dialog className="workbench-panel" ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2>{title}</h2><button className="pane-btn" aria-label="Close / 关闭" onClick={onClose}>×</button></header>
    {children}
  </dialog>;
}

export function Settings({ path, language, theme, onLanguage, onTheme }: {
  path?: string; language: Language; theme: Theme; onLanguage: (language: Language) => void; onTheme: (theme: Theme) => void;
}) {
  const t = useText();
  return <div className="setting-fields">
    {path && <p className="folder-location">{path}</p>}
    <label>{t('界面语言', 'Interface language')}
      <select value={language} onChange={(event) => onLanguage(event.target.value as Language)}><option value="zh">简体中文</option><option value="en">English</option></select>
    </label>
    <label>{t('主题', 'Theme')}
      <select value={theme} onChange={(event) => onTheme(event.target.value as Theme)}>
        <option value="dark">{t('深色', 'Dark')}</option><option value="light">{t('浅色', 'Light')}</option>
        <option value="yoimiya">{t('宵宫主题配色', 'Yoimiya Palette')}</option>
        <option value="furina">{t('芙宁娜主题配色', 'Furina Palette')}</option>
      </select>
    </label>
  </div>;
}

export function FileOutline({ content, hasFile, onJump }: { content: string; hasFile: boolean; onJump: (line: number, column: number) => void }) {
  const t = useText();
  const headings = useMemo(() => outline(content), [content]);
  return <div className="file-outline">
    <div className="pane-title">{t('文件大纲', 'File Outline')}</div>
    <div className="outline-list">
      {headings.map((heading) => <button key={heading.line + ':' + heading.column} title={heading.text}
        onClick={() => onJump(heading.line, heading.column)} style={{ paddingInlineStart: 10 + heading.level * 14 }}>{heading.text}</button>)}
      {!headings.length && <span>{hasFile ? t('当前文件没有章节', 'No sections in this file') : t('打开文件后显示大纲', 'Open a file to see its outline')}</span>}
    </div>
  </div>;
}

export function filesIn(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => node.type === 'dir' ? filesIn(node.children) : [node]);
}

export function ProjectSearch({ files, folder, currentFile, content, onJump }: {
  files: TreeNode[]; folder?: string; currentFile: string | null; content: string;
  onJump: (file: string, line: number, column: number) => void;
}) {
  const t = useText();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<MatchMode>('contains');
  const [kind, setKind] = useState('label');
  const [whole, setWhole] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<SourceLocation & { file: string }>>([]);
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return <>
    {folder && <p className="folder-location">{folder}</p>}
    <form className="workbench-form" onSubmit={async (event) => {
      event.preventDefault();
      const term = query.trim();
      if (!term || busy) return;
      setBusy(true); setMessage(''); setResults([]);
      const matches: Array<SourceLocation & { file: string }> = [];
      const pattern = searchPattern(term, mode, whole, kind === 'label');
      const prefix = folder?.replace(/[\\/]$/, '') + '\\';
      let failed = 0;
      for (const file of files) {
        if (!alive.current || matches.length >= 300) break;
        if (!file.editable || (folder && !file.path.replace(/\//g, '\\').toLowerCase().startsWith(prefix.toLowerCase()))) continue;
        try {
          const source = file.path === currentFile ? content : await window.api.readFile(file.path);
          const found = kind === 'label' ? labels(source).filter((label) => {
            pattern.lastIndex = 0;
            return pattern.test(label.text);
          }) : textMatches(source, pattern);
          matches.push(...found.slice(0, 300 - matches.length).map((match) => ({ ...match, file: file.path })));
        } catch { failed++; }
      }
      if (!alive.current) return;
      setResults(matches); setBusy(false);
      setMessage((matches.length ? t(`${matches.length}${matches.length === 300 ? '+' : ''} 条结果`, `${matches.length}${matches.length === 300 ? '+' : ''} results`) : t('没有结果', 'No results')) +
        (failed ? t(` · ${failed} 个文件无法读取`, ` · ${failed} unreadable files`) : ''));
    }}>
      <input autoFocus maxLength={160} value={query} onChange={(event) => setQuery(event.target.value)}
        aria-label={t('搜索词', 'Search query')} placeholder={t('搜索词，例如 fig:*', 'Search, e.g. fig:*')} />
      <select aria-label={t('搜索类型', 'Search type')} value={kind} onChange={(event) => setKind(event.target.value)}>
        <option value="label">{t('LaTeX 标记', 'LaTeX labels')}</option><option value="text">{t('文本', 'Text')}</option>
      </select>
      <select aria-label={t('匹配方式', 'Match mode')} value={mode} onChange={(event) => setMode(event.target.value as MatchMode)}>
        <option value="contains">{t('包含', 'Contains')}</option><option value="exact">{t('完全匹配', 'Exact match')}</option><option value="wildcard">{t('通配符', 'Wildcard')}</option>
      </select>
      <label><input type="checkbox" checked={whole} onChange={(event) => setWhole(event.target.checked)} /> {t('整词', 'Whole Word')}</label>
      <button className="tb-btn tb-primary" disabled={busy || !query.trim()}>{busy ? t('搜索中…', 'Searching…') : t('搜索', 'Search')}</button>
    </form>
    <div className="panel-status" role="status">{message}</div>
    <div className="panel-results">
      {results.map((result) => <button key={result.file + ':' + result.line + ':' + result.column}
        onClick={() => onJump(result.file, result.line, result.column)} title={result.file}>
        <small>{basename(result.file)}:{result.line}</small><span>{result.text}</span>
      </button>)}
    </div>
  </>;
}

export function GitHistory() {
  const t = useText();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [remote, setRemote] = useState('');
  const [patch, setPatch] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const value = await window.api.git('status');
    setStatus(value); setRemote(value.remote);
  }
  function run(action: () => Promise<unknown>) {
    setBusy(true); setMessage('');
    void action().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false));
  }
  useEffect(() => { run(refresh); }, []);
  return <>
    <div className="workbench-form">
      {status?.exists === false && <button className="tb-btn" disabled={busy} onClick={() => run(async () => { await window.api.git('init'); await refresh(); })}>{t('初始化 Git', 'Initialize Git')}</button>}
      {status?.exists && <>
        <input aria-label={t('远程仓库地址', 'Remote repository URL')} value={remote} onChange={(event) => setRemote(event.target.value)} placeholder="https://… / git@…" />
        <button className="tb-btn" disabled={busy || !remote.trim()} onClick={() => run(async () => {
          await window.api.git('connect', remote); await refresh(); setMessage(t('已连接远程仓库。', 'Remote repository connected.'));
        })}>{t('连接远程仓库', 'Connect Remote')}</button>
        <button className="tb-btn" disabled={busy || !status.remote} onClick={() => run(async () => { await window.api.git('fetch'); await refresh(); })}>{t('获取远程历史', 'Fetch History')}</button>
      </>}
      <button className="tb-btn" disabled={busy} onClick={() => run(refresh)}>{t('刷新', 'Refresh')}</button>
    </div>
    <div className="panel-status" role="status">{message || (busy ? t('正在运行 Git…', 'Running Git…') : status?.branch || '')}</div>
    {status?.exists && !status.commits.length && <p>{t('暂无提交。', 'No commits yet.')}</p>}
    <div className="panel-results">
      {status?.commits.map((commit) => <button key={commit.hash} disabled={busy} onClick={() => run(async () => setPatch(await window.api.git('commit', commit.hash)))}>
        <small>{commit.short} · {commit.date} · {commit.author}</small><span>{commit.subject}</span>
      </button>)}
    </div>
    {patch && <pre className="commit-patch">{patch}</pre>}
  </>;
}
