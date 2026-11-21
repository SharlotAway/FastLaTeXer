import type { Theme } from './index';

export function applyMonacoTheme(monaco: typeof import('monaco-editor'), theme: Theme, style: CSSStyleDeclaration) {
  // Production CSS may shorten hex colors. Monaco's token rules need six digits.
  const colorParser = document.createElement('canvas').getContext('2d');
  const color = (property: string) => {
    const value = style.getPropertyValue('--' + property).trim();
    if (!colorParser || !value) return value;
    colorParser.fillStyle = value;
    return colorParser.fillStyle;
  };
  const syntax = (property: string) => color('editor-' + property).slice(1);
  const name = 'latex-' + theme;
  const selection = color('editor-selection');

  monaco.editor.defineTheme(name, {
    base: style.colorScheme === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: syntax('comment'), fontStyle: 'italic' },
      { token: 'keyword', foreground: syntax('command') },
      { token: 'keyword.section', foreground: syntax('section'), fontStyle: 'bold' },
      { token: 'keyword.env', foreground: syntax('environment'), fontStyle: 'bold' },
      { token: 'keyword.math', foreground: syntax('math') },
      { token: 'string.math', foreground: syntax('math-text') },
      { token: 'number', foreground: syntax('number') },
      { token: 'delimiter.curly', foreground: syntax('delimiter') },
      { token: 'delimiter.square', foreground: syntax('delimiter') },
      { token: 'delimiter.parenthesis', foreground: syntax('delimiter') },
    ],
    colors: {
      'editor.background': color('bg'),
      'editor.foreground': color('fg'),
      'editorLineNumber.foreground': color('editor-line-number'),
      'editorLineNumber.activeForeground': color('fg'),
      'editor.lineHighlightBackground': color('editor-line'),
      'editorCursor.foreground': color('editor-cursor'),
      'editor.selectionBackground': selection,
      'editor.inactiveSelectionBackground': selection + '99',
      'editorIndentGuide.background1': color('border'),
      'editorSuggestWidget.background': color('bg2'),
      'editorSuggestWidget.border': color('border'),
      'editorSuggestWidget.selectedBackground': color('selection'),
    },
  });
  monaco.editor.setTheme(name);
}
