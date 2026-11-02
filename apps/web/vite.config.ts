import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  test: {
    environment: 'jsdom',
    // Typing-heavy UI tests take ~1-2 s alone but can pass 5 s when all files run at once.
    testTimeout: 15_000,
    setupFiles: ['./src/test/setup.ts'],
    // Pages load lazily in the app (src/pages/lazy.ts, one chunk per route). Tests get the same
    // pages imported eagerly, so a page's first load never counts against a test's own waits.
    alias: [
      {
        find: /^\.\/pages\/lazy$/,
        replacement: fileURLToPath(new URL('./src/test/eager-pages.ts', import.meta.url)),
      },
    ],
    css: false,
  },
});
