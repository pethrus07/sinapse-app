// Gera o desenho de cada projeto (Excalidraw) a partir de uma especificação simples no vault.
//   vault/09-DESENHOS/specs/<nota>.json  →  vault/09-DESENHOS/<nota>.excalidraw
// Três blocos, sempre: "Como funciona" (quem e o que se conecta), "Fluxo principal" (passos numerados) e
// "Arquitetura" (camadas com seus itens e as ligações entre elas).
// Nunca sobrescreve um desenho editado à mão: só escreve se o arquivo não existe, ou se ainda é o que o
// gerador escreveu da última vez (marca "gerado" no próprio arquivo e o conteúdo bate). --forcar ignora isso.
// Uso: node scripts/gerar-desenhos.mjs [nota ...] [--forcar]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.VAULT_PATH || path.resolve(AQUI, "../../sinapse");
const DIR = path.join(VAULT, "09-DESENHOS");
const SPECS = path.join(DIR, "specs");

// cores por tipo de nó (fundo claro, traço escuro): legível no tema claro e no escuro do Excalidraw
const TIPOS = {
  pessoa: { fundo: "#ffec99", traco: "#e67700" },
  interface: { fundo: "#d0ebff", traco: "#1971c2" },
  servico: { fundo: "#e5dbff", traco: "#6741d9" },
  dado: { fundo: "#d3f9d8", traco: "#2f9e44" },
  externo: { fundo: "#e9ecef", traco: "#495057" },
  tarefa: { fundo: "#ffe8cc", traco: "#d9480f" },
};
const ROTULO = { servico: "serviço" };
const CAMADA = ["#f3f0ff", "#e7f5ff", "#ebfbee", "#fff4e6", "#f8f9fa", "#fff0f6"];

let semente = 1;
const id = () => crypto.randomBytes(8).toString("hex");
const base = (extra) => ({
  angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2,
  strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: semente++,
  version: 1, versionNonce: semente * 7919, isDeleted: false, boundElements: [], updated: 1, link: null, locked: false, ...extra,
});

// quebra o texto em linhas de até `largura` caracteres (o Excalidraw não reembrulha texto salvo)
function quebrar(texto, largura) {
  const linhas = [];
  for (const par of String(texto).split("\n")) {
    let atual = "";
    for (const p of par.split(/\s+/)) {
      if ((atual + " " + p).trim().length > largura && atual) { linhas.push(atual); atual = p; } else atual = (atual + " " + p).trim();
    }
    linhas.push(atual);
  }
  return linhas.join("\n");
}

function caixa(els, { x, y, w, h, texto, fundo = "transparent", traco = "#1e1e1e", tam = 18, forma = "rectangle", tracejado = false, alinhar = "center" }) {
  const cid = id(), tid = id();
  const t = quebrar(texto, Math.max(10, Math.floor(w / (tam * 0.55))));
  const linhas = t.split("\n").length;
  const alto = Math.max(h, linhas * tam * 1.25 + 24);
  els.push(base({ id: cid, type: forma, x, y, width: w, height: alto, backgroundColor: fundo, strokeColor: traco,
    roundness: forma === "rectangle" ? { type: 3 } : { type: 2 }, strokeStyle: tracejado ? "dashed" : "solid", boundElements: [{ id: tid, type: "text" }] }));
  els.push(base({ id: tid, type: "text", x: x + 8, y: y + (alto - linhas * tam * 1.25) / 2, width: w - 16, height: linhas * tam * 1.25,
    text: t, originalText: t, fontSize: tam, fontFamily: 1, textAlign: alinhar, verticalAlign: "middle", containerId: cid, lineHeight: 1.25,
    strokeColor: traco, autoResize: true }));
  return { id: cid, x, y, w, h: alto };
}

function texto(els, { x, y, texto: t, tam = 28, cor = "#1e1e1e", w = 900 }) {
  const q = quebrar(t, Math.floor(w / (tam * 0.55)));
  els.push(base({ id: id(), type: "text", x, y, width: w, height: q.split("\n").length * tam * 1.25, text: q, originalText: q,
    fontSize: tam, fontFamily: 1, textAlign: "left", verticalAlign: "top", containerId: null, lineHeight: 1.25, strokeColor: cor, autoResize: true }));
}

function seta(els, a, b, rotulo) {
  const aid = id();
  // sai da borda mais próxima: horizontal se estão lado a lado, vertical se estão um sobre o outro
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const horizontal = Math.abs(bc.x - ac.x) > Math.abs(bc.y - ac.y);
  const ini = horizontal ? { x: bc.x > ac.x ? a.x + a.w : a.x, y: ac.y } : { x: ac.x, y: bc.y > ac.y ? a.y + a.h : a.y };
  const fim = horizontal ? { x: bc.x > ac.x ? b.x : b.x + b.w, y: bc.y } : { x: bc.x, y: bc.y > ac.y ? b.y : b.y + b.h };
  const el = base({ id: aid, type: "arrow", x: ini.x, y: ini.y, width: Math.abs(fim.x - ini.x), height: Math.abs(fim.y - ini.y),
    points: [[0, 0], [fim.x - ini.x, fim.y - ini.y]], roundness: { type: 2 }, lastCommittedPoint: null,
    startBinding: { elementId: a.id, focus: 0, gap: 6 }, endBinding: { elementId: b.id, focus: 0, gap: 6 },
    startArrowhead: null, endArrowhead: "arrow", strokeColor: "#495057" });
  els.push(el);
  for (const c of els) if (c.id === a.id || c.id === b.id) c.boundElements.push({ id: aid, type: "arrow" });
  if (rotulo) {
    const tid = id(), r = quebrar(rotulo, 22);
    el.boundElements.push({ id: tid, type: "text" });
    els.push(base({ id: tid, type: "text", x: (ini.x + fim.x) / 2 - 60, y: (ini.y + fim.y) / 2 - 10, width: 120, height: 20 * r.split("\n").length,
      text: r, originalText: r, fontSize: 14, fontFamily: 1, textAlign: "center", verticalAlign: "middle", containerId: aid, lineHeight: 1.25,
      strokeColor: "#495057", autoResize: true }));
  }
}

// camadas pelo caminho mais longo (esquerda → direita); ciclos não travam (limite de passos)
function niveis(nos, setas) {
  const nivel = Object.fromEntries(nos.map((n) => [n.id, 0]));
  for (let i = 0; i < nos.length; i++) for (const s of setas) if (nivel[s.de] != null && nivel[s.para] != null && nivel[s.para] <= nivel[s.de]) nivel[s.para] = nivel[s.de] + 1;
  return nivel;
}

export function desenhar(spec) {
  semente = 1;
  const els = [];
  const X0 = 0;
  let y = 0;
  texto(els, { x: X0, y, texto: spec.titulo, tam: 40, w: 1600 });
  y += 60;
  if (spec.resumo) { texto(els, { x: X0, y, texto: spec.resumo, tam: 20, cor: "#495057", w: 1500 }); y += 30 * Math.ceil(spec.resumo.length / 130) + 30; }

  // 1. Como funciona
  y += 30;
  texto(els, { x: X0, y, texto: "1 · Como funciona", tam: 28, cor: "#6741d9" });
  y += 60;
  const f = spec.funcionamento || { nos: [], setas: [] };
  const nv = niveis(f.nos, f.setas || []);
  const porNivel = {};
  for (const n of f.nos) (porNivel[nv[n.id]] ||= []).push(n);
  const caixas = {};
  let alturaBloco = 0;
  for (const [k, lista] of Object.entries(porNivel)) {
    let yy = y;
    for (const n of lista) {
      const c = TIPOS[n.tipo] || TIPOS.servico;
      const b = caixa(els, { x: X0 + Number(k) * 330, y: yy, w: 240, h: 80, texto: n.texto, fundo: c.fundo, traco: c.traco,
        forma: n.tipo === "pessoa" ? "ellipse" : "rectangle", tracejado: n.tipo === "externo" });
      caixas[n.id] = b;
      yy += b.h + 40;
    }
    alturaBloco = Math.max(alturaBloco, yy - y);
  }
  for (const s of f.setas || []) if (caixas[s.de] && caixas[s.para]) seta(els, caixas[s.de], caixas[s.para], s.texto);
  // legenda dos tipos usados
  const usados = [...new Set(f.nos.map((n) => n.tipo))].filter((t) => TIPOS[t]);
  let lx = X0;
  for (const t of usados) { caixa(els, { x: lx, y: y + alturaBloco + 10, w: 120, h: 36, texto: ROTULO[t] || t, fundo: TIPOS[t].fundo, traco: TIPOS[t].traco, tam: 14 }); lx += 135; }
  y += alturaBloco + 90;

  // 2. Fluxo principal
  texto(els, { x: X0, y, texto: "2 · Fluxo principal", tam: 28, cor: "#6741d9" });
  y += 60;
  const passos = spec.fluxo || [];
  const porLinha = 4;
  let anterior = null, maiorLinha = 0;
  passos.forEach((p, i) => {
    const col = i % porLinha, lin = Math.floor(i / porLinha);
    if (col === 0 && i) { y += maiorLinha + 50; maiorLinha = 0; }
    // em cobra: linha ímpar corre da direita para a esquerda, e a seta da quebra de linha
    // desce reto em vez de atravessar o desenho na diagonal
    const pos = lin % 2 ? porLinha - 1 - col : col;
    const b = caixa(els, { x: X0 + pos * 340, y, w: 270, h: 90, texto: `${i + 1}. ${p}`, fundo: "#fff9db", traco: "#e67700", alinhar: "left" });
    maiorLinha = Math.max(maiorLinha, b.h);
    if (anterior) seta(els, anterior, b);
    anterior = b;
  });
  y += maiorLinha + 90;

  // 3. Arquitetura
  texto(els, { x: X0, y, texto: "3 · Arquitetura", tam: 28, cor: "#6741d9" });
  y += 60;
  const arq = spec.arquitetura || { camadas: [], ligacoes: [] };
  const camadas = {};
  arq.camadas.forEach((c, i) => {
    const itens = c.itens || [];
    const largura = Math.max(1100, itens.length * 250 + 220);
    const faixa = { id: id(), x: X0, y, w: largura, h: 0 };
    let alto = 0;
    const tmp = [];
    itens.forEach((it, j) => { const b = caixa(tmp, { x: X0 + 210 + j * 250, y: y + 20, w: 220, h: 70, texto: it, fundo: "#ffffff", traco: "#495057", tam: 16 }); alto = Math.max(alto, b.h); });
    faixa.h = Math.max(110, alto + 40);
    els.push(base({ id: faixa.id, type: "rectangle", x: faixa.x, y: faixa.y, width: faixa.w, height: faixa.h, backgroundColor: CAMADA[i % CAMADA.length],
      strokeColor: "#adb5bd", roundness: { type: 3 }, strokeWidth: 1 }));
    texto(els, { x: X0 + 16, y: y + faixa.h / 2 - 14, texto: c.nome, tam: 20, cor: "#343a40", w: 180 });
    els.push(...tmp);
    camadas[c.nome] = faixa;
    y += faixa.h + 50;
  });
  for (const l of arq.ligacoes || []) if (camadas[l.de] && camadas[l.para]) {
    const a = camadas[l.de], b = camadas[l.para];
    seta(els, { ...a, x: a.x + a.w - 60, w: 40 }, { ...b, x: b.x + b.w - 60, w: 40 }, l.texto);
  }
  return { type: "excalidraw", version: 2, source: "sinapse", elements: els, appState: { viewBackgroundColor: "#ffffff", gridSize: null }, files: {} };
}

const assinatura = (obj) => crypto.createHash("sha1").update(JSON.stringify(obj.elements)).digest("hex");

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const forcar = args.includes("--forcar");
  const pedidas = args.filter((a) => !a.startsWith("--"));
  fs.mkdirSync(SPECS, { recursive: true });
  const specs = fs.readdirSync(SPECS).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
    .filter((n) => !pedidas.length || pedidas.includes(n));
  let feitos = 0, pulados = 0;
  for (const nome of specs) {
    const spec = JSON.parse(fs.readFileSync(path.join(SPECS, `${nome}.json`), "utf8"));
    const destino = path.join(DIR, `${nome}.excalidraw`);
    if (fs.existsSync(destino) && !forcar) {
      const atual = JSON.parse(fs.readFileSync(destino, "utf8"));
      if (!atual.gerado || atual.gerado !== assinatura(atual)) { pulados++; console.log(`  ${nome}: editado à mão, mantido`); continue; }
    }
    const d = desenhar(spec);
    d.gerado = assinatura(d);
    fs.writeFileSync(destino, JSON.stringify(d, null, 1));
    feitos++;
  }
  console.log(`${feitos} desenho(s) gerado(s), ${pulados} mantido(s) por terem sido editados`);
}
