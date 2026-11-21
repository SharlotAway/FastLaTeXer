export type TextEdit = { text: string; cursor?: number };
export type MatchMode = 'contains' | 'exact' | 'wildcard';
export type SourceLocation = { line: number; column: number; text: string };

function withoutComments(source: string) {
  return source.replace(/((?:^|[^\\])(?:\\\\)*)%[^\r\n]*/gm, (match, prefix: string) => prefix + ' '.repeat(match.length - prefix.length));
}

function findLocation(source: string, offset: number) {
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

const sectionLevels: Record<string, number> = {
  part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6,
};

export function outline(source: string) {
  const body = withoutComments(source);
  const headings = [];
  for (const match of body.matchAll(/\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\]\s*)?\{/g)) {
    const start = match.index + match[0].length;
    let end = start;
    let depth = 1;
    while (end < body.length && depth) {
      const char = body[end++];
      if (char === '\\') end++;
      else if (char === '{') depth++;
      else if (char === '}') depth--;
    }
    if (!depth) headings.push({ ...findLocation(body, match.index), text: body.slice(start, end - 1).replace(/\s+/g, ' ').trim(), level: sectionLevels[match[1]] });
  }
  const levels = [...new Set(headings.map((heading) => heading.level))].sort((a, b) => a - b);
  return headings.map((heading) => ({ ...heading, level: levels.indexOf(heading.level) }));
}

export function labels(source: string): SourceLocation[] {
  const body = withoutComments(source);
  return Array.from(body.matchAll(/\\label\s*\{([^{}\r\n]+)\}/g), (match) => ({
    ...findLocation(body, match.index),
    text: match[1].trim(),
  }));
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function searchPattern(query: string, mode: MatchMode, wholeWord: boolean, label: boolean) {
  const word = '[\\p{L}\\p{N}_]';
  const pattern = mode === 'wildcard' ? [...query].map((char) => char === '*' ? '.*?' : char === '?' ? '.' : escape(char)).join('') : escape(query);
  const qualified = wholeWord ? `(?<!${word})(?:${pattern})(?!${word})` : pattern;
  return new RegExp(label && mode !== 'contains' ? `^(?:${qualified})$` : qualified, mode === 'exact' ? 'gu' : 'giu');
}

export function textMatches(source: string, pattern: RegExp): SourceLocation[] {
  return Array.from(source.matchAll(pattern)).filter((match) => match[0]).slice(0, 300).map((match) => ({
    ...findLocation(source, match.index),
    text: source.slice(source.lastIndexOf('\n', match.index - 1) + 1, source.indexOf('\n', match.index) < 0 ? undefined : source.indexOf('\n', match.index)).trim(),
  }));
}

export function words(source: string) {
  const plain = withoutComments(source)
    .replace(/\\(?:documentclass|usepackage|begin|end|label|cite|ref|includegraphics)\*?\s*(?:\[[^\]]*\]\s*)?\{[^{}]*\}/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?/g, ' ');
  const segments = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(plain);
  return {
    words: [...segments].filter((segment) => segment.isWordLike).length,
    characters: [...plain.replace(/\s|[{}\[\]$]/g, '')].length,
    lines: source.split('\n').length,
  };
}
