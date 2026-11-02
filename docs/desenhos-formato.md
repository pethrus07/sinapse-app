# Formato das especificações de desenho (versão 2)

Cada `specs/<id-da-nota>.json` gera `09-DESENHOS/<id>.excalidraw` com três diagramas, cada um numa
notação padrão de mercado (a mesma estudada na faculdade, 2026.2):

| bloco | notação | pergunta que responde |
|---|---|---|
| `casosDeUso` | **UML 2.5 — diagrama de casos de uso** | quem usa o sistema e para quê |
| `processo` | **BPMN 2.0 — diagrama de processo** | como o caso principal acontece, passo a passo, e quem faz cada passo |
| `arquitetura` | **Modelo C4 — nível 2 (containers)** | de que peças o sistema é feito, em que tecnologia, e com quem fala |

Gerador: `sinapse-app/scripts/gerar-desenhos.mjs` (só gera desenho que não foi editado à mão).

## Esqueleto

```json
{
  "versao": 2,
  "nota": "hermes",
  "titulo": "Hermes · propostas de freela no 99Freelas",
  "resumo": "Uma ou duas frases: o que é e para quem.",

  "casosDeUso": {
    "sistema": "Hermes",
    "atores": [
      { "id": "pedro", "nome": "Pedro", "tipo": "humano" },
      { "id": "site", "nome": "99Freelas", "tipo": "sistema" },
      { "id": "relogio", "nome": "Agendador do Windows", "tipo": "tempo" }
    ],
    "casos": [
      { "id": "buscar", "nome": "Buscar projetos novos" },
      { "id": "avaliar", "nome": "Avaliar e precificar o projeto" }
    ],
    "associacoes": [ { "ator": "relogio", "caso": "buscar" } ],
    "relacoes": [ { "de": "buscar", "para": "avaliar", "tipo": "include" },
                  { "de": "x", "para": "y", "tipo": "extend", "condicao": "nota baixa" } ]
  },

  "processo": {
    "nome": "Do projeto novo à proposta enviada",
    "raias": [ { "id": "hermes", "nome": "Hermes (automático)" }, { "id": "pedro", "nome": "Pedro" } ],
    "externos": [ { "id": "site", "nome": "99Freelas" } ],
    "elementos": [
      { "id": "i",  "tipo": "inicio-timer",    "nome": "A cada 30 min",        "raia": "hermes" },
      { "id": "t1", "tipo": "tarefa",          "nome": "Buscar projetos novos", "raia": "hermes" },
      { "id": "g1", "tipo": "gateway",         "nome": "Passa no filtro?",      "raia": "hermes" },
      { "id": "f1", "tipo": "fim",             "nome": "Descartado",            "raia": "hermes" }
    ],
    "fluxos":    [ { "de": "i", "para": "t1" }, { "de": "t1", "para": "g1" }, { "de": "g1", "para": "f1", "rotulo": "Não" } ],
    "mensagens": [ { "de": "t1", "para": "site", "rotulo": "lê a busca" } ]
  },

  "arquitetura": {
    "sistema": "Hermes",
    "pessoas":    [ { "id": "pedro", "nome": "Pedro", "descricao": "Revisa e envia as propostas" } ],
    "containers": [ { "id": "ciclo", "nome": "Ciclo", "tecnologia": "Node.js + Playwright", "descricao": "Busca, avalia e escreve", "tipo": "job" },
                    { "id": "dados", "nome": "Dados locais", "tecnologia": "JSON / JSONL", "descricao": "Fila, propostas, métricas", "tipo": "banco" } ],
    "externos":   [ { "id": "claude", "nome": "Claude", "descricao": "Avalia e escreve o texto" } ],
    "relacoes":   [ { "de": "ciclo", "para": "dados", "rotulo": "grava", "tecnologia": "arquivo" } ]
  }
}
```

## Regras de cada notação

**Casos de uso (UML).** 2 a 6 atores; 3 a 9 casos, nome começando por verbo no infinitivo
("Emitir certificado", não "Certificado"). `tipo` do ator: `humano`, `sistema` (aparece com
«sistema») ou `tempo` (gatilho agendado). Toda associação liga ator a caso. `include` = o caso
sempre usa o outro; `extend` = acontece só na `condicao`. Caso sem ator nem relação não entra.

**Processo (BPMN).** Uma raia por quem executa (pessoa, papel ou o próprio sistema), 1 a 4 raias.
`tipo` ∈ `inicio` · `inicio-timer` · `inicio-mensagem` · `tarefa` · `gateway` (exclusivo, decisão em
pergunta terminada em "?") · `fim`. 5 a 14 elementos. Exatamente um início; pelo menos um fim. Toda
saída de gateway tem `rotulo` ("Sim", "Não", "Correção"…). Laço de volta é permitido (fluxo para
elemento anterior). `externos` = pool fechado (cliente, site, API) que só troca mensagens; `mensagens`
ligam um elemento do processo a uma TAREFA ou evento (nunca a um gateway) e a um externo (ou o
contrário). Tarefa com `"multiplo": "paralelo"` é multi-instância: várias cópias ao mesmo tempo, uma
por item (três barras em pé no pé da tarefa); use para frentes paralelas em vez de desenhá-las em
sequência.

**Arquitetura (C4, nível 2).** `containers` são as peças que rodam ou guardam dados *dentro* do
sistema: app web, API, worker, job agendado, app mobile, banco, fila, arquivo. `tipo` ∈ `app` ·
`api` · `job` · `banco` (banco de dados de verdade: SQL, D1, Postgres…) · `arquivos` (pasta, JSON,
Markdown, CSV, imagens que o sistema lê/grava) · `mobile`. Biblioteca, thread, API do navegador,
arquivo de configuração e chave **não** são container: entram na `tecnologia` de quem os usa.
Sempre com `tecnologia` real (lida do código). 2 a 7 containers,
0 a 4 pessoas, 0 a 5 externos. Toda relação tem `rotulo` (verbo curto) e, quando houver,
`tecnologia` (HTTPS, SQL, arquivo, Modbus…). Sem container órfão.

**Texto.** Português, curto: nome de ator/caso/tarefa até 40 caracteres; descrição até 60.
Nada sensível: sem IP, senha, token, CPF, endereço, nome de cliente pessoa física. Ator é papel
("Analista de QA", "Dono do padrão"), não nome de pessoa, quando o repositório pode ficar público.

## Campos de controle (01/11/2026)

| campo | o que faz |
|---|---|
| `"pastas": ["retifica-os"]` | pastas que podem receber o desenho além das que já têm o nome dele (título ou id). A trava de identidade do publicador recusa qualquer outra, mesmo que o `pastas:` da nota mande. Spec sem nota própria no vault vai só para estas. |
| `"sistema": false` + `"motivo"` | projeto sem sistema (arte, documento, perfil, cofre pessoal, arquivo morto). Não gera nem publica; o publicador tira o `docs/arquitetura` gerado de lá. A spec fica só com `versao`, `nota`, `titulo`, `sistema` e `motivo`. |
| `"vistas": ["c4"]` | desenha só parte das três vistas (`uml`, `bpmn`, `c4`), na ordem. As vistas fora da lista não são conferidas. |

## Medidas do qa-desenhos (calibradas em 01/11/2026)

Além de seta atravessando forma, texto sobreposto, linha cortando texto, trilho, colada, raspa,
vaza e escapa:

- `longe`: rótulo a mais de 16 px da própria seta, medido do texto que o olho vê (largura média medida
  da fonte, não a caixa estimada). Nos 56 desenhos de 29/10 o pior rótulo de cada um ficava a 18-25 px
  (todos reprovariam); com o rótulo apertado ficou em 8-13 px.
- `ambíguo`: rótulo 6 px ou mais perto de outra seta do que da dele.
- `morto`: área útil abaixo de UML 0,60, BPMN 0,50, C4 0,50. Área útil = fração do retângulo da vista
  que fica a até 48 px de forma ou texto (seta não conta; raia, pool e fronteira contam só pela
  moldura). Em 29/10: UML 0,72-0,98, BPMN 0,59-0,86, C4 em pé 0,39-0,80 (8 abaixo de 0,50).

