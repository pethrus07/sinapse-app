# Métis (financeiro): formato do razão e sincronização com o banco

> **Métis** é o nome do módulo financeiro do Sinapse (a deusa grega da sabedoria prática e da
> prudência); a visão de projeção dentro dela é a **Pronoia** (previdência): "Métis › Pronoia".
> O nome é só o que aparece na tela: pasta (`04-NEGOCIO/financeiro/`), bloco ` ```financeiro `,
> `scripts/financas/`, rota (`#/financeiro`, `#/financeiro/pronoia`) e ids continuam como estão.

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

## As abas da Métis

Lógica em `src/lib/financeiroGraficos.ts` e `src/lib/financeiroAnalise.ts` (testadas em
`*.test.ts`); páginas em `src/components/MetisPaginas.tsx`.

**Visão** (o mês e o que já aconteceu), com os avisos no topo: fatura que vence nos próximos 5 dias,
autorização do Open Finance perto de vencer, sincronização que falhou (`ultimaFalha` no
`estado.json`) ou parou há mais de 3 dias, e lançamentos "a classificar".

1. **Fluxo do mês**: entra, sai e guarda por mês; realizado (pelo `liquidadoEm`) forte, previsto fraco.
2. **Gastos por categoria** (mês escolhido no seletor): saída paga + compra no cartão (a fatura paga
   fica fora, senão dobraria), com a média dos 3 meses completos antes do mês (sem pontuais; o mês em
   que o banco começou no meio fica fora) e o destaque do que fugiu (± R$ 50 e 30%). Clicar abre os
   lançamentos da categoria.
3. **Renda que se repete: até quando** (`rendaRecorrente`): a renda recorrente de cada mês, de hoje
   até o mês depois do fim do razão (onde sobra só o que não tem data de fim), contra o gasto que se
   repete (média dos meses completos), e o mês da queda (primeiro mês com 20% ou mais a menos que
   hoje). Embaixo, o mês em foco: gasto que se repete, pontual e sobra.
4. **Gastos por categoria** (ver 2), **Patrimônio**: posições por grupo (CDB liquidez diária, renda
   fixa, FII, ação, cripto), reserva líquida (só `liquidez: diaria`) × piso de R$ 5.000 e a evolução
   pelos retratos de `patrimonio.md`.
5. **A receber vencido**: entrada aberta com vencimento passado, por origem, com dias de atraso.
6. **Fontes de renda: recebido × o que falta**: recebido, quando, dias de atraso (vencimento ×
   `liquidadoEm`) e o que falta até o fim; recorrente sem `ate` (salário) aparece como "sem fim".

Rótulo de categoria na tela vem de `rotuloCategoria` (`src/lib/financeiro.ts`): o id gravado
("alimentacao") não muda, a tela mostra "Alimentação".

**Pronoia** (previdência: o que vem pela frente; `#/financeiro/pronoia`):

1. **Receita por cliente**: colunas empilhadas por cliente, uma coluna depois do fim do razão com
   só o estável, e a linha da receita estável. Cor fixa por cliente (pelo total no razão).
2. **Reserva acumulada**: guardado (pago) e programado (pago + aberto), com o piso de R$ 5.000.
   Parte da última posição de investimento com `reserva: true`; sem ela, parte de zero e avisa.
3. **Cartão parcelado**: faturas do mês de hoje em diante, tom pela `confianca`.
4. **Projeção mês a mês** (tabela).

**Lançamentos**: a fila "a classificar" (um toque escolhe a categoria; "lembrar para os próximos"
grava a regra no `regras.json` LOCAL pelo endpoint do dev server, a partir da transação crua do
bruto, nunca no repo nem no vault), o formulário (inclui **= Saldo**: investimento lançado à mão,
como cripto, com instituição livre e classe; o mais recente de cada nome vale) e a lista (o botão
**1×** marca/desmarca `pontual`).

## Recorrente, pontual e retrato do patrimônio

- **Entrada recorrente** (`entradaRecorrente`): `recorrente: true` (com ou sem `ate`), ou categoria de
  contrato (`mensalidade`, `parcela`, `salario`, `assinatura`) em sequência: "parcela 3/7" no nome
  (total > 1) ou a mesma série (cliente + descrição sem o número) em 2 meses ou mais. Fica de fora:
  `pontual: true`, entrega única (`projeto`, `artes`) e parcela solta. Conta no mês em que entrou
  (aberta: no do vencimento).
- **Gasto recorrente**: todo gasto (cartão, casa, ônibus, contribuição) menos o `pontual: true`.
- `pontual: true` num lançamento de saída: gasto que não se repete (empréstimo, compra grande). Fica
  no gasto do mês, mas fora do gasto recorrente e da média das categorias.
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
