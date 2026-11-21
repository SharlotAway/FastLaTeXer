import type { CompileResult } from '../types';
import type { ReactNode } from 'react';
import { useText } from '../preferences';
import { ApplicationMenus } from './Workbench';

export default function Toolbar({
  projectName,
  currentFile,
  engine,
  onEngineChange,
  compiling,
  lastResult,
  autoCompile,
  onAutoCompileChange,
  onEditorMenuAction,
  onSave,
  onCompile,
  onSync,
  canSync,
  children,
}: {
  projectName: string;
  currentFile: string | null;
  engine: string;
  onEngineChange: (e: string) => void;
  compiling: boolean;
  lastResult: CompileResult | null;
  autoCompile: boolean;
  onAutoCompileChange: (v: boolean) => void;
  onEditorMenuAction: (role: string) => boolean;
  onSave: () => void;
  onCompile: () => void;
  onSync: () => void;
  canSync: boolean;
  children?: ReactNode;
}) {
  const t = useText();
  const errCount = lastResult ? lastResult.diagnostics.filter((d) => d.severity === 'error').length : 0;
  const warnCount = lastResult ? lastResult.diagnostics.filter((d) => d.severity === 'warning').length : 0;

  return (
    <div className="toolbar">
      <ApplicationMenus onEditorAction={onEditorMenuAction} />
      {children}
      <span className="tb-sep" />
      <button className="tb-btn" onClick={onSave} title={t('保存（Ctrl+S 保存并编译）', 'Save (Ctrl+S saves and compiles)')} disabled={!currentFile}>
        💾 {t('保存', 'Save')}
      </button>
      <button className="tb-btn tb-primary" onClick={onCompile} title={t('编译 (Ctrl+Shift+B)', 'Compile (Ctrl+Shift+B)')} disabled={!currentFile || compiling}>
        {compiling ? t('⏳ 编译中…', '⏳ Compiling…') : t('▶ 编译', '▶ Compile')}
      </button>
      <button className="tb-btn" onClick={onSync} title={t('编辑器 → 预览（SyncTeX）', 'Editor → Preview (SyncTeX)')} disabled={!canSync}>
        ⇄ {t('同步', 'Sync')}
      </button>
      <span className="tb-sep" />
      <label className="tb-engine">
        {t('引擎', 'Engine')}
        <select value={engine} onChange={(e) => onEngineChange(e.target.value)}>
          <option value="xelatex">XeLaTeX</option>
          <option value="pdflatex">pdfLaTeX</option>
          <option value="lualatex">LuaLaTeX</option>
        </select>
      </label>
      <label className="tb-check">
        <input type="checkbox" checked={autoCompile} onChange={(e) => onAutoCompileChange(e.target.checked)} />
        {t('自动编译', 'Auto Compile')}
      </label>
      <div className="tb-spacer" />

      <div className="tb-status">
        {errCount > 0 && <span className="tb-badge err">✖ {errCount}</span>}
        {warnCount > 0 && <span className="tb-badge warn">⚠ {warnCount}</span>}
        {lastResult?.success && <span className="tb-badge ok">✓ {t('编译成功', 'Compiled')} · {lastResult.engine}</span>}
        {!lastResult && !compiling && projectName && <span className="tb-muted">{t('未编译', 'Not compiled')}</span>}
      </div>

      <div className="tb-title" title={projectName}>
        {projectName}
      </div>
    </div>
  );
}
