/// <reference types="vite/client" />

import type { WindowApi } from './types';

declare global {
  interface Window {
    api: WindowApi;
  }
}

export {};
