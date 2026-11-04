# CLAUDE.md — sinapse-app

App web local (Vite + React + TypeScript, d3, marked, gray-matter) que **lê o vault markdown do
Sinapse** e mostra grafo, notas com wikilinks/backlinks, busca, Roadmap de estudo, Projetos,
Skill Tree, Agenda, Financeiro (Métis) e Investimentos (Aion). O markdown é a fonte da verdade; o
app é uma lente por cima.

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
  (e2e/package.json:6 → `playwright test`). Desde 01/11/2026 a suíte inteira roda numa **cópia
  temporária do vault**: o `e2e/playwright.config.ts` copia o vault para `SINAPSE_E2E_TMP`, sobe um
  Vite próprio na porta **5175** (não reusa o :5173 do dia a dia) com `VAULT_PATH`, `INDEX_OUT`,
  `PROJETOS_PATH` (pastas reais, só leitura do git) e `SINAPSE_ESTADO`; `e2e/global-setup.ts` guarda o
  `git status` do vault real e `e2e/global-teardown.ts` confere que não mudou e apaga a cópia. Se
  outra sessão mexer no vault real durante a suíte, o teardown acusa (falso alarme: rodar de novo).
  Teste unitário: `npm test` (node --test: gráficos do financeiro, sincronizador do banco, Aion
  (carteira, simulação, porquês, coletor e escrita), plano de publicação dos desenhos). Não há CI.
- **Métis** = o módulo financeiro (nome visível desde 03/11/2026; por dentro segue `financeiro`: rota, pasta, bloco, `scripts/financas/`). Métis v2 (04/11/2026, branch `metis-v2`): abas Visão, Gastos, Entradas, Patrimônio (enxuto: reserva × piso e total investido; investimentos ganham módulo próprio), **Pronoia** (projeção), Plano (orçamento) e Lançamentos, rota `#/financeiro/<aba>`; páginas em `src/components/MetisPaginas.tsx`, gráficos em `MetisGraficos.tsx`, modelo em `src/lib/financeiroModelo.ts` + `financeiroAnalise.ts` (natureza fixo/variável/pontual: `NATUREZA_POR_CATEGORIA`; gasto que se repete: `gastoQueSeRepete`). Orçamento em `04-NEGOCIO/financeiro/orcamento.md` (bloco ```financeiro-orcamento), só o Pedro define os tetos. Gráficos base (`src/components/FinanceiroGraficos.tsx`, lógica
  em `src/lib/financeiroGraficos.ts`) e sincronização só leitura pelo Meu Pluggy
  (`scripts/financas/`). Formato, regras e passo a passo em `docs/financeiro-formato.md`. **Repo
  público: nenhum dado financeiro real aqui**; o e2e troca o razão da cópia do vault por um falso
  (`e2e/fixtures/financeiro-falso.ts`) e aponta `SINAPSE_FINANCAS` para a pasta temporária.
  Credencial só em `%LOCALAPPDATA%\sinapse-financas\pluggy.cred` (DPAPI, o Pedro digita); itemId
  também não entra no repo. A tarefa `Metis-Sincronizar` (`instalar-tarefa.ps1`) roda todo dia às 17:00 `--gravar --commitar`: commita no vault só os arquivos do razão que gravou (e não commita com rebase/merge/conflito em curso).
  Revisão de 03/11/2026: POST do dev server só com `content-type: application/json` e origem local
  (página de fora mandava text/plain e gravava); `rel` e mês validados contra `../`; bloco
  ```financeiro com JSON quebrado responde 409 (antes o próximo lançamento apagava o mês); lançamento
  à mão com cara de documento/conta/chave Pix é recusado (marcador de teste sem número longo). No e2e,
  com `INDEX_OUT` o `vite.config.ts` aponta `./data/*.json` para lá (o primeiro paint não mostra mais
  o src/data real) e `VITE_CACHE_DIR` separa o cache de dependências do :5173.
- **Aion** = o módulo de investimentos (04/11/2026, branch `aion-v1`), item próprio no menu ao lado da
  Métis, rota `#/aion/<tela>` (Carteira, Porquês, Observação, Simular, Metas, Economia, Estudo, Minha
  regra). **Não recomenda**: dado, fonte e data; separa causa conhecida, fato, opinião, estimativa,
  hipótese e "sem notícia" (`src/lib/aionPorques.ts`, camada `FontePorque`; a fonte de notícia em tempo
  real ainda não foi escolhida e entra como mais uma fonte). O porquê é pop-up em todas as telas
  (`ComPorque` em `src/components/AionPorque.tsx`, alvo em `data-porque`). Modelo em `src/lib/aion.ts`,
  simulação em `src/lib/aionSimular.ts` (premissas na tela, IR regressivo por lote, valor real pelo
  Focus), telas em `AionPaginas.tsx`, gráficos em `AionGraficos.tsx`. Dado de mercado: `scripts/aion/coletar.mjs`
  (`npm run aion:simular` / `aion:gravar`) → cache LOCAL `%LOCALAPPDATA%\sinapse-aion\mercado.json`
  (`SINAPSE_AION`); o índice lê o cache (`scripts/aion/indice.mjs`), o navegador nunca chama a rede de
  mercado. Fontes permitidas: BCB SGS/Olinda/Copom, brapi, CoinGecko (citar "Data provided by
  CoinGecko"), CVM. **Proibido**: site da B3, Yahoo/yfinance, Status Invest, Fundamentus. Chaves (brapi,
  CoinGecko) só pelo `scripts/aion/aion-chave.ps1` (DPAPI, o Pedro digita). Tarefa `Aion-Coletar`
  (`scripts/aion/instalar-tarefa.ps1`) **não instalada**: é com o Pedro. Escrita no vault por
  `POST /api/aion` (`scripts/aion/escrita.mjs`): `04-NEGOCIO/financeiro/aion-observacao.md`,
  `aion-regra.md`, `aion-metas.md`, `aion-estudo.md`, caminho fixo, validação, 409 com JSON quebrado.
  A sincronização da Métis grava agora `codigo`, `quantidade`, `aportado`, `desde`, `indexador` na
  posição (rendimento × CDI precisa do `aportado`). Calendário do Copom é constante em
  `scripts/aion/fontes.mjs` (`CALENDARIO_COPOM`, o BC não tem API): atualizar todo ano. Formato e
  regras em `docs/aion-formato.md`.
  `SINAPSE_SO_LEITURA=1` faz o dev server recusar toda escrita (403): para olhar o vault real em outra
  porta sem risco (as telas do Aion foram revistas assim, :5176, `INDEX_OUT` fora de `src/data`).
  e2e: `tests/aion.spec.ts` usa mercado falso (`fixtures/aion-falso.ts`, `SINAPSE_AION` na pasta
  temporária) e grava posições falsas num arquivo próprio da cópia, apagado no `afterAll` (a Métis não
  vê); bloqueia e conta chamadas a BCB/brapi/CoinGecko/CVM. Armadilhas: o Chromium dá caixa a filho de
  `<details>` fechado (a conferência de alvo de toque pula); `getByLabel('… bloco 1')` casa 10 e 11
  (usar `exact`); a heredoc do Git Bash comeu `\a` (virou BEL) num patch: patch com contrabarra por arquivo.
- `e2e/tests/frentes.spec.ts` escreve numa **cópia temporária** do vault: sobe um Vite próprio na
  porta 5174 com `VAULT_PATH` (a cópia), `INDEX_OUT` (índice fora de `src/data`) e `PROJETOS_PATH`
  (as pastas reais, só leitura do git), e no fim confere que o `git status` do vault real não mudou.
  Screenshots em `e2e/shots/13…15-frentes*.png` (gitignored). O mesmo spec monta um **Atas
  falso** (5 reuniões, uma `parresia` e uma `pessoal` que não podem aparecer) e passa
  `ATAS_PATH` + `SINAPSE_ESTADO` para a pasta temporária: nunca ler o `atas-salvas` real em
  teste. Screenshots do "o que prometi" em `e2e/shots/16…18-promessa*.png`.
- `e2e/tests/indice-vivo.spec.ts` e `financeiro.spec.ts` escrevem só na cópia (`SINAPSE_E2E_VAULT`).
  Data em teste é relativa a hoje: data fixa no passado quebrou o financeiro quando o calendário andou.
- `frentes.spec.ts` fixa na cópia o frontmatter das duas frentes que usa (atas → título "Atas", vaga;
  renatinho-motores → pastas [retifica-os]): o teste não depende mais do título real das notas.
- Importar NotebookLM para o INBOX do vault:
  `node scripts/importar-notebooklm.mjs <pasta> [--dry] [--vault CAMINHO]`
  (scripts/importar-notebooklm.mjs:3). Usar `--dry` primeiro. Extrator local em `scripts/nlm/`
  (`npm run explorar`, scripts/nlm/package.json:7; o script `extrair` aponta para `extrair.mjs`,
  que não existe no repo).
- Atalho da área de trabalho: `abrir-sinapse.cmd` → `scripts/abrir-sinapse.ps1` (sobe o dev server
  se a porta 5173 estiver livre e abre em janela de app, rota `#/agenda`).

## Onde está a arquitetura

- `docs/arquitetura/` (desde 29/10/2026): os três diagramas deste app (UML, BPMN, C4), gerados pelo
  próprio gerador a partir de `../sinapse/09-DESENHOS/specs/sinapse-app.json`. Não editar à mão.
- `docs/desenhos-formato.md`: formato das specs de desenho; `docs/desenhos-exemplo-hermes.json`.
- `README.md` (inglês) e `README.pt-BR.md`: funções, como rodar, testes, decisões.
- Cabeçalhos de `scripts/vault-api.mjs`, `scripts/build-index.mjs` e `scripts/importar-notebooklm.mjs`,
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
  Spec nova: formato 2 em `docs/desenhos-formato.md` (UML + BPMN + C4), conferida por
  `scripts/validar-specs.mjs`. Projeto novo = spec + gerar + `publicar-desenhos.mjs --commit`.
  O Pedro rejeitou o visual de rascunho (Virgil, roughness 1) em 29/10: manter traço reto e notação padrão.
  Mudou o gerador: `node scripts/qa-desenhos.mjs` (atravessa, colada, raspa, trilho…) **e** revisão por
  imagem (exportar com `exportar.html` → `exportarPartes`); só o instrumento não basta, a revisão de
  29/10 achou ~270 defeitos com o instrumento zerado. Armadilhas achadas: o ELK lê espaçamento do nó
  pai (repetir dentro de `__sistema`); a caixa do pool de destino não pode ser obstáculo da mensagem;
  origem/destino só se ignoram no primeiro/último trecho da rota.
- Tema dos desenhos = RYZE (29/10, pedido do Pedro). O Excalidraw 0.17 só tem 3 fontes, então o
  `fontFamily` é papel: 1 título (Space Grotesk), 2 texto (Plus Jakarta Sans), 3 técnico (JetBrains
  Mono). A troca acontece em três lugares: `src/lib/diagramaSvg.ts` (SVG da aba Desenho e do GitHub,
  fontes embutidas em base64, recortadas em `public/fontes-diagrama/`), `vite.config.ts`
  (`fontesDoEditor`: Virgil/Cascadia do editor) e `DesenhoView.tsx` (Helvetica do editor por
  FontFace). Fonte nova = medir a largura média no texto das specs e acertar `LARG` no gerador.
- A aba Desenho abre no modo ver (os SVGs que vão para o GitHub); `#/note/<id>?aba=desenho` abre
  direto nela. O Pedro quer ver no Sinapse ANTES de publicar nos repos.
- `publicar-desenhos.mjs` nomeia os arquivos pelo título do diagrama (`nomeDe` em
  `destinos-desenhos.mjs`, com exceções em `NOMES`) e renomeia os do nome antigo. Portões (01/11):
  (1) QA zerado ou não publica (`--forcar` só a pedido do Pedro); (2) trava de identidade
  (`destinos-desenhos.mjs`): a pasta precisa conter o nome do desenho, o id da spec ou estar no
  `"pastas"` da spec; não há `--forcar` para isso; (3) spec com `"sistema": false` não gera nem
  publica e o publicador tira o docs/arquitetura gerado dela. Também tira desenho de OUTRO projeto
  deixado por `pastas:` errado (só arquivos com nome de desenho gerado). Spec sem nota própria usa o
  `"pastas"` dela; `"pastas": []` deixa o desenho só no Sinapse. `--exceto=a,b` tira pastas da rodada (não grava nem limpa nelas). `node scripts/destinos-desenhos.mjs`
  mostra o plano sem gravar nada.
- `qa-desenhos.mjs` mede também `longe` (rótulo a mais de 16 px visíveis da própria seta),
  `ambíguo`, `ponta×texto`, `aperta` e `morto` (área útil por vista: UML 0,60, BPMN 0,50, C4 0,50). Limiares calibrados em
  01/11/2026 (números no topo do script); `--medidas` imprime os números por desenho.
- C4 deitado (ELK `RIGHT`, pessoas/sistema/externos em partições, portas a 34 px e caixa que cresce
  para caber as setas). `DIRECAO_C4=DOWN` volta ao em pé, só para comparar; `ROT_C4` (largura do
  rótulo, 120) e `CAMADA_C4` (vão entre camadas, 60) são botões de teste: 96/40 estreitam o C4 só ~6%.
- Spec com `"vistas": ["c4"]` desenha só parte das três; os cabeçalhos ficam 1..n e o SVG sai com o
  nome da vista (`-3-arquitetura.svg`).
- Excalidraw 0.17 precisa de `process.env.IS_PREACT` definido (`vite.config.ts`) e de
  `window.EXCALIDRAW_ASSET_PATH` apontando para o `node_modules` (`DesenhoView.tsx`).
- "Invalid hook call" / `reading 'useState'` em toda tela = duas cópias do React por cache de
  dependências inconsistente. Conserto: parar o dev server e subir com `npx vite --force`.
- O índice guarda o `git log` de cada pasta em `~/.sinapse/cache-git.json`, válido enquanto o
  HEAD não muda (lido direto do `.git`). Apagar o arquivo só deixa o primeiro índice lento.
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
