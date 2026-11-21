// Custom LaTeX language (Monarch tokenizer) for Monaco.
export function registerLatexLanguage(monaco: any) {
  monaco.languages.register({
    id: 'latex',
    extensions: ['.tex', '.ltx', '.sty', '.cls', '.bib'],
    aliases: ['LaTeX', 'latex', 'tex'],
  });

  monaco.languages.setLanguageConfiguration('latex', {
    comments: { lineComment: '%' },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
      ['$$', '$$'],
      ['$', '$'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '$', close: '$', notIn: ['string', 'comment'] },
      { open: '"', close: '"', notIn: ['string'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '$', close: '$' },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider('latex', {
    defaultToken: '',
    ignoreCase: true,

    sectioning: [
      '\\part', '\\chapter', '\\section', '\\subsection', '\\subsubsection',
      '\\paragraph', '\\subparagraph', '\\appendix', '\\title', '\\author',
      '\\date', '\\maketitle', '\\tableofcontents', '\\listoffigures', '\\listoftables',
    ],

    mathCommands: [
      '\\frac', '\\sqrt', '\\sum', '\\int', '\\prod', '\\lim', '\\left', '\\right',
      '\\big', '\\Big', '\\bigg', '\\Bigg', '\\mathbb', '\\mathbf', '\\mathcal',
      '\\mathrm', '\\mathit', '\\mathsf', '\\mathtt', '\\boldsymbol', '\\operatorname',
      '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\varepsilon', '\\zeta',
      '\\eta', '\\theta', '\\vartheta', '\\lambda', '\\mu', '\\nu', '\\xi', '\\pi',
      '\\varpi', '\\rho', '\\sigma', '\\tau', '\\phi', '\\varphi', '\\chi', '\\psi', '\\omega',
      '\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Xi', '\\Pi', '\\Sigma', '\\Upsilon',
      '\\Phi', '\\Psi', '\\Omega', '\\partial', '\\nabla', '\\infty', '\\pm', '\\mp',
      '\\times', '\\div', '\\cdot', '\\leq', '\\geq', '\\neq', '\\approx', '\\equiv',
      '\\in', '\\notin', '\\subset', '\\subseteq', '\\cup', '\\cap', '\\to', '\\rightarrow',
      '\\leftarrow', '\\Rightarrow', '\\forall', '\\exists', '\\land', '\\lor', '\\neg',
    ],

    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/\\begin\s*\{[^}]*\}/, 'keyword.env'],
        [/\\end\s*\{[^}]*\}/, 'keyword.env'],
        [/\\(?:[a-zA-Z@]+)/, {
          cases: {
            '@sectioning': 'keyword.section',
            '@mathCommands': 'keyword.math',
            '@default': 'keyword',
          },
        }],
        [/\$\$/, 'keyword.math', '@mathDisplay'],
        [/\\\[/, 'keyword.math', '@mathDisplay'],
        [/\$/, 'keyword.math', '@mathInline'],
        [/\\\(/, 'keyword.math', '@mathInline'],
        [/[{}[\]]/, '@brackets'],
        [/[0-9]+/, 'number'],
      ],
      mathInline: [
        [/\$/, 'keyword.math', '@pop'],
        [/\\(?:[a-zA-Z@]+)/, {
          cases: { '@mathCommands': 'keyword.math', '@default': 'keyword' },
        }],
        [/[{}[\]]/, '@brackets'],
        [/[^$\\{}[\]]+/, 'string.math'],
      ],
      mathDisplay: [
        [/\$\$/, 'keyword.math', '@pop'],
        [/\\\]/, 'keyword.math', '@pop'],
        [/\\(?:[a-zA-Z@]+)/, {
          cases: { '@mathCommands': 'keyword.math', '@default': 'keyword' },
        }],
        [/[{}[\]]/, '@brackets'],
        [/[^$\\{}[\]]+/, 'string.math'],
      ],
    },
  });
}
