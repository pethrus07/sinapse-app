# Aion (investimentos): dados, telas, porquês e simulação

> **Aion** é o módulo de investimentos do Sinapse, com o nome do tempo longo e contínuo dos gregos,
> o tempo dos juros compostos. Fecha um trio com a Métis (o dinheiro de hoje) e a Pronoia (os
> próximos meses): o Aion olha os anos. Item próprio no menu, ao lado da Métis; rota `#/aion/<tela>`,
> abre na Carteira. Planejamento na nota `05-IDEIAS/aion.md` do vault; trilha de estudo em
> `02-ESTUDO/trilha-investimentos-e-economia.md`.
>
> **O Pedro decide; o Aion não recomenda.** Mostra dado, notícia e análise com fonte e data, e
> separa fato de opinião e de estimativa. Sem dado, diz "sem base"; sem notícia, diz "sem notícia".

**Repo público: nenhum dado financeiro real aqui.** O e2e usa mercado e carteira falsos
(`e2e/fixtures/aion-falso.ts`); os testes de unidade usam ativos de teste (TEST3, FUND11).

## De onde vem cada coisa

| o quê | de onde | onde mora |
|---|---|---|
| posições (reserva, renda fixa, FII, ação) | razão da Métis, sincronização do Meu Pluggy, uma por aplicação por mês | vault, `04-NEGOCIO/financeiro/AAAA-MM.md` |
| cripto | lançada à mão na Métis (Lançamentos, **= Saldo**, classe `cripto`) | idem |
| Selic, CDI, IPCA, dólar | Banco Central SGS (432, 4389, 4391, 433, 1), grátis, sem chave. A Selic meta guarda também o valor do fim de cada mês dos últimos 5 anos (`selicMeta.mensal`); CDI e IPCA mensais, 6 anos | cache local |
| Focus (IPCA, Selic, PIB, câmbio) | Banco Central, API Olinda, grátis, sem chave | cache local |
| Focus semana a semana | Olinda (`ExpectativasMercadoAnuais`, `Data ge` um ano atrás): IPCA e Selic do ano e do próximo, o último valor de cada semana (`focus.historico`) | cache local |
| decisões do Copom | comunicados do site do BC (`api/servico/sitebcb/copom`), sem chave | cache local |
| próxima reunião do Copom | `CALENDARIO_COPOM` em `scripts/aion/fontes.mjs` (o BC não tem API do calendário; datas de 2026 conferidas em 04/11/2026) | código |
| cotação, proventos, P/L | brapi.dev (sem token só PETR4, MGLU3, VALE3, ITUB4; com token grátis 15 mil req/mês) | cache local |
| cripto (preço, 24 h) | CoinGecko (público sem chave; Demo com chave). Exige citar "Data provided by CoinGecko" | cache local |
| fatos relevantes | CVM dados abertos (IPE) + código de negociação → CNPJ pelo FCA. Saem com atraso (semanal): histórico, não alerta | cache local |
| resultado do trimestre | CVM, IPE "Dados Econômico-Financeiros" › "Press-release" (`cvm.resultados`): o dia da divulgação, marcador no gráfico de preço | cache local |
| o que a empresa faz | CVM, FCA geral: `Setor_Atividade` e `Descricao_Atividade` (`cvm.perfis`) | cache local |
| o que o FII é | CVM, informe mensal de FII (geral + complemento): o código liga pelo ISIN (ABCD11 → BRABCDCTF…); segmento, valor patrimonial da cota, DY do mês (`cvm.fiis`). O campo "mandato" veio vazio em 2026: papel × tijolo não sai daqui | cache local |
| lista de observação, regra, metas, progresso do estudo | escritos pelo app | vault, `04-NEGOCIO/financeiro/aion-*.md` |

**Proibido** (termos de uso): raspar o site da B3 (inclusive por IA e para uso próprio),
Yahoo Finance/yfinance, Status Invest, Fundamentus.

## O coletor (`scripts/aion/`)

```
node scripts/aion/coletar.mjs              # = --simular: busca e mostra o resumo, não grava (npm run aion:simular)
node scripts/aion/coletar.mjs --gravar     # grava o cache (npm run aion:gravar)
node scripts/aion/coletar.mjs --so=bcb,focus,copom,cotacao,cripto,cvm
node scripts/aion/coletar.mjs --cvm        # força a CVM (por padrão, no máximo 1 vez a cada 6 dias)
```

- Ativos coletados: as posições de ação, FII e cripto do razão + a lista de observação.
- Cache em `%LOCALAPPDATA%\sinapse-aion\mercado.json` (ou `SINAPSE_AION`), fora do git e do vault.
  Fonte que falha fica com o dado anterior (cada uma com a sua data `em`) e o erro vai para `erros`.
- Limites: brapi até 12 mil chamadas/mês e 60 por rodada; CoinGecko 3 por rodada e 2,5 s entre
  chamadas; 0,4 s entre chamadas ao mesmo host. Contador do mês em `uso.json`. Log em `logs\AAAA-MM.log`.
- O índice do app (`scripts/aion/indice.mjs`, chamado pelo `build-index.mjs`) lê o cache. **O
  navegador nunca chama a rede de mercado** (o e2e bloqueia e conta).

### Chaves (o Pedro digita; nunca vão para o repo)

```
powershell -ExecutionPolicy Bypass -File scripts\aion\aion-chave.ps1 -Servico brapi
powershell -ExecutionPolicy Bypass -File scripts\aion\aion-chave.ps1 -Servico coingecko   # opcional
```

Cifradas com DPAPI do usuário do Windows em `%LOCALAPPDATA%\sinapse-aion\<servico>.cred` (mesmo
padrão da Pluggy, `scripts/financas/credencial.mjs`). `-Remover` apaga. Sem chave, o caminho sem
chave segue e a tela diz o que falta ("sem cotação: falta o token da brapi", com o passo a passo).

### Tarefa agendada (não instalada: é com o Pedro)

```
powershell -ExecutionPolicy Bypass -File scripts\aion\instalar-tarefa.ps1                # dias úteis, 09:30 e 18:30
powershell -ExecutionPolicy Bypass -File scripts\aion\instalar-tarefa.ps1 -Horas 10:00
powershell -ExecutionPolicy Bypass -File scripts\aion\instalar-tarefa.ps1 -Remover
```

Tarefa `Aion-Coletar`, escondida pelo `rodar-escondido.vbs` da Métis, roda `--gravar`: só o cache
local muda (nada no vault, nada no git).

## Campos novos na posição de investimento

A sincronização da Métis passou a gravar, quando a API do Meu Pluggy manda (`detalhesDoInvestimento`
em `scripts/financas/pluggy.mjs`; nenhum é segredo):

| campo | o que é |
|---|---|
| `codigo` | código de negociação (ação, FII, ETF, BDR). Sem ele, o Aion lê da descrição ("FII ABCD11") |
| `quantidade` | cotas, ações ou títulos |
| `aportado` | valor aplicado (`amountOriginal`) |
| `desde` | data da aplicação (`purchaseDate` ou `issueDate`) |
| `indexador` | "115% CDI", "pré 12,5% a.a." |

Mudou um desses: a posição do mês é regravada no lugar. Cripto à mão pode ter `codigo` ("BTC") e
`quantidade`. Os campos só chegam ao razão na primeira sincronização depois que este código entrar no
app que a tarefa `Metis-Sincronizar` usa.

## Arquivos do vault (escritos pelo app, `POST /api/aion`)

Todos em `04-NEGOCIO/financeiro/`, `tipo: aion`, um bloco JSON cada. Escrita segura no padrão do
orçamento da Métis (`scripts/aion/escrita.mjs`): só `application/json` de origem local, caminho FIXO
por ação, validação de cada campo, texto com cara de documento/conta/chave Pix recusado, só o bloco
é trocado se o arquivo existe (frontmatter, texto e CRLF ficam), bloco com JSON quebrado responde
409 e nada é gravado.

- `aion-observacao.md`, ` ```aion-observacao `: `{ "ativos": [{ "codigo": "ITSA4", "tipo": "acao", "nota": "", "desde": "AAAA-MM-DD" }] }`
  (`tipo`: `acao`, `fii`, `etf`, `bdr`, `cripto`; cripto pelo id da CoinGecko ou símbolo comum: BTC, ETH, SOL…).
- `aion-regra.md`, ` ```aion-regra `: `{ "reservaMinima": 5000, "alocacao": { "fii": { "alvo": 40, "tolerancia": 5 }, ... }, "aportes": [], "naoFazer": [], "revisarEm": "AAAA-MM", "escritaEm": "AAAA-MM-DD" }`.
  Tipos da alocação: `renda-fixa`, `fii`, `acao`, `cripto`, `outros`, em **% da carteira fora da
  reserva**, somando 100. A reserva é em reais (o mínimo). Sem regra: a tela explica que ela vem no
  bloco 11 e oferece o modelo vazio.
- `aion-metas.md`, ` ```aion-metas `: `{ "reserva": 5000, "carteira": 5000, "meta3": { "nome": "sair de casa ou veículo", "valor": null } }`.
  Sem arquivo: reserva R$ 5.000 (ou `metaReserva` do orçamento da Métis), carteira R$ 5.000, meta 3 sem valor.
- `aion-estudo.md`, ` ```aion-estudo `: `{ "blocos": { "1": "estudando" }, "atualizado": "AAAA-MM-DD" }`, no
  vocabulário `progresso` do vault (`a-fazer`, `estudando`, `revisar`, `dominado`).

`SINAPSE_SO_LEITURA=1` no dev server recusa toda escrita (403): para abrir o vault real sem risco
(foi como as telas foram revistas com dado real).

## Conceito × porquê (a regra das telas)

O Pedro pediu (04/11/2026): saber quando o pop-up mostra um **conceito** ("o que é aquilo") e quando
mostra um **porquê**. A regra:

| onde passa o mouse (ou toca) | abre | marca na tela | componente |
|---|---|---|---|
| um **nome, termo ou indicador** (P/L, P/VP, DY, CDI, Selic, Focus, IPCA, "liquidez diária", nome de um tipo da carteira) | **O que é**: o conceito em 2 a 3 linhas, no tom da trilha, e "Entender: bloco N" | sublinhado pontilhado discreto | `<Termo id>` |
| um **número que mudou** (valor, variação, desvio da regra, taxa, mediana) | **Por quê**: motivo, tipo da explicação, data e fonte; no fim, sempre "Fonte do número" | um ponto pequeno depois do número | `<ComPorque fonte>` |
| um **ativo inteiro** (linha da Carteira e da Observação) | os dois: **O que é** em cima (o que a empresa ou o fundo faz, pela CVM; sem fonte, o tipo), **Por quê** embaixo | a linha toda | `<ComAtivo>` |

O título do pop-up diz qual é ("O que é · Selic", "Por quê · Reserva", "O que é e por quê · ABCD3").
**Nunca "Por quê" sem fonte**: `ComPorque` exige a fonte do número. Clique (mouse) num ativo abre o
gráfico dele; no toque, o primeiro toque abre o pop-up e o botão "Ver … no tempo" leva ao gráfico.

**O glossário mora em `src/lib/aionGlossario.ts`** (49 verbetes em 04/11/2026), não no vault: é
conhecimento geral sem nada do Pedro; as telas e o teste leem o mesmo arquivo no build, então termo
marcado sem verbete quebra o `npm test` (`aionGlossario.test.ts` lê o código das telas) e o tipo
`IdTermo` quebra o tsc; o aprofundamento continua no vault, porque cada verbete aponta para um bloco
da trilha. Texto de colega, sem travessão, 80 a 320 caracteres (o teste confere). Termo novo numa
tela: verbete primeiro.

## Os gráficos (skill dataviz)

Forma antes de cor; um eixo só (nunca dois); legenda com 2+ séries e rótulo direto no fim da linha;
hover e teclado (setas) em tudo; a tabela em "Mais opções". Paleta: slots 1 a 3 da categórica,
validados no fundo do app (#11141C) com `validate_palette.js --pairs all` (CVD ΔE 9,4, normal 20,9,
contraste ≥ 3:1); série única no slot 1; mês andando no mesmo tom, mais claro com contorno. Pouco dado:
todo gráfico diz quanto tem ("1 mês de dado; o gráfico cresce com o tempo", `avisoPoucoDado`) e não
inventa ponto entre dois reais. Lógica em `src/lib/aionSeries.ts`, desenho em `AionGraficos.tsx`
(`GraficoLinhas`, `GraficoColunas`, `Sparkline`, `Faixa52`).

| tela | gráfico | o que mostra |
|---|---|---|
| Carteira | Patrimônio mês a mês | colunas empilhadas reserva × fora da reserva, um retrato por mês do razão (mês sem retrato não aparece) |
| Carteira | Aportes por mês | o que entrou de reserva e aplicação; o mês de hoje mais claro (andando, fora do ritmo) |
| Carteira | Renda passiva por mês | dividendos, JCP e rendimentos recebidos, desde o primeiro mês do razão |
| Carteira | Rendimento × CDI × IPCA | base 100 no primeiro retrato; a carteira anda por (valor − aportes do mês) ÷ valor anterior, então aporte não vira rendimento. Com 1 retrato, não desenha as três linhas em 100: diz que a comparação começa no mês que vem |
| ativo (`#/aion/ativo/<CODIGO>`) | Preço no tempo | fechamento diário da brapi (3 meses no plano grátis) com marcadores: resultado (quadrado), fato relevante (losango), data com e data ex (círculo), Copom (triângulo). A forma diz o tipo; o marcador abre o porquê (data ex = causa; o resto, fato ou contexto). Sem token: diz o que falta |
| Economia | Selic, CDI e IPCA | small multiples, um por indicador, mesma escala e mesmos meses (% ao ano; CDI e IPCA acumulados em 12 meses) |
| Economia | Focus semana a semana | IPCA esperado e Selic esperada, ano corrente × próximo, a mediana de cada semana do último ano |
| Observação | linha de preço + régua de 52 semanas | o histórico que a brapi deu (3 meses, dito) e a mínima/máxima de 52 semanas que ela informa |
| Metas | Caminho até a meta | o que já foi (retratos), a projeção pelo ritmo real (tracejada) e a faixa: estimativa fraca = metade a 1,5× o ritmo; com 3+ meses, ritmo ± desvio padrão. Sem aporte medido: sem projeção (dito) |

## As telas

1. **Carteira** (`#/aion`): total investido, reserva × piso, fora da reserva, renda passiva do mês
   (entradas liquidadas de dividendo, JCP, rendimento); fora da reserva por tipo × a regra (faixa e
   alvo; fora da faixa com ⚠ e texto); rendimento × CDI e IPCA com a base dita (valor aplicado da
   posição, ou dois retratos do patrimônio descontado o aporte, ou "sem base"); seus ativos hoje
   (variação do dia, ou "sem cotação: falta o token da brapi").
2. **Porquês** (`#/aion/porques`): a lista completa, com filtro (juros e inflação, seus ativos,
   observação) e, em "Mais opções", a camada de fontes de porquê (ligada, histórico ou tempo real).
3. **Observação** (`#/aion/observacao`): os ativos que ele não tem, com preço, variação, P/L e
   mínima/máxima de 52 semanas quando a fonte dá; incluir e tirar.
4. **Simular** (`#/aion/simular`): "e se" (aportar a mais por mês; aplicar ou resgatar uma vez,
   inclusive um ativo da lista, pelo tipo dele) e a faixa ruim/base/bom em 1, 3 e 5 anos, em reais de
   hoje e líquida de imposto, antes × depois. Premissas editáveis em "Mais opções". "Olhar para trás":
   R$ X por mês desde uma data no CDI.
5. **Metas** (`#/aion/metas`) (com o caminho de cada meta no tempo): ritmo real de aporte (média dos meses fechados, mês sem aporte = 0;
   menos de 3 meses = estimativa fraca) e quando chega cada meta, na ordem do Pedro (reserva, carteira,
   meta 3). Valores editáveis.
6. **Economia** (`#/aion/economia`): Selic meta, CDI, IPCA (12 meses e mês), dólar, cada um com
   fonte e data; Copom (última decisão, o trecho do comunicado, a próxima reunião); Focus (IPCA,
   Selic, PIB, câmbio no ano e no próximo).
7. **Estudo** (`#/aion/estudo`): os 11 blocos lidos da nota da trilha, com progresso por bloco;
   `?bloco=N` abre no bloco (é para onde o "Entender: bloco N" do porquê leva).
8. **Minha regra** (`#/aion/regra`): a política escrita, ou a explicação + o modelo vazio.

## O porquê (em todas as telas)

Pop-up ao passar o mouse, ao tocar (celular) ou ao focar pelo teclado sobre um número, uma barra ou
um ativo (`ComPorque` em `src/components/AionPorque.tsx`; o alvo fica em `data-porque`). Mostra cada
explicação com o **tipo**, a data, a fonte (link) e o bloco da trilha:

| tipo | quando |
|---|---|
| causa conhecida | o Copom mudou a Selic (reserva, renda fixa, CDI); a ação ficou "ex" provento (queda perto do valor do provento) |
| fato | dado oficial que ajuda a entender sem ser a causa: IPCA do mês, fato relevante da CVM, próxima reunião, provento que vem |
| opinião | o que alguém disse, com o nome: o trecho do comunicado do Copom |
| estimativa | a mediana do Focus |
| hipótese | variação pequena do dia (menos de 1%): vaivém normal |
| sem notícia | movimento sem nada ligado que explique; o pop-up diz isso e o que falta ligar |

Camada **fontes de porquê** (`src/lib/aionPorques.ts`): cada fonte implementa `FontePorque`
(`id`, `nome`, `tempoReal`, `ligada`, `explica`, `porques(aion, ctx)`). Hoje: Copom, IPCA, Focus,
proventos (brapi), fatos relevantes (CVM), movimento do dia (cotação), dólar. **A fonte de notícia
em tempo real ainda não foi escolhida** (termos a conferir): entra como mais uma `FontePorque` com
`tempoReal: true` sem mudar as telas; até lá todo pop-up diz "notícia em tempo real: fonte ainda não
escolhida". Decisões antigas do Copom ficam só na lista (`historico`), não no pop-up.

## Simulação (`src/lib/aionSimular.ts`)

Conta com premissas à vista, não previsão nem promessa:

- **Renda fixa e reserva**: CDI esperado = Selic do Focus para cada ano + a diferença CDI × Selic
  medida hoje, × o % do CDI (premissa, 100). Ruim/bom = Selic ∓ 1 ponto.
- **Renda variável** (FII, ação, cripto): sem prêmio de risco assumido, a base é o CDI esperado; a
  faixa é ±1 desvio padrão da volatilidade declarada (premissa: ação 25%, FII 15%, cripto 60% ao ano),
  lognormal: `base × e^(±σ√t − σ²t/2)`. Cerca de 2 em cada 3 resultados caem dentro, SE a volatilidade
  for essa. Ruim e bom de todos os tipos juntos: a faixa da carteira fica mais larga que a real.
- **Aporte**: o ritmo real medido; divisão pela Minha regra (sem regra: como a carteira de hoje).
- **Imposto** (regra geral, bloco 10 da trilha; conferir todo ano): renda fixa na tabela
  regressiva por tempo de cada aporte (22,5% até 180 dias, 20% até 360, 17,5% até 720, 15% depois);
  ação 15% do ganho se a venda do mês passar de R$ 20 mil; FII 20% do ganho na venda da cota
  (conservador; o rendimento mensal de FII é isento para pessoa física: premissa `fiiParteIsenta`);
  cripto 15% do ganho se a venda do mês passar de R$ 35 mil. Só o ganho daqui para a frente, como se
  resgatasse tudo no mês do horizonte. Prejuízo não paga.
- **Valor real**: dividido pelo IPCA esperado (Focus, por ano).

## Testes

- `npm test`: `src/lib/aion.test.ts` (carteira × regra, rendimento × CDI e IPCA, renda passiva,
  ritmo, metas), `aionSimular.test.ts` (juros compostos, IR regressivo por lote, inflação, faixa,
  isenções, resgate, premissas do Focus, olhar para trás), `aionPorques.test.ts` (tipo de cada
  explicação, sem notícia, camada de fontes) e `scripts/aion/aion.test.mjs` (fontes com fetch falso,
  limite de requisição, zip e CSV da CVM, coleta inteira, escrita e validação).
- `src/lib/aionSeries.test.ts` (patrimônio mês a mês, aportes e renda passiva por mês, base 100 sem
  aporte virar rendimento, acumulado em 12 meses, eventos do preço com fonte, caminho das metas e a
  faixa) e `src/lib/aionGlossario.test.ts` (toda tela só marca termo com verbete; verbete sem
  travessão, 2 a 3 linhas, bloco 1 a 11; "o que é" do ativo pela CVM).
- `cd e2e && npm test`: `tests/aion.spec.ts` abre as 8 telas e o ativo no tempo em 1440 e 390 (nenhum
  `[data-termo-sem-verbete]`); "O que é" e "Por quê" no hover e no toque (título, fonte, ordem no
  ativo, todo porquê da Carteira e da Economia com fonte); o clique no ativo e os marcadores de
  evento; 1 mês de dado (aviso) e o razão falso estendido para 12 meses (os gráficos crescem, sem
  aviso). Screenshots por cartão em `e2e/shots/50…52-cartao-*.png`.
- (v1) `tests/aion.spec.ts` abre as 8 telas em 1440 e 390 (sem erro de console,
  sem rolagem lateral, alvo de toque ≥ 44 px), o pop-up no hover e no toque, as escritas na cópia
  do vault e o "e se". Mercado falso em `SINAPSE_AION` temporário; posições falsas num arquivo
  próprio da cópia, apagado no fim (a Métis não as vê). Screenshots em `e2e/shots/40…44-aion-*.png`.
