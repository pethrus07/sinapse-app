import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vaultApi } from './scripts/vault-api.mjs';

export default defineConfig({
  plugins: [react(), vaultApi()],
  base: './',
  server: {
    port: 5173,
    // O índice (src/data/*.json) é gerado; não deixar o watcher recarregar a página a cada escrita.
    watch: { ignored: ['**/src/data/**'] },
  },
});
