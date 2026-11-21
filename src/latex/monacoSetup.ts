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

export default monaco;
