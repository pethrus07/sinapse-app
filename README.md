# Sinapse — app

App web que **lê o vault markdown do Sinapse** (`../sinapse`), indexa em grafo e mostra:

- 🕸️ **grafo interativo gamificado** — nós dimensionados por nº de conexões, cores por área, hover destaca vizinhos, clique abre a nota
- 📄 leitura de notas com **wikilinks clicáveis** e **backlinks automáticos** (`[[x]]` dentro de código é exemplo, não vira link)
- ✏️ **edição de notas** pelo app (salva direto no vault e reindexa) — precisa do `npm run dev`
- 🔎 busca full-text nas notas
- 🎮 painel de XP/estatísticas (notas, conexões, "sementes" a criar, progresso da regra dos 3 links)
- 🌳 **Skill Tree** por domínio de competência (Produto, Negócio, Desenvolvimento, Dados, Segurança, Infra, Engenharia, Comunicação)
- 🗺️ **Roadmap de estudo** (trilhas por `trilha`/`ordem`/`progresso`) e **Projetos** agrupados por `status`
- 🎯 **Frentes** (`#/frentes`) — no máximo 3 frentes em andamento, o resto em estados que não ocupam vaga (abaixo)
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

## Tela Frentes

O gargalo é ter frente aberta demais. A tela mostra **no máximo 3 em andamento** (as vagas) e o
resto em estados que não ocupam vaga — tudo lido do frontmatter das notas de projeto:

| estado | de onde vem |
|---|---|
| em andamento (máx. 3) | `vaga: true` |
| esperando alguém | `status: aguardando` + opcionais `esperando: quem` e `cutucar: AAAA-MM-DD` |
| sob demanda | `status: em-producao` |
| na fila | `status: ativo` sem vaga |
| parado (recolhido em "Mais") | `status: pausado` + `motivo:` |

- A **Parresia** (tag `parresia` ou `cliente` com Parresia) é a faixa fixa do dia: não ocupa vaga e
  aparece só numa linha no pé da tela.
- **Último movimento** = último commit nas `pastas:` da nota (relativas a `~/Projetos`, ou
  `PROJETOS_PATH`); sem pasta, o último commit da própria nota no vault. Vaga sem commit há 7 dias
  ou mais vira "parada há N dias".
- **Horas** dos últimos 7 dias pelo método de sessões: commits a até 120 min formam uma sessão,
  que vale (último − primeiro) + 40 min. É piso: reunião e conversa não viram commit.
- `proximo:` (opcional) aparece no cartão da vaga.
- **Trocar** é um clique ("Pôr na vaga" / "Tirar da vaga" → `POST /api/vaga`, que só mexe na linha
  `vaga:` do frontmatter e reindexa). Com as 3 ocupadas, a 4ª aparece em vermelho perguntando qual
  sai — a única cor de alerta da tela. O servidor também recusa a 4ª sem dizer qual sai.
- A régua do vault mede as vagas (alvo ≤ 3, aviso) em `99-MOCS/SAUDE.md`.

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
