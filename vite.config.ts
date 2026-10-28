import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vaultApi } from './scripts/vault-api.mjs';

export default defineConfig({
  plugins: [react(), vaultApi()],
  base: './',
  // @excalidraw/excalidraw 0.17 lê process.env.IS_PREACT no navegador
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  server: {
    port: 5173,
    // O índice (src/data/*.json) é gerado; não deixar o watcher recarregar a página a cada escrita.
    watch: { ignored: ['**/src/data/**'] },
  },
});
