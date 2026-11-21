import catalog from './catalog.json';

import.meta.glob('./*.css', { eager: true });

export const themes = catalog.themes;
export type Theme = keyof typeof themes;
const defaultTheme = catalog.defaultTheme as Theme;
export const themeOptions = Object.keys(themes) as Theme[];

export function resolveTheme(value: string | null | undefined): Theme {
  if (value && Object.hasOwn(themes, value)) return value as Theme;
  if (value && Object.hasOwn(catalog.legacy, value)) return catalog.legacy[value as keyof typeof catalog.legacy] as Theme;
  return defaultTheme;
}
