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

// seta (polilinha) presa às formas de origem e destino; rótulo opcional preso à seta
function seta(els, pontos, { de, para, rotulo, cor = LINHA, tracejado = false, ponta = "arrow", inicio = null, tam = 13, espessura = 1 } = {}) {
  const id = novoId();
  const [x0, y0] = pontos[0];
  const xs = pontos.map((p) => p[0]), ys = pontos.map((p) => p[1]);
  const el = base({ id, type: "arrow", x: x0, y: y0, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    points: pontos.map(([x, y]) => [x - x0, y - y0]), strokeColor: cor, strokeWidth: espessura, strokeStyle: tracejado ? "dashed" : "solid",
    lastCommittedPoint: null, startArrowhead: inicio, endArrowhead: ponta,
    startBinding: de ? { elementId: de, focus: 0, gap: 4 } : null, endBinding: para ? { elementId: para, focus: 0, gap: 4 } : null });
  els.push(el);
  for (const c of els) if (c.id === de || c.id === para) c.boundElements.push({ id, type: "arrow" });
  if (rotulo) {
    const tid = novoId();
    const q = quebrar(rotulo, 170, tam);
    const w = Math.ceil(largura(q, tam)) + 6, h = q.split("\n").length * tam * 1.25;
    const meio = pontos[Math.floor((pontos.length - 1) / 2)], prox = pontos[Math.floor((pontos.length - 1) / 2) + 1] || meio;
    const mx = (meio[0] + prox[0]) / 2, my = (meio[1] + prox[1]) / 2;
    el.boundElements.push({ id: tid, type: "text" });
    els.push(base({ id: tid, type: "text", x: mx - w / 2, y: my - h / 2, width: w, height: h, text: q, originalText: q, fontSize: tam,
      fontFamily: 2, textAlign: "center", verticalAlign: "middle", containerId: id, lineHeight: 1.25, strokeColor: SUAVE, autoResize: true }));
  }
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

function cabecalho(els, x, y, numero, titulo, notacao) {
  texto(els, { x, y, t: `${numero} · ${titulo}`, tam: 24, cor: TINTA });
  texto(els, { x, y: y + 34, t: notacao, tam: 14, cor: SUAVE });
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
  const r = texto(els, { x: cx, y: topo + 88, t: est + a.nome, tam: 14, alinhar: "center", maxPx: 150, grupo: g, cor: TINTA });
  return { x: cx - 24, y: topo, w: 48, h: 84, cx, cy: topo + 36, alto: 88 + r.h };
}

function casosDeUso(els, u, X, Y) {
  const W = 250, H = 66, VG = 30, PAD = 40, AX = 170, GAPC = 120;
  const lado = (a) => (a.tipo === "sistema" ? "dir" : "esq");
  const atores = u.atores || [];
  const assoc = (u.associacoes || []).filter((s) => atores.some((a) => a.id === s.ator));
  const rels = u.relacoes || [];
  const casos = u.casos || [];
  const ladoDe = Object.fromEntries(atores.map((a) => [a.id, lado(a)]));

  // geometria pura de uma arrumação (sem desenhar): elipses, atores e segmentos
  function planejar(colunas) {
    const usaDuas = colunas[1].length > 0;
    const bx = X + AX, by = Y;
    const colX = [bx + PAD, bx + PAD + W + GAPC];
    const altura = Math.max(1, ...colunas.map((c) => c.length)) * (H + VG) - VG;
    const bw = PAD * 2 + (usaDuas ? 2 * W + GAPC : W), bh = altura + PAD * 2 + 30;
    const pos = {};
    colunas.forEach((lista, k) => {
      const off = (altura - (lista.length * (H + VG) - VG)) / 2;
      lista.forEach((c, i) => (pos[c.id] = { x: colX[k], y: by + PAD + 30 + off + i * (H + VG), w: W, h: H }));
    });
    const posAtor = {};
    for (const ladoA of ["esq", "dir"]) {
      const lista = atores.filter((a) => lado(a) === ladoA).map((a) => {
        const ys = assoc.filter((s) => s.ator === a.id && pos[s.caso]).map((s) => pos[s.caso].y + H / 2);
        return { a, alvo: ys.length ? ys.reduce((p, q) => p + q, 0) / ys.length - 36 : by + bh / 2 };
      }).sort((p, q) => p.alvo - q.alvo);
      let minimo = by;
      for (const it of lista) {
        const topo = Math.max(it.alvo, minimo);
        const cx = ladoA === "esq" ? X + 60 : bx + bw + 110;
        posAtor[it.a.id] = { cx, cy: topo + 36, topo };
        minimo = topo + 150;
      }
    }
    const segs = [];
    for (const s of assoc) {
      const a = posAtor[s.ator], c = pos[s.caso];
      if (!a || !c) continue;
      const ponta = a.cx < c.x ? [a.cx + 24, a.cy] : [a.cx - 24, a.cy];
      segs.push({ tipo: "assoc", s, p0: ponta, p1: borda(c, ...ponta, true), fora: [s.caso] });
    }
    for (const r of rels) {
      const a = pos[r.de], b = pos[r.para];
      if (!a || !b) continue;
      const [ax, ay] = centro(a), [bx2, by2] = centro(b);
      segs.push({ tipo: "rel", r, p0: borda(a, bx2, by2, true), p1: borda(b, ax, ay, true), fora: [r.de, r.para] });
    }
    return { colunas, pos, posAtor, segs, bx, by, bw, bh };
  }

  // nota da arrumação: linha atravessando elipse pesa muito; cruzamento de linhas pesa pouco
  function pontuar(pl) {
    let nota = 0;
    const dentro = (x, y, e) => ((x - e.x - e.w / 2) / (e.w / 2 + 6)) ** 2 + ((y - e.y - e.h / 2) / (e.h / 2 + 6)) ** 2 < 1;
    for (const sg of pl.segs) {
      const [x1, y1] = sg.p0, [x2, y2] = sg.p1;
      const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 8));
      for (const [id, e] of Object.entries(pl.pos)) {
        if (sg.fora.includes(id)) continue;
        for (let k = 1; k < n; k++) if (dentro(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n, e)) { nota += 100; break; }
      }
    }
    const cruza = (a, b) => {
      const d = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      return d(a.p0, a.p1, b.p0) * d(a.p0, a.p1, b.p1) < 0 && d(b.p0, b.p1, a.p0) * d(b.p0, b.p1, a.p1) < 0;
    };
    for (let i = 0; i < pl.segs.length; i++) for (let j = i + 1; j < pl.segs.length; j++) if (cruza(pl.segs[i], pl.segs[j])) nota += 10;
    // caso usado só por ator da esquerda na coluna da direita (ou o contrário) alonga a linha
    for (const [k, lista] of pl.colunas.entries()) for (const c of lista) {
      for (const s of assoc.filter((x) => x.caso === c.id)) if ((ladoDe[s.ator] === "esq") !== (k === 0)) nota += 3;
    }
    return nota;
  }

  // começo: esquerda = usado por ator da esquerda; direita = o resto
  const daEsq = new Set(assoc.filter((s) => ladoDe[s.ator] === "esq").map((s) => s.caso));
  let colunas = [casos.filter((c) => daEsq.has(c.id)), casos.filter((c) => !daEsq.has(c.id))];
  if (!colunas[0].length) colunas = [colunas[1], []];
  let melhor = planejar(colunas), notaMelhor = pontuar(melhor);
  // busca local: troca dois casos de lugar ou move um para a outra coluna; aceita se a nota cai
  for (let rodada = 0, mudou = true; mudou && rodada < 60; rodada++) {
    mudou = false;
    const todos = colunas.flatMap((l, k) => l.map((c, i) => ({ k, i })));
    const tentativas = [];
    for (let p = 0; p < todos.length; p++) for (let q = p + 1; q < todos.length; q++) tentativas.push(["troca", todos[p], todos[q]]);
    for (const t of todos) for (let i = 0; i <= colunas[1 - t.k].length; i++) tentativas.push(["move", t, { k: 1 - t.k, i }]);
    for (const [tipo, a, b] of tentativas) {
      const nova = colunas.map((l) => [...l]);
      if (tipo === "troca") { const tmp = nova[a.k][a.i]; nova[a.k][a.i] = nova[b.k][b.i]; nova[b.k][b.i] = tmp; }
      else { const [c] = nova[a.k].splice(a.i, 1); nova[b.k].splice(b.i, 0, c); }
      if (!nova[0].length || Math.abs(nova[0].length - nova[1].length) > Math.max(3, Math.ceil(casos.length / 2))) continue;
      const pl = planejar(nova), n = pontuar(pl);
      if (n < notaMelhor) { colunas = nova; melhor = pl; notaMelhor = n; mudou = true; break; }
    }
  }

  // desenho da arrumação escolhida
  const { pos, posAtor, bx, by, bw, bh } = melhor;
  forma(els, { x: bx, y: by, w: bw, h: bh, fundo: "transparent", traco: LINHA, espessura: 2 });
  texto(els, { x: bx + 18, y: by + 12, t: u.sistema, tam: 16, cor: TINTA });
  const formas = {};
  for (const c of casos) if (pos[c.id]) formas[c.id] = forma(els, { tipo: "ellipse", ...pos[c.id], t: c.nome, tam: 14, fundo: UML.caso, traco: UML.traco });
  for (const a of atores) if (posAtor[a.id]) ator(els, a, posAtor[a.id].cx, posAtor[a.id].topo);
  // associação que atravessaria uma elipse dobra pelo vão entre as fileiras da coluna do meio do caminho
  const elipses = Object.entries(pos);
  const atravessa = (pts, fora) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 6));
      for (let k = 1; k < n; k++) {
        const x = x1 + ((x2 - x1) * k) / n, y = y1 + ((y2 - y1) * k) / n;
        for (const [id, e] of elipses) if (!fora.includes(id) && ((x - e.x - e.w / 2) / (e.w / 2 + 4)) ** 2 + ((y - e.y - e.h / 2) / (e.h / 2 + 4)) ** 2 < 1) return true;
      }
    }
    return false;
  };
  const vaos = [...new Set(elipses.map(([, e]) => e.y))].sort((p, q) => p - q).flatMap((y, i, ys) => (i ? [(ys[i - 1] + H + y) / 2] : [y - VG / 2])).concat([Math.max(...elipses.map(([, e]) => e.y)) + H + VG / 2]);
  for (const sg of melhor.segs) {
    if (sg.tipo === "assoc") {
      let pts = [sg.p0, sg.p1];
      if (atravessa(pts, sg.fora)) {
        const c = pos[sg.s.caso];
        const xs = elipses.map(([, e]) => e.x);
        const esq = sg.p0[0] < c.x;
        // coluna atravessada: a que fica entre o ator e o caso
        const colMeio = esq ? Math.min(...xs) : Math.max(...xs);
        const xa = esq ? colMeio - 14 : colMeio + W + 14, xb = esq ? colMeio + W + 14 : colMeio - 14;
        const cands = vaos.map((gy) => [sg.p0, [xa, gy], [xb, gy], borda(c, xb, gy, true)]).sort((p, q) => Math.abs(p[1][1] - sg.p0[1]) - Math.abs(q[1][1] - sg.p0[1]));
        pts = cands.find((p) => !atravessa(p, sg.fora)) || pts;
      }
      seta(els, pts, { para: formas[sg.s.caso].id, ponta: null, cor: LINHA });
    }
    else {
      const rot = sg.r.tipo === "extend" ? `«extend»${sg.r.condicao ? `\n[${sg.r.condicao}]` : ""}` : "«include»";
      let pts = [sg.p0, sg.p1];
      if (atravessa(pts, sg.fora)) {
        // contorna pela lateral da coluna (direita, depois esquerda)
        const a = pos[sg.r.de], b = pos[sg.r.para];
        const ay = a.y + H / 2, by2 = b.y + H / 2;
        const dir = Math.max(a.x, b.x) + W, esq = Math.min(a.x, b.x);
        pts = [[[dir, ay], [dir + 28, ay], [dir + 28, by2], [dir, by2]], [[esq, ay], [esq - 28, ay], [esq - 28, by2], [esq, by2]]]
          .find((p) => !atravessa(p, sg.fora)) || pts;
      }
      seta(els, pts, { de: formas[sg.r.de].id, para: formas[sg.r.para].id, rotulo: rot, tracejado: true, cor: SUAVE, ponta: "arrow" });
    }
  }
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
  for (const e of [...elementos].sort((a, b) => col[a.id] - col[b.id])) {
    const k = `${e.raia}|${col[e.id]}`;
    linhaDe[e.id] = ocupado[k] || 0;
    ocupado[k] = (ocupado[k] || 0) + 1;
  }
  const linhasDaRaia = Object.fromEntries(raias.map((r) => [r.id, Math.max(1, ...elementos.filter((e) => e.raia === r.id).map((e) => linhaDe[e.id] + 1))]));
  const COLW = 200, ROWH = 110, POOLBAND = 34, LANEBAND = 30, X0 = X + POOLBAND + LANEBAND + 40;
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
  raias.forEach((r) => { topoRaia[r.id] = yr; alturaRaia[r.id] = linhasDaRaia[r.id] * ROWH + 80; yr += alturaRaia[r.id]; });
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
    const t = quebrar(r.nome, h - 16, 13), w = largura(t, 13) + 4, hh = 13 * 1.25 * t.split("\n").length;
    texto(els, { x: X + POOLBAND + LANEBAND / 2 - w / 2, y: y + h / 2 - hh / 2, t, tam: 13, cor: c.traco, angulo: (3 * Math.PI) / 2, maxPx: h - 16 });
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
      const t = quebrar(e.nome, 130, 12);
      texto(els, { x: cx, y: cy - 30 - t.split("\n").length * 15, t, tam: 12, alinhar: "center", maxPx: 130, grupo: g, cor: TINTA });
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
      texto(els, { x: cx, y: cy + 24, t: e.nome, tam: 12, alinhar: "center", maxPx: 120, grupo: g, cor: TINTA });
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
  const contorno = (a, b, lado) => {
    const k = (desvio[lado] = (desvio[lado] || 0) + 1);
    const y = lado === "baixo" ? Math.max(a.cy + a.meiaA, b.cy + b.meiaA) + 22 + k * 7 : Math.min(a.cy - a.meiaA, b.cy - b.meiaA) - 22 - k * 7;
    const sa = lado === "baixo" ? a.cy + a.meiaA : a.cy - a.meiaA, sb = lado === "baixo" ? b.cy + b.meiaA : b.cy - b.meiaA;
    return { pts: [[a.cx, sa], [a.cx, y], [b.cx, y], [b.cx, sb]], lx: (a.cx + b.cx) / 2, ly: lado === "baixo" ? y + 3 : y - 18 };
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
    const escolhida = opcoes.find((o) => !corta(o.pts, ign)) || opcoes[0];
    seta(els, escolhida.pts, { de: a.id, para: b.id, cor: LINHA, espessura: 1 });
    if (f.rotulo) texto(els, { x: escolhida.lx, y: escolhida.ly, t: f.rotulo, tam: 12, alinhar: "center", maxPx: 110, cor: TINTA });
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
    // posição livre na borda de cima do elemento; se nenhuma subir livre, sai, desvia na margem
    // de cima da raia e sobe por um x livre
    const x0 = el.cx + (n - 1) * 14 - 7 * (n > 1 ? 1 : 0);
    let ida = null;
    for (const d of [0, -18, 18, -36, 36, -54, 54].filter((d) => Math.abs(x0 + d - el.cx) < el.meiaL)) {
      const p = [[x0 + d, yEl], [x0 + d, yEx]];
      if (!corta(p, [idEl])) { ida = p; break; }
    }
    if (!ida) {
      // desvio: sai pela borda, anda de lado pelo vão logo acima/abaixo do elemento (ou pela margem
      // da raia) até um x livre e segue até o pool
      const raiaEl = porId[deExt ? m.para : m.de].raia;
      const vao = baixo ? yEl + 20 : yEl - 20;
      const margem = baixo ? topoRaia[raiaEl] + alturaRaia[raiaEl] - 10 : topoRaia[raiaEl] + 10;
      fora: for (const yy of [vao, margem]) {
        for (const d of [100, -100, 120, -120, 160, -160, 200, -200, 300, -300]) {
          const p = [[x0, yEl], [x0, yy], [x0 + d, yy], [x0 + d, yEx]];
          if (!corta(p, [idEl])) { ida = p; break fora; }
        }
      }
    }
    ida ||= [[x0, yEl], [x0, yEx]];
    const x = ida[ida.length - 1][0];
    const pts = deExt ? [...ida].reverse() : ida;
    seta(els, pts, { de: deExt ? ex.id : el.id, para: deExt ? el.id : ex.id, tracejado: true, cor: SUAVE, inicio: "dot", ponta: "arrow" });
    if (m.rotulo) texto(els, { x: x + 8, y: baixo ? yEx - 22 - (n - 1) * 16 : yEx + 6 + (n - 1) * 16, t: m.rotulo, tam: 12, cor: SUAVE, maxPx: 160 });
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
function c4(els, c, X, Y) {
  const pessoas = c.pessoas || [], conts = c.containers || [], exts = c.externos || [];
  const rel = c.relacoes || [];
  const ids = new Set(conts.map((x) => x.id));
  // linhas de containers: caminho mais longo nas relações entre containers
  const nivel = Object.fromEntries(conts.map((x) => [x.id, 0]));
  for (let i = 0; i < conts.length; i++) for (const r of rel) if (ids.has(r.de) && ids.has(r.para) && r.de !== r.para && nivel[r.para] <= nivel[r.de] && nivel[r.de] < conts.length) nivel[r.para] = nivel[r.de] + 1;
  const linhas = [];
  for (const x of conts) (linhas[nivel[x.id]] ||= []).push(x);
  const fileiras = [];
  for (const l of linhas.filter(Boolean)) for (let i = 0; i < l.length; i += 4) fileiras.push(l.slice(i, i + 4));
  // ordem dentro de cada fileira pelo baricentro dos vizinhos já posicionados (heurística de
  // Sugiyama): reduz setas cruzando caixas. Pessoas no topo, externos embaixo.
  const lugar = {};
  const marcar = (lista) => lista.forEach((x, i) => (lugar[x.id] = (i + 0.5) / lista.length));
  const vizinhos = (id) => rel.filter((r) => r.de === id || r.para === id).map((r) => (r.de === id ? r.para : r.de));
  const baricentro = (x) => { const v = vizinhos(x.id).filter((n) => lugar[n] != null).map((n) => lugar[n]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0.5; };
  marcar(pessoas);
  for (let passada = 0; passada < 2; passada++) {
    for (const f of fileiras) { f.sort((p1, p2) => baricentro(p1) - baricentro(p2)); marcar(f); }
    exts.sort((p1, p2) => baricentro(p1) - baricentro(p2)); marcar(exts);
  }
  const CW = 230, CH = 130, GX = 80, GY = 120, PAD = 40;
  const maxPorFileira = Math.max(1, ...fileiras.map((f) => f.length), pessoas.length, exts.length);
  const larguraUtil = maxPorFileira * CW + (maxPorFileira - 1) * GX;
  const pos = {};
  const centralizar = (n) => X + PAD + (larguraUtil - (n * CW + (n - 1) * GX)) / 2;
  let y = Y;
  // pessoas
  if (pessoas.length) {
    const x0 = centralizar(pessoas.length);
    pessoas.forEach((p, i) => {
      const g = novoId(), x = x0 + i * (CW + GX);
      forma(els, { tipo: "ellipse", x: x + CW / 2 - 28, y, w: 56, h: 56, fundo: C4.pessoa, traco: C4.pessoa, grupo: g });
      const f = forma(els, { x, y: y + 46, w: CW, h: 110, fundo: C4.pessoa, traco: C4.pessoa, grupo: g, t: "" });
      pilha(els, x + CW / 2, y + 46, 110, [
        { t: p.nome, tam: 17, cor: "#FFFFFF", maxPx: CW - 20 },
        { t: "[Pessoa]", tam: 12, cor: "#C9D7EA", maxPx: CW - 16 },
        { t: p.descricao, tam: 12, cor: "#FFFFFF", maxPx: CW - 24 },
      ], g);
      pos[p.id] = { id: f.id, x, y: y + 46, w: CW, h: 110 };
    });
    y += 156 + GY;
  }
  // fronteira do sistema + containers
  const topoFronteira = y;
  y += PAD;
  for (const fileira of fileiras) {
    const x0 = centralizar(fileira.length);
    fileira.forEach((k, i) => {
      const g = novoId(), x = x0 + i * (CW + GX);
      const cor = k.tipo === "banco" ? C4.banco : C4.container;
      let f;
      if (k.tipo === "banco") {
        f = forma(els, { x, y: y + 12, w: CW, h: CH - 12, fundo: cor, traco: "#1F4E89", grupo: g, redondo: false, espessura: 1 });
        forma(els, { tipo: "ellipse", x, y, w: CW, h: 24, fundo: "#3D80CC", traco: "#1F4E89", grupo: g });
        linha(els, [[x, y + 12], [x, y + CH]], { cor: "#1F4E89", grupo: g });
      } else {
        f = forma(els, { x, y, w: CW, h: CH, fundo: cor, traco: "#1F4E89", grupo: g, espessura: 1 });
      }
      const banco = k.tipo === "banco";
      pilha(els, x + CW / 2, banco ? y + 14 : y, banco ? CH - 14 : CH, [
        { t: k.nome, tam: 16, cor: "#FFFFFF", maxPx: CW - 20 },
        { t: `[${banco ? "Banco" : k.tipo === "job" ? "Job" : k.tipo === "mobile" ? "App mobile" : k.tipo === "api" ? "API" : "Container"}: ${k.tecnologia}]`, tam: 11, cor: "#D6E4F5", maxPx: CW - 16 },
        { t: k.descricao, tam: 12, cor: "#FFFFFF", maxPx: CW - 24 },
      ], g);
      pos[k.id] = { id: f.id, x, y, w: CW, h: CH };
    });
    y += CH + GY;
  }
  y = y - GY + PAD + 26;
  const fw = larguraUtil + PAD * 2;
  forma(els, { x: X, y: topoFronteira, w: fw, h: y - topoFronteira, fundo: "transparent", traco: C4.fronteira, tracejado: true, espessura: 2, redondo: false });
  texto(els, { x: X + 14, y: y - 40, t: `${c.sistema}\n[Sistema de software]`, tam: 13, cor: C4.fronteira });
  y += GY;
  // externos: com mais de uma fileira de containers, ficam numa coluna à direita, cada um na altura
  // dos containers com que conversa (convenção dos diagramas C4: o mundo de fora fica ao lado, e a
  // seta é curta). Com uma fileira só, ficam embaixo.
  const desenharExterno = (e, x, yy) => {
    const g = novoId();
    const f = forma(els, { x, y: yy, w: CW, h: 110, fundo: C4.externo, traco: "#4B5563", grupo: g });
    pilha(els, x + CW / 2, yy, 110, [
      { t: e.nome, tam: 16, cor: "#FFFFFF", maxPx: CW - 20 },
      { t: "[Sistema externo]", tam: 11, cor: "#E5E7EB", maxPx: CW - 16 },
      { t: e.descricao, tam: 12, cor: "#FFFFFF", maxPx: CW - 24 },
    ], g);
    pos[e.id] = { id: f.id, x, y: yy, w: CW, h: 110, lateral: true };
  };
  let lateral = false;
  // ao lado só quando nada fica no caminho: todo container ligado a um externo é o último da sua
  // fileira. Senão a seta teria de contornar outros containers, e embaixo fica mais limpo.
  const ultimoDaFileira = new Set(fileiras.map((f) => f[f.length - 1].id));
  const ladoLivre = exts.every((e) => vizinhos(e.id).filter((n) => ids.has(n)).every((n) => ultimoDaFileira.has(n)));
  if (exts.length && fileiras.length >= 2 && ladoLivre) {
    lateral = true;
    const xl = X + fw + 130;
    const alvo = exts.map((e) => {
      const cs = vizinhos(e.id).filter((n) => pos[n]).map((n) => pos[n].y + pos[n].h / 2);
      return { e, y: (cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : topoFronteira + 100) - 55 };
    }).sort((p, q) => p.y - q.y);
    let minimo = topoFronteira;
    for (const it of alvo) { const yy = Math.max(it.y, minimo); desenharExterno(it.e, xl, yy); minimo = yy + 140; }
    y = Math.max(y - GY, minimo - 30);
  } else if (exts.length) {
    const x0 = centralizar(exts.length);
    exts.forEach((e, i) => {
      const g = novoId(), x = x0 + i * (CW + GX);
      const f = forma(els, { x, y, w: CW, h: 110, fundo: C4.externo, traco: "#4B5563", grupo: g });
    pilha(els, x + CW / 2, y, 110, [
      { t: e.nome, tam: 16, cor: "#FFFFFF", maxPx: CW - 20 },
      { t: "[Sistema externo]", tam: 11, cor: "#E5E7EB", maxPx: CW - 16 },
      { t: e.descricao, tam: 12, cor: "#FFFFFF", maxPx: CW - 24 },
    ], g);
      pos[e.id] = { id: f.id, x, y, w: CW, h: 110 };
    });
    y += 110;
  }
  // relações: reta quando não cruza caixa; senão desce/sobe pelos corredores entre as colunas
  // (mesma ideia do BPMN: candidatos em ordem de preferência, fica o primeiro que não atravessa nada)
  const obst = Object.entries(pos).map(([id, q]) => ({ id, x0: q.x - 8, x1: q.x + q.w + 8, y0: q.y - 8, y1: q.y + q.h + 8 }));
  // a cabeça da pessoa fica acima da caixa: também é obstáculo (com o id da pessoa, para a
  // própria pessoa poder ligar-se)
  for (const p of pessoas) if (pos[p.id]) obst.push({ id: p.id, x0: pos[p.id].x + CW / 2 - 36, x1: pos[p.id].x + CW / 2 + 36, y0: pos[p.id].y - 54, y1: pos[p.id].y });
  const corta = (pts, ign) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      // amostra o segmento (serve para diagonal também)
      const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 10));
      for (let s = 0; s <= n; s++) {
        const x = x1 + ((x2 - x1) * s) / n, y = y1 + ((y2 - y1) * s) / n;
        for (const o of obst) if (!ign.includes(o.id) && x > o.x0 && x < o.x1 && y > o.y0 && y < o.y1) return true;
      }
    }
    return false;
  };
  const corredoresX = [];
  // corredores entre as colunas; os das pontas ficam fora da fronteira tracejada, para a seta
  // não correr em cima da linha da fronteira
  for (let i = 1; i < maxPorFileira; i++) corredoresX.push(X + PAD + i * (CW + GX) - GX / 2);
  corredoresX.push(X - 34, X + larguraUtil + PAD * 2 + 34);
  // várias setas na mesma caixa: espalha os pontos de saída/chegada pela borda, em ordem do
  // lado em que está a outra ponta (senão correm juntas e os rótulos se sobrepõem)
  const desloc = new Map();
  for (const no of Object.keys(pos)) {
    for (const papel of ["de", "para"]) {
      const minhas = rel.filter((r) => r[papel] === no && pos[r.de] && pos[r.para]);
      const outra = (r) => centro(pos[papel === "de" ? r.para : r.de])[0];
      minhas.sort((p, q) => outra(p) - outra(q));
      const passo = Math.min(36, (pos[no].w * 0.7) / Math.max(1, minhas.length));
      minhas.forEach((r, i) => desloc.set(`${papel}|${rel.indexOf(r)}`, (i - (minhas.length - 1) / 2) * passo));
    }
  }
  let faixa = 0;
  const usoCorredor = new Map();
  // ligações com externo lateral: portas espalhadas na vertical, dos dois lados
  const portaY = new Map();
  for (const no of Object.keys(pos)) {
    const minhas = rel.filter((r) => (r.de === no || r.para === no) && pos[r.de] && pos[r.para] && (pos[r.de].lateral || pos[r.para].lateral));
    const outraY = (r) => centro(pos[r.de === no ? r.para : r.de])[1];
    minhas.sort((p, q) => outraY(p) - outraY(q));
    // 34 px: o rótulo tem duas linhas (verbo + [tecnologia]) e não pode encostar no vizinho
    minhas.forEach((r, i) => portaY.set(`${no}|${rel.indexOf(r)}`, (i - (minhas.length - 1) / 2) * 34));
  }
  let corredorLateral = 0;
  for (const r of rel) {
    const a = pos[r.de], b = pos[r.para];
    if (!a || !b) continue;
    if (lateral && (a.lateral || b.lateral) && !(a.lateral && b.lateral) && (ids.has(r.de) || ids.has(r.para))) {
      const ext = a.lateral ? a : b, cont = a.lateral ? b : a;
      const idExt = a.lateral ? r.de : r.para, idCont = a.lateral ? r.para : r.de;
      const yc = centro(cont)[1] + (portaY.get(`${idCont}|${rel.indexOf(r)}`) || 0);
      const ye = centro(ext)[1] + (portaY.get(`${idExt}|${rel.indexOf(r)}`) || 0);
      const mx = X + fw + 40 + (corredorLateral++ % 5) * 12;
      // sai pela direita do container; se houver caixa no caminho até a fronteira, sobe/desce antes
      let ida = Math.abs(yc - ye) < 3 ? [[cont.x + cont.w, yc], [ext.x, ye]] : [[cont.x + cont.w, yc], [mx, yc], [mx, ye], [ext.x, ye]];
      if (corta(ida, [r.de, r.para])) {
        const sobe = [[centro(cont)[0], cont.y], [centro(cont)[0], cont.y - 22], [mx, cont.y - 22], [mx, ye], [ext.x, ye]];
        if (!corta(sobe, [r.de, r.para])) ida = sobe;
      }
      const pts = a.lateral ? [...ida].reverse() : ida;
      seta(els, pts, { de: a.id, para: b.id, rotulo: r.tecnologia ? `${r.rotulo}\n[${r.tecnologia}]` : r.rotulo, cor: C4.seta, tam: 12 });
      continue;
    }
    const [ax0, ay] = centro(a), [bx0, by] = centro(b);
    const ax = ax0 + (desloc.get(`de|${rel.indexOf(r)}`) || 0), bx = bx0 + (desloc.get(`para|${rel.indexOf(r)}`) || 0);
    const ign = [r.de, r.para];
    const opcoes = [[borda(a, bx, by), borda(b, ax, ay)]];
    if (Math.abs(ay - by) <= 10) {
      // mesma fileira com caixa no meio: passa por baixo da fileira, ou por cima
      const k = (faixa = (faixa + 1) % 5);
      const yb = Math.max(a.y + a.h, b.y + b.h) + 22 + k * 6, yc = Math.min(a.y, b.y) - 22 - k * 6;
      opcoes.push([[ax, a.y + a.h], [ax, yb], [bx, yb], [bx, b.y + b.h]], [[ax, a.y], [ax, yc], [bx, yc], [bx, b.y]]);
    }
    if (Math.abs(ay - by) > 10) {
      const desce = by > ay;
      const sa = desce ? a.y + a.h : a.y, sb = desce ? b.y : b.y + b.h;
      const k = (faixa = (faixa + 1) % 5);
      const c1 = sa + (desce ? 1 : -1) * (24 + k * 6), c2 = sb - (desce ? 1 : -1) * (24 + k * 6);
      opcoes.push([[ax, sa], [ax, c2], [bx, c2], [bx, sb]]);
      // corredor menos usado primeiro (dois rótulos no mesmo corredor caem no mesmo ponto), depois o mais perto
      const custo = (gx) => (usoCorredor.get(gx) || 0) * 400 + Math.abs(gx - (ax + bx) / 2);
      for (const gx of [...corredoresX].sort((p, q) => custo(p) - custo(q))) {
        const xx = gx + ((usoCorredor.get(gx) || 0) % 2 ? 16 : -16) * Math.ceil((usoCorredor.get(gx) || 0) / 2);
        const o = [[ax, sa], [ax, c1], [xx, c1], [xx, c2], [bx, c2], [bx, sb]];
        o.corredor = gx;
        opcoes.push(o);
      }
    }
    const pts = opcoes.find((o) => !corta(o, ign)) || opcoes[0];
    if (pts.corredor != null) usoCorredor.set(pts.corredor, (usoCorredor.get(pts.corredor) || 0) + 1);
    seta(els, pts, { de: a.id, para: b.id, rotulo: r.tecnologia ? `${r.rotulo}\n[${r.tecnologia}]` : r.rotulo, cor: C4.seta, tam: 12 });
  }
  // legenda
  y += 40;
  const leg = [["Pessoa", C4.pessoa], ["Container", C4.container], ["Sistema externo", C4.externo]];
  leg.forEach(([nome, cor], i) => forma(els, { x: X + i * 150, y, w: 130, h: 30, t: nome, tam: 12, cor: "#FFFFFF", fundo: cor, traco: cor }));
}

export function desenhar(spec) {
  semente = 1;
  const els = [];
  const X = 0;
  let y = 0;
  texto(els, { x: X, y, t: spec.titulo, tam: 34, cor: TINTA });
  y += 52;
  if (spec.resumo) y += texto(els, { x: X, y, t: spec.resumo, tam: 16, cor: SUAVE, maxPx: 1300 }).h + 50;

  y = cabecalho(els, X, y, 1, "Quem usa e para quê", "UML · diagrama de casos de uso");
  let antes = els.length;
  casosDeUso(els, spec.casosDeUso || {}, X, y);
  y = caixaDe(els, antes).y1 + 90;

  y = cabecalho(els, X, y, 2, spec.processo?.nome || "Processo principal", "BPMN 2.0 · processo com raias");
  antes = els.length;
  processo(els, spec.processo || {}, spec.casosDeUso?.sistema || spec.arquitetura?.sistema || "Sistema", X, y);
  y = caixaDe(els, antes).y1 + 90;

  y = cabecalho(els, X, y, 3, "Arquitetura", "Modelo C4 · nível 2, containers");
  c4(els, spec.arquitetura || {}, X, y);
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
    const d = desenhar(spec);
    d.gerado = assinatura(d);
    fs.writeFileSync(destino, JSON.stringify(d, null, 1));
    feitos++;
  }
  console.log(`${feitos} desenho(s) gerado(s), ${pulados} mantido(s) por terem sido editados, ${invalidos} com especificação inválida`);
}
