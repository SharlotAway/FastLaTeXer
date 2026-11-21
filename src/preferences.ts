import { createContext, useContext } from 'react';
import type { Language } from './types';

export const LanguageContext = createContext<Language>('zh');

export function useText() {
  const language = useContext(LanguageContext);
  return (zh: string, en: string) => language === 'en' ? en : zh;
}

export function readPreference<T extends string>(key: string, fallback: T, ...alternates: T[]): T {
  return alternates.find((value) => value === localStorage.getItem(key)) ?? fallback;
}
