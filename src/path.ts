// Small path helpers for the renderer (no Node `path` available there).

export function normalizeWinPath(p: string): string {
  return p.replace(/\//g, '\\');
}

export function projectRelativePath(root: string, file: string): string | null {
  const prefix = root.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  const path = file.replace(/\\/g, '/');
  return path.toLowerCase().startsWith(prefix.toLowerCase()) ? path.slice(prefix.length) : null;
}

// Collapse empty and `.` segments and normalize a Windows path.
export function collapseDots(p: string): string {
  const parts = p.split('\\').filter((s) => s !== '' && s !== '.');
  if (parts.length === 0) return p;
  if (/^[a-zA-Z]:$/.test(parts[0])) {
    return parts[0] + '\\' + parts.slice(1).join('\\');
  }
  return parts.join('\\');
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i < 0 ? p : p.slice(0, i);
}

export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

// Resolve a path returned by `synctex edit` (may use forward slashes, a
// leading "./", or a `./` segment) against the compiled main file.
export function resolveAgainst(baseFile: string, rel: string): string {
  const f = normalizeWinPath(rel);
  if (/^[a-zA-Z]:\\/.test(f) || f.startsWith('\\')) {
    return collapseDots(f);
  }
  const baseDir = baseFile ? dirname(baseFile) : '';
  const joined = baseDir ? baseDir + '\\' + f : f;
  return collapseDots(joined);
}
