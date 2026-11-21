import type { editor } from 'monaco-editor';

// LaTeX completion provider: commands, environments, and project files.
//
// Snippet convention (see SnippetParser._parseEscaped):
//  - a single backslash before a normal char is preserved literally,
//  - `\\` emits one backslash, `\$` emits `$`, `\}` emits `}`,
//  - `${n:default}` / `$0` are tabstops,
//  - newline/tab must be REAL characters (there is no `\n`/`\t` escape).
//
// `latexSnip` takes a "natural" LaTeX string (single backslashes, `${n:x}`
// tabstops, real newlines) and doubles every backslash so Monaco emits a
// single backslash again.

function latexSnip(latex: string): string {
  return latex.replace(/\\/g, '\\\\');
}

export type ReferenceKeys = { citations: readonly string[]; labels: readonly string[] };
const projectPaths = new WeakMap<editor.ITextModel, { paths: readonly string[]; references: ReferenceKeys }>();

export function setProjectCompletionPaths(model: editor.ITextModel, paths: readonly string[], references: ReferenceKeys) {
  projectPaths.set(model, { paths, references });
}

const ENVIRONMENTS = [
  'itemize', 'enumerate', 'description', 'figure', 'figure*', 'table', 'table*',
  'equation', 'equation*', 'align', 'align*', 'gather', 'multline', 'center',
  'flushleft', 'flushright', 'quote', 'quotation', 'verbatim', 'verbatim*',
  'abstract', 'document', 'theorem', 'lemma', 'proof', 'corollary', 'definition',
  'example', 'remark', 'case', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix',
  'array', 'tabular', 'tabular*', 'minipage', 'tikzpicture', 'lstlisting',
];

const SIMPLE_COMMANDS = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta',
  'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi',
  'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi',
  'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma',
  'Upsilon', 'Phi', 'Psi', 'Omega',
  'partial', 'nabla', 'infty', 'pm', 'mp', 'times', 'div', 'cdot', 'ast', 'star',
  'circ', 'bullet', 'oplus', 'otimes', 'leq', 'geq', 'neq', 'approx', 'equiv',
  'sim', 'simeq', 'propto', 'in', 'notin', 'ni', 'subset', 'subseteq', 'supset',
  'supseteq', 'cup', 'cap', 'setminus', 'emptyset', 'forall', 'exists', 'nexists',
  'neg', 'land', 'lor', 'to', 'rightarrow', 'leftarrow', 'leftrightarrow',
  'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'mapsto', 'implies', 'iff',
  'langle', 'rangle', 'lfloor', 'rfloor', 'lceil', 'rceil', 'cdot', 'cdots',
  'ldots', 'vdots', 'ddots', 'dots', 'quad', 'qquad', 'hfill', 'vfill', 'hspace',
  'vspace', 'noindent', 'indent', 'newline', 'linebreak', 'pagebreak', 'clearpage',
  'newpage', 'centering', 'raggedright', 'raggedleft', 'sloppy', 'today',
];

const SNIPPET_COMMANDS: Array<{ name: string; detail: string; snip: string }> = [
  { name: 'documentclass', detail: '文档类', snip: '\\documentclass{${1:article}}' },
  { name: 'usepackage', detail: '导入宏包', snip: '\\usepackage{${1:package}}' },
  { name: 'RequirePackage', detail: '导入宏包（类/样式文件）', snip: '\\RequirePackage{${1:package}}' },
  { name: 'include', detail: '引入章节文件', snip: '\\include{${1:file}}' },
  { name: 'input', detail: '引入文件', snip: '\\input{${1:file}}' },
  { name: 'includegraphics', detail: '插入图片', snip: '\\includegraphics[${1:width=\\textwidth}]{${2:file}}' },
  { name: 'includeonly', detail: '仅编译指定章节', snip: '\\includeonly{${1:file}}' },
  { name: 'section', detail: '一级标题', snip: '\\section{${1:title}}' },
  { name: 'subsection', detail: '二级标题', snip: '\\subsection{${1:title}}' },
  { name: 'subsubsection', detail: '三级标题', snip: '\\subsubsection{${1:title}}' },
  { name: 'chapter', detail: '章', snip: '\\chapter{${1:title}}' },
  { name: 'paragraph', detail: '段标题', snip: '\\paragraph{${1:title}}' },
  { name: 'subparagraph', detail: '子段标题', snip: '\\subparagraph{${1:title}}' },
  { name: 'part', detail: '部', snip: '\\part{${1:title}}' },
  { name: 'label', detail: '标签', snip: '\\label{${1:key}}' },
  { name: 'ref', detail: '引用标签', snip: '\\ref{${1:key}}' },
  { name: 'eqref', detail: '引用公式', snip: '\\eqref{${1:key}}' },
  { name: 'pageref', detail: '引用页码', snip: '\\pageref{${1:key}}' },
  { name: 'autoref', detail: '自动引用', snip: '\\autoref{${1:key}}' },
  { name: 'cite', detail: '引用文献', snip: '\\cite{${1:key}}' },
  { name: 'citep', detail: '引用文献（natbib 括号）', snip: '\\citep{${1:key}}' },
  { name: 'citet', detail: '引用文献（natbib 正文）', snip: '\\citet{${1:key}}' },
  { name: 'citeauthor', detail: '引用作者', snip: '\\citeauthor{${1:key}}' },
  { name: 'footnote', detail: '脚注', snip: '\\footnote{${1:text}}' },
  { name: 'caption', detail: '图/表标题', snip: '\\caption{${1:text}}' },
  { name: 'textbf', detail: '加粗', snip: '\\textbf{${1:text}}' },
  { name: 'textit', detail: '斜体', snip: '\\textit{${1:text}}' },
  { name: 'emph', detail: '强调', snip: '\\emph{${1:text}}' },
  { name: 'underline', detail: '下划线', snip: '\\underline{${1:text}}' },
  { name: 'texttt', detail: '等宽字体', snip: '\\texttt{${1:text}}' },
  { name: 'textrm', detail: '罗马字体', snip: '\\textrm{${1:text}}' },
  { name: 'textsf', detail: '无衬线字体', snip: '\\textsf{${1:text}}' },
  { name: 'url', detail: '网址', snip: '\\url{${1:https://}}' },
  { name: 'href', detail: '超链接', snip: '\\href{${1:url}}{${2:text}}' },
  { name: 'frac', detail: '分数', snip: '\\frac{${1:num}}{${2:den}}' },
  { name: 'sqrt', detail: '根号', snip: '\\sqrt{${1:x}}' },
  { name: 'text', detail: '数学环境中的文本', snip: '\\text{${1:text}}' },
  { name: 'mathrm', detail: '正体', snip: '\\mathrm{${1:x}}' },
  { name: 'mathbf', detail: '粗体', snip: '\\mathbf{${1:x}}' },
  { name: 'mathbb', detail: '黑板粗体', snip: '\\mathbb{${1:X}}' },
  { name: 'mathcal', detail: '花体', snip: '\\mathcal{${1:X}}' },
  { name: 'boldsymbol', detail: '加粗符号', snip: '\\boldsymbol{${1:x}}' },
  { name: 'newcommand', detail: '定义新命令', snip: '\\newcommand{\\${1:name}}[${2:0}]{${3:definition}}' },
  { name: 'renewcommand', detail: '重定义命令', snip: '\\renewcommand{\\${1:name}}[${2:0}]{${3:definition}}' },
  { name: 'newenvironment', detail: '定义新环境', snip: '\\newenvironment{${1:name}}[${2:0}]{${3:begin}}{${4:end}}' },
  { name: 'bibliographystyle', detail: '参考文献样式', snip: '\\bibliographystyle{${1:plain}}' },
  { name: 'bibliography', detail: '参考文献文件', snip: '\\bibliography{${1:refs}}' },
  { name: 'title', detail: '标题', snip: '\\title{${1:title}}' },
  { name: 'author', detail: '作者', snip: '\\author{${1:author}}' },
  { name: 'date', detail: '日期', snip: '\\date{${1:\\today}}' },
  { name: 'begin', detail: '环境（自动闭合）', snip: '\\begin{${1:env}}\n\t$0\n\\end{$1}' },
  { name: 'item', detail: '列表项', snip: '\\item ${0}' },
];

export function registerLatexCompletions(monaco: any) {
  const CompletionKind = monaco.languages.CompletionItemKind;
  const InsertAsSnippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;

  const envItems = ENVIRONMENTS.map((env) => ({
    label: env,
    kind: CompletionKind.Snippet,
    detail: '环境（自动闭合）',
    documentation: `\\begin{${env}} ... \\end{${env}}`,
    insertText: latexSnip(`${env}}\n\t$0\n\\end{${env}}`),
    insertTextRules: InsertAsSnippet,
    sortText: '0' + env,
  }));

  const simpleItems = SIMPLE_COMMANDS.map((name) => ({
    label: '\\' + name,
    kind: CompletionKind.Function,
    detail: 'LaTeX 命令',
    insertText: '\\' + name,
  }));

  const snippetItems = SNIPPET_COMMANDS.map((s) => ({
    label: '\\' + s.name,
    kind: CompletionKind.Snippet,
    detail: s.detail,
    documentation: s.snip,
    insertText: latexSnip(s.snip),
    insertTextRules: InsertAsSnippet,
    sortText: '0' + s.name,
  }));

  monaco.languages.registerCompletionItemProvider('latex', {
    triggerCharacters: ['\\', '{', '/', ','],
    provideCompletionItems(model: any, position: any) {
      const textUntil = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const refMatch = textUntil.match(/\\((?:[a-z]*cite[a-z]*|(?:page|auto|eq|name)?ref|[cC]ref))\*?\s*(?:\[[^\]]*\]\s*){0,2}\{[^{}%]*?([^,\s{}%]*)$/i);
      if (refMatch && !/(^|[^\\])(?:\\\\)*%/.test(textUntil)) {
        const prefix = refMatch[2];
        const references = projectPaths.get(model)?.references;
        const keys = /cite/i.test(refMatch[1]) ? references?.citations : references?.labels;
        const suffix = model.getLineContent(position.lineNumber).slice(position.column - 1).match(/^[^,\s{}%]*/)?.[0] ?? '';
        const range = new monaco.Range(position.lineNumber, position.column - prefix.length,
          position.lineNumber, position.column + suffix.length);
        return { incomplete: true, suggestions: (keys ?? []).filter((key) => key.toLowerCase().startsWith(prefix.toLowerCase()))
          .map((key) => ({ label: key, insertText: key, kind: CompletionKind.Reference, range })) };
      }
      const fileMatch = textUntil.match(/\\(input|include)\s*\{[ \t]*([^{}%\\]*)$/);
      if (fileMatch && !/(^|[^\\])(?:\\\\)*%/.test(textUntil)) {
        const [, command, typed] = fileMatch;
        const prefix = typed.toLowerCase();
        const rest = model.getLineContent(position.lineNumber).slice(position.column - 1);
        const suffix = rest.match(/^[^{}%]*?(?=[ \t]*\})/)?.[0] ?? '';
        const range = new monaco.Range(position.lineNumber, position.column - typed.length,
          position.lineNumber, position.column + suffix.length);
        const paths = projectPaths.get(model)?.paths ?? [];
        const suggestions = paths.flatMap((path) => {
          if (command === 'include' && !/\.tex$/i.test(path)) return [];
          const label = command === 'include' ? path.slice(0, -4) : path;
          const insertText = typed.startsWith('./') ? './' + label : label;
          return insertText.toLowerCase().startsWith(prefix) ? [{
            label: insertText,
            kind: CompletionKind.File,
            insertText,
            range,
          }] : [];
        });
        return { suggestions, incomplete: true };
      }

      // \begin{... -> environment list (auto-closing)
      const beginMatch = textUntil.match(/\\begin\s*\{([a-zA-Z*]*)$/);
      if (beginMatch) {
        const prefix = beginMatch[1];
        const following = model.getLineContent(position.lineNumber).slice(position.column - 1);
        const existingEnd = following.match(/^[a-zA-Z*]*\}/)?.[0] ?? '';
        const range = new monaco.Range(position.lineNumber, position.column - prefix.length,
          position.lineNumber, position.column + existingEnd.length);
        const filtered = envItems.filter((e) => e.label.startsWith(prefix));
        const list = filtered.length ? filtered : envItems;
        return { suggestions: list.map((e) => ({ ...e, range })) };
      }

      // \command -> command list
      const cmdMatch = textUntil.match(/\\([a-zA-Z@]*)$/);
      if (cmdMatch) {
        const prefix = cmdMatch[1];
        const range = new monaco.Range(
          position.lineNumber,
          position.column - prefix.length - 1,
          position.lineNumber,
          position.column,
        );
        const all = [...snippetItems, ...simpleItems];
        const filtered = all.filter((c) => c.label.slice(1).startsWith(prefix));
        const list = filtered.length ? filtered : all;
        return { suggestions: list.map((c) => ({ ...c, range })) };
      }

      return { suggestions: [] };
    },
  });
}
