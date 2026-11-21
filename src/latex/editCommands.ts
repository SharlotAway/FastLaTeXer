import type { EditorHandle } from '../components/EditorPane';
import type { FormatAction, InsertAction } from '../components/Workbench';
import type { TextEdit } from './documentTools';

function wrap(selected: string, start: string, end: string): TextEdit {
  return { text: start + selected + end, cursor: start.length + selected.length };
}

const paragraph = /^(\s*)\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{(.*)\}(\s*)$/;

export function formatSource(editor: EditorHandle, action: FormatAction) {
  if (action === 'indent' || action === 'outdent') {
    editor.indent(action === 'outdent');
  } else if (action === 'bold' || action === 'italic') {
    const command = action === 'bold' ? '\\textbf{' : '\\textit{';
    editor.edit((selected) => selected.startsWith(command) && selected.endsWith('}')
      ? { text: selected.slice(command.length, -1) } : wrap(selected, command, '}'));
  } else if (action === 'bullet' || action === 'numbered') {
    const env = action === 'bullet' ? 'itemize' : 'enumerate';
    editor.edit((selected) => wrap(selected.split(/\r?\n/).map((line) => line.trim()).join('\n  \\item '), `\\begin{${env}}\n  \\item `, `\n\\end{${env}}`));
  } else {
    editor.edit((selected) => {
      const text = selected.replace(paragraph, '$1$2$3');
      if (action === 'normal') return { text };
      const indentation = text.match(/^\s*/)?.[0] ?? '';
      return wrap(text.slice(indentation.length), `${indentation}\\${action}{`, '}');
    }, true);
  }
}

export function insertSource(editor: EditorHandle, action: InsertAction, value = '') {
  editor.edit((selected) => {
    switch (action) {
      case 'inlineMath': return wrap(selected, '$', '$');
      case 'displayMath': return wrap(selected, '\\[\n', '\n\\]');
      case 'symbol': return { text: `\\ensuremath{${value}}` };
      case 'table': return wrap(selected, '\\begin{tabular}{ll}\n  ', ' & \\\\\n\\end{tabular}');
      case 'cite': return wrap(selected, '\\cite{', '}');
      case 'link': return wrap(selected, '\\href{', '}{link text}');
      case 'ref': return wrap(selected, '\\ref{', '}');
      case 'comment': {
        const lines = selected.split(/\r?\n/);
        const uncomment = lines.every((line) => /^\s*%/.test(line));
        return { text: lines.map((line) => uncomment ? line.replace(/^(\s*)% ?/, '$1') : line.replace(/^(\s*)/, '$1% ')).join('\n') };
      }
      case 'abstract': return wrap(selected, '\\begin{abstract}\n', '\n\\end{abstract}');
      case 'keywords': return wrap(selected, '\\textbf{Keywords:} ', '');
      case 'title': return wrap(selected, '\\title{', '}');
      default: return wrap('', `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{\\detokenize{${value}}}\n  \\caption{`, '}\n\\end{figure}');
    }
  }, action === 'comment');
  if (action === 'link') editor.ensurePackage('hyperref');
  if (['local', 'project', 'another', 'url'].includes(action)) editor.ensurePackage('graphicx');
}
