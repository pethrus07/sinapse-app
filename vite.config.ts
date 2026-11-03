import { defineConfig, searchForWorkspaceRoot, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { vaultApi } from './scripts/vault-api.mjs';

// sem @types/node no projeto: só o que este arquivo usa do process do Node
declare const process: { env: Record<string, string | undefined>; cwd(): string };

// Editor de desenho com as fontes da marca: o Excalidraw 0.17 busca Virgil.woff2 e Cascadia.woff2 em
// EXCALIDRAW_ASSET_PATH (/excalidraw-ryze/, DesenhoView.tsx). Neste caminho elas viram as da RYZE
// (títulos e técnico, public/fontes-diagrama) e o resto segue para o node_modules.
function fontesDoEditor(): Plugin {
  const trocas: Record<string, string> = { 'Virgil.woff2': 'titulo.woff2', 'Cascadia.woff2': 'mono.woff2' };
  const desvio: Connect.NextHandleFunction = (req, res, next) => {
    const m = /^\/excalidraw-ryze\/([^?]*)/.exec((req as { url?: string }).url || '');
    if (!m) return next();
    const arquivo = m[1].split('/').pop() || '';
    res.statusCode = 302;
    res.setHeader('Location', trocas[arquivo] ? `/fontes-diagrama/${trocas[arquivo]}` : `/node_modules/@excalidraw/excalidraw/dist/${m[1]}`);
    res.end();
  };
  return {
    name: 'fontes-do-editor',
    configureServer: (s) => void s.middlewares.use(desvio),
    configurePreviewServer: (s) => void s.middlewares.use(desvio),
  };
}

const INDEX_OUT = process.env.INDEX_OUT ? process.env.INDEX_OUT.split('\\').join('/') : '';

export default defineConfig({
  plugins: [react(), vaultApi(), fontesDoEditor()],
  base: './',
  // @excalidraw/excalidraw 0.17 lê process.env.IS_PREACT no navegador
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  // Prevenção: empacota o Excalidraw junto com o React na largada. Em 28/10/2026 o cache de
  // dependências (node_modules/.vite) ficou inconsistente depois de vários reinícios e a página
  // carregou DUAS cópias do React ("Invalid hook call"; o mesmo chunk com e sem ?v=). Quem
  // resolveu foi refazer o cache: `npx vite --force`. A mutação (tirar esta linha) não
  // reproduziu o defeito, então ela é seguro barato, não a correção provada.
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', '@excalidraw/excalidraw'] },
  // O e2e sobe um Vite próprio (:5175) enquanto o do dia a dia (:5173) pode estar rodando: cada um
  // com o seu cache de dependências, para um não reescrever o node_modules/.vite do outro no meio.
  ...(process.env.VITE_CACHE_DIR ? { cacheDir: process.env.VITE_CACHE_DIR } : {}),
  // Índice gerado em outra pasta (INDEX_OUT, o e2e): o primeiro paint também sai de lá. Sem isto o
  // App.tsx empacotava o src/data do dia a dia (o vault REAL, razão financeiro incluído) e trocava
  // pelo índice da cópia quando o /api/indice respondia: dado real na tela do teste e a tela
  // mudando no meio de um clique.
  ...(INDEX_OUT ? { resolve: { alias: [{ find: /^\.\/data\/([\w-]+\.json)$/, replacement: INDEX_OUT + '/$1' }] } } : {}),
  server: {
    port: 5173,
    // O índice (src/data/*.json) é gerado; não deixar o watcher recarregar a página a cada escrita.
    watch: { ignored: ['**/src/data/**', ...(INDEX_OUT ? [INDEX_OUT + '/**'] : [])] },
    ...(INDEX_OUT ? { fs: { allow: [searchForWorkspaceRoot(process.cwd()), INDEX_OUT] } } : {}),
  },
});
