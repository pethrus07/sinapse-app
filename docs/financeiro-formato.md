# Métis (financeiro): formato do razão e sincronização com o banco

> **Métis** é o nome do módulo financeiro do Sinapse (a deusa grega da sabedoria prática e da
> prudência); a visão de projeção dentro dela é a **Pronoia** (previdência): "Métis › Pronoia".
> O nome é só o que aparece na tela: pasta (`04-NEGOCIO/financeiro/`), bloco ` ```financeiro `,
> `scripts/financas/`, rota (`#/financeiro`, `#/financeiro/<aba>`) e ids continuam como estão.

O razão vive no vault, um arquivo por mês em `04-NEGOCIO/financeiro/AAAA-MM.md`, com um bloco
` ```financeiro ` que contém `{ "lancamentos": [...] }`. O app lê, soma e desenha; quem escreve é o
formulário do app (`POST /api/financeiro`) ou o sincronizador do banco (`scripts/financas/`).
**Nenhum dado real entra neste repositório**: os testes usam o razão falso de
`e2e/fixtures/financeiro-falso.ts` e as respostas falsas de `scripts/financas/fixtures/pluggy/`.

## Campos de um lançamento

| campo | o que é |
|---|---|
| `id` | único dentro do mês |
| `tipo` | `entrada`, `saida`, `reserva` (destinação, não gasto) ou `investimento` (saldo numa data) |
| `descricao` | texto limpo; nunca nome de pessoa, CPF/CNPJ, conta ou cartão |
| `valor` | número positivo |
| `vencimento` | `AAAA-MM-DD`; vazio = "neste mês, dia a definir" |
| `status` | `a-receber`, `recebido`, `a-pagar`, `pago`; `posicao` só em investimento |
| `liquidadoEm` | dia em que o dinheiro mexeu. O gráfico de fluxo conta o realizado neste mês |
| `cliente`, `categoria`, `nota`, `obs` | como sempre |
| `recorrente` | repete todo mês. Recorrente sem `ate` é **receita estável** |
| `ate` | último mês (`AAAA-MM`) de um recorrente com prazo, ex.: acordo de 6 ciclos |
| `semPrazo` | existe mas não tem cronograma: fica fora da projeção e do fluxo |
| `confianca` | `medido`, `extrapolado` ou `estimado`. Sem o campo, o app lê da `obs` ("MEDIDO", "EXTRAPOLADO", "NAO MEDIDO") |
| `origem`, `fitid` | gravados pelo sincronizador: fonte (`pluggy`) e hash de 16 caracteres do id da transação (nunca o id cru) |
| `conta` | rótulo da conta (`Nubank · conta`, `Nubank · cartão`, `Inter · conta`), nunca número |
| `viaCartao`, `fatura` | compra no cartão e o mês da fatura em que cai. **Fica fora do fluxo e das somas**: o dinheiro sai quando a fatura é paga |
| `faturaFitid` | no previsto do cartão: hash da fatura do banco que deu o valor medido |
| `pontual` | gasto que não se repete (empréstimo, compra grande) |
| `natureza` | `fixo`, `variavel` ou `pontual`: sobrescreve a natureza que vem da categoria (ver "Natureza do gasto") |

## Investimento

Uma posição por aplicação por mês, com o saldo naquela data:

```json
{
  "id": "2030-01-31-banco-x-caixinha",
  "tipo": "investimento",
  "descricao": "Caixinha da reserva",
  "instituicao": "Banco X",
  "liquidez": "diaria",
  "data": "2030-01-31",
  "valor": 5000,
  "status": "posicao",
  "reserva": true,
  "vencimento": ""
}
```

- `liquidez`: `diaria` (sai no mesmo dia), `no-vencimento` (só no vencimento do título), `carencia`
  ou `bolsa-d2` (ação, FII: vende na bolsa e o dinheiro cai em dois dias úteis).
- `classe`: `CDB`, `RDB`, `FII`, `Ação`, `ETF`, `Tesouro`, `cripto`…
- `reserva: true` faz a posição contar como saldo de partida da reserva no gráfico "Reserva acumulada".
- Investimento não entra em fluxo, projeção, agenda nem nos totais a receber/pagar.

## As abas da Métis (v2, 04/11/2026)

Lógica em `src/lib/financeiroModelo.ts`, `src/lib/financeiroAnalise.ts` e
`src/lib/financeiroGraficos.ts` (testadas em `*.test.ts`); páginas em
`src/components/MetisPaginas.tsx`, gráficos em `MetisGraficos.tsx` e `FinanceiroGraficos.tsx`.
Cada aba tem rota própria (`#/financeiro/<aba>`). Regra de tela: poucas coisas à vista, o resto em
"Mais opções" (onde mora a tabela de cada gráfico). O seletor de mês fica no topo, abaixo das abas,
e vale para Visão, Gastos, Entradas e Plano; o padrão é o último mês fechado.

1. **Visão** (`#/financeiro`): quatro números (entrou, saiu, sobrou, reserva × piso com o total
   investido), o gráfico "fixo, variável e pontual" do mês contra o mês anterior (cinza) e um aviso
   só à vista; os outros em "Mais N avisos". Ordem dos avisos (`PRIORIDADE_AVISO`): sincronização que
   falhou, autorização vencida, conexão com erro, fatura em até 5 dias, autorização perto de vencer,
   sincronização parada há mais de 3 dias, lançamentos "a classificar".
2. **Gastos** (`#/financeiro/gastos`): por categoria (barras ordenadas, cor = natureza, traço = teto
   do orçamento, "⚠ acima do teto"), fixo/variável/pontual por mês (colunas empilhadas, mês
   incompleto com "·"), comparado com o mês anterior (diferença por categoria) e a lista do mês
   agrupada por natureza e categoria, onde cada gasto pode trocar de natureza (grava `natureza`).
3. **Entradas** (`#/financeiro/entradas`): por cliente no mês (entrou × falta, pelo vencimento) com o
   vencido em aberto, e a linha do tempo dos contratos de renda que se repete (`contratosDeRenda`):
   início, fim (ou "segue") e o mês em que a renda cai (`rendaRecorrente`).
4. **Patrimônio** (`#/financeiro/patrimonio`): só a reserva contra o piso de R$ 5.000 (ou a meta do
   orçamento) e o total investido. Carteira, evolução e simulação vão para um módulo próprio de
   investimentos (ainda sem nome); a lógica de posições (`posicoesAtuais`, `patrimonio`,
   `investimentos`) fica em `src/lib` para ele reaproveitar.
5. **Pronoia** (`#/financeiro/pronoia`): o que sobra por mês daqui pra frente (renda que se repete −
   gasto que se repete), receita por cliente, reserva acumulada, cartão parcelado e a projeção mês a
   mês (tabela em "Mais opções").
6. **Plano** (`#/financeiro/plano`): orçamento do mês (teto × gasto) e a meta da reserva (quanto
   falta, ritmo de aporte, quando chega, aporte do mês). Sem `orcamento.md` a tela diz "Sem teto
   definido" e oferece "Definir tetos"; os campos nascem vazios (a referência ao lado é a mediana do
   que já saiu, só texto).
7. **Lançamentos** (`#/financeiro/lancamentos`): a fila "a classificar" sempre à vista (um toque escolhe a
   categoria; "lembrar para os próximos" grava a regra no `regras.json` LOCAL), o formulário
   (inclui **= Saldo**) e a lista (o botão **1×** marca/desmarca `pontual`).

Rótulo de categoria na tela vem de `rotuloCategoria` (`src/lib/financeiro.ts`): o id gravado
("alimentacao") não muda, a tela mostra "Alimentação".

## Natureza do gasto: fixo, variável e pontual

Todo gasto (saída paga e compra no cartão; a fatura paga fica fora) tem uma natureza, decidida em
`naturezaDe` (`src/lib/financeiroAnalise.ts`), nesta ordem:

1. o campo `natureza` do lançamento (`fixo`, `variavel` ou `pontual`), gravado pela lista de Gastos;
2. `pontual: true`;
3. saída com `recorrente: true` ("repete todo mês") é **fixo**;
4. o mapa `NATUREZA_POR_CATEGORIA` (um lugar só, testado):
   - **fixo**: moradia, casa, aluguel, condomínio, energia, luz, água, internet, telefone, celular,
     imposto(s), das, assinatura, parcela, educação, seguro, infra, plano;
   - **variável**: alimentação, comida fora, delivery, mercado, transporte, pix a pessoa física,
     vestuário, lazer, compras, farmácia, saúde, doação, família, outro, "a classificar";
   - **pontual**: empréstimo, equipamento;
5. categoria fora do mapa: **variável** (não chamar de fixo o que não se sabe).

**Gasto que se repete** (`gastoQueSeRepete`) = fixo + uma estimativa do variável, nunca o pontual:

- fixo = mediana do fixo dos meses completos (até 6);
- variável = mediana dos meses completos quando há 3 ou mais; com menos, a soma dos tetos das
  categorias variáveis do orçamento (se houver); sem teto, a mediana do que houver, marcada como
  **fraca**. Sem mês completo: "nenhum" (a tela diz que não dá para estimar).
- Mês completo = o banco cobria o mês inteiro: fora o mês de hoje, o mês em que a sincronização
  começou no meio e os meses antes dela (`mesesParciais`).
- A tela sempre diz qual base usou e com quantos meses (`data-estimativa` no HTML).

A Pronoia ("o que sobra por mês") e a "renda que se repete: até quando" usam esse número.

## Orçamento (`orcamento.md`)

`04-NEGOCIO/financeiro/orcamento.md` (`tipo: financeiro`), bloco ` ```financeiro-orcamento `:

```json
{ "tetos": { "alimentacao": 600, "transporte": 300 }, "metaReserva": 5000 }
```

- `tetos`: teto mensal por categoria (o id gravado no razão, em minúsculas). Categoria sem teto não
  aparece aqui. **Quem define é o Pedro**: o app não sugere valor.
- `metaReserva` (opcional): meta da reserva; sem ela vale o piso de R$ 5.000.
- Gravado pelo botão "Salvar tetos" (aba Plano) via `POST /api/financeiro` `{ acao: "orcamento",
  tetos, metaReserva }`: só `application/json` de origem local, caminho fixo (nada vem do
  navegador), categoria até 40 letras/números, valor no formato brasileiro; teto vazio ou 0 sai do
  arquivo. Se o arquivo existe, só o bloco é trocado.
- `POST /api/financeiro` `{ acao: "natureza", mes, id, valor }` grava (ou tira, com `valor: ""`) o
  campo `natureza` de um lançamento.

## Recorrente, pontual e retrato do patrimônio

- **Entrada recorrente** (`entradaRecorrente`): `recorrente: true` (com ou sem `ate`), ou categoria de
  contrato (`mensalidade`, `parcela`, `salario`, `assinatura`) em sequência: "parcela 3/7" no nome
  (total > 1) ou a mesma série (cliente + descrição sem o número) em 2 meses ou mais. Fica de fora:
  `pontual: true`, entrega única (`projeto`, `artes`) e parcela solta. Conta no mês em que entrou
  (aberta: no do vencimento).
- **Pontual** num gasto (`pontual: true`, `natureza: "pontual"` ou categoria pontual): não se repete
  (empréstimo, compra grande). Fica no gasto do mês, mas fora do gasto que se repete e da média das
  categorias.
- **Reserva** = posição de investimento com `reserva: true` ou de liquidez diária (a caixinha).
- `04-NEGOCIO/financeiro/patrimonio.md`, bloco ` ```patrimonio `: `{ "retratos": [{ "data",
  "total", "diaria", "porGrupo": { "<grupo>": valor } }] }`, um por dia, gravado pelo `--gravar`
  (o do mesmo dia é trocado). Nenhum id nem nome de aplicação, só totais.

## Sincronizar com o banco (Open Finance pelo Meu Pluggy)

Só leitura. Grátis para uso pessoal (até 5 conexões), atualiza 1 vez por dia, autorização de 1 ano.
Docs: https://docs.pluggy.ai/en/docs/guides/meu-pluggy-personal-use

### Passo a passo (uma vez)

1. Criar conta em **meu.pluggy.ai** e conectar o **Nubank** e o **Inter** lá (cada banco pede a
   aprovação no app dele). Um banco novo depois entra no mesmo item, sem mudar nada aqui.
2. Entrar em **dashboard.pluggy.ai** com a mesma conta. Em Applications → sua aplicação → Demo →
   Connect Account, escolher **MeuPluggy** (não o banco, não o Sandbox).
3. Copiar o **itemId** em Demo → Connected Items (o `GET /v2/items` não funciona no Meu Pluggy).
   O **Client ID** está na linha da aplicação; o **Client Secret** aparece uma vez só.
4. Gravar a credencial (o Pedro digita; ela é cifrada com DPAPI do usuário do Windows):
   ```
   powershell -ExecutionPolicy Bypass -File scripts\financas\pluggy-credencial.ps1 -ItemId <itemId>
   ```
   Arquivo: `%LOCALAPPDATA%\sinapse-financas\pluggy.cred`. Só esta conta, nesta máquina, abre.
   `-Remover` apaga.
5. Testar sem baixar transação: `npm run financas:testar` (lista as contas com os 4 últimos dígitos,
   o status do item e quando a autorização vence).
6. Copiar `scripts/financas/regras.exemplo.json` para
   `%LOCALAPPDATA%\sinapse-financas\regras\regras.json` e trocar pelos clientes de verdade.
7. Simular: `npm run financas:simular` (padrão; não grava nada). Revisar o relatório.
8. Gravar: `npm run financas:gravar`. Depois, revisar no app (Lançamentos, categoria
   "a classificar") e fazer o commit do vault.
9. Diário (**instalado em 03/11/2026, 17:00**, tarefa `Metis-Sincronizar`): `powershell -ExecutionPolicy Bypass -File scripts\financas\instalar-tarefa.ps1 -Hora 17:00`
   (escondido; `-Remover` tira). Roda `--gravar --commitar`: depois de gravar, `git add` e `git commit` no
   vault **só** dos `04-NEGOCIO/financeiro/AAAA-MM.md` que escreveu ("Razão: sincronização do banco de
   DD/MM") e `git push`. Nada gravado: nada commitado. Pre-commit que barra (o `git add` é desfeito) ou push
   que falha vão para o log. Vault no meio de rebase, merge, cherry-pick ou com conflito: não commita (o razão
   fica gravado; a rodada seguinte commita). "Hoje" e o dia de cada transação são de São Paulo, não UTC.

### O que o sincronizador faz com cada transação

1. **Já importada** (mesmo `fitid`): ignora. Reimportar nunca duplica.
2. **Pendente no banco**, categoria em `ignorarCategorias` ou regra `ignorar`: ignora.
3. **Casa com um previsto aberto**: mesma direção, mesmo valor (centavo), vencimento a até ±5 dias
   (sem dia: mesmo mês; com `previsto` na regra, qualquer mês, na ordem das parcelas), cliente e
   pedaço de id da regra quando houver. Liquida: `status`, `liquidadoEm`, `fitid`, `origem`. Dois
   previstos empatados sem regra que decida: **ambíguo**, não grava nada e volta na próxima rodada.
   As transações são processadas da mais antiga para a mais nova.
   - **Já lançado à mão** (`recebido`/`pago` sem `fitid`): se a regra diz o cliente ou o previsto,
     ele também é candidato (distância pelo vencimento ou pelo `liquidadoEm`). É **conciliado**:
     ganha `fitid`, `origem` e o `liquidadoEm` do banco, e não vira lançamento em dobro.
   - **Soma**: sem um de mesmo valor, um Pix pode pagar de 2 a 6 lançamentos do(s) cliente(s) da
     regra (`clientes`) que somam o valor no centavo (ex.: parcela + etapa no mesmo envio).
   - **`valorLivre`** (com `previsto`): o previsto aberto mais perto é liquidado com o valor do
     banco (o previsto antigo fica em `valorPrevisto`). Feito para o pagamento da fatura.
   - **Divergente**: a regra diz o cliente, há lançamento dele sem banco na janela, mas nada fecha.
     Não grava; o relatório mostra o que há no razão para o Pedro corrigir o valor ou lançar o que falta.
   - **Estorno**: entrada com regra `estorno: true` anula uma saída de mesmo valor, mesma conta, até
     `diasEstorno` (padrão 3) dias de distância, ainda não importada. As duas saem do fluxo; estorno
     parcial segue como lançamento com a categoria da regra.
   - **Acumula** (`acumula: true` + `previsto`): vários Pix pagam um previsto só do mesmo mês (ex.:
     contribuição mensal em partes). Fecha quando a soma chega no previsto, ou, se o mês já passou,
     fecha com o valor real e guarda o previsto em `valorPrevisto`. Os `fitids` de todos os Pix ficam
     no lançamento. Mês corrente sem fechar: aparece em "acumulando" e não grava.
4. **Não casa**: vira lançamento novo, já liquidado, com descrição **montada** (meio + cliente da
   regra: "Pix recebido · Cliente Alfa"; sem regra, "Pix recebido") e categoria da regra ou
   "a classificar". Compra no cartão nunca liquida previsto (quem liquida é o pagamento da fatura).
5. **Faturas** (`/bills`) primeiro: o previsto do cartão do mês do vencimento passa a ter o valor
   medido (`confianca: medido`); fatura futura sem previsto abre um.
6. **Investimentos** (`/investments`): uma posição por aplicação por mês; `liquidez` e `reserva`
   vêm das regras (`investimentos`). Sem regra, o normalizador preenche `instituicao` (emissor pelo
   nome, ou a corretora do banco da conexão: Nubank → Nu Invest), `classe` (CDB, FII, Ação…) e
   `liquidez`: CDB/RDB sem vencimento ou do Nubank → `diaria`; outro título → `no-vencimento`;
   ação/FII → `bolsa-d2`. Mudou instituição, liquidez ou descrição: a posição do mês é regravada no lugar.
7. **Nome de pessoa**: o nome do pagador/recebedor sem CNPJ e o do titular ficam só em memória; cada
   palavra deles sai da descrição e da conta gravadas, mesmo que uma regra os tenha escrito.
8. **Trava**: antes de gravar, qualquer campo novo com cara de CPF (cru, formatado ou mascarado), CNPJ,
   conta, cartão, e-mail, telefone ou chave Pix aleatória aborta tudo (nenhum mês é gravado). Só o bloco do mês é reescrito; o resto do arquivo
   (e o CRLF) fica.

Fora do git, em `%LOCALAPPDATA%\sinapse-financas\`: `pluggy.cred`, `regras\regras.json`,
`bruto\pluggy\AAAA-MM-DD\*.json` (resposta crua da API, só no `--gravar`), `estado.json`
(status e vencimento da autorização, sem ids) e `logs\AAAA-MM.log`. O índice do app lê o
`estado.json`: 30 dias antes de a autorização vencer aparece um aviso na Visão e uma data na Agenda.

### Regras (`regras.json`)

Ver `scripts/financas/regras.exemplo.json`. A primeira regra que casa decide.

- `quando.texto`: procura, sem acento e sem maiúscula, na descrição do banco, no nome de quem
  pagou/recebeu e no estabelecimento (esse texto fica só na memória).
- `quando.documento`: CPF/CNPJ de quem pagou/recebeu, só dígitos (o arquivo de regras fica fora do git).
- `quando.direcao` (`entrada`/`saida`), `quando.viaCartao`, `quando.valor`, `quando.categoriaFonte`,
  `quando.meio` (`pix`, `debito`…) e `quando.contraparte` (`pf`, `pj` ou `''` sem documento: só o tipo).
- Efeito: `cliente`, `categoria`, `descricao` (o que vai para o vault), `previsto` (pedaço do id
  do previsto que deve liquidar), `ignorar: true`.
- Casamento: `clientes` (lista de clientes que o mesmo pagador pode estar pagando; `cliente` segue
  sendo o rótulo do lançamento novo), `toleranciaDias` (janela só desta regra), `valorLivre`,
  `estorno`, `diasEstorno` e `acumula` (ver acima).

### Testes

`npm test` (unidade: gráficos, núcleo, cliente da API com fetch falso, DPAPI de ida e volta) e
`cd e2e && npm test` (a suíte roda sobre uma cópia do vault com razão falso e estado falso).
