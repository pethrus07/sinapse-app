// Leva o desenho de cada projeto para o repositório do próprio projeto:
//   <pasta do projeto>/docs/arquitetura/<id>.excalidraw   (editável: excalidraw.com ou extensão do VS Code)
//   <pasta do projeto>/docs/arquitetura/<id>.svg          (o GitHub mostra direto)
//   <pasta do projeto>/docs/arquitetura/README.md         (o que é cada diagrama)
// A pasta vem do frontmatter `pastas:` da nota. A fonte da verdade continua no vault (09-DESENHOS);
// rodar de novo atualiza as cópias. Precisa do dev server no ar (o SVG sai do próprio Excalidraw).
//
// Uso:  node scripts/publicar-desenhos.mjs [id ...]            → só simula (lista o que faria)
//       node scripts/publicar-desenhos.mjs [id ...] --gravar   → grava os arquivos
//       node scripts/publicar-desenhos.mjs [id ...] --commit   → grava, commita SÓ docs/arquitetura e dá push
// Variáveis: SINAPSE_URL (padrão http://localhost:5173), VAULT_PATH, PROJETOS_PATH.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.VAULT_PATH || path.resolve(AQUI, "../../sinapse");
const PROJETOS = process.env.PROJETOS_PATH || path.join(os.homedir(), "Projetos");
const URL_APP = process.env.SINAPSE_URL || "http://localhost:5173";
const args = process.argv.slice(2);
const gravar = args.includes("--gravar") || args.includes("--commit");
const commitar = args.includes("--commit");
const pedidas = args.filter((a) => !a.startsWith("--"));

const git = (dir, a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const raizGit = (dir) => { try { return git(dir, ["rev-parse", "--show-toplevel"]); } catch { return null; } };

const notas = JSON.parse(fs.readFileSync(path.resolve(AQUI, "../src/data/notes.json"), "utf8"));
const specsDir = path.join(VAULT, "09-DESENHOS", "specs");
const ids = fs.readdirSync(specsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((i) => !pedidas.length || pedidas.includes(i));

// destino: pasta -> lista de { id, spec }
const destinos = new Map();
const semPasta = [];
for (const id of ids) {
  const nota = notas.find((n) => n.id === id);
  // `pastasProjeto` vale para todo projeto; `pastas` o índice só preenche nas frentes em andamento
  const pastas = nota?.pastasProjeto || nota?.pastas || [];
  if (!pastas.length) { semPasta.push(id); continue; }
  const spec = JSON.parse(fs.readFileSync(path.join(specsDir, id + ".json"), "utf8"));
  for (const p of pastas) {
    const dir = path.join(PROJETOS, p);
    if (!fs.existsSync(dir)) { console.log(`  ${id}: pasta ${p} não existe`); continue; }
    if (!destinos.has(dir)) destinos.set(dir, []);
    destinos.get(dir).push({ id, spec });
  }
}

const readme = (itens) => [
  "# Arquitetura",
  "",
  "Diagramas gerados a partir do Sinapse (o segundo cérebro do Pedro). Cada projeto tem três vistas,",
  "cada uma numa notação padrão:",
  "",
  "1. **Quem usa e para quê**: UML, diagrama de casos de uso.",
  "2. **O processo principal**: BPMN 2.0, com raias por quem executa.",
  "3. **A arquitetura**: modelo C4, nível 2 (containers).",
  "",
  ...itens.flatMap(({ id, spec }) => [
    `## ${spec.titulo}`,
    "",
    spec.resumo,
    "",
    `![${spec.titulo}](./${id}.svg)`,
    "",
    `Editável: [\`${id}.excalidraw\`](./${id}.excalidraw), abre em [excalidraw.com](https://excalidraw.com) ou no VS Code com a extensão Excalidraw.`,
    "",
  ]),
  "A fonte destes arquivos é o vault do Sinapse (`09-DESENHOS/`); alterações feitas aqui são sobrescritas na próxima publicação.",
  "",
].join("\n");

let navegador = null, pagina = null;
async function svgDe(id) {
  if (!pagina) {
    const { chromium } = await import(pathToFileURL(path.resolve(AQUI, "../e2e/node_modules/playwright/index.mjs")).href);
    navegador = await chromium.launch();
    pagina = await navegador.newPage();
    await pagina.goto(URL_APP + "/exportar.html");
    await pagina.waitForFunction(() => window.pronto === true, null, { timeout: 120000 });
  }
  return pagina.evaluate((n) => window.exportarSvg(n), id);
}

const relatorio = [];
for (const [dir, itens] of destinos) {
  const raiz = raizGit(dir);
  const rel = path.relative(PROJETOS, dir);
  const alvo = path.join(dir, "docs", "arquitetura");
  if (!gravar) { relatorio.push(`${rel.padEnd(42)} ${raiz ? "git" : "SEM GIT"}  ← ${itens.map((i) => i.id).join(", ")}`); continue; }
  fs.mkdirSync(alvo, { recursive: true });
  for (const { id } of itens) {
    fs.copyFileSync(path.join(VAULT, "09-DESENHOS", id + ".excalidraw"), path.join(alvo, id + ".excalidraw"));
    fs.writeFileSync(path.join(alvo, id + ".svg"), await svgDe(id));
  }
  fs.writeFileSync(path.join(alvo, "README.md"), readme(itens));
  let estado = "gravado";
  if (commitar && raiz) {
    const caminho = path.relative(raiz, alvo).replace(/\\/g, "/");
    git(raiz, ["add", "--", caminho]);
    const mudou = git(raiz, ["diff", "--cached", "--name-only", "--", caminho]);
    if (!mudou) estado = "sem mudança";
    else {
      git(raiz, ["commit", "-q", "-m", "docs: diagramas de arquitetura (UML, BPMN e C4)", "--", caminho]);
      estado = "commitado";
      let remoto = "";
      try { remoto = git(raiz, ["remote"]); } catch { /* sem remoto */ }
      if (remoto) { try { git(raiz, ["push", "-q"]); estado += " e enviado"; } catch (e) { estado += ` (push falhou: ${String(e.stderr || e.message).split("\n")[0]})`; } }
      else estado += " (sem remoto)";
    }
  } else if (commitar) estado += " (pasta sem git)";
  relatorio.push(`${rel.padEnd(42)} ${estado}  ← ${itens.map((i) => i.id).join(", ")}`);
}
if (navegador) await navegador.close();
console.log(relatorio.join("\n"));
if (semPasta.length) console.log(`\nsem pasta de projeto (ficam só no Sinapse): ${semPasta.join(", ")}`);
console.log(`\n${destinos.size} pasta(s)${gravar ? "" : " — simulação; use --gravar ou --commit"}`);
