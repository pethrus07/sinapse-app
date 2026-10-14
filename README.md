# Sinapse — app

App web que **lê o vault markdown do Sinapse** (`../sinapse`), indexa em grafo e mostra:

- 🕸️ **grafo interativo gamificado** — nós dimensionados por nº de conexões, cores por área, hover destaca vizinhos, clique abre a nota
- 📄 leitura de notas com **wikilinks clicáveis** e **backlinks automáticos** (`[[x]]` dentro de código é exemplo, não vira link)
- ✏️ **edição de notas** pelo app (salva direto no vault e reindexa) — precisa do `npm run dev`
- 🔎 busca full-text nas notas
- 🎮 painel de XP/estatísticas (notas, conexões, "sementes" a criar, progresso da regra dos 3 links)
- 🌳 **Skill Tree** por domínio de competência (Produto, Negócio, Desenvolvimento, Dados, Segurança, Infra, Engenharia, Comunicação)
- 🗺️ **Roadmap de estudo** (trilhas por `trilha`/`ordem`/`progresso`) e **Projetos** agrupados por `status`
- 📅 **Agenda** (rotina, prazos e o diário em `01-DIARIO/`) e 💰 **Financeiro** (um arquivo por mês)
- 🧭 canvas do roadmap de sistema (notas `tipo: roadmap`)

O markdown continua sendo a fonte da verdade — este app é uma **lente** por cima. Quem escreve no
vault é o Claude; o Pedro lê (pelo app, pelo Obsidian ou pelo VS Code).

## Vocabulário que o app entende

O vault usa **status em dois eixos** (desde 14/10/2026), e a régua do vault
(`../sinapse/scripts/saude-vault.py`, no pre-commit) trava qualquer valor fora disto:

- `status` (ciclo de vida): `ideia` · `ativo` · `aguardando` · `pausado` · `em-producao` · `concluido` · `arquivado`
- `progresso` (só estudo): `a-fazer` · `estudando` · `revisar` · `dominado`
- diário: `tipo: diario` (o antigo `tipo: daily` continua aceito)

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
- Mostrar o diário e a saúde do vault (`99-MOCS/SAUDE.md`) numa aba própria — hoje abrem como nota
- Busca semântica + "pergunte ao Sinapse" — embeddings locais (Ollama) em estudo
- Revisão espaçada (FSRS, `ts-fsrs`) e quadros (Excalidraw) — adiados
- Deploy em Cloudflare Pages
