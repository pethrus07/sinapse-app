// Leva o desenho de cada projeto para o repositório do próprio projeto:
//   <pasta do projeto>/docs/arquitetura/<nome>.excalidraw   (editável: excalidraw.com ou extensão do VS Code)
//   <pasta do projeto>/docs/arquitetura/<nome>-1-casos-de-uso.svg, -2-processo.svg, -3-arquitetura.svg
//                                                            (um por diagrama, cortado no conteúdo; o GitHub mostra direto)
//   <pasta do projeto>/docs/arquitetura/README.md           (o que é cada diagrama)
// <nome> sai do título que o leitor vê no diagrama ("Cortex Analytics · ..." vira cortex-analytics), não
// do id da nota, que às vezes é histórico (desafio-tecnico-dev-, relatorio-servi-o-csfiltros). Arquivo
// com o nome antigo é renomeado, nunca apagado.
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

// nome fixado à mão quando o título não serve: "Estudo de caso · ..." daria o mesmo nome para dois
// projetos, e "Stela 4.0" / "No bailado da sanfona" dão nomes que ninguém procuraria
const NOMES = { "estudo-tv-aoc": "estudo-tv-aoc", "galeria-pessoal": "estudo-galeria-ia", stela: "stela", "bailado-da-sanfona": "bailado-da-sanfona" };
const nomeDe = (id, spec) =>
  NOMES[id] ||
  spec.titulo.split(" · ")[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// README de docs/arquitetura: o mesmo modelo em todo repositório, curto e sem jargão de ferramenta
const readme = (itens) => [
  "# Arquitetura",
  "",
  itens.length > 1
    ? `Diagramas de ${itens.length} sistemas ligados a este repositório. Cada um tem três vistas, cada vista numa notação padrão.`
    : "Três vistas do sistema, cada uma numa notação padrão.",
  "",
  "| Vista | Notação | Responde |",
  "|---|---|---|",
  "| 1. Casos de uso | UML | Quem usa e para quê |",
  "| 2. Processo | BPMN 2.0 | Como o trabalho anda, com uma raia para cada quem executa |",
  "| 3. Arquitetura | C4, nível 2 | De que partes o sistema é feito e com quem conversa |",
  "",
  ...itens.flatMap(({ nome, spec }) => {
    const sistema = spec.titulo.split(" · ")[0];
    return [
      `## ${spec.titulo}`,
      "",
      spec.resumo,
      "",
      "### 1. Quem usa e para quê",
      "",
      `![Casos de uso de ${sistema}](./${nome}-1-casos-de-uso.svg)`,
      "",
      `### 2. ${spec.processo?.nome || "Processo principal"}`,
      "",
      `![Processo de ${sistema}](./${nome}-2-processo.svg)`,
      "",
      "### 3. Arquitetura",
      "",
      `![Arquitetura de ${sistema}](./${nome}-3-arquitetura.svg)`,
      "",
      `Para editar: [${nome}.excalidraw](./${nome}.excalidraw), que abre em [excalidraw.com](https://excalidraw.com) ou na extensão Excalidraw do VS Code.`,
      "",
    ];
  }),
  "## De onde vêm",
  "",
  "Os diagramas são gerados a partir do Sinapse, o vault onde o Pedro organiza notas e projetos. Mudança feita direto aqui some na próxima publicação: o lugar de mudar é a especificação no Sinapse.",
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
  return pagina.evaluate((n) => window.exportarPartes(n), id);
}

const relatorio = [];
for (const [dir, itens] of destinos) {
  const raiz = raizGit(dir);
  const rel = path.relative(PROJETOS, dir);
  const alvo = path.join(dir, "docs", "arquitetura");
  if (!gravar) { relatorio.push(`${rel.padEnd(42)} ${raiz ? "git" : "SEM GIT"}  ← ${itens.map((i) => `${i.id} (${nomeDe(i.id, i.spec)})`).join(", ")}`); continue; }
  fs.mkdirSync(alvo, { recursive: true });
  const VISTAS = ["1-casos-de-uso", "2-processo", "3-arquitetura"];
  for (const item of itens) {
    const { id, spec } = item;
    const nome = (item.nome = nomeDe(id, spec));
    // nome antigo (o id da nota) vira o novo: renomeia em vez de apagar, e o git registra como renomeação
    if (nome !== id) {
      for (const [velho, novo] of [[`${id}.excalidraw`, `${nome}.excalidraw`], ...VISTAS.map((v) => [`${id}-${v}.svg`, `${nome}-${v}.svg`])]) {
        const de = path.join(alvo, velho), para = path.join(alvo, novo);
        if (fs.existsSync(de) && !fs.existsSync(para)) fs.renameSync(de, para);
      }
    }
    fs.copyFileSync(path.join(VAULT, "09-DESENHOS", id + ".excalidraw"), path.join(alvo, nome + ".excalidraw"));
    const partes = await svgDe(id);
    if (partes.length !== 3) throw new Error(`${id}: esperava 3 diagramas, veio ${partes.length}`);
    VISTAS.forEach((v, i) => fs.writeFileSync(path.join(alvo, `${nome}-${v}.svg`), partes[i]));
  }
  fs.writeFileSync(path.join(alvo, "README.md"), readme(itens));
  let estado = "gravado";
  if (commitar && raiz) {
    const caminho = path.relative(raiz, alvo).replace(/\\/g, "/");
    git(raiz, ["add", "--", caminho]);
    const mudou = git(raiz, ["diff", "--cached", "--name-only", "--", caminho]);
    if (!mudou) estado = "sem mudança";
    else {
      git(raiz, ["commit", "-q", "-m", process.env.MENSAGEM || "docs: diagramas de arquitetura (UML, BPMN e C4)", "--", caminho]);
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
