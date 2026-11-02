// Leva o desenho de cada projeto para o repositório do próprio projeto:
//   <pasta do projeto>/docs/arquitetura/<nome>.excalidraw   (editável: excalidraw.com ou extensão do VS Code)
//   <pasta do projeto>/docs/arquitetura/<nome>-1-casos-de-uso.svg, -2-processo.svg, -3-arquitetura.svg
//                                                            (um por diagrama, cortado no conteúdo; o GitHub mostra direto)
//   <pasta do projeto>/docs/arquitetura/README.md           (o que é cada diagrama)
// <nome> sai do título que o leitor vê no diagrama ("Cortex Analytics · ..." vira cortex-analytics), não
// do id da nota, que às vezes é histórico (desafio-tecnico-dev-, relatorio-servi-o-csfiltros). Arquivo
// com o nome antigo é renomeado.
// Para onde vai: scripts/destinos-desenhos.mjs (o `pastas:` da nota, filtrado pela trava de identidade).
// A fonte da verdade continua no vault (09-DESENHOS); rodar de novo atualiza as cópias. Precisa do dev
// server no ar (o SVG sai do próprio Excalidraw).
//
// Três portões (01/11/2026):
//   1. QA: desenho com qualquer achado do qa-desenhos.mjs NÃO é publicado. `--forcar` passa por cima,
//      e só se usa quando o Pedro pedir.
//   2. Identidade: pasta cujo nome não bate com o desenho é recusada (destinos-desenhos.mjs). Não há
//      `--forcar` para isso: o conserto é o `pastas:` da nota ou o "pastas" da spec.
//   3. Só onde há sistema: spec com "sistema": false não publica, e o docs/arquitetura gerado que
//      ficou nas pastas dela é removido (só os arquivos com o nome do desenho e o README gerado).
// E limpa: desenho de OUTRO projeto que um `pastas:` errado deixou na pasta sai na publicação.
//
// Uso:  node scripts/publicar-desenhos.mjs [id ...]            → só simula (lista o que faria)
//       node scripts/publicar-desenhos.mjs [id ...] --gravar   → grava os arquivos
//       node scripts/publicar-desenhos.mjs [id ...] --commit   → grava, commita SÓ docs/arquitetura e dá push
//       --forcar                                                → publica mesmo com achado do QA (só a pedido do Pedro)
// Variáveis: SINAPSE_URL (padrão http://localhost:5173), VAULT_PATH, PROJETOS_PATH.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { planejar, arquivosDe, VISTAS, VAULT, PROJETOS, lerExceto, aplicarExceto } from "./destinos-desenhos.mjs";
import { medir } from "./qa-desenhos.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const URL_APP = process.env.SINAPSE_URL || "http://localhost:5173";
const args = process.argv.slice(2);
const gravar = args.includes("--gravar") || args.includes("--commit");
const commitar = args.includes("--commit");
const forcar = args.includes("--forcar");
// --exceto=a,b,c (ou --exceto a,b,c): pastas que ficam de fora desta publicação (repo em revisão ou
// sendo limpo por outra pessoa). Vale para gravar e para limpar.
const exceto = lerExceto(args);
const pedidas = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--exceto");

const git = (dir, a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const raizGit = (dir) => { try { return git(dir, ["rev-parse", "--show-toplevel"]); } catch { return null; } };
const MARCA_README = "Os diagramas são gerados a partir do Sinapse";

const plano = aplicarExceto(planejar({ vault: VAULT, projetos: PROJETOS, pedidas }), exceto, PROJETOS);

// portão 1: o QA zerado
const reprovados = new Map();
for (const itens of plano.destinos.values()) for (const { id } of itens) {
  if (reprovados.has(id)) continue;
  const arq = path.join(VAULT, "09-DESENHOS", id + ".excalidraw");
  if (!fs.existsSync(arq)) { reprovados.set(id, ["desenho não gerado (rode gerar-desenhos.mjs)"]); continue; }
  const achados = medir(JSON.parse(fs.readFileSync(arq, "utf8")));
  reprovados.set(id, achados.map((a) => `${a.tipo}: ${a.msg}`));
}
const barradoQa = (id) => (reprovados.get(id) || []).length > 0 && !forcar;
for (const [dir, itens] of plano.destinos) {
  const ok = itens.filter((i) => !barradoQa(i.id));
  if (ok.length) plano.destinos.set(dir, ok); else plano.destinos.delete(dir);
}

// README de docs/arquitetura: o mesmo modelo em todo repositório, curto e sem jargão de ferramenta
// vistas de cada desenho (spec com "vistas": só parte das três) e o nome do arquivo de cada uma
const VISTA_ARQ = { uml: "1-casos-de-uso", bpmn: "2-processo", c4: "3-arquitetura" };
const vistasDe = (spec) => spec.vistas || ["uml", "bpmn", "c4"];
const LINHA_TABELA = {
  uml: "| Casos de uso | UML | Quem usa e para quê |",
  bpmn: "| Processo | BPMN 2.0 | Como o trabalho anda, com uma raia para cada quem executa |",
  c4: "| Arquitetura | C4, nível 2 | De que partes o sistema é feito e com quem conversa |",
};
const readme = (itens) => {
  const usadas = ["uml", "bpmn", "c4"].filter((v) => itens.some((i) => vistasDe(i.spec).includes(v)));
  const todas = usadas.length === 3 && itens.every((i) => vistasDe(i.spec).length === 3);
  return [
  "# Arquitetura",
  "",
  itens.length > 1
    ? `Diagramas de ${itens.length} sistemas ligados a este repositório${todas ? ". Cada um tem três vistas, cada vista numa notação padrão." : ", cada vista numa notação padrão."}`
    : todas ? "Três vistas do sistema, cada uma numa notação padrão." : usadas.length === 1 ? "Uma vista do sistema, numa notação padrão." : "Vistas do sistema, cada uma numa notação padrão.",
  "",
  "| Vista | Notação | Responde |",
  "|---|---|---|",
  ...usadas.map((v) => LINHA_TABELA[v]),
  "",
  ...itens.flatMap(({ nome, spec }) => {
    const sistema = spec.titulo.split(" · ")[0];
    const vs = vistasDe(spec);
    const bloco = {
      uml: ["### Quem usa e para quê", "", `![Casos de uso de ${sistema}](./${nome}-1-casos-de-uso.svg)`, ""],
      bpmn: [`### ${spec.processo?.nome || "Processo principal"}`, "", `![Processo de ${sistema}](./${nome}-2-processo.svg)`, ""],
      c4: ["### Arquitetura", "", `![Arquitetura de ${sistema}](./${nome}-3-arquitetura.svg)`, ""],
    };
    return [
      `## ${spec.titulo}`,
      "",
      spec.resumo,
      "",
      ...vs.flatMap((v) => bloco[v]),
      `Para editar: [${nome}.excalidraw](./${nome}.excalidraw), que abre em [excalidraw.com](https://excalidraw.com) ou na extensão Excalidraw do VS Code.`,
      "",
    ];
  }),
  "## De onde vêm",
  "",
  `${MARCA_README}, o vault onde o Pedro organiza notas e projetos. Mudança feita direto aqui some na próxima publicação: o lugar de mudar é a especificação no Sinapse.`,
  "",
  ].join("\n");
};

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

// commit + push só de docs/arquitetura (git add -A pega também o que foi removido)
function commitarPasta(dir, alvo, mensagem) {
  const raiz = raizGit(dir);
  if (!raiz) return " (pasta sem git)";
  const caminho = path.relative(raiz, alvo).replace(/\\/g, "/");
  git(raiz, ["add", "-A", "--", caminho]);
  if (!git(raiz, ["diff", "--cached", "--name-only", "--", caminho])) return ", sem mudança";
  git(raiz, ["commit", "-q", "-m", mensagem, "--", caminho]);
  let remoto = "";
  try { remoto = git(raiz, ["remote"]); } catch { /* sem remoto */ }
  if (!remoto) return ", commitado (sem remoto)";
  try { git(raiz, ["push", "-q"]); return ", commitado e enviado"; } catch (e) { return `, commitado (push falhou: ${String(e.stderr || e.message).split("\n")[0]})`; }
}

// tira de docs/arquitetura os arquivos gerados que não pertencem mais ali; o README gerado sai junto
// quando não sobra nenhum desenho, e a pasta vazia também
function limpar(alvo, nomes) {
  const tirados = [];
  for (const nome of nomes) for (const f of arquivosDe(nome)) {
    const p = path.join(alvo, f);
    if (fs.existsSync(p)) { fs.rmSync(p); tirados.push(f); }
  }
  const readmeArq = path.join(alvo, "README.md");
  const sobrou = fs.existsSync(alvo) && fs.readdirSync(alvo).some((f) => /-(1-casos-de-uso|2-processo|3-arquitetura)\.svg$/.test(f));
  if (!sobrou && fs.existsSync(readmeArq) && fs.readFileSync(readmeArq, "utf8").includes(MARCA_README)) { fs.rmSync(readmeArq); tirados.push("README.md"); }
  if (fs.existsSync(alvo) && !fs.readdirSync(alvo).length) fs.rmdirSync(alvo);
  return tirados;
}

const relatorio = [];
const intrusosPor = new Map();
for (const i of plano.intrusos) {
  const dir = path.join(PROJETOS, i.pasta);
  if (!intrusosPor.has(dir)) intrusosPor.set(dir, []);
  intrusosPor.get(dir).push(i.nome);
}

for (const [dir, itens] of plano.destinos) {
  const rel = path.relative(PROJETOS, dir);
  const alvo = path.join(dir, "docs", "arquitetura");
  const fora = intrusosPor.get(dir) || [];
  intrusosPor.delete(dir);
  if (!gravar) {
    relatorio.push(`${rel.padEnd(42)} ${raizGit(dir) ? "git" : "SEM GIT"}  ← ${itens.map((i) => `${i.id} (${i.nome})`).join(", ")}${fora.length ? `  · tira: ${fora.join(", ")}` : ""}`);
    continue;
  }
  fs.mkdirSync(alvo, { recursive: true });
  for (const item of itens) {
    const { id, nome } = item;
    // nome antigo (o id da nota) vira o novo: renomeia, e o git registra como renomeação
    if (nome !== id) {
      for (const [velho, novo] of [[`${id}.excalidraw`, `${nome}.excalidraw`], ...VISTAS.map((v) => [`${id}-${v}.svg`, `${nome}-${v}.svg`])]) {
        const de = path.join(alvo, velho), para = path.join(alvo, novo);
        if (fs.existsSync(de) && !fs.existsSync(para)) fs.renameSync(de, para);
      }
    }
    fs.copyFileSync(path.join(VAULT, "09-DESENHOS", id + ".excalidraw"), path.join(alvo, nome + ".excalidraw"));
    const partes = await svgDe(id);
    const vs = vistasDe(item.spec);
    if (partes.length !== vs.length) throw new Error(`${id}: esperava ${vs.length} diagrama(s), veio ${partes.length}`);
    // trava de identidade também no arquivo: o SVG tem que trazer o título do próprio desenho
    const sistema = item.spec.titulo.split(" · ")[0].replace(/&/g, "&amp;");
    if (!partes.every((s) => s.includes(sistema))) throw new Error(`${id}: o SVG exportado não traz o título "${sistema}" (exportou outro desenho?)`);
    vs.forEach((v, i) => fs.writeFileSync(path.join(alvo, `${nome}-${VISTA_ARQ[v]}.svg`), partes[i]));
    // vista que saiu da spec (cosmos e galeria ficaram só com o C4): o SVG antigo sai
    for (const v of Object.keys(VISTA_ARQ)) if (!vs.includes(v)) { const velho = path.join(alvo, `${nome}-${VISTA_ARQ[v]}.svg`); if (fs.existsSync(velho)) fs.rmSync(velho); }
  }
  const tirados = limpar(alvo, fora);
  fs.writeFileSync(path.join(alvo, "README.md"), readme(itens));
  let estado = "gravado" + (tirados.length ? `, tirou ${fora.join(", ")}` : "");
  if (commitar) estado += commitarPasta(dir, alvo, process.env.MENSAGEM || "docs: diagramas de arquitetura (UML, BPMN e C4)");
  relatorio.push(`${rel.padEnd(42)} ${estado}  ← ${itens.map((i) => i.id).join(", ")}`);
}

// pastas que só têm o que sair: desenho de outro projeto, ou de spec marcada "sistema": false
const saidas = new Map(intrusosPor);
for (const s of plano.semSistema) for (const p of s.pastas) {
  const dir = path.join(PROJETOS, p);
  if (!saidas.has(dir)) saidas.set(dir, []);
  saidas.get(dir).push(s.nome);
}
for (const dir of [...saidas.keys()]) if (plano.foraDaRodada.has(path.relative(PROJETOS, dir).replace(/\\/g, "/").toLowerCase())) saidas.delete(dir);
for (const [dir, nomes] of saidas) {
  const alvo = path.join(dir, "docs", "arquitetura");
  const existentes = nomes.filter((n) => arquivosDe(n).some((f) => fs.existsSync(path.join(alvo, f))));
  if (!existentes.length) continue;
  const rel = path.relative(PROJETOS, dir);
  if (!gravar) { relatorio.push(`${rel.padEnd(42)} tira: ${existentes.join(", ")}`); continue; }
  const tirados = limpar(alvo, existentes);
  let estado = `tirou ${existentes.join(", ")} (${tirados.length} arquivos)`;
  if (commitar) estado += commitarPasta(dir, alvo, process.env.MENSAGEM_LIMPEZA || "docs: tira diagrama que não é deste repositório");
  relatorio.push(`${rel.padEnd(42)} ${estado}`);
}

if (navegador) await navegador.close();
console.log(relatorio.join("\n"));
const barradosQa = [...reprovados].filter(([, a]) => a.length);
if (barradosQa.length) {
  console.log(`\n${forcar ? "PUBLICADOS COM ACHADO (--forcar)" : "BARRADOS pelo QA (qa-desenhos.mjs com achado)"}:`);
  for (const [id, a] of barradosQa) console.log(`  ${id}: ${a.slice(0, 3).join(" · ")}${a.length > 3 ? ` e mais ${a.length - 3}` : ""}`);
}
if (plano.barrados.length) { console.log("\nBARRADOS pela trava de identidade (o nome da pasta não bate com o desenho):"); for (const b of plano.barrados) console.log(`  ${b.id} → ${b.pasta}`); }
if (plano.semSistema.length) console.log(`\nsem sistema (não publica): ${plano.semSistema.map((s) => s.id).join(", ")}`);
if (plano.semPasta.length) console.log(`\nsem pasta de projeto (ficam só no Sinapse): ${plano.semPasta.join(", ")}`);
if (exceto.length) console.log(`\nfora desta rodada (--exceto): ${exceto.join(", ")}`);
console.log(`\n${plano.destinos.size} pasta(s)${gravar ? "" : " · simulação; use --gravar ou --commit"}`);
