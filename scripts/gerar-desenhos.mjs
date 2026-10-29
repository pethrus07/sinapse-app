// Gera o desenho de cada projeto (Excalidraw) a partir de uma especificação no vault.
//   vault/09-DESENHOS/specs/<nota>.json  →  vault/09-DESENHOS/<nota>.excalidraw
// Três diagramas, cada um numa notação padrão (formato em docs/desenhos-formato.md):
//   1. UML de casos de uso   2. BPMN 2.0 (processo com raias)   3. C4 nível 2 (containers)
// Visual de diagrama técnico, não de rascunho: traço reto (roughness 0), fonte sem serifa,
// fundo branco, cores da convenção de cada notação.
// Nunca sobrescreve desenho editado à mão: só escreve se o arquivo não existe, ou se ainda é o que o
// gerador escreveu da última vez (campo "gerado" bate com o conteúdo). --forcar ignora isso.
// Uso: node scripts/gerar-desenhos.mjs [nota ...] [--forcar]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { validar } from "./validar-specs.mjs";
import ELK from "elkjs/lib/elk.bundled.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.VAULT_PATH || path.resolve(AQUI, "../../sinapse");
const DIR = path.join(VAULT, "09-DESENHOS");
const SPECS = path.join(DIR, "specs");

/* ---------- paleta ---------- */
const TINTA = "#1F2937", SUAVE = "#64748B", LINHA = "#334155";
const UML = { caso: "#EEF2F7", traco: "#334155" };
const BPMN = {
  raias: [
    { traco: "#2563EB", fundo: "#F5F8FF", cab: "#E8F0FE" },
    { traco: "#0F8A7E", fundo: "#F4FBFA", cab: "#E2F5F2" },
    { traco: "#7C3AED", fundo: "#F8F6FF", cab: "#EEE9FE" },
    { traco: "#B45309", fundo: "#FFFBF5", cab: "#FDF0DD" },
  ],
  pool: "#1E293B", externo: "#E8EDF5",
  inicio: { traco: "#15803D", fundo: "#F0FDF4" }, fim: { traco: "#BE123C", fundo: "#FFF1F2" },
  gateway: { traco: "#C2410C", fundo: "#FFF7ED" },
};
// C4: cores da convenção (Simon Brown / Structurizr), escurecidas o bastante para texto branco legível
const C4 = { pessoa: "#08427B", container: "#2F6FBA", banco: "#2F6FBA", externo: "#6B7280", fronteira: "#5B6676", seta: "#5B6676" };

/* ---------- elementos básicos ---------- */
let semente = 1;
const novoId = () => crypto.randomBytes(8).toString("hex");
const base = (extra) => ({
  angle: 0, strokeColor: LINHA, backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1,
  strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: semente++,
  version: 1, versionNonce: semente * 7919, isDeleted: false, boundElements: [], updated: 1, link: null, locked: false, ...extra,
});
const LARG = 0.56; // largura média de caractere da Helvetica, em fração do corpo
const largura = (t, tam) => Math.max(...String(t).split("\n").map((l) => l.length)) * tam * LARG;

function quebrar(texto, maxPx, tam) {
  const cabe = Math.max(6, Math.floor(maxPx / (tam * LARG)));
  const linhas = [];
  for (const par of String(texto).split("\n")) {
    let atual = "";
    for (const p of par.split(/\s+/)) {
      if ((atual + " " + p).trim().length > cabe && atual) { linhas.push(atual); atual = p; } else atual = (atual + " " + p).trim();
    }
    linhas.push(atual);
  }
  // sem órfão: última linha muito curta ("h?", "h]") recebe a última palavra da linha de cima
  for (let i = linhas.length - 1; i > 0; i--) {
    if (linhas[i].length <= 4 && linhas[i - 1].includes(" ")) {
      const k = linhas[i - 1].lastIndexOf(" ");
      linhas[i] = linhas[i - 1].slice(k + 1) + " " + linhas[i];
      linhas[i - 1] = linhas[i - 1].slice(0, k);
    }
  }
  return linhas.join("\n");
}

function texto(els, { x, y, t, tam = 16, cor = TINTA, alinhar = "left", maxPx = 1400, grupo, angulo = 0, centroX }) {
  const q = quebrar(t, maxPx, tam);
  const w = Math.ceil(largura(q, tam)) + 4, h = q.split("\n").length * tam * 1.25;
  const xx = centroX != null ? centroX - w / 2 : alinhar === "center" ? x - w / 2 : x;
  els.push(base({ id: novoId(), type: "text", x: xx, y, width: w, height: h, text: q, originalText: q, fontSize: tam, fontFamily: 2,
    textAlign: alinhar, verticalAlign: "top", containerId: null, lineHeight: 1.25, strokeColor: cor, autoResize: true,
    angle: angulo, groupIds: grupo ? [grupo] : [] }));
  return { w, h };
}

// forma com texto preso dentro (move junto)
function forma(els, { tipo = "rectangle", x, y, w, h, t = "", tam = 15, cor = TINTA, fundo = "#FFFFFF", traco = LINHA, espessura = 1,
  tracejado = false, redondo = true, grupo, alinhar = "center" }) {
  const id = novoId();
  const el = base({ id, type: tipo, x, y, width: w, height: h, backgroundColor: fundo, strokeColor: traco, strokeWidth: espessura,
    strokeStyle: tracejado ? "dashed" : "solid", roundness: redondo ? (tipo === "rectangle" ? { type: 3 } : { type: 2 }) : null,
    groupIds: grupo ? [grupo] : [] });
  els.push(el);
  if (t) {
    const tid = novoId();
    const util = tipo === "ellipse" ? w * 0.72 : tipo === "diamond" ? w * 0.5 : w - 20;
    const q = quebrar(t, util, tam);
    const th = q.split("\n").length * tam * 1.25;
    el.boundElements.push({ id: tid, type: "text" });
    els.push(base({ id: tid, type: "text", x: x + (w - util) / 2, y: y + (h - th) / 2, width: util, height: th, text: q, originalText: q,
      fontSize: tam, fontFamily: 2, textAlign: alinhar, verticalAlign: "middle", containerId: id, lineHeight: 1.25, strokeColor: cor,
      autoResize: true, groupIds: grupo ? [grupo] : [] }));
  }
  return { id, x, y, w, h, el };
}

function linha(els, pontos, { cor = LINHA, espessura = 1, tracejado = false, grupo } = {}) {
  const [x0, y0] = pontos[0];
  const xs = pontos.map((p) => p[0]), ys = pontos.map((p) => p[1]);
  els.push(base({ id: novoId(), type: "line", x: x0, y: y0, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    points: pontos.map(([x, y]) => [x - x0, y - y0]), strokeColor: cor, strokeWidth: espessura, strokeStyle: tracejado ? "dashed" : "solid",
    lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: null, groupIds: grupo ? [grupo] : [] }));
}

/* ---------- posicionador de rótulos ----------
   Rótulo não fica "onde cair": a seta e a forma só pedem (pendentes) e, depois de todas as linhas
   do diagrama traçadas, cada rótulo testa posições e fica com a de menor custo. Custo: encostar em
   forma ou em outro texto (1000), cruzar linha alheia (60), ficar em cima da própria linha (25) e a
   distância do ponto ideal (0,03 por px). O rótulo vai no mesmo grupo da seta/forma: movem juntos. */
let pendentes = [];

function rotular(els, desde) {
  const fatia = els.slice(desde);
  const area = (e) => (e.width > 600 || e.height > 200) && e.height > 60; // raia, pool interno, fronteira
  const obst = fatia.filter((e) => !e.customData?.halo && ["rectangle", "ellipse", "diamond"].includes(e.type) && e.backgroundColor !== "transparent" && !area(e))
    .map((e) => ({ x0: e.x, y0: e.y, x1: e.x + e.width, y1: e.y + e.height }));
  const textos = fatia.filter((e) => e.type === "text").map((e) => ({ x0: e.x, y0: e.y, x1: e.x + e.width, y1: e.y + e.height }));
  const segs = [];
  for (const e of fatia) if (e.type === "arrow" || e.type === "line") {
    const p = e.points.map(([x, y]) => [e.x + x, e.y + y]);
    for (let i = 0; i < p.length - 1; i++) segs.push({ dono: e.id, a: p[i], b: p[i + 1] });
  }
  // borda de raia, pool e fronteira também é linha: rótulo em cima dela parecia escrito na moldura
  const areas = fatia.filter((e) => e.type === "rectangle" && !e.customData?.halo && area(e));
  for (const e of areas) {
    const [x0, y0, x1, y1] = [e.x, e.y, e.x + e.width, e.y + e.height];
    segs.push({ dono: null, a: [x0, y0], b: [x1, y0] }, { dono: null, a: [x1, y0], b: [x1, y1] },
      { dono: null, a: [x1, y1], b: [x0, y1] }, { dono: null, a: [x0, y1], b: [x0, y0] });
  }
  // halo da cor do fundo onde o rótulo cai (branco numa raia cinza virava um remendo)
  const fundo = (c) => {
    const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
    const dentro = areas.filter((e) => e.backgroundColor && e.backgroundColor !== "transparent" && cx > e.x && cx < e.x + e.width && cy > e.y && cy < e.y + e.height);
    return dentro.sort((a, b) => a.width * a.height - b.width * b.height)[0]?.backgroundColor || "#FFFFFF";
  };
  const sobre = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0;
  const cortaCaixa = (s, c) => {
    const n = Math.max(2, Math.ceil(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) / 4));
    for (let k = 0; k <= n; k++) {
      const x = s.a[0] + ((s.b[0] - s.a[0]) * k) / n, y = s.a[1] + ((s.b[1] - s.a[1]) * k) / n;
      if (x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1) return true;
    }
    return false;
  };
  const custo = (c, ancora, dono) => {
    let v = 0;
    for (const o of obst) if (sobre(c, o)) v += 1000;
    for (const t of textos) if (sobre(c, t)) v += 1000;
    for (const s of segs) if (cortaCaixa(s, c)) v += s.dono === dono ? 25 : 60;
    return v + 0.03 * Math.hypot((c.x0 + c.x1) / 2 - ancora[0], (c.y0 + c.y1) / 2 - ancora[1]);
  };
  const ordem = [...pendentes].sort((p, q) => (p.tipo === "forma" ? 0 : 1) - (q.tipo === "forma" ? 0 : 1));
  for (const p of ordem) {
    // variantes do texto: como veio e quebrado mais estreito (nome longo de gateway que, numa linha
    // só, encosta nas tarefas vizinhas cabe no canto livre em duas linhas); estreito custa +3
    const corrido = p.texto.replace(/\n/g, " ");
    const variantes = [...new Set([p.texto, quebrar(corrido, p.tipo === "forma" ? 88 : 100, p.tam)])];
    const cands = [];
    variantes.forEach((txt, iv) => {
      const w = Math.ceil(largura(txt, p.tam)) + 6, h = txt.split("\n").length * p.tam * 1.25;
      const extraV = iv * 3;
      if (p.tipo === "forma") {
        const { x0, y0, x1, y1 } = p.caixa, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const lugares = { cima: [cx - w / 2, y0 - h - 6], baixo: [cx - w / 2, y1 + 6], direita: [x1 + 8, cy - h / 2], esquerda: [x0 - w - 8, cy - h / 2],
          "cima-dir": [x1 - 4, y0 - h - 2], "baixo-dir": [x1 - 4, y1 + 2], "cima-esq": [x0 - w + 4, y0 - h - 2], "baixo-esq": [x0 - w + 4, y1 + 2] };
        p.ordem.concat(["cima-dir", "baixo-dir", "cima-esq", "baixo-esq"]).forEach((k, i) => {
          const [x, y] = lugares[k];
          cands.push({ txt, w, h, c: { x0: x, y0: y, x1: x + w, y1: y + h }, extra: i * 4 + extraV });
        });
      } else {
        const pts = p.pts;
        const comp = [];
        let tot = 0;
        for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); comp.push(l); tot += l; }
        const fracoes = p.perto === "inicio" ? [0.12, 0.22, 0.35, 0.5, 0.65] : p.perto === "fim" ? [0.88, 0.78, 0.65, 0.5] : [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];
        fracoes.forEach((fr, ordemF) => {
          let alvo = fr * tot, i = 0;
          while (i < comp.length - 1 && alvo > comp[i]) { alvo -= comp[i]; i++; }
          const [ax, ay] = pts[i], [bx, by] = pts[i + 1] || pts[i];
          const t = comp[i] ? alvo / comp[i] : 0;
          const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
          const horizontal = Math.abs(by - ay) < Math.abs(bx - ax);
          const opcoes = horizontal ? [[x - w / 2, y - h - 4], [x - w / 2, y + 4]] : [[x + 6, y - h / 2], [x - w - 6, y - h / 2]];
          opcoes.push([x - w / 2, y - h / 2]); // em cima da linha: último recurso
          opcoes.forEach(([cx, cy], k) => cands.push({ txt, w, h, c: { x0: cx, y0: cy, x1: cx + w, y1: cy + h }, extra: ordemF * 3 + k * 2 + extraV, ancora: [x, y] }));
        });
      }
    });
    const ancora = p.tipo === "forma" ? [(p.caixa.x0 + p.caixa.x1) / 2, (p.caixa.y0 + p.caixa.y1) / 2] : null;
    let melhor = null, vMelhor = Infinity;
    for (const k of cands) { const v = custo(k.c, k.ancora || ancora, p.seta?.id) + k.extra; if (v < vMelhor) { vMelhor = v; melhor = k; } }
    let grupo = p.grupo;
    if (!grupo && p.seta) { grupo = novoId(); p.seta.groupIds = [grupo]; }
    els.push(base({ id: novoId(), type: "rectangle", x: melhor.c.x0 - 2, y: melhor.c.y0 - 1, width: melhor.w + 4, height: melhor.h + 2,
      backgroundColor: fundo(melhor.c), strokeColor: "transparent", strokeWidth: 0, roundness: null, groupIds: grupo ? [grupo] : [], customData: { halo: true } }));
    els.push(base({ id: novoId(), type: "text", x: melhor.c.x0, y: melhor.c.y0, width: melhor.w, height: melhor.h, text: melhor.txt, originalText: melhor.txt,
      fontSize: p.tam, fontFamily: 2, textAlign: "center", verticalAlign: "top", containerId: null, lineHeight: 1.25,
      strokeColor: p.cor, autoResize: true, groupIds: grupo ? [grupo] : [] }));
    textos.push(melhor.c);
  }
  pendentes = [];
}

// seta (polilinha) presa às formas de origem e destino; o rótulo vai para o posicionador
function seta(els, pontos, { de, para, rotulo, cor = LINHA, tracejado = false, ponta = "arrow", inicio = null, tam = 13, espessura = 1, perto = "meio", corRotulo = SUAVE } = {}) {
  const id = novoId();
  const [x0, y0] = pontos[0];
  const xs = pontos.map((p) => p[0]), ys = pontos.map((p) => p[1]);
  const el = base({ id, type: "arrow", x: x0, y: y0, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    points: pontos.map(([x, y]) => [x - x0, y - y0]), strokeColor: cor, strokeWidth: espessura, strokeStyle: tracejado ? "dashed" : "solid",
    lastCommittedPoint: null, startArrowhead: inicio, endArrowhead: ponta,
    startBinding: de ? { elementId: de, focus: 0, gap: 4 } : null, endBinding: para ? { elementId: para, focus: 0, gap: 4 } : null });
  els.push(el);
  for (const c of els) if (c.id === de || c.id === para) c.boundElements.push({ id, type: "arrow" });
  if (rotulo) pendentes.push({ tipo: "seta", texto: quebrar(rotulo, 170, tam), tam, cor: corRotulo, pts: pontos, seta: el, perto });
  return el;
}

// ponto onde a reta do centro de `a` até (px,py) cruza a borda do retângulo/elipse `a`
function borda(a, px, py, elipse = false) {
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2, dx = px - cx, dy = py - cy;
  if (!dx && !dy) return [cx, cy];
  if (elipse) { const t = 1 / Math.sqrt((dx * dx) / ((a.w / 2) ** 2) + (dy * dy) / ((a.h / 2) ** 2)); return [cx + dx * t, cy + dy * t]; }
  const t = Math.min(Math.abs(a.w / 2 / (dx || 1e-9)), Math.abs(a.h / 2 / (dy || 1e-9)));
  return [cx + dx * t, cy + dy * t];
}
const centro = (a) => [a.x + a.w / 2, a.y + a.h / 2];

function cabecalho(els, x, y, numero, titulo, notacao, projeto = "") {
  texto(els, { x, y, t: `${numero} · ${titulo}`, tam: 24, cor: TINTA });
  texto(els, { x, y: y + 34, t: projeto ? `${projeto}  ·  ${notacao}` : notacao, tam: 14, cor: SUAVE });
  return y + 74;
}
const caixaDe = (els, desde) => {
  const xs = [], ys = [];
  for (const e of els.slice(desde)) { xs.push(e.x, e.x + (e.width || 0)); ys.push(e.y, e.y + (e.height || 0)); }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

/* ---------- 1. UML: casos de uso ---------- */
function ator(els, a, cx, topo) {
  const g = novoId();
  if (a.tipo === "tempo") {
    // ator de tempo: relógio
    forma(els, { tipo: "ellipse", x: cx - 22, y: topo + 6, w: 44, h: 44, fundo: "#FFFFFF", traco: LINHA, espessura: 2, grupo: g });
    linha(els, [[cx, topo + 28], [cx, topo + 14]], { espessura: 2, grupo: g });
    linha(els, [[cx, topo + 28], [cx + 10, topo + 34]], { espessura: 2, grupo: g });
  } else {
    forma(els, { tipo: "ellipse", x: cx - 11, y: topo, w: 22, h: 22, fundo: "#FFFFFF", traco: LINHA, espessura: 2, grupo: g });
    linha(els, [[cx, topo + 22], [cx, topo + 56]], { espessura: 2, grupo: g });
    linha(els, [[cx - 20, topo + 32], [cx + 20, topo + 32]], { espessura: 2, grupo: g });
    linha(els, [[cx, topo + 56], [cx - 16, topo + 80]], { espessura: 2, grupo: g });
    linha(els, [[cx, topo + 56], [cx + 16, topo + 80]], { espessura: 2, grupo: g });
  }
  const est = a.tipo === "sistema" ? "«sistema»\n" : a.tipo === "tempo" ? "«tempo»\n" : "";
  // nome com halo; casosDeUso leva os dois para cima das associações (linha passa por trás do nome)
  const yNome = topo + (a.tipo === "tempo" ? 56 : 88);
  const halo = base({ id: novoId(), type: "rectangle", x: cx, y: yNome - 1, width: 0, height: 0, backgroundColor: "#FFFFFF",
    strokeColor: "transparent", strokeWidth: 0, roundness: null, groupIds: [g], customData: { halo: true, nomeAtor: true } });
  els.push(halo);
  const r = texto(els, { x: cx, y: yNome, t: est + a.nome, tam: 14, alinhar: "center", maxPx: 150, grupo: g, cor: TINTA });
  els[els.length - 1].customData = { nomeAtor: true };
  Object.assign(halo, { x: cx - r.w / 2 - 3, width: r.w + 6, height: r.h + 2 });
  return { x: cx - 24, y: topo, w: 48, h: 84, cx, cy: topo + 36, alto: 88 + r.h };
}

// UML de casos de uso em UMA coluna: atores humanos e «tempo» à esquerda, «sistema» à direita. Com
// todos os casos na mesma coluna, a reta de um ator até o caso dele não passa por outra elipse (com
// duas colunas, a reta até a coluna de lá atravessava a de cá). A busca local ordena os casos para
// deixar vizinhos os que se ligam por include/extend; os que não ficam vizinhos contornam pela lateral
// com menos ligações, cada um num afastamento próprio.
function casosDeUso(els, u, X, Y) {
  const W = 270, H = 64, VG = 34, PAD = 40, AX = 190;
  const lado = (a) => (a.tipo === "sistema" ? "dir" : "esq");
  const atores = u.atores || [];
  const assoc = (u.associacoes || []).filter((s) => atores.some((a) => a.id === s.ator));
  const rels = u.relacoes || [];
  const casos = u.casos || [];
  const ladoDe = Object.fromEntries(atores.map((a) => [a.id, lado(a)]));
  const bx = X + AX, by = Y, cx0 = bx + PAD + 30; // 30: espaço para os contornos da esquerda

  function planejar(ordem) {
    const pos = {};
    // vão maior entre vizinhos ligados por «extend» com condição: o rótulo de três linhas não cabe em 34 px
    const vao = (a, b) => (rels.some((r) => r.condicao && ((r.de === a.id && r.para === b.id) || (r.de === b.id && r.para === a.id))) ? VG + 40 : VG);
    // cada contorno além do primeiro anda 22 px para fora: a fronteira cresce junto (senão o terceiro
    // contorno saía do sistema)
    const idx = Object.fromEntries(ordem.map((c, i) => [c.id, i]));
    const nContornos = rels.filter((r) => idx[r.de] != null && idx[r.para] != null && Math.abs(idx[r.de] - idx[r.para]) !== 1).length;
    const extra = Math.max(0, nContornos - 1) * 22;
    let yy = by + PAD + 30;
    ordem.forEach((c, i) => { if (i) yy += H + vao(ordem[i - 1], c); pos[c.id] = { x: cx0 + extra, y: yy, w: W, h: H, i }; });
    const altura = yy + H - (by + PAD + 30);
    const bw = W + PAD * 2 + 60 + 2 * extra, bh = altura + PAD * 2 + 30;
    const posAtor = {};
    for (const ladoA of ["esq", "dir"]) {
      const lista = atores.filter((a) => lado(a) === ladoA).map((a) => {
        const ys = assoc.filter((s) => s.ator === a.id && pos[s.caso]).map((s) => pos[s.caso].y + H / 2);
        return { a, alvo: ys.length ? ys.reduce((p, q) => p + q, 0) / ys.length - 36 : by + bh / 2 };
      }).sort((p, q) => p.alvo - q.alvo);
      let minimo = by;
      for (const it of lista) {
        const topo = Math.max(it.alvo, minimo);
        posAtor[it.a.id] = { cx: ladoA === "esq" ? X + 70 : bx + bw + 110, cy: topo + 36, topo };
        minimo = topo + 178;
      }
    }
    return { ordem, pos, posAtor, bw, bh };
  }

  function pontuar(pl) {
    let nota = 0;
    const idx = Object.fromEntries(pl.ordem.map((c, i) => [c.id, i]));
    for (const r of rels) if (Math.abs(idx[r.de] - idx[r.para]) !== 1) nota += 150; // ligação não vizinha contorna (e cruza associação): pesa mais que linha de ator inclinada
    // linhas de ator que atravessam outra elipse
    for (const s of assoc) {
      const a = pl.posAtor[s.ator], c = pl.pos[s.caso];
      if (!a || !c) continue;
      const p0 = a.cx < c.x ? [a.cx + 24, a.cy] : [a.cx - 24, a.cy];
      const p1 = a.cx < c.x ? [c.x, c.y + c.h / 2] : [c.x + c.w, c.y + c.h / 2]; // ponto extremo da elipse: a reta não cruza as outras da coluna
      for (const [id, e] of Object.entries(pl.pos)) {
        if (id === s.caso) continue;
        for (let k = 1; k < 20; k++) {
          const x = p0[0] + ((p1[0] - p0[0]) * k) / 20, y = p0[1] + ((p1[1] - p0[1]) * k) / 20;
          if (((x - e.x - e.w / 2) / (e.w / 2 + 6)) ** 2 + ((y - e.y - e.h / 2) / (e.h / 2 + 6)) ** 2 < 1) { nota += 100; break; }
        }
      }
    }
    // associações que se cruzam (diagonal longa de um ator passando sobre as de outro)
    const segA = assoc.map((s) => {
      const a = pl.posAtor[s.ator], c = pl.pos[s.caso];
      if (!a || !c) return null;
      return a.cx < c.x ? [[a.cx + 24, a.cy], [c.x, c.y + c.h / 2]] : [[a.cx - 24, a.cy], [c.x + c.w, c.y + c.h / 2]];
    });
    const lado2 = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    for (let i = 0; i < segA.length; i++) for (let j = i + 1; j < segA.length; j++) {
      const u = segA[i], v = segA[j];
      if (!u || !v || assoc[i].ator === assoc[j].ator || assoc[i].caso === assoc[j].caso) continue;
      if (lado2(u[0], u[1], v[0]) * lado2(u[0], u[1], v[1]) < 0 && lado2(v[0], v[1], u[0]) * lado2(v[0], v[1], u[1]) < 0) nota += 60;
    }
    // atores longe dos seus casos (linhas compridas e inclinadas)
    for (const s of assoc) { const a = pl.posAtor[s.ator], c = pl.pos[s.caso]; if (a && c) nota += Math.abs(a.cy - (c.y + H / 2)) / 100; }
    return nota;
  }

  // começo: casos agrupados pelo ator que os usa (ordem dos atores), depois busca local por trocas
  const ordemAtor = Object.fromEntries(atores.map((a, i) => [a.id, i]));
  const peso = (c) => { const xs = assoc.filter((s) => s.caso === c.id).map((s) => ordemAtor[s.ator]); return xs.length ? Math.min(...xs) + xs.length / 100 : 99; };
  let ordem = [...casos].sort((a, b) => peso(a) - peso(b));
  let melhor = planejar(ordem), notaMelhor = pontuar(melhor);
  for (let rodada = 0, mudou = true; mudou && rodada < 80; rodada++) {
    mudou = false;
    for (let i = 0; i < ordem.length && !mudou; i++) for (let j = 0; j < ordem.length && !mudou; j++) {
      if (i === j) continue;
      const nova = [...ordem];
      const [c] = nova.splice(i, 1);
      nova.splice(j, 0, c);
      const pl = planejar(nova), n = pontuar(pl);
      if (n < notaMelhor - 1e-6) { ordem = nova; melhor = pl; notaMelhor = n; mudou = true; }
    }
  }

  const { pos, posAtor, bw, bh } = melhor;
  forma(els, { x: bx, y: by, w: bw, h: bh, fundo: "transparent", traco: LINHA, espessura: 2 });
  texto(els, { x: bx + 18, y: by + 12, t: u.sistema, tam: 16, cor: TINTA });
  const formas = {};
  for (const c of casos) if (pos[c.id]) formas[c.id] = forma(els, { tipo: "ellipse", ...pos[c.id], t: c.nome, tam: 14, fundo: UML.caso, traco: UML.traco });
  for (const a of atores) if (posAtor[a.id]) ator(els, a, posAtor[a.id].cx, posAtor[a.id].topo);
  for (const s of assoc) {
    const a = posAtor[s.ator], c = pos[s.caso];
    if (!a || !c) continue;
    const p0 = a.cx < c.x ? [a.cx + 24, a.cy] : [a.cx - 24, a.cy];
    // chega no ponto extremo da elipse (esquerdo ou direito): assim a reta fica sempre por fora das outras elipses da coluna
    seta(els, [p0, a.cx < c.x ? [c.x, c.y + H / 2] : [c.x + c.w, c.y + H / 2]], { para: formas[s.caso].id, ponta: null, cor: LINHA });
  }
  // include/extend: vizinhos em reta; os demais contornam pelo lado com menos associações
  const nEsq = assoc.filter((s) => ladoDe[s.ator] === "esq").length, nDir = assoc.length - nEsq;
  const ladoContorno = nDir <= nEsq ? "dir" : "esq";
  let k = 0, kc = 0; // k: retas entre vizinhos; kc: contornos
  for (const r of rels) {
    const a = pos[r.de], b = pos[r.para];
    if (!a || !b) continue;
    const rot = r.tipo === "extend" ? `«extend»${r.condicao ? `\n[${r.condicao}]` : ""}` : "«include»";
    const desce = b.y > a.y;
    let pts;
    if (Math.abs(a.i - b.i) === 1) {
      // vizinhos: reta vertical entre as elipses, um pouco deslocada se houver mais de uma no mesmo vão
      const x = a.x + W / 2 + (k % 2 ? 40 : -40) * Math.ceil(k / 2);
      pts = [[x, desce ? a.y + H : a.y], [x, desce ? b.y : b.y + H]];
    } else {
      // contorno a 34 px das pontas das elipses (a 16 parecia colado) e saindo/chegando 14 px fora do
      // meio, para não nascer no mesmo ponto onde chega a associação do ator
      const sinal = ladoContorno === "dir" ? 1 : -1;
      const x = ladoContorno === "dir" ? a.x + W + 34 + kc * 22 : a.x - 34 - kc * 22;
      kc++;
      const dy = desce ? 14 : -14;
      const borda = (c, yy) => c.x + W / 2 + sinal * (W / 2) * Math.sqrt(1 - ((yy - c.y - H / 2) / (H / 2)) ** 2);
      const ya = a.y + H / 2 + dy, yb = b.y + H / 2 - dy;
      pts = [[borda(a, ya), ya], [x, ya], [x, yb], [borda(b, yb), yb]];
    }
    k++;
    seta(els, pts, { de: formas[r.de].id, para: formas[r.para].id, rotulo: rot, tracejado: true, cor: SUAVE, ponta: "arrow" });
  }
  // nomes dos atores (com halo) por cima das linhas
  const nomes = els.filter((e) => e.customData?.nomeAtor);
  for (const e of nomes) els.splice(els.indexOf(e), 1);
  els.push(...nomes);
}

/* ---------- 2. BPMN: processo ---------- */
function processo(els, p, nomePool, X, Y) {
  const elementos = p.elementos || [];
  const fluxos = p.fluxos || [];
  const porId = Object.fromEntries(elementos.map((e) => [e.id, e]));
  // fluxos de volta (laços): DFS a partir do início
  const volta = new Set(), visto = new Set(), pilha = new Set();
  const saidas = (id) => fluxos.filter((f) => f.de === id);
  const dfs = (id) => { visto.add(id); pilha.add(id); for (const f of saidas(id)) { if (pilha.has(f.para)) volta.add(f); else if (!visto.has(f.para)) dfs(f.para); } pilha.delete(id); };
  const ini = elementos.find((e) => e.tipo.startsWith("inicio"));
  if (ini) dfs(ini.id);
  for (const e of elementos) if (!visto.has(e.id)) dfs(e.id);
  // coluna = caminho mais longo sem os laços
  const col = Object.fromEntries(elementos.map((e) => [e.id, 0]));
  for (let i = 0; i < elementos.length; i++) for (const f of fluxos) if (!volta.has(f) && col[f.para] <= col[f.de]) col[f.para] = col[f.de] + 1;
  // fim compartilhado fica na coluna mais à direita de quem chega nele (já é, pelo caminho mais longo)
  const raias = p.raias || [];
  const linhaDe = {};
  const ocupado = {};
  // fileira: a de quem chega no elemento pela mesma raia, se estiver livre (o fluxo segue reto; com a
  // primeira livre, "Avisar a falha" na fileira 1 levava ao fim posto na fileira 0, ao lado do Deploy,
  // e a leitura trocava os dois fins); senão a primeira livre
  for (const e of [...elementos].sort((a, b) => col[a.id] - col[b.id])) {
    const k = `${e.raia}|${col[e.id]}`;
    const usadas = (ocupado[k] ||= new Set());
    const preferidas = fluxos.filter((f) => f.para === e.id && !volta.has(f) && porId[f.de]?.raia === e.raia && linhaDe[f.de] != null).map((f) => linhaDe[f.de]);
    let linha = preferidas.find((l) => !usadas.has(l));
    if (linha == null) { linha = 0; while (usadas.has(linha)) linha++; }
    linhaDe[e.id] = linha;
    usadas.add(linha);
  }
  const linhasDaRaia = Object.fromEntries(raias.map((r) => [r.id, Math.max(1, ...elementos.filter((e) => e.raia === r.id).map((e) => linhaDe[e.id] + 1))]));
  const COLW = 200, ROWH = 110, POOLBAND = 34, LANEBAND = 36, X0 = X + POOLBAND + LANEBAND + 40;
  const ncols = Math.max(...Object.values(col)) + 1;
  const larguraTotal = POOLBAND + LANEBAND + 40 + ncols * COLW + 20;

  // pools externos em cima (cada um cobre a faixa x das suas mensagens)
  const msgs = p.mensagens || [];
  const extIds = (p.externos || []).map((x) => x.id);
  const xMsg = (el) => X0 + col[el] * COLW + 75;
  const faixaExt = (p.externos || []).map((x) => {
    const xs = msgs.filter((m) => m.de === x.id || m.para === x.id).map((m) => xMsg(m.de === x.id ? m.para : m.de));
    const a = xs.length ? Math.min(...xs) - 110 : X0, b = xs.length ? Math.max(...xs) + 110 : X0 + 260;
    return { x, a: Math.max(X + POOLBAND + LANEBAND, Math.min(a, b - 240)), b: Math.max(b, a + 240) };
  });
  const filas = [];
  for (const f of faixaExt.sort((p1, p2) => p1.a - p2.a)) {
    let k = filas.findIndex((fila) => fila.every((g) => g.b + 20 < f.a || f.b + 20 < g.a));
    if (k < 0) { filas.push([]); k = filas.length - 1; }
    filas[k].push(f); f.fila = k;
  }
  // fileiras de pools alternam em cima e embaixo do processo (BPMN permite os dois): com duas
  // fileiras no mesmo lado, a mensagem até a de fora atravessaria a de dentro
  const POOLH = 46;
  const emCima = (f) => f.fila % 2 === 0, nivelPool = (f) => Math.floor(f.fila / 2);
  const nCima = Math.ceil(filas.length / 2);
  const topoLanes = Y + nCima * (POOLH + 16) + (nCima ? 50 : 0);
  // pool interno com raias
  let yr = topoLanes;
  const topoRaia = {}, alturaRaia = {};
  // folga em cima e embaixo de cada raia: os contornos de fluxo passam dentro da própria raia
  const lacosDaRaia = (id) => [...volta].filter((f) => porId[f.de]?.raia === id).length;
  raias.forEach((r) => { topoRaia[r.id] = yr; alturaRaia[r.id] = linhasDaRaia[r.id] * ROWH + 80 + Math.min(3, lacosDaRaia(r.id)) * 18; yr += alturaRaia[r.id]; });
  const alturaPool = yr - topoLanes;
  const extPos = {};
  for (const f of faixaExt) {
    // a fileira mais perto do processo é a de nível 0
    const y = emCima(f) ? topoLanes - 50 - POOLH - nivelPool(f) * (POOLH + 16) : yr + 50 + nivelPool(f) * (POOLH + 16);
    extPos[f.x.id] = forma(els, { x: f.a, y, w: f.b - f.a, h: POOLH, t: f.x.nome, tam: 15, fundo: BPMN.externo, traco: LINHA, espessura: 2, redondo: false });
    extPos[f.x.id].embaixo = !emCima(f);
  }
  forma(els, { x: X, y: topoLanes, w: larguraTotal, h: alturaPool, fundo: "transparent", traco: LINHA, espessura: 2, redondo: false });
  forma(els, { x: X, y: topoLanes, w: POOLBAND, h: alturaPool, fundo: BPMN.pool, traco: BPMN.pool, redondo: false });
  {
    const t = quebrar(nomePool, alturaPool - 20, 15), w = largura(t, 15) + 4, h = 15 * 1.25 * t.split("\n").length;
    texto(els, { x: X + POOLBAND / 2 - w / 2, y: topoLanes + alturaPool / 2 - h / 2, t, tam: 15, cor: "#FFFFFF", angulo: (3 * Math.PI) / 2, maxPx: alturaPool - 20 });
  }
  raias.forEach((r, i) => {
    const c = BPMN.raias[i % BPMN.raias.length];
    const y = topoRaia[r.id], h = alturaRaia[r.id];
    forma(els, { x: X + POOLBAND, y, w: larguraTotal - POOLBAND, h, fundo: c.fundo, traco: LINHA, redondo: false });
    forma(els, { x: X + POOLBAND, y, w: LANEBAND, h, fundo: c.cab, traco: LINHA, redondo: false });
    const t = quebrar(r.nome, h - 16, 12), w = largura(t, 12) + 4, hh = 12 * 1.25 * t.split("\n").length;
    texto(els, { x: X + POOLBAND + LANEBAND / 2 - w / 2, y: y + h / 2 - hh / 2, t, tam: 12, cor: c.traco, angulo: (3 * Math.PI) / 2, maxPx: h - 16 });
  });

  // elementos
  const cor = Object.fromEntries(raias.map((r, i) => [r.id, BPMN.raias[i % BPMN.raias.length]]));
  const pos = {};
  for (const e of elementos) {
    const cx = X0 + col[e.id] * COLW + 75;
    const cy = topoRaia[e.raia] + 40 + linhaDe[e.id] * ROWH + ROWH / 2;
    const g = novoId();
    if (e.tipo === "tarefa") {
      const f = forma(els, { x: cx - 75, y: cy - 32, w: 150, h: 64, t: e.nome, tam: 13, fundo: "#FFFFFF", traco: cor[e.raia].traco, espessura: 2 });
      pos[e.id] = { ...f, cx, cy, meiaL: 75, meiaA: 32 };
    } else if (e.tipo === "gateway") {
      const f = forma(els, { tipo: "diamond", x: cx - 24, y: cy - 24, w: 48, h: 48, fundo: BPMN.gateway.fundo, traco: BPMN.gateway.traco, espessura: 2, grupo: g });
      linha(els, [[cx - 8, cy - 8], [cx + 8, cy + 8]], { cor: BPMN.gateway.traco, espessura: 2, grupo: g });
      linha(els, [[cx + 8, cy - 8], [cx - 8, cy + 8]], { cor: BPMN.gateway.traco, espessura: 2, grupo: g });
      // nome do gateway: acima por convenção, mas o posicionador o tira do caminho das linhas
      pendentes.push({ tipo: "forma", caixa: { x0: cx - 24, y0: cy - 24, x1: cx + 24, y1: cy + 24 }, texto: quebrar(e.nome, 130, 12), tam: 12, cor: TINTA, grupo: g, ordem: ["cima", "baixo", "direita", "esquerda"] });
      pos[e.id] = { ...f, cx, cy, meiaL: 24, meiaA: 24 };
    } else {
      const fim = e.tipo === "fim";
      const c = fim ? BPMN.fim : BPMN.inicio;
      const f = forma(els, { tipo: "ellipse", x: cx - 19, y: cy - 19, w: 38, h: 38, fundo: c.fundo, traco: c.traco, espessura: fim ? 4 : 2, grupo: g });
      if (e.tipo === "inicio-timer") {
        forma(els, { tipo: "ellipse", x: cx - 12, y: cy - 12, w: 24, h: 24, fundo: "#FFFFFF", traco: c.traco, grupo: g });
        linha(els, [[cx, cy], [cx, cy - 8]], { cor: c.traco, grupo: g });
        linha(els, [[cx, cy], [cx + 6, cy + 3]], { cor: c.traco, grupo: g });
      } else if (e.tipo === "inicio-mensagem") {
        forma(els, { x: cx - 10, y: cy - 7, w: 20, h: 14, fundo: "#FFFFFF", traco: c.traco, redondo: false, grupo: g });
        linha(els, [[cx - 10, cy - 7], [cx, cy + 1], [cx + 10, cy - 7]], { cor: c.traco, grupo: g });
      }
      pendentes.push({ tipo: "forma", caixa: { x0: cx - 19, y0: cy - 19, x1: cx + 19, y1: cy + 19 }, texto: quebrar(e.nome, 120, 12), tam: 12, cor: TINTA, grupo: g, ordem: ["baixo", "cima", "direita", "esquerda"] });
      pos[e.id] = { ...f, cx, cy, meiaL: 19, meiaA: 19 };
    }
  }

  // fluxos de sequência (ângulos retos). Cada fluxo tenta caminhos em ordem de preferência e fica
  // com o primeiro que não atravessa outro elemento: reto, em L, em degrau, e por fim contornando
  // por baixo ou por cima da fileira (laços de volta vão sempre por baixo).
  const caixas = Object.entries(pos).map(([id, q]) => ({ id, x0: q.cx - q.meiaL - 6, x1: q.cx + q.meiaL + 6, y0: q.cy - q.meiaA - 6, y1: q.cy + q.meiaA + 6 }));
  // pools externos também são obstáculo para os fluxos de sequência
  for (const [id, q] of Object.entries(extPos)) caixas.push({ id: "pool:" + id, x0: q.x - 4, x1: q.x + q.w + 4, y0: q.y - 4, y1: q.y + q.h + 4 });
  const corta = (pts, ignorar) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const sx0 = Math.min(x1, x2), sx1 = Math.max(x1, x2), sy0 = Math.min(y1, y2), sy1 = Math.max(y1, y2);
      for (const c of caixas) if (!ignorar.includes(c.id) && sx0 <= c.x1 && sx1 >= c.x0 && sy0 <= c.y1 && sy1 >= c.y0) return true;
    }
    return false;
  };
  const desvio = {};
  const ladosGw = {}; // lados por onde cada gateway já soltou um ramo
  // trechos já traçados: rota que corre colada a outra por 20px ou mais fica para depois
  const usados = [];
  const pontas = []; // começo e ponta de cada seta já traçada (mensagem não sai colada a uma ponta)
  const trilho = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      for (const [c, d] of usados) {
        let comum = 0;
        if (Math.abs(a[1] - b[1]) < 1 && Math.abs(c[1] - d[1]) < 1 && Math.abs(a[1] - c[1]) < 18)
          comum = Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]));
        if (Math.abs(a[0] - b[0]) < 1 && Math.abs(c[0] - d[0]) < 1 && Math.abs(a[0] - c[0]) < 18)
          comum = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]));
        if (comum >= 20) return true;
      }
    }
    return false;
  };
  // quantos contornos já saem/chegam por cima/baixo de cada elemento: o próximo sai deslocado,
  // senão dois laços sobem pela mesma linha vertical
  const portas = {};
  const desloca = [0, 24, -24, 48, -48];
  const contorno = (a, b, lado) => {
    const k = (desvio[lado] || 0) + 1; // conta só contornos traçados (ver a escolha abaixo), não candidatos
    const y = lado === "baixo" ? Math.max(a.cy + a.meiaA, b.cy + b.meiaA) + 16 + k * 18 : Math.min(a.cy - a.meiaA, b.cy - b.meiaA) - 16 - k * 18;
    const sa = lado === "baixo" ? a.cy + a.meiaA : a.cy - a.meiaA, sb = lado === "baixo" ? b.cy + b.meiaA : b.cy - b.meiaA;
    const ka = `${a.id}|${lado}`, kb = `${b.id}|${lado}`;
    const xa = a.cx + Math.max(-a.meiaL + 6, Math.min(a.meiaL - 6, desloca[(portas[ka] || 0) % 5]));
    const xb = b.cx + Math.max(-b.meiaL + 6, Math.min(b.meiaL - 6, desloca[(portas[kb] || 0) % 5]));
    return { pts: [[xa, sa], [xa, y], [xb, y], [xb, sb]], lx: (xa + xb) / 2, ly: lado === "baixo" ? y + 3 : y - 18, portas: [ka, kb], lado };
  };
  for (const f of fluxos) {
    const a = pos[f.de], b = pos[f.para];
    if (!a || !b) continue;
    const gw = porId[f.de].tipo === "gateway";
    const ign = [f.de, f.para];
    const opcoes = [];
    if (volta.has(f) || b.cx <= a.cx) opcoes.push(contorno(a, b, "baixo"), contorno(a, b, "cima"));
    else {
      if (Math.abs(a.cy - b.cy) < 2) opcoes.push({ pts: [[a.cx + a.meiaL, a.cy], [b.cx - b.meiaL, b.cy]], lx: a.cx + a.meiaL + 22, ly: a.cy - 20 });
      if (gw && Math.abs(a.cy - b.cy) >= 2) {
        const sy = b.cy > a.cy ? a.cy + a.meiaA : a.cy - a.meiaA;
        opcoes.push({ pts: [[a.cx, sy], [a.cx, b.cy], [b.cx - b.meiaL, b.cy]], lx: a.cx + 26, ly: (sy + b.cy) / 2 - 8 });
      }
      if (Math.abs(a.cy - b.cy) >= 2) {
        for (const mx of [a.cx + a.meiaL + 22, b.cx - b.meiaL - 22]) {
          opcoes.push({ pts: [[a.cx + a.meiaL, a.cy], [mx, a.cy], [mx, b.cy], [b.cx - b.meiaL, b.cy]], lx: mx + 20, ly: (a.cy + b.cy) / 2 });
        }
        // sobe/desce primeiro e segue na altura do destino
        const sy = b.cy > a.cy ? a.cy + a.meiaA : a.cy - a.meiaA;
        opcoes.push({ pts: [[a.cx, sy], [a.cx, b.cy], [b.cx - b.meiaL, b.cy]], lx: a.cx + 26, ly: (sy + b.cy) / 2 - 8 });
      }
      opcoes.push(contorno(a, b, "baixo"), contorno(a, b, "cima"));
    }
    // último recurso antes de cruzar: correr pela margem de baixo/cima da raia de origem ou de destino
    for (const raiaId of new Set([porId[f.de].raia, porId[f.para].raia])) {
      const t = topoRaia[raiaId], h = alturaRaia[raiaId];
      for (const [yy, sa, sb] of [[t + h - 10, a.cy + a.meiaA, b.cy + b.meiaA], [t + 10, a.cy - a.meiaA, b.cy - b.meiaA]]) {
        opcoes.push({ pts: [[a.cx, sa], [a.cx, yy], [b.cx, yy], [b.cx, sb]], lx: (a.cx + b.cx) / 2, ly: yy - 16 });
      }
    }
    const lado = (o) => { const [p, q] = o.pts; return Math.abs(p[1] - q[1]) < 1 ? "dir" : q[1] > p[1] ? "baixo" : "cima"; };
    const ladoLivre = (o) => !gw || !(ladosGw[f.de] || new Set()).has(lado(o));
    const escolhida = opcoes.find((o) => !corta(o.pts, ign) && !trilho(o.pts) && ladoLivre(o)) || opcoes.find((o) => !corta(o.pts, ign) && !trilho(o.pts))
      || opcoes.find((o) => !corta(o.pts, ign)) || opcoes[0];
    if (gw) (ladosGw[f.de] ||= new Set()).add(lado(escolhida));
    for (const k of escolhida.portas || []) portas[k] = (portas[k] || 0) + 1;
    if (escolhida.lado) desvio[escolhida.lado] = (desvio[escolhida.lado] || 0) + 1;
    seta(els, escolhida.pts, { de: a.id, para: b.id, cor: LINHA, espessura: 1, rotulo: f.rotulo, tam: 12, perto: "inicio", corRotulo: TINTA, ponta: "triangle" });
    usados.push(...escolhida.pts.slice(1).map((pt, i) => [escolhida.pts[i], pt]));
    pontas.push(escolhida.pts[0], escolhida.pts[escolhida.pts.length - 1]);
  }

  // fluxos de mensagem: tracejados, verticais, entre o elemento e o pool externo
  const cortaNos = corta;
  const porElemento = {};
  for (const m of msgs) {
    const deExt = extIds.includes(m.de);
    const idEl = deExt ? m.para : m.de; // id da especificação: é o que a lista de obstáculos usa
    const el = pos[idEl], ex = extPos[deExt ? m.de : m.para];
    if (!el || !ex) continue;
    const n = (porElemento[el.id] = (porElemento[el.id] || 0) + 1);
    // pool em cima: sai pela borda de cima do elemento e chega no pé do pool; embaixo, o contrário
    const baixo = ex.embaixo;
    const yEl = baixo ? el.cy + el.meiaA : el.cy - el.meiaA, yEx = baixo ? ex.y : ex.y + ex.h;
    // os outros pools externos também são obstáculo (com duas fileiras de pools, a linha até o de
    // cima cortaria o de baixo)
    const outrosPools = Object.entries(extPos).filter(([id]) => id !== ex.id && id !== (deExt ? m.de : m.para));
    const corta = (pts, ign) => cortaNos(pts, ign) || pts.some((p, i) => i < pts.length - 1 && outrosPools.some(([, q]) => {
      const [x1, y1] = p, [x2, y2] = pts[i + 1];
      return Math.min(x1, x2) <= q.x + q.w && Math.max(x1, x2) >= q.x && Math.min(y1, y2) <= q.y + q.h && Math.max(y1, y2) >= q.y;
    }));
    // rota por custo entre todos os candidatos (a primeira "livre" saía ao lado da ponta de um laço,
    // raspava a lateral de tarefas e cruzava fluxos; revisões 3 e 4): atravessar forma ou pool é
    // proibido; colar em outra linha ou em borda de raia, raspar caixa e sair perto de ponta de seta
    // custam caro; cada cruzamento custa; depois comprimento e dobras
    const raiaEl = porId[deExt ? m.para : m.de].raia;
    const bordas = [];
    for (const r of raias) {
      const t = topoRaia[r.id], b = t + alturaRaia[r.id], X1 = X + larguraTotal;
      bordas.push([[X, t], [X1, t]], [[X, b], [X1, b]]);
    }
    bordas.push([[X + larguraTotal, topoRaia[raias[0].id]], [X + larguraTotal, yr]]);
    const paralelo = (a, b, c, d) => {
      // distância e trecho comum entre dois segmentos paralelos (ou null)
      const h = (p, q) => Math.abs(p[1] - q[1]) < 1, v = (p, q) => Math.abs(p[0] - q[0]) < 1;
      if (h(a, b) && h(c, d)) return [Math.abs(a[1] - c[1]), Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]))];
      if (v(a, b) && v(c, d)) return [Math.abs(a[0] - c[0]), Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]))];
      return null;
    };
    const cruza = (a, b, c, d) => {
      const hv = (p, q, r, s2) => Math.abs(p[1] - q[1]) < 1 && Math.abs(r[0] - s2[0]) < 1 &&
        r[0] > Math.min(p[0], q[0]) + 1 && r[0] < Math.max(p[0], q[0]) - 1 && p[1] > Math.min(r[1], s2[1]) + 1 && p[1] < Math.max(r[1], s2[1]) - 1;
      return hv(a, b, c, d) || hv(c, d, a, b);
    };
    const caixasReais = Object.entries(pos).filter(([id]) => id !== idEl).map(([, q]) => ({ x0: q.cx - q.meiaL, x1: q.cx + q.meiaL, y0: q.cy - q.meiaA, y1: q.cy + q.meiaA }));
    const preferido = el.cx + (n % 2 ? 1 : -1) * Math.min(22, Math.max(0, el.meiaL - 10));
    const custo = (p) => {
      if (corta(p, [idEl, "pool:" + (deExt ? m.de : m.para)]) || p.some(([px]) => px < X0 - 30)) return Infinity;
      let v = 0;
      for (let i = 0; i < p.length - 1; i++) {
        const [a, b] = [p[i], p[i + 1]];
        for (const [c, d] of usados) {
          const par = paralelo(a, b, c, d);
          if (par && par[0] < 20 && par[1] > 10) v += 300 + par[1];
          else if (par && par[0] < 3 && par[1] > -40) v += 150; // na mesma reta com vão curto: lê como uma linha só
          if (cruza(a, b, c, d)) v += 60;
        }
        for (const [c, d] of bordas) { const par = paralelo(a, b, c, d); if (par && par[0] < 16 && par[1] > 20) v += 200 + par[1]; }
        for (const q of caixasReais) {
          const vert = Math.abs(a[0] - b[0]) < 1;
          const dist = vert ? Math.min(Math.abs(a[0] - q.x0), Math.abs(a[0] - q.x1)) : Math.min(Math.abs(a[1] - q.y0), Math.abs(a[1] - q.y1));
          const comum = vert ? Math.min(Math.max(a[1], b[1]), q.y1) - Math.max(Math.min(a[1], b[1]), q.y0) : Math.min(Math.max(a[0], b[0]), q.x1) - Math.max(Math.min(a[0], b[0]), q.x0);
          if (dist < 18 && comum > 10) v += 250;
        }
        v += 0.02 * Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      for (const [px, py] of pontas) if (Math.hypot(px - p[0][0], py - p[0][1]) < 26) v += 250;
      for (const [px, py] of pontas) if (p.slice(1).some(([qx, qy]) => Math.hypot(px - qx, py - qy) < 20)) v += 200;
      return v + (p.length - 2) * 12 + 0.3 * Math.abs(p[0][0] - preferido);
    };
    const cands = [];
    const xs = [];
    for (let dx = -el.meiaL + 8; dx <= el.meiaL - 8; dx += 8) xs.push(el.cx + dx);
    for (const x0 of xs) cands.push([[x0, yEl], [x0, yEx]]);
    const vao = baixo ? yEl + 22 : yEl - 22;
    const margem = baixo ? topoRaia[raiaEl] + alturaRaia[raiaEl] - 22 : topoRaia[raiaEl] + 22;
    for (const x0 of xs.filter((_, i) => i % 2 === 0)) for (const yy of [vao, (yEl + margem) / 2, margem]) {
      for (let d = 60; d <= 420; d += 30) for (const sgn of [1, -1]) cands.push([[x0, yEl], [x0, yy], [x0 + sgn * d, yy], [x0 + sgn * d, yEx]]);
    }
    let ida = null, melhor = Infinity;
    for (const p of cands) { const v = custo(p); if (v < melhor) { melhor = v; ida = p; } }
    const x0 = preferido;
    ida ||= [[x0, yEl], [x0, yEx]];
    usados.push(...ida.slice(1).map((pt, i) => [ida[i], pt]));
    {
      const xf = ida[ida.length - 1][0];
      if (xf < ex.x + 24 || xf > ex.x + ex.w - 24) {
        const nx0 = Math.min(ex.x, xf - 70), nx1 = Math.max(ex.x + ex.w, xf + 70);
        const bate = Object.values(extPos).some((q) => q !== ex && q.y === ex.y && q.x < nx1 + 12 && q.x + q.w > nx0 - 12);
        if (!bate) {
          ex.x = nx0; ex.w = nx1 - nx0;
          ex.el.x = nx0; ex.el.width = ex.w;
          const t = els.find((e) => e.containerId === ex.id);
          if (t) { t.x = nx0 + 10; t.width = ex.w - 20; }
        } else {
          // degrau: perto do pool, a mensagem anda de lado até entrar nele
          const xd = Math.max(ex.x + 30, Math.min(ex.x + ex.w - 30, xf));
          const yd = baixo ? yEx - 14 : yEx + 14;
          ida.splice(ida.length - 1, 1, [xf, yd], [xd, yd], [xd, yEx]);
        }
      }
    }
    const x = ida[ida.length - 1][0];
    const pts = deExt ? [...ida].reverse() : ida;
    void x;
    seta(els, pts, { de: deExt ? ex.id : el.id, para: deExt ? el.id : ex.id, tracejado: true, cor: SUAVE, inicio: "dot", ponta: "arrow", rotulo: m.rotulo, tam: 12, perto: deExt ? "inicio" : "fim" });
  }
}

/* ---------- 3. C4: containers ---------- */
// texto empilhado e centrado na vertical dentro de um cartão (nome, [tipo], descrição): cada linha
// começa onde a anterior termina, então nome que quebra em duas linhas não cobre o [tipo]
function pilha(els, cx, topo, alto, linhas, grupo) {
  const altura = linhas.map((l) => quebrar(l.t, l.maxPx, l.tam).split("\n").length * l.tam * 1.25);
  const total = altura.reduce((a, b) => a + b, 0) + (linhas.length - 1) * 5;
  let y = topo + Math.max(6, (alto - total) / 2);
  linhas.forEach((l, i) => {
    texto(els, { x: cx, y, t: l.t, tam: l.tam, cor: l.cor, alinhar: "center", maxPx: l.maxPx, grupo });
    y += altura[i] + 5;
  });
}
// C4 com o ELK (Eclipse Layout Kernel, algoritmo em camadas): pessoas na primeira camada, sistemas
// externos na última, containers dentro da fronteira do sistema (nó composto). O ELK faz a ordem que
// minimiza cruzamentos, as rotas ortogonais com portas distribuídas e a posição dos rótulos.
const elk = new ELK();
const ehArquivo = (t) => /\b(json|jsonl|markdown|md|csv|png|svg|css|html|arquivo|arquivos|pasta|yaml|txt|pdf)\b/i.test(t || "");

async function c4(els, c, X, Y) {
  const pessoas = c.pessoas || [], conts = c.containers || [], exts = c.externos || [];
  const rel = (c.relacoes || []).filter((r) => r.de !== r.para);
  const CW = 230, CH = 130, PH = 156, EH = 110;
  // pessoas presas na primeira camada e externos na última; quem se liga a outro do mesmo grupo fica
  // livre (o ELK não liga dois nós presos na mesma camada: IndexOutOfBounds, visto em ryze-identidade)
  const idsPessoas = new Set(pessoas.map((p) => p.id)), idsExts = new Set(exts.map((e) => e.id));
  const travaCamada = (id, grupo, camada) =>
    rel.some((r) => (r.de === id && grupo.has(r.para)) || (r.para === id && grupo.has(r.de))) ? {} : { "elk.layered.layering.layerConstraint": camada };
  const rotuloDe = (r) => quebrar(r.tecnologia ? `${r.rotulo}\n[${r.tecnologia}]` : r.rotulo, 150, 12);
  const medida = (t) => ({ width: Math.ceil(largura(t, 12)) + 10, height: t.split("\n").length * 15 + 4 });
  // o ELK lê o espaçamento do nó pai de cada grafo: sem repetir dentro da fronteira, as linhas lá
  // dentro saíam no padrão (~10 px, feixes ilegíveis e linha raspando a lateral das caixas)
  const espacos = {
    "elk.spacing.nodeNode": "80", "elk.layered.spacing.nodeNodeBetweenLayers": "110",
    "elk.spacing.edgeNode": "40", "elk.spacing.edgeEdge": "28", "elk.layered.spacing.edgeNodeBetweenLayers": "36",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "26", "elk.spacing.edgeLabel": "6",
    "elk.layered.unnecessaryBendpoints": "false",
  };
  const grafo = {
    id: "raiz",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.edgeLabels.placement": "CENTER", ...espacos,
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP", "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.considerModelOrder.strategy": "NONE",
    },
    children: [
      ...pessoas.map((p) => ({ id: p.id, width: CW, height: PH, layoutOptions: travaCamada(p.id, idsPessoas, "FIRST") })),
      { id: "__sistema", layoutOptions: { ...espacos, "elk.padding": "[top=56,left=36,bottom=70,right=36]" }, children: conts.map((k) => ({ id: k.id, width: CW, height: CH })) },
      ...exts.map((e) => ({ id: e.id, width: CW, height: EH })),
    ],
    edges: rel.map((r, i) => {
      const t = rotuloDe(r);
      const sobe = idsExts.has(r.de) || idsPessoas.has(r.para);
      return { id: "r" + i, sources: [sobe ? r.para : r.de], targets: [sobe ? r.de : r.para], labels: [{ text: t, ...medida(t) }] };
    }),
  };
  const g = await elk.layout(grafo);
  // coordenadas absolutas: o ELK devolve filhos e setas relativos ao nó que os contém
  const abs = {};
  const andar = (n, ox, oy) => { for (const k of n.children || []) { abs[k.id] = { x: ox + k.x, y: oy + k.y, w: k.width, h: k.height }; andar(k, ox + k.x, oy + k.y); } };
  andar(g, X, Y);
  const origem = (cont) => (cont && cont !== "raiz" && abs[cont] ? [abs[cont].x, abs[cont].y] : [X, Y]);

  const pos = {};
  // fronteira do sistema
  const s = abs.__sistema;
  forma(els, { x: s.x, y: s.y, w: s.w, h: s.h, fundo: "transparent", traco: C4.fronteira, tracejado: true, espessura: 2, redondo: false });
  const nomeSistema = `${c.sistema}\n[Sistema de software]`;
  const segsC4 = [];
  // pessoas
  for (const p of pessoas) {
    const { x, y } = abs[p.id], g2 = novoId();
    forma(els, { tipo: "ellipse", x: x + CW / 2 - 28, y, w: 56, h: 56, fundo: C4.pessoa, traco: C4.pessoa, grupo: g2 });
    const f = forma(els, { x, y: y + 46, w: CW, h: 110, fundo: C4.pessoa, traco: C4.pessoa, grupo: g2 });
    pilha(els, x + CW / 2, y + 46, 110, [
      { t: p.nome, tam: 17, cor: "#FFFFFF", maxPx: CW - 20 },
      { t: "[Pessoa]", tam: 12, cor: "#C9D7EA", maxPx: CW - 16 },
      { t: p.descricao, tam: 12, cor: "#FFFFFF", maxPx: CW - 24 },
    ], g2);
    pos[p.id] = { id: f.id };
  }
  // containers
  const tiposUsados = new Set();
  for (const k of conts) {
    const { x, y } = abs[k.id], g2 = novoId();
    const banco = k.tipo === "banco" && !ehArquivo(k.tecnologia), arquivos = k.tipo === "arquivos" || (k.tipo === "banco" && ehArquivo(k.tecnologia));
    let f;
    if (banco && !arquivos) {
      // cilindro: fundo curvo embaixo, corpo, tampa em cima
      forma(els, { tipo: "ellipse", x, y: y + CH - 24, w: CW, h: 24, fundo: C4.banco, traco: "#1F4E89", grupo: g2 });
      f = forma(els, { x, y: y + 12, w: CW, h: CH - 24, fundo: C4.banco, traco: C4.banco, grupo: g2, redondo: false });
      linha(els, [[x, y + 12], [x, y + CH - 12]], { cor: "#1F4E89", grupo: g2 });
      linha(els, [[x + CW, y + 12], [x + CW, y + CH - 12]], { cor: "#1F4E89", grupo: g2 });
      forma(els, { tipo: "ellipse", x, y, w: CW, h: 24, fundo: "#3D80CC", traco: "#1F4E89", grupo: g2 });
      tiposUsados.add("banco");
    } else {
      f = forma(els, { x, y, w: CW, h: CH, fundo: C4.container, traco: "#1F4E89", grupo: g2, redondo: !arquivos });
      tiposUsados.add(arquivos ? "arquivos" : "container");
    }
    const tipo = arquivos ? "Arquivos" : banco ? "Banco" : k.tipo === "job" ? "Job" : k.tipo === "mobile" ? "App mobile" : k.tipo === "api" ? "API" : "Container";
    pilha(els, x + CW / 2, banco && !arquivos ? y + 14 : y, banco && !arquivos ? CH - 28 : CH, [
      { t: k.nome, tam: 16, cor: "#FFFFFF", maxPx: CW - 20 },
      { t: `[${tipo}: ${k.tecnologia}]`, tam: 11, cor: "#D6E4F5", maxPx: CW - 16 },
      { t: k.descricao, tam: 12, cor: "#FFFFFF", maxPx: CW - 24 },
    ], g2);
    pos[k.id] = { id: f.id };
  }
  // externos
  for (const e of exts) {
    const { x, y } = abs[e.id], g2 = novoId();
    const f = forma(els, { x, y, w: CW, h: EH, fundo: C4.externo, traco: "#4B5563", grupo: g2 });
    pilha(els, x + CW / 2, y, EH, [
      { t: e.nome, tam: 16, cor: "#FFFFFF", maxPx: CW - 20 },
      { t: "[Sistema externo]", tam: 11, cor: "#E5E7EB", maxPx: CW - 16 },
      { t: e.descricao, tam: 12, cor: "#FFFFFF", maxPx: CW - 24 },
    ], g2);
    pos[e.id] = { id: f.id };
  }
  // relações: rota e rótulo do ELK; rótulo com halo branco, no grupo da seta
  const todas = [];
  const coletar = (n) => { for (const e of n.edges || []) todas.push(e); for (const k of n.children || []) coletar(k); };
  coletar(g);
  for (const e of todas) {
    const r = rel[Number(e.id.slice(1))];
    const sec = e.sections?.[0];
    if (!r || !sec || !pos[r.de] || !pos[r.para]) continue;
    const [ox, oy] = origem(e.container);
    const sobe = idsExts.has(r.de) || idsPessoas.has(r.para);
    const ptsLayout = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint].map((p) => [ox + p.x, oy + p.y]);
    const pts = sobe ? ptsLayout.reverse() : ptsLayout;
    const seta1 = seta(els, pts, { de: pos[r.de].id, para: pos[r.para].id, cor: C4.seta, ponta: "triangle" });
    for (let i = 0; i < pts.length - 1; i++) segsC4.push([pts[i], pts[i + 1]]);
    const l = e.labels?.[0];
    if (l) {
      const gid = novoId();
      seta1.groupIds = [gid];
      const t = l.text;
      els.push(base({ id: novoId(), type: "rectangle", x: ox + l.x - 2, y: oy + l.y - 1, width: l.width + 4, height: l.height + 2,
        backgroundColor: "#FFFFFF", strokeColor: "transparent", strokeWidth: 0, roundness: null, groupIds: [gid], customData: { halo: true } }));
      els.push(base({ id: novoId(), type: "text", x: ox + l.x, y: oy + l.y + 2, width: l.width, height: l.height - 4, text: t, originalText: t,
        fontSize: 12, fontFamily: 2, textAlign: "center", verticalAlign: "top", containerId: null, lineHeight: 1.25, strokeColor: SUAVE,
        autoResize: true, groupIds: [gid] }));
    }
  }
  // nome do sistema: o canto interno da fronteira que nenhuma linha atravessa (convenção: embaixo à esquerda)
  {
    const w = Math.ceil(largura(nomeSistema, 13)) + 6, h = 2 * 13 * 1.25;
    const cantos = [[s.x + 16, s.y + s.h - h - 14], [s.x + s.w - w - 16, s.y + s.h - h - 14], [s.x + 16, s.y + 8], [s.x + s.w - w - 16, s.y + 8]];
    // custo do canto: linhas que passam por ele e caixas que ele encosta (caixa pesa mais)
    const caixasC4 = conts.map((k) => abs[k.id]);
    const cruza = ([x, y]) => segsC4.filter(([a, b]) => {
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      return x1 >= x && x0 <= x + w && y1 >= y && y0 <= y + h;
    }).length + 10 * caixasC4.filter((q) => q.x < x + w + 4 && q.x + q.w > x - 4 && q.y < y + h + 4 && q.y + q.h > y - 4).length;
    const [nx, ny] = cantos.reduce((m, k) => (cruza(k) < cruza(m) ? k : m), cantos[0]);
    const gNome = novoId();
    els.push(base({ id: novoId(), type: "rectangle", x: nx - 3, y: ny - 2, width: w + 6, height: h + 4, backgroundColor: "#FFFFFF",
      strokeColor: "transparent", strokeWidth: 0, roundness: null, groupIds: [gNome], customData: { halo: true } }));
    texto(els, { x: nx, y: ny, t: nomeSistema, tam: 13, cor: C4.fronteira, grupo: gNome });
  }
  // legenda: só os tipos que aparecem, logo abaixo do desenho
  const yLeg = Y + g.height + 24;
  const leg = [
    pessoas.length && ["Pessoa", C4.pessoa],
    tiposUsados.has("container") && ["Container", C4.container],
    tiposUsados.has("banco") && ["Banco de dados", C4.banco],
    tiposUsados.has("arquivos") && ["Arquivos", C4.container],
    exts.length && ["Sistema externo", C4.externo],
  ].filter(Boolean);
  leg.forEach(([nome, cor], i) => forma(els, { x: X + i * 150, y: yLeg, w: 136, h: 30, t: nome, tam: 12, cor: "#FFFFFF", fundo: cor, traco: cor }));
}

export async function desenhar(spec) {
  semente = 1;
  const els = [];
  const X = 0;
  let y = 0;
  texto(els, { x: X, y, t: spec.titulo, tam: 34, cor: TINTA });
  y += 52;
  if (spec.resumo) y += texto(els, { x: X, y, t: spec.resumo, tam: 16, cor: SUAVE, maxPx: 1300 }).h + 50;

  pendentes = [];
  y = cabecalho(els, X, y, 1, "Quem usa e para quê", "UML · diagrama de casos de uso", spec.titulo);
  let antes = els.length;
  casosDeUso(els, spec.casosDeUso || {}, X, y);
  rotular(els, antes);
  y = caixaDe(els, antes).y1 + 90;

  y = cabecalho(els, X, y, 2, spec.processo?.nome || "Processo principal", "BPMN 2.0 · processo com raias", spec.titulo);
  antes = els.length;
  processo(els, spec.processo || {}, spec.casosDeUso?.sistema || spec.arquitetura?.sistema || "Sistema", X, y);
  rotular(els, antes);
  y = caixaDe(els, antes).y1 + 90;

  y = cabecalho(els, X, y, 3, "Arquitetura", "Modelo C4 · nível 2, containers", spec.titulo);
  antes = els.length;
  await c4(els, spec.arquitetura || {}, X, y);
  rotular(els, antes);
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
  let feitos = 0, pulados = 0, invalidos = 0;
  for (const nome of specs) {
    const spec = JSON.parse(fs.readFileSync(path.join(SPECS, `${nome}.json`), "utf8"));
    const erros = validar(spec);
    if (erros.length) { invalidos++; console.log(`  ${nome}: especificação inválida (${erros[0]}${erros.length > 1 ? ` e mais ${erros.length - 1}` : ""})`); continue; }
    const destino = path.join(DIR, `${nome}.excalidraw`);
    if (fs.existsSync(destino) && !forcar) {
      const atual = JSON.parse(fs.readFileSync(destino, "utf8"));
      if (!atual.gerado || atual.gerado !== assinatura(atual)) { pulados++; console.log(`  ${nome}: editado à mão, mantido`); continue; }
    }
    let d;
    try {
      d = await desenhar(spec);
    } catch (e) {
      // um desenho com problema não derruba os outros: aparece no relatório e o arquivo antigo fica
      invalidos++;
      console.log(`  ${nome}: falhou ao desenhar (${String(e?.message || e).split("\n")[0].slice(0, 160)})`);
      continue;
    }
    d.gerado = assinatura(d);
    fs.writeFileSync(destino, JSON.stringify(d, null, 1));
    feitos++;
  }
  console.log(`${feitos} desenho(s) gerado(s), ${pulados} mantido(s) por terem sido editados, ${invalidos} com especificação inválida`);
}
