import { useEffect, useState } from 'react';
import type { EntryKind, TreeNode } from '../types';
import { useText } from '../preferences';

function iconFor(node: TreeNode): string {
  if (node.type === 'dir') return '📁';
  const ext = node.ext || '';
  if (['.tex', '.ltx', '.sty', '.cls'].includes(ext)) return '📄';
  if (['.bib', '.bst'].includes(ext)) return '📚';
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.eps', '.pdf'].includes(ext)) return '🖼';
  return '📃';
}

function TreeNodeView({
  node,
  depth,
  currentFile,
  onOpen,
  directory,
  selectedDirectory,
  dropRow,
  onSelectDirectory,
}: {
  node: TreeNode;
  depth: number;
  currentFile: string | null;
  onOpen: (node: TreeNode) => void;
  directory: string;
  selectedDirectory: string;
  dropRow: string | null;
  onSelectDirectory: (directory: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);

  if (node.type === 'dir') {
    return (
      <div>
        <div
          className={`tree-row tree-dir${selectedDirectory === node.path ? ' active' : ''}${dropRow === node.path ? ' drop-target' : ''}`}
          data-drop-directory={node.path}
          data-drop-row={node.path}
          style={{ paddingLeft: depth * 12 + 4 }}
          onClick={() => {
            onSelectDirectory(node.path);
            setOpen((o) => selectedDirectory !== node.path || !o);
          }}
        >
          <span className="tree-chevron">{open ? '▾' : '▸'}</span>
          <span className="tree-icon">{iconFor(node)}</span>
          <span className="tree-name">{node.name}</span>
        </div>
        {open &&
          node.children.map((c) => (
            <TreeNodeView key={c.path} node={c} depth={depth + 1} currentFile={currentFile} onOpen={onOpen}
              directory={node.path} selectedDirectory={selectedDirectory} dropRow={dropRow} onSelectDirectory={onSelectDirectory} />
          ))}
      </div>
    );
  }

  const active = node.path === currentFile;
  return (
    <div
      className={`tree-row tree-file${active ? ' active' : ''}${dropRow === node.path ? ' drop-target' : ''}`}
      data-drop-directory={directory}
      data-drop-row={node.path}
      style={{ paddingLeft: depth * 12 + 20 }}
      onClick={() => { onSelectDirectory(directory); onOpen(node); }}
    >
      <span className="tree-icon">{iconFor(node)}</span>
      <span className="tree-name">{node.name}</span>
    </div>
  );
}

export default function FileTree({
  root,
  nodes,
  currentFile,
  onOpen,
  onCreate,
  dropRow,
  request,
}: {
  root: string | null;
  nodes: TreeNode[];
  currentFile: string | null;
  onOpen: (node: TreeNode) => void;
  onCreate: (directory: string, name: string, kind: EntryKind) => Promise<boolean>;
  dropRow: string | null;
  request?: { directory: string; kind: EntryKind };
}) {
  const t = useText();
  const [directory, setDirectory] = useState(root ?? '');
  const [draft, setDraft] = useState<{ directory: string; kind: EntryKind } | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!request) return;
    setName('');
    setDraft(request);
  }, [request]);

  function startCreate(kind: EntryKind) {
    setName('');
    setDraft({ directory, kind });
  }

  return (
    <>
      <div className="pane-title pane-actions">
        <button className="pane-btn tree-root" title={t('选择项目根目录', 'Select project root')} disabled={!root}
          onClick={() => setDirectory(root ?? '')}>{t('资源管理器', 'Explorer')}</button>
        <button className="pane-btn" disabled={!root || creating} onClick={() => startCreate('file')}>{t('新建文件', 'New File')}</button>
        <button className="pane-btn" disabled={!root || creating} onClick={() => startCreate('dir')}>{t('新建文件夹', 'New Folder')}</button>
      </div>
      {draft && (
        <form className="tree-create" onSubmit={async (event) => {
          event.preventDefault();
          if (creating || !name.trim()) return;
          setCreating(true);
          try {
            if (await onCreate(draft.directory, name.trim(), draft.kind)) setDraft(null);
          } finally {
            setCreating(false);
          }
        }}>
          <label className="tree-create-path" title={draft.directory} htmlFor="new-entry-name">
            {draft.kind === 'file' ? t('新建文件', 'New File') : t('新建文件夹', 'New Folder')} · {draft.directory === root ? t('项目根目录', 'Project root') : draft.directory.split(/[\\/]/).pop()}
          </label>
          <div className="tree-create-actions">
            <input id="new-entry-name" autoFocus value={name} onChange={(event) => setName(event.target.value)}
              placeholder={draft.kind === 'file' ? t('例如章节.tex', 'e.g. chapter.tex') : t('文件夹名称', 'Folder name')} disabled={creating} />
            <button type="submit" className="pane-btn" disabled={creating || !name.trim()}>{t('创建', 'Create')}</button>
            <button type="button" className="pane-btn" disabled={creating} onClick={() => setDraft(null)}>{t('取消', 'Cancel')}</button>
          </div>
        </form>
      )}
      <div className={`filetree${!nodes.length ? ' filetree-empty' : ''}`} onClick={(event) => {
        if (event.target === event.currentTarget && root) setDirectory(root);
      }}>
        {!nodes.length && (root ? t('空项目', 'Empty project') : t('尚未打开项目', 'No project open'))}
        {nodes.map((n) => (
          <TreeNodeView key={n.path} node={n} depth={0} currentFile={currentFile} onOpen={onOpen}
            directory={root ?? ''} selectedDirectory={directory} dropRow={dropRow} onSelectDirectory={setDirectory} />
        ))}
      </div>
    </>
  );
}
