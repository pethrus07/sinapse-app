# Sinapse App

[English](README.md)

App web local que lê o vault de notas em Markdown do Sinapse (o segundo cérebro do Pedro) e mostra grafo, notas com links e backlinks, Frentes, Agenda, Financeiro, Panorama e a página de cada projeto. Também gera e publica os diagramas de arquitetura (UML, BPMN e C4) de todos os projetos.

## Status

Em uso diário, local (novembro de 2026). Não tem produção: roda só no dev server da máquina do Pedro.

## O problema

O vault tem centenas de notas, dezenas de projetos e prazos espalhados. O Markdown continua sendo a fonte da verdade; o app é uma lente por cima, para achar, ligar e decidir sem abrir arquivo por arquivo. Quem escreve no vault é o Claude; o Pedro lê pelo app, pelo Obsidian ou pelo VS Code.

## O que faz

- Grafo das notas (tamanho pelo número de conexões, cor por área) e leitura de nota com wikilinks e backlinks. `[[x]]` dentro de código é exemplo e não vira link.
- Busca nas notas, Skill Tree por domínio, Roadmap de estudo e Projetos por status.
- Frentes (`#/frentes`): no máximo 3 frentes em andamento; o resto fica em estados que não ocupam vaga. Mostra o último commit e as horas da semana de cada frente, e "o que prometi" lido das atas de reunião (só leitura).
- Agenda (rotina, prazos e diário) e Financeiro (um arquivo por mês).
- Página do projeto com abas Visão geral, História (commits das pastas do projeto), Tarefas (as caixas `- [ ]` da nota) e Desenho.
- Panorama (`#/panorama`): quadro por status e a linha do ano.
- Desenhos: de uma especificação em JSON no vault saem três diagramas em notação padrão, medidos por um QA antes de ir para o repositório de cada projeto.

## Stack

Vite, React e TypeScript; d3-force (grafo em canvas); marked (Markdown); gray-matter (frontmatter); Excalidraw (aba Desenho); ELK (layout do C4); Playwright (testes e exportação dos SVG).

## Rodar localmente

```bash
npm install
npm run dev          # indexa o vault e sobe o Vite em http://localhost:5173
npm run reindex      # regenera o índice quando uma nota mudou fora do app
VAULT_PATH=/caminho/do/vault npm run dev   # vault em outro lugar (padrão: ../sinapse)
```

O índice vai para `src/data/*.json` (fora do git). As escritas no vault (nota, tarefa, vaga, diário, financeiro, desenho) só existem com o dev server no ar.

## Testes

Testes de ponta a ponta com Playwright, num pacote próprio em `e2e/`:

```bash
cd e2e
npm install
npm test
```

A suíte inteira roda contra uma cópia do vault numa pasta temporária, com um Vite próprio na porta 5175. No fim ela confere que o `git status` do vault real não mudou e apaga a cópia. O teste das Frentes sobe outro Vite (porta 5174) com um Atas falso.

## Desenhos (UML, BPMN e C4)

Cada projeto tem uma especificação em `09-DESENHOS/specs/<id>.json` no vault (formato em [docs/desenhos-formato.md](docs/desenhos-formato.md)).

```bash
node scripts/validar-specs.mjs [id ...]        # confere as regras de cada notação
node scripts/gerar-desenhos.mjs [id ...]       # gera 09-DESENHOS/<id>.excalidraw; pula o editado à mão
node scripts/qa-desenhos.mjs [id ...]          # mede: seta atravessando forma, texto sobreposto,
                                               # rótulo longe da seta, área morta e outros
node scripts/destinos-desenhos.mjs             # só lê: para onde cada desenho iria e o que seria recusado
node scripts/publicar-desenhos.mjs [id ...]    # simula a publicação
node scripts/publicar-desenhos.mjs --commit    # grava docs/arquitetura/ em cada repositório e dá push
```

O publicador tem três portões: desenho com achado no QA não sai (`--forcar` só a pedido do Pedro); pasta cujo nome não bate com o desenho é recusada (trava de identidade); spec com `"sistema": false` não publica e o diagrama gerado antes sai do repositório. Mudança no gerador só vale depois do QA em todos os desenhos e de revisão por imagem com dois revisores independentes.

## Pastas

| Pasta | O quê |
|---|---|
| `src/` | o app (telas em `components/`, lógica em `lib/`, formato do índice em `types.ts`) |
| `scripts/` | indexador, API local do dev server, compromissos, importador do NotebookLM e os scripts dos desenhos |
| `e2e/` | testes Playwright (pacote próprio) |
| `docs/` | formato das especificações de desenho e a arquitetura deste app (`docs/arquitetura/`) |
| `public/` | as fontes recortadas dos diagramas |

## Arquitetura

Ver [docs/arquitetura/](docs/arquitetura/).

## Decisões e limites conhecidos

- O Markdown é a fonte da verdade. O app nunca reescreve o frontmatter inteiro: cada endpoint troca só a linha que precisa (vaga, tarefa).
- Dado de reunião (as promessas) não vai para o vault nem para o bundle: vem só do servidor local e o "feito" fica em `~/.sinapse/`.
- Sem produção e sem login: o app pressupõe a máquina do dono. Publicar em algum lugar exigiria autenticação antes.
- O vocabulário de `status` e `progresso` vem da régua do vault (`../sinapse/scripts/saude-vault.py`); valor novo muda nos dois lados.

## Licença

Todos os direitos reservados.
