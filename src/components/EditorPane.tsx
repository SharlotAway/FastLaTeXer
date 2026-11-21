import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import monaco from '../latex/monacoSetup';
import type * as monacoNs from 'monaco-editor';
import type { Diagnostic } from '../types';
import type { TextEdit } from '../latex/documentTools';
import { setProjectCompletionPaths } from '../latex/completion';

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
  diagnostics: Diagnostic[];
  projectPaths: readonly string[];
}

const ITEM_ENVS = ['itemize', 'enumerate', 'description'];

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

const EditorPane = forwardRef<EditorHandle, Props>(({ filePath, content, onChange, diagnostics, projectPaths }, ref) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const updatingFromDisk = useRef(false);

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

    const model = monaco.editor.createModel(content || '', 'latex', monaco.Uri.file(filePath));
    editor.setModel(model);

    const sub = editor.onDidChangeModelContent((e) => {
      if (updatingFromDisk.current) return;
      onChange(editor.getValue());
      handleAutoItem(editor, e);
    });

    return () => {
      sub.dispose();
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
    if (model) setProjectCompletionPaths(model, projectPaths);
  }, [filePath, projectPaths]);

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
      const commands: Record<string, string> = {
        undo: 'undo', redo: 'redo', cut: 'editor.action.clipboardCutAction',
        copy: 'editor.action.clipboardCopyAction', paste: 'editor.action.clipboardPasteAction',
        delete: 'deleteRight', selectall: 'editor.action.selectAll',
      };
      const editor = editorRef.current;
      const command = commands[role.toLowerCase()];
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

  return <div ref={hostRef} className="editor-host" />;
});

EditorPane.displayName = 'EditorPane';
export default EditorPane;
