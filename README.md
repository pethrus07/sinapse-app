# Sinapse App

English · [Português](README.pt-BR.md)

A local web app that reads the Sinapse vault (Pedro's second brain, a folder of Markdown notes) and shows a graph, notes with links and backlinks, Fronts, Agenda, Métis (finance), Aion (investments), Overview and a page for each project. It also generates and publishes the architecture diagrams (UML, BPMN and C4) of every project.

## Status

In daily use, local (November 2026). There is no production deployment: it runs only on the dev server on Pedro's machine.

## The problem

The vault holds hundreds of notes, dozens of projects and deadlines spread across them. Markdown stays the source of truth; the app is a lens on top of it, to find, connect and decide without opening file after file. Claude writes to the vault; Pedro reads it through the app, Obsidian or VS Code.

## What it does

- Graph of the notes (size by number of connections, color by area) and note reading with wikilinks and backlinks. `[[x]]` inside code is an example and does not become a link.
- Search, a Skill Tree by domain, a study Roadmap and Projects by status.
- Fronts (`#/frentes`): at most 3 fronts in progress; the rest sit in states that take no slot. Shows each front's last commit, its hours this week, and "what I promised", read from meeting minutes (read only).
- Agenda (routine, deadlines and journal).
- **Métis** (`#/financeiro`), the finance module, named after the Greek goddess of practical wisdom and prudence. One file per month in the vault; read-only bank sync through Open Finance (Meu Pluggy) every day at 17:00. Tabs: **Overview** (cash flow, spending by category against the 3-month average, recurring vs one-off, net worth by class with the liquid reserve against the R$ 5,000 floor, clients paid vs still due, alerts), **Pronoia** (foresight: future income by client, projected reserve, card installments and the month-by-month projection) and **Entries** (the "to classify" queue, the form, the list). Internally it keeps the name `financeiro` (route, folder, data format). Format in `docs/financeiro-formato.md`.
- **Aion** (`#/aion`), the investments module (the long, continuous time of the Greeks, the time of compound interest): follow, study, project and simulate, without recommending anything. Eight screens: **Portfolio** (by type against your own rule, return vs CDI and inflation with the base stated, passive income of the month), **Whys** (why each thing moved, with source, date and kind: known cause, fact, opinion, estimate, hypothesis or "no news"), **Watchlist**, **Simulate** ("what if" and bad/base/good scenarios at 1, 3 and 5 years, in today's money and after tax), **Goals** (from the real average contribution), **Economy** (Selic, CDI, IPCA, dollar, Focus, Copom), **Study** (the 11-block learning path with progress) and **My rule**. The "why" shows on every screen as a pop-up on hover or tap. Market data only from sources whose terms allow it (Central Bank, brapi, CoinGecko, CVM), collected by `scripts/aion/` into a local cache; the browser never calls market APIs. Format in `docs/aion-formato.md`.
- Project page with tabs Overview, History (commits of the project folders), Tasks (the `- [ ]` boxes of the note) and Diagram.
- Overview (`#/panorama`): a board by status and the year line.
- Diagrams: a JSON spec in the vault becomes three diagrams in standard notation, measured by a QA step before going to each project's repository.

## Diagrams (UML, BPMN and C4)

Each project has a spec at `09-DESENHOS/specs/<id>.json` in the vault (format in [docs/desenhos-formato.md](docs/desenhos-formato.md), in Portuguese).

```bash
node scripts/validar-specs.mjs [id ...]        # checks the rules of each notation
node scripts/gerar-desenhos.mjs [id ...]       # generates 09-DESENHOS/<id>.excalidraw; skips hand-edited ones
node scripts/qa-desenhos.mjs [id ...]          # measures: arrow crossing a shape, overlapping text,
                                               # label far from its arrow, dead area and more
node scripts/destinos-desenhos.mjs             # read only: where each diagram would go and what would be refused
node scripts/publicar-desenhos.mjs [id ...]    # simulates publishing
node scripts/publicar-desenhos.mjs --commit    # writes docs/arquitetura/ in each repository and pushes
```

The publisher has three gates: a diagram with any QA finding is not published (`--forcar` only when Pedro asks); a folder whose name does not match the diagram is refused (identity lock); a spec with `"sistema": false` is not published and the diagram generated before is removed from the repository. A change to the generator only counts after QA on every diagram and an image review by two independent reviewers.

## Stack

Vite, React and TypeScript; d3-force (canvas graph); marked (Markdown); gray-matter (frontmatter); Excalidraw (Diagram tab); ELK (C4 layout); Playwright (tests and SVG export).

## Run locally

```bash
npm install
npm run dev          # indexes the vault and starts Vite at http://localhost:5173
npm run reindex      # rebuilds the index when a note changed outside the app
VAULT_PATH=/path/to/vault npm run dev   # vault somewhere else (default: ../sinapse)
```

The index goes to `src/data/*.json` (not in git). Writes to the vault (note, task, slot, journal, finance, Aion, diagram) exist only while the dev server is running. `SINAPSE_SO_LEITURA=1` starts the dev server refusing every write.

Aion (market data in a local cache, outside git and the vault):

```bash
npm run aion:simular   # fetches and prints a summary, writes nothing
npm run aion:gravar    # writes %LOCALAPPDATA%\sinapse-aion\mercado.json
powershell -ExecutionPolicy Bypass -File scripts\aion\aion-chave.ps1 -Servico brapi   # brapi token, encrypted (DPAPI)
```

## Tests

End to end tests with Playwright, in a separate package under `e2e/`:

```bash
cd e2e
npm install
npm test
```

Unit tests (`npm test` at the root, `node --test`): Métis charts and model, the bank sync, Aion (portfolio, simulation, the "whys", the collector with a fake fetch) and the diagram publishing plan.

The whole suite runs against a copy of the vault in a temporary folder, with its own Vite on port 5175. At the end it checks that `git status` of the real vault did not change, and deletes the copy. The Fronts test starts another Vite (port 5174) with a fake minutes folder.

## Folders

| Folder | What |
|---|---|
| `src/` | the app (screens in `components/`, logic in `lib/`, index format in `types.ts`) |
| `scripts/` | indexer, local API of the dev server, promises, NotebookLM importer and the diagram scripts |
| `e2e/` | Playwright tests (own package) |
| `docs/` | diagram spec format and this app's architecture (`docs/arquitetura/`) |
| `public/` | the subset fonts of the diagrams |

## Architecture

See [docs/arquitetura/](docs/arquitetura/).

## Decisions and known limits

- Markdown is the source of truth. The app never rewrites the whole frontmatter: each endpoint changes only the line it needs (slot, task).
- Meeting data (the promises) does not go into the vault or the bundle: it comes only from the local server, and "done" is stored in `~/.sinapse/`.
- No production and no login: the app assumes the owner's machine. Publishing it anywhere would need authentication first.
- Aion does not recommend: it shows data, source and date, and keeps fact, opinion and estimate apart. When no news explains a move, it says so. The simulation is arithmetic with visible assumptions, never a promised return.
- No scraping: the B3 website, Yahoo Finance, Status Invest and Fundamentus are out because of their terms. A real-time news source has not been chosen yet; the "sources of why" layer is ready for it.
- The `status` and `progresso` vocabulary comes from the vault's rules (`../sinapse/scripts/saude-vault.py`); a new value changes on both sides.

## License

MIT. See [LICENSE](LICENSE).
