import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Electron loads the built app via `loadFile` (file://). Vite adds a
// `crossorigin` attribute to the module script/link, which breaks module
// loading over file://. Strip it so ES modules load correctly.
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/\s+crossorigin(?=\s|>)/g, '');
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), stripCrossorigin()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
