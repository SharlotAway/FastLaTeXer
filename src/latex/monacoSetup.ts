import * as monaco from 'monaco-editor';
// monaco-editor's `exports` map rewrites `./*` to `./esm/vs/*.js`, so worker
// subpaths must NOT repeat the `esm/vs/` prefix.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { registerLatexLanguage } from './latexLanguage';
import { registerLatexCompletions } from './completion';

(self as any).MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  },
};

registerLatexLanguage(monaco);
registerLatexCompletions(monaco);

monaco.editor.defineTheme('latex-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '569CD6' },
    { token: 'keyword.section', foreground: 'C586C0', fontStyle: 'bold' },
    { token: 'keyword.env', foreground: '4EC9B0', fontStyle: 'bold' },
    { token: 'keyword.math', foreground: '4FC1FF' },
    { token: 'string.math', foreground: 'DCDCAA' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'delimiter.curly', foreground: '9CDCFE' },
    { token: 'delimiter.square', foreground: '9CDCFE' },
    { token: 'delimiter.parenthesis', foreground: '9CDCFE' },
  ],
  colors: {
    'editor.background': '#1e1e1e',
    'editor.foreground': '#d4d4d4',
    'editorLineNumber.foreground': '#6e7681',
    'editor.lineHighlightBackground': '#2a2a2a',
    'editorCursor.foreground': '#aeafad',
    'editor.selectionBackground': '#264f78',
    'editorIndentGuide.background': '#404040',
    'editorSuggestWidget.background': '#252526',
    'editorSuggestWidget.border': '#454545',
  },
});

function defineLightTheme(name: string, colors: Record<string, string>, tokens: string[]) {
  const scopes = ['comment', 'keyword', 'keyword.section', 'keyword.env', 'keyword.math', 'string.math'];
  monaco.editor.defineTheme(name, {
    base: 'vs',
    inherit: true,
    colors,
    rules: scopes.map((token, index) => ({
      token, foreground: tokens[index], fontStyle: index === 0 ? 'italic' : index === 2 || index === 3 ? 'bold' : '',
    })),
  });
}

defineLightTheme('latex-light', {
  'editor.background': '#fcfcfe', 'editor.foreground': '#242936', 'editor.lineHighlightBackground': '#eef1f6',
}, ['557445', '20439A', '763984', '166452', '155F84', '66521D']);

defineLightTheme('latex-yoimiya', {
  'editor.background': '#fff7ec', 'editor.foreground': '#3f2622', 'editor.lineHighlightBackground': '#f8e4d5',
  'editor.selectionBackground': '#f2c6ae', 'editorCursor.foreground': '#a63b31', 'editorLineNumber.foreground': '#8c6b60',
  'editorSuggestWidget.background': '#ffede1', 'editorSuggestWidget.border': '#d9ae9c',
}, ['776140', '9E3229', '882A26', '8A4B1D', '394978', '70491E']);

defineLightTheme('latex-furina', {
  'editor.background': '#f3f9ff', 'editor.foreground': '#202e54', 'editor.lineHighlightBackground': '#e2effb',
  'editor.selectionBackground': '#c0dbf6', 'editorCursor.foreground': '#2756a3', 'editorLineNumber.foreground': '#586e8e',
  'editorSuggestWidget.background': '#eaf5ff', 'editorSuggestWidget.border': '#adc5e0',
}, ['526a83', '284B9D', '23387B', '17637E', '4C4294', '71532C']);

monaco.editor.setTheme('latex-dark');

export default monaco;
