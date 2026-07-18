# Cérebro — app v1

App web que **lê o seu vault markdown** (`../cerebro`), indexa em grafo e mostra:

- 🕸️ **grafo interativo gamificado** — nós dimensionados por nº de conexões, cores por área, hover destaca vizinhos, clique abre a nota
- 📄 leitura de notas com **wikilinks clicáveis** e **backlinks automáticos**
- 🔎 busca full-text nas notas
- 🎮 painel de XP/estatísticas (notas, conexões, "sementes" a criar, progresso da regra dos 3 links)

O markdown continua sendo a fonte da verdade — este app é só uma **lente** por cima. Edite as notas no Obsidian/VS Code e rode o índice de novo.

## Rodar

```bash
npm install
npm run dev
```

Abre em http://localhost:5173

## Como funciona
- `npm run dev` roda `scripts/index-vault.mjs` (gera `src/data/*.json` a partir do vault) e sobe o Vite.
- Mudou as notas? `npm run reindex` (ou é só reiniciar o dev).
- Vault em outro lugar? `VAULT_PATH=/caminho/do/vault npm run dev`.

## Stack
Vite + React + TypeScript · d3-force (grafo em canvas) · marked (markdown) · gray-matter (frontmatter).

## Próximas fases
- Escrever/criar notas pelo app (hoje é leitura + navegação; edição pelo Obsidian)
- Busca semântica + "pergunte ao cérebro" (Claude) — Fase 2
- Quadros (Excalidraw) e revisão espaçada (FSRS) — Fases 2/3
- Deploy em Cloudflare Pages
