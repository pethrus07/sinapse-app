# Financeiro: formato do razão e sincronização com o banco

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

- `liquidez`: `diaria` (sai no mesmo dia), `no-vencimento` (só no vencimento do título) ou `carencia`.
- `reserva: true` faz a posição contar como saldo de partida da reserva no gráfico "Reserva acumulada".
- Investimento não entra em fluxo, projeção, agenda nem nos totais a receber/pagar.

## Os seis gráficos (aba Visão)

Lógica em `src/lib/financeiroGraficos.ts`, testada em `src/lib/financeiroGraficos.test.ts`.

1. **Fluxo do mês**: entra, sai e guarda por mês; realizado (pelo `liquidadoEm`) forte, previsto fraco.
2. **Receita por cliente**: colunas empilhadas por cliente, uma coluna depois do fim do razão com
   só o estável, e a linha da receita estável. Cor fixa por cliente (pelo total no razão).
3. **A receber vencido**: entrada aberta com vencimento passado, por origem, com dias de atraso.
4. **Reserva acumulada**: guardado (pago) e programado (pago + aberto), com o piso de R$ 5.000.
   Parte da última posição de investimento com `reserva: true`; sem ela, parte de zero e avisa.
5. **Cartão parcelado**: faturas do mês de hoje em diante, tom pela `confianca`.
6. **Investimentos**: total e liquidez diária; vazio até a primeira posição.

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
9. Diário (opcional, **não instalado**): `powershell -ExecutionPolicy Bypass -File scripts\financas\instalar-tarefa.ps1`
   (07:30, escondido; `-Remover` tira).

### O que o sincronizador faz com cada transação

1. **Já importada** (mesmo `fitid`): ignora. Reimportar nunca duplica.
2. **Pendente no banco**, categoria em `ignorarCategorias` ou regra `ignorar`: ignora.
3. **Casa com um previsto aberto**: mesma direção, mesmo valor (centavo), vencimento a até ±5 dias
   (sem dia: mesmo mês), cliente e pedaço de id da regra quando houver. Liquida: `status`,
   `liquidadoEm`, `fitid`, `origem`. Dois previstos empatados sem regra que decida: **ambíguo**,
   não grava nada e volta na próxima rodada.
4. **Não casa**: vira lançamento novo, já liquidado, com descrição **montada** (meio + cliente da
   regra: "Pix recebido · Desbravando UTV"; sem regra, "Pix recebido") e categoria da regra ou
   "a classificar". Compra no cartão nunca liquida previsto (quem liquida é o pagamento da fatura).
5. **Faturas** (`/bills`) primeiro: o previsto do cartão do mês do vencimento passa a ter o valor
   medido (`confianca: medido`); fatura futura sem previsto abre um.
6. **Investimentos** (`/investments`): uma posição por aplicação por mês; `liquidez` e `reserva`
   vêm das regras (`investimentos`), senão título com vencimento vira `no-vencimento`.
7. **Trava**: antes de gravar, qualquer campo novo com cara de CPF, CNPJ, conta, cartão, e-mail ou
   telefone aborta tudo (nenhum mês é gravado). Só o bloco do mês é reescrito; o resto do arquivo
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
- `quando.direcao` (`entrada`/`saida`), `quando.viaCartao`, `quando.valor`, `quando.categoriaFonte`.
- Efeito: `cliente`, `categoria`, `descricao` (o que vai para o vault), `previsto` (pedaço do id
  do previsto que deve liquidar), `ignorar: true`.

### Testes

`npm test` (unidade: gráficos, núcleo, cliente da API com fetch falso, DPAPI de ida e volta) e
`cd e2e && npm test` (a suíte roda sobre uma cópia do vault com razão falso e estado falso).
