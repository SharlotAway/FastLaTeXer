import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useText } from '../preferences';
import monaco from '../latex/monacoSetup';
import type * as monacoNs from 'monaco-editor';
import type { Diagnostic } from '../types';
import type { TextEdit } from '../latex/documentTools';
import { setProjectCompletionPaths, type ReferenceKeys } from '../latex/completion';

export interface EditorHandle {
  getPosition: () => { line: number; column: number };
  revealLine: (line: number, column: number) => void;
  setContent: (value: string) => void;
  focus: () => void;
  runEditMenuAction: (role: string) => boolean;
  edit: (transform: (selected: string) => TextEdit, useLine?: boolean) => void;
  indent: (outdent: boolean) => void;
  ensurePackage: (name: 'graphicx' | 'hyperref') => void;
}

interface Props {
  filePath: string;
  content: string;
  onChange: (content: string) => void;
  onDoubleClick: (line: number, column: number) => void;
  diagnostics: Diagnostic[];
  projectPaths: readonly string[];
  referenceKeys: ReferenceKeys;
}

const ITEM_ENVS = ['itemize', 'enumerate', 'description'];
const EDIT_COMMANDS: Record<string, string> = {
  undo: 'undo', redo: 'redo', cut: 'editor.action.clipboardCutAction',
  copy: 'editor.action.clipboardCopyAction', paste: 'editor.action.clipboardPasteAction',
  delete: 'deleteRight', selectall: 'editor.action.selectAll',
};

function itemEnvDepth(model: monacoNs.editor.ITextModel, lineNumber: number): number {
  const re = /\\(begin|end)\s*\{([^}]+)\}/g;
  let depth = 0;
  for (let i = 1; i <= lineNumber; i++) {
    const line = model.getLineContent(i);
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      const name = m[2].trim();
      if (ITEM_ENVS.includes(name)) {
        depth += m[1] === 'begin' ? 1 : -1;
      }
    }
  }
  return depth;
}

function envIndent(model: monacoNs.editor.ITextModel, lineNumber: number): string {
  const re = /^(\s*)\\begin\s*\{(itemize|enumerate|description)\}/;
  for (let i = lineNumber - 1; i >= 1; i--) {
    const m = model.getLineContent(i).match(re);
    if (m) return m[1] + '\t';
  }
  return '\t';
}

function handleAutoItem(editor: monacoNs.editor.IStandaloneCodeEditor, e: monacoNs.editor.IModelContentChangedEvent) {
  const model = editor.getModel();
  if (!model) return;
  const isEnter = e.changes.some((c) => c.rangeLength === 0 && c.text.includes('\n'));
  if (!isEnter) return;
  const pos = editor.getPosition();
  if (!pos) return;
  const line = pos.lineNumber;
  if (itemEnvDepth(model, line) <= 0) return;
  const lineText = model.getLineContent(line);
  if (lineText.trim() !== '') return;
  const indent = envIndent(model, line);
  const insert = indent + '\\item ';
  editor.executeEdits('auto-item', [{ range: new monaco.Range(line, 1, line, 1), text: insert }]);
  editor.setPosition(new monaco.Position(line, insert.length + 1));
}

const EditorPane = forwardRef<EditorHandle, Props>(({ filePath, content, onChange, onDoubleClick, diagnostics, projectPaths, referenceKeys }, ref) => {
  const t = useText();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const updatingFromDisk = useRef(false);
  const doubleClickRef = useRef(onDoubleClick);
  doubleClickRef.current = onDoubleClick;

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setContextMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
        editorRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', escape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!hostRef.current) return;
    const editor = monaco.editor.create(hostRef.current, {
      model: null,
      language: 'latex',
      automaticLayout: true,
      fontFamily: '"Cascadia Mono", Consolas, "Microsoft YaHei", monospace',
      fontSize: 15,
      lineHeight: 23,
      minimap: { enabled: false },
      wordWrap: 'off',
      contextmenu: false,
      scrollBeyondLastLine: false,
      tabSize: 2,
      insertSpaces: true,
      bracketPairColorization: { enabled: true },
      quickSuggestions: { other: true, comments: false, strings: false },
      suggest: { showWords: false, showIcons: true },
      padding: { top: 8 },
      scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12 },
    });
    editorRef.current = editor;
    let wrapped = false;
    const toggleWrap = () => {
      wrapped = !wrapped;
      editor.updateOptions({ wordWrap: wrapped ? 'on' : 'off' });
    };
    editor.addAction({
      id: 'fastlatexer.toggleWordWrap',
      label: 'Toggle Word Wrap',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyZ],
      run: toggleWrap,
    });

    const model = monaco.editor.createModel(content || '', 'latex', monaco.Uri.file(filePath));
    editor.setModel(model);

    const sub = editor.onDidChangeModelContent((e) => {
      if (updatingFromDisk.current) return;
      onChange(editor.getValue());
      handleAutoItem(editor, e);
    });
    const mouse = editor.onMouseDown(({ event, target }) => {
      if (!event.leftButton || event.detail !== 2 || !target.position) return;
      if (target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT && target.type !== monaco.editor.MouseTargetType.CONTENT_EMPTY) return;
      doubleClickRef.current(target.position.lineNumber, target.position.column);
    });
    const context = editor.onContextMenu(({ event, target }) => {
      event.preventDefault();
      if (target.position && !editor.getSelection()?.containsPosition(target.position)) editor.setPosition(target.position);
      const { clientX, clientY } = event.browserEvent;
      setContextMenu({ x: Math.max(0, Math.min(clientX, innerWidth - 250)), y: Math.max(0, Math.min(clientY, innerHeight - 315)) });
    });

    return () => {
      sub.dispose();
      mouse.dispose();
      context.dispose();
      editor.getModel()?.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap model when the file changes.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const uri = monaco.Uri.file(filePath);
    const model = editor.getModel();
    if (!model || model.uri.toString() !== uri.toString()) {
      const newModel = monaco.editor.createModel(content || '', 'latex', uri);
      editor.setModel(newModel);
      model?.dispose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) setProjectCompletionPaths(model, projectPaths, referenceKeys);
  }, [filePath, projectPaths, referenceKeys]);

  // Update markers from diagnostics (only for the current file).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const markers = diagnostics
      .filter((d) => d.file === filePath)
      .map((d) => ({
        severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        startLineNumber: Math.max(1, d.line),
        startColumn: 1,
        endLineNumber: Math.max(1, d.line),
        endColumn: 1000,
        message: d.message,
      }));
    monaco.editor.setModelMarkers(model, 'latex', markers);
  }, [diagnostics, filePath]);

  useImperativeHandle(ref, () => ({
    getPosition: () => {
      const p = editorRef.current?.getPosition();
      return { line: p?.lineNumber ?? 1, column: p?.column ?? 1 };
    },
    revealLine: (line, column) => {
      const ed = editorRef.current;
      if (!ed) return;
      ed.layout();
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: Math.max(1, line), column: Math.max(1, column || 1) });
      ed.focus();
    },
    setContent: (v) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model || model.getValue() === v) return;
      const position = editor.getPosition();
      const scrollTop = editor.getScrollTop();
      const scrollLeft = editor.getScrollLeft();
      updatingFromDisk.current = true;
      try {
        editor.pushUndoStop();
        editor.executeEdits('disk', [{ range: model.getFullModelRange(), text: v }]);
        editor.pushUndoStop();
        if (position) editor.setPosition(model.validatePosition(position));
        editor.setScrollPosition({ scrollTop, scrollLeft });
      } finally {
        updatingFromDisk.current = false;
      }
    },
    focus: () => editorRef.current?.focus(),
    runEditMenuAction: (role) => {
      const editor = editorRef.current;
      const command = EDIT_COMMANDS[role.toLowerCase()];
      if (!editor || !command) return false;
      editor.focus();
      editor.trigger('menu', command, null);
      return true;
    },
    edit: (transform, useLine) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      const selection = editor?.getSelection();
      if (!editor || !model || !selection) return;
      const range = useLine && selection.isEmpty()
        ? new monaco.Range(selection.startLineNumber, 1, selection.startLineNumber, model.getLineMaxColumn(selection.startLineNumber))
        : selection;
      const edit = transform(model.getValueInRange(range));
      const offset = model.getOffsetAt(range.getStartPosition());
      editor.pushUndoStop();
      editor.executeEdits('toolbar', [{ range, text: edit.text }]);
      editor.pushUndoStop();
      editor.setPosition(model.getPositionAt(offset + (edit.cursor ?? edit.text.length)));
      editor.focus();
    },
    indent: (outdent) => {
      const editor = editorRef.current;
      editor?.trigger('toolbar', outdent ? 'editor.action.outdentLines' : 'editor.action.indentLines', null);
      editor?.focus();
    },
    ensurePackage: (name) => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model) return;
      const source = model.getValue();
      const document = /^\s*\\begin\s*\{document\}/m.exec(source);
      if (!document) return;
      const preamble = source.slice(0, document.index);
      const packages = [...preamble.matchAll(/^[^%\r\n]*?\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/gm)];
      if (packages.some((match) => match[1].split(',').some((entry) => entry.trim() === name))) return;
      const point = model.getPositionAt(document.index);
      editor.executeEdits('preamble', [{ range: monaco.Range.fromPositions(point), text: `\\usepackage{${name}}\n` }]);
      editor.pushUndoStop();
    },
  }), []);

  const items = [
    ['undo', t('撤销', 'Undo'), 'Ctrl+Z'],
    ['redo', t('重做', 'Redo'), 'Ctrl+Y'],
    ['cut', t('剪切', 'Cut'), 'Ctrl+X'],
    ['copy', t('复制', 'Copy'), 'Ctrl+C'],
    ['paste', t('粘贴', 'Paste'), 'Ctrl+V'],
    ['delete', t('删除', 'Delete'), 'Delete'],
    ['selectall', t('全选', 'Select All'), 'Ctrl+A'],
    ['actions.find', t('查找', 'Find'), 'Ctrl+F'],
    ['editor.action.startFindReplaceAction', t('替换', 'Replace'), 'Ctrl+H'],
    ['fastlatexer.toggleWordWrap', t('切换自动换行', 'Toggle Word Wrap'), 'Alt+Z'],
  ];
  return <>
    <div ref={hostRef} className="editor-host" />
    {contextMenu && <div className="workbench-dropdown tree-context editor-context" ref={menuRef}
      style={{ left: contextMenu.x, top: contextMenu.y, width: 250 }}
      onMouseDown={(event) => event.preventDefault()}>
      {items.map(([action, label, shortcut]) => <button key={action} onClick={() => {
        setContextMenu(null);
        const editor = editorRef.current;
        editor?.focus();
        editor?.trigger('context-menu', EDIT_COMMANDS[action] ?? action, null);
      }}>{label}<kbd>{shortcut}</kbd></button>)}
    </div>}
  </>;
});

EditorPane.displayName = 'EditorPane';
export default EditorPane;
