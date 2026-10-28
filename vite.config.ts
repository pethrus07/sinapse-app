import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vaultApi } from './scripts/vault-api.mjs';

export default defineConfig({
  plugins: [react(), vaultApi()],
  base: './',
  // @excalidraw/excalidraw 0.17 lê process.env.IS_PREACT no navegador
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  // Prevenção: empacota o Excalidraw junto com o React na largada. Em 28/10/2026 o cache de
  // dependências (node_modules/.vite) ficou inconsistente depois de vários reinícios e a página
  // carregou DUAS cópias do React ("Invalid hook call"; o mesmo chunk com e sem ?v=). Quem
  // resolveu foi refazer o cache: `npx vite --force`. A mutação (tirar esta linha) não
  // reproduziu o defeito, então ela é seguro barato, não a correção provada.
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', '@excalidraw/excalidraw'] },
  server: {
    port: 5173,
    // O índice (src/data/*.json) é gerado; não deixar o watcher recarregar a página a cada escrita.
    watch: { ignored: ['**/src/data/**'] },
  },
});
