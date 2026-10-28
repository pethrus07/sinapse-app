# CLAUDE.md — sinapse-app

App web local (Vite + React + TypeScript, d3, marked, gray-matter) que **lê o vault markdown do
Sinapse** e mostra grafo, notas com wikilinks/backlinks, busca, Roadmap de estudo, Projetos,
Skill Tree, Agenda e Financeiro. O markdown é a fonte da verdade; o app é uma lente por cima.

## Relação com o vault

- Vault: `C:\Users\olive\Projetos\sinapse` (repo separado). O app procura em `../sinapse`
  (ou `VAULT_PATH`) — `scripts/index-vault.mjs:8`.
- `scripts/build-index.mjs` gera `src/data/*.json` (gitignored; nunca editar à mão nem commitar).
- `scripts/vault-api.mjs` é plugin do Vite: os endpoints de ESCRITA no vault (`POST /api/note`,
  `/api/progress`, diário, financeiro) só existem com o dev server rodando, e reindexam ao vivo.
- **Quem escreve no vault é o Claude; o Pedro lê** (pelo app, Obsidian ou VS Code) — README.md:15-16.
- Vocabulário de `status`/`progresso` vem da régua do vault (`../sinapse/scripts/saude-vault.py`,
  no pre-commit do vault) — README.md:18-25. Valor novo só se mudar nos dois lados.
- O vault tem pre-commit próprio (`.githooks/`: `verificar-pastas.py` + `saude-vault.py --trava`).

## Rodar e testar (comandos conferidos)

```
npm install                 # README.md:30
npm run dev                 # README.md:31 / package.json:9 — indexa o vault e sobe o Vite em :5173
npm run reindex             # package.json:12 — regenera src/data/*.json (mudou nota fora do app)
npm run build               # package.json:10 — indexa + vite build (dist/, gitignored)
npm run preview             # package.json:11
VAULT_PATH=/caminho npm run dev   # README.md:39 — vault em outro lugar
```

- Testes: só e2e com Playwright, em `e2e/` (pacote próprio). Em `e2e/`: `npm test`
  (e2e/package.json:6 → `playwright test`). O config sobe `npm run dev` na raiz e **reusa** um
  servidor já aberto em :5173 (e2e/playwright.config.ts:30-35). Não há teste unitário nem CI.
- `e2e/tests/frentes.spec.ts` escreve numa **cópia temporária** do vault: sobe um Vite próprio na
  porta 5174 com `VAULT_PATH` (a cópia), `INDEX_OUT` (índice fora de `src/data`) e `PROJETOS_PATH`
  (as pastas reais, só leitura do git), e no fim confere que o `git status` do vault real não mudou.
  Screenshots em `e2e/shots/13…15-frentes*.png` (gitignored). O mesmo spec monta um **Atas
  falso** (5 reuniões, uma `parresia` e uma `pessoal` que não podem aparecer) e passa
  `ATAS_PATH` + `SINAPSE_ESTADO` para a pasta temporária: nunca ler o `atas-salvas` real em
  teste. Screenshots do "o que prometi" em `e2e/shots/16…18-promessa*.png`.
- `e2e/tests/indice-vivo.spec.ts` grava e apaga `00-INBOX/_teste-e2e-evento.md` **no vault real**
  (linhas 9-10 e 22): rodar com o vault limpo e conferir `git status` do vault depois.
- Importar NotebookLM para o INBOX do vault:
  `node scripts/importar-notebooklm.mjs <pasta> [--dry] [--vault CAMINHO]`
  (scripts/importar-notebooklm.mjs:3). Usar `--dry` primeiro. Extrator local em `scripts/nlm/`
  (`npm run explorar`, scripts/nlm/package.json:7; o script `extrair` aponta para `extrair.mjs`,
  que não existe no repo).
- Atalho da área de trabalho: `abrir-sinapse.cmd` → `scripts/abrir-sinapse.ps1` (sobe o dev server
  se a porta 5173 estiver livre e abre em janela de app, rota `#/agenda`).

## Onde está a arquitetura

Não há `docs/`. Referências: `README.md` (funções, vocabulário, como funciona, próximas fases),
cabeçalhos de `scripts/vault-api.mjs`, `scripts/build-index.mjs` e `scripts/importar-notebooklm.mjs`,
`src/types.ts` (formato do índice), `src/lib/skills.ts` (taxonomia da Skill Tree).

## Convenções e armadilhas

- `vite.config.ts`: `watch.ignored` em `src/data/**` — sem isso cada escrita recarrega a página.
- `vault-api.mjs` junta o corpo do POST como Buffer e decodifica uma vez em UTF-8 (concatenar
  string quebra acento partido entre chunks). Manter assim.
- `[[x]]` dentro de código é exemplo, não vira link (README.md:6).
- `build-index.mjs` chama `git log` nas `pastas:` de cada frente (cache de 60 s): o `reindex` leva
  ~2 s por isso. `/api/vaga` edita só a linha `vaga:` (não usa `matter.stringify`, que reescreveria
  o YAML inteiro).
- "O que prometi" (`scripts/compromissos.mjs`, README "O que prometi") **só lê** o Atas
  (`../atas` ou `ATAS_PATH`) e grava o "feito" em `~/.sinapse/compromissos-feitos.json`
  (`SINAPSE_ESTADO`). Dado de reunião não vai para o vault nem para o bundle (o app não importa
  `src/data/compromissos.json`; vem só do `/api/indice`). Tipo `parresia`/`pessoal`/`pendente`
  fica fora — não afrouxar. Em 14/10/2026 as atas com `ata.json` não tinham `projeto`: tudo caía
  em "sem frente".
- Desenhos: `scripts/gerar-desenhos.mjs` lê `../sinapse/09-DESENHOS/specs/*.json` e escreve
  `09-DESENHOS/<id>.excalidraw`. Desenho sem o campo `gerado` (ou com `gerado` diferente da
  assinatura) foi editado à mão: o gerador pula. **Não usar `--forcar` sem o Pedro pedir.**
  Spec nova segue o formato de `specs/hermes.json` (caixa ≤ 45 caracteres, 3–5 camadas).
- Excalidraw 0.17 precisa de `process.env.IS_PREACT` definido (`vite.config.ts`) e de
  `window.EXCALIDRAW_ASSET_PATH` apontando para o `node_modules` (`DesenhoView.tsx`).
- `/api/tarefa` acha a tarefa pela **linha exata**: se a nota mudou desde o índice, devolve 409
  em vez de editar a linha errada.
- Importador do NotebookLM escreve só em `00-INBOX/notebooklm/` + 1 MOC por notebook; nada cai
  direto nas áreas do vault.
- Porta 5173 ocupada por outro dev server órfão faz o app/e2e falar com o servidor errado:
  conferir quem está na porta antes.
- Se reinstalar dependências e o esbuild falhar (postinstall bloqueado pelo allow-scripts do npm):
  `node node_modules/esbuild/install.js`.
- **O app não tem produção.** "Deploy em Cloudflare Pages" no README é fase futura; não existe
  projeto Pages do Sinapse. Não publicar sem pedido do Pedro.

## Regras do Pedro

- O Sinapse é a base segura de retomada do Pedro: nada de mudança que quebre leitura do vault
  sem ele ver. Fluxo padrão: revisão → commit + push → ao final, registrar no vault o que mudou
  (eu faço; ele não mantém o vault na mão).
- Ao escrever no vault, `[[x]]` só se `x.md` existir no vault (conferir com Glob). Nome de
  arquivo de memória do Claude **não** é nota do vault: vira texto comum ou nota de verdade.
- Trabalho de QA da Parresia não entra no vault, salvo a esteira de QA (exceção pedida por ele).
- Nada de RG, CPF, endereço ou dado pessoal no vault nem no app (é git).
- Patch com regex ou contrabarra vai por arquivo (Write/Edit), **nunca** `node -e`/`python -c`
  inline no Bash (o Git Bash come as contrabarras e gera código válido e errado).

## Git

- Commits em português, sem trailer `Co-Authored-By` e sem linha "Generated with Claude Code".
- Existe um pre-commit global com gitleaks em `C:\Users\olive\.git-hooks\pre-commit`
  (`core.hooksPath` global) que encadeia o hook local do repo. **Nunca usar `--no-verify`**:
  se o gitleaks travar, tirar o segredo do diff.
- Nunca copiar segredo, token, senha ou chave de API para arquivo versionado (inclusive este).
  A IA "pergunte ao Sinapse" ficou para o fim; se vier, a chave mora fora do repo.
