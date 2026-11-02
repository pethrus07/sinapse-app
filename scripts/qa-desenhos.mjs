// QA dos desenhos do vault (09-DESENHOS/*.excalidraw): mede o que deixa um diagrama feio ou ilegível.
// Reprova; não aprova (gosto segue humano). Uso: node scripts/qa-desenhos.mjs [id ...] [--detalhe]
//
//   atravessa    seta passando por cima de uma forma que não é origem nem destino dela
//   texto×forma  texto solto ou rótulo de seta em cima de uma forma (que não é a dele)
//   texto×texto  dois textos se sobrepondo
//   linha×texto  linha de seta cortando um texto que não é o rótulo dela
//   trilho       duas setas diferentes correndo juntas (mesmo trecho, mesma direção) por 24px ou mais
//   colada       duas setas paralelas a 3-16 px por 100 px ou mais
//   raspa        seta a 2-14 px da lateral de uma forma por 80 px ou mais
//   vaza         texto preso numa caixa maior que a caixa
//   escapa       seta que liga dois pontos de dentro de um pool/fronteira e sai dele no caminho
//   longe        rótulo de seta a mais de LIMIAR.rotuloSeta px da própria seta, medido do texto que o olho
//                vê (largura média medida da fonte), não da caixa estimada
//   ambíguo      rótulo mais perto de outra seta do que da dele (por LIMIAR.ambiguo px ou mais)
//   morto        parte do desenho com área útil abaixo de LIMIAR.areaUtil[vista]: fração do retângulo da
//                parte que fica a até LIMIAR.raio px de forma ou texto (seta não conta: linha longa
//                atravessando o vazio não ocupa o espaço; raia, pool e fronteira contam só pela moldura)
// Sai 1 se algum desenho tiver problema. --medidas imprime os números por desenho (calibração).
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(AQUI, "..", "..", "sinapse");
const DIR = join(VAULT, "09-DESENHOS");
const args = process.argv.slice(2);
const detalhe = args.includes("--detalhe");
const medidas = args.includes("--medidas");
const pedidos = args.filter((a) => !a.startsWith("--"));

// Limiares calibrados em 01/11/2026 nos 56 desenhos (números no relatório da revisão geral e em
// docs/desenhos-formato.md, seção "Medidas"). Mudar só com nova calibração.
// largura média medida da fonte ÷ largura estimada pelo gerador (LARG em gerar-desenhos.mjs)
// largura média de caractere medida em cada fonte, em fração do corpo (a mono é exata)
const MEDIA = { 1: 0.495, 2: 0.48, 3: 0.62 };
// Calibração (56 desenhos, 01/11/2026), pior caso por desenho:
//   rótulo↔seta: antes 18 a 25 px em TODOS (a folga de LARG virava vão), depois do aperto 8 a 13 px → 16
//   área útil: UML 0,72 a 0,98 · BPMN 0,59 a 0,86 · C4 em pé 0,39 a 0,80 (8 abaixo de 0,50), C4 deitado
//   0,44 a 0,90 → 0,60 / 0,50 / 0,50
export const LIMIAR = { rotuloSeta: 16, ambiguo: 6, areaUtil: { uml: 0.6, bpmn: 0.5, c4: 0.5 }, raio: 48, celula: 8 };

const caixa = (e) => ({ x0: e.x, y0: e.y, x1: e.x + e.width, y1: e.y + e.height });
const sobrepoe = (a, b, folga = 1) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > folga && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > folga;
const dentroForma = (f, x, y, m = 3) => {
  if (f.type === "ellipse") return ((x - f.x - f.width / 2) / (f.width / 2 - m)) ** 2 + ((y - f.y - f.height / 2) / (f.height / 2 - m)) ** 2 < 1;
  if (f.type === "diamond") return Math.abs(x - f.x - f.width / 2) / (f.width / 2 - m) + Math.abs(y - f.y - f.height / 2) / (f.height / 2 - m) < 1;
  return x > f.x + m && x < f.x + f.width - m && y > f.y + m && y < f.y + f.height - m;
};
// caixa de texto real. Texto girado 90°/270° (nome de pool e raia no BPMN): o Excalidraw gira em
// torno do centro, então a caixa na tela troca largura por altura
const caixaTexto = (t) => {
  const a = ((t.angle || 0) % Math.PI + Math.PI) % Math.PI;
  if (Math.abs(a - Math.PI / 2) < 0.1) {
    const cx = t.x + t.width / 2, cy = t.y + t.height / 2;
    return { x0: cx - t.height / 2 + 1, y0: cy - t.width / 2 + 1, x1: cx + t.height / 2 - 1, y1: cy + t.width / 2 - 1 };
  }
  return { x0: t.x + 1, y0: t.y + 1, x1: t.x + t.width - 1, y1: t.y + t.height - 1 };
};

export function medir(cena) {
  const els = cena.elements.filter((e) => !e.isDeleted);
  const porId = new Map(els.map((e) => [e.id, e]));
  // "forma" = nó do diagrama (tarefa, caso, container, evento, gateway, pool externo…); fica de fora
  // o que é área (raia, pool interno, fronteira do sistema), pela transparência ou pelo tamanho
  const formas = els.filter((e) => !e.customData?.halo && ["rectangle", "ellipse", "diamond"].includes(e.type) && e.backgroundColor !== "transparent" && e.width >= 20 && e.width <= 1200 && e.height <= 180);
  const textos = els.filter((e) => e.type === "text");
  const setas = els.filter((e) => e.type === "arrow");
  const grupoDe = (e) => new Set(e.groupIds || []);
  const mesmoGrupo = (a, b) => [...grupoDe(a)].some((g) => grupoDe(b).has(g));
  const achados = [];
  const acha = (tipo, msg) => achados.push({ tipo, msg });
  const rot = (t) => JSON.stringify((t.text || "").replace(/\n/g, " ").slice(0, 28));

  // pontos de cada seta, absolutos
  const pts = new Map(setas.map((s) => [s.id, s.points.map(([x, y]) => [s.x + x, s.y + y])]));
  const amostra = (p, passo = 5) => {
    const out = [];
    for (let i = 0; i < p.length - 1; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / passo));
      for (let k = 1; k < n; k++) out.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
    }
    return out;
  };

  // atravessa
  for (const s of setas) {
    const ign = new Set([s.startBinding?.elementId, s.endBinding?.elementId].filter(Boolean));
    for (const f of formas) if (ign.has(f.id)) for (const h of formas) if (mesmoGrupo(f, h)) ign.add(h.id);
    const hit = formas.find((f) => !ign.has(f.id) && amostra(pts.get(s.id)).some(([x, y]) => dentroForma(f, x, y)));
    if (hit) acha("atravessa", `seta sobre ${hit.type} em (${Math.round(hit.x)},${Math.round(hit.y)})`);
  }
  // escapa: seta que liga dois pontos de dentro de uma área (pool interno, fronteira do sistema) e
  // sai dela no caminho (laço contornando por fora do pool)
  const areas = els.filter((e) => e.type === "rectangle" && e.backgroundColor === "transparent" && e.width > 300 && e.height > 120);
  const dentroArea = (r, [x, y]) => x >= r.x - 1 && x <= r.x + r.width + 1 && y >= r.y - 1 && y <= r.y + r.height + 1;
  for (const s of setas) {
    const p = pts.get(s.id);
    const r = areas.filter((a) => dentroArea(a, p[0]) && dentroArea(a, p[p.length - 1])).sort((a, b) => a.width * a.height - b.width * b.height)[0];
    if (r && amostra(p).some((q) => !dentroArea(r, q))) acha("escapa", `seta sai da área em (${Math.round(r.x)},${Math.round(r.y)})`);
  }
  // vaza
  for (const t of textos) if (t.containerId) {
    const c = porId.get(t.containerId);
    if (c && c.type !== "arrow" && (t.height > c.height + 2 || (c.type === "rectangle" && t.width > c.width + 2))) acha("vaza", `${rot(t)} maior que a caixa`);
  }
  // texto × forma (texto solto e rótulo de seta)
  for (const t of textos) {
    const dono = t.containerId ? porId.get(t.containerId) : null;
    if (dono && dono.type !== "arrow") continue; // texto dentro da própria forma
    const bt = caixaTexto(t);
    for (const f of formas) {
      if (mesmoGrupo(t, f)) continue;
      if (dono && (dono.startBinding?.elementId === f.id || dono.endBinding?.elementId === f.id) && false) continue;
      // só conta se uma boa parte do texto está dentro da forma
      const cx = (bt.x0 + bt.x1) / 2, cy = (bt.y0 + bt.y1) / 2;
      const cantos = [[bt.x0, bt.y0], [bt.x1, bt.y0], [bt.x0, bt.y1], [bt.x1, bt.y1], [cx, cy]];
      if (cantos.filter(([x, y]) => dentroForma(f, x, y, 1)).length >= 2) { acha("texto×forma", `${rot(t)} sobre ${f.type} em (${Math.round(f.x)},${Math.round(f.y)})`); break; }
    }
  }
  // texto × texto
  for (let i = 0; i < textos.length; i++) for (let j = i + 1; j < textos.length; j++) {
    const a = textos[i], b = textos[j];
    if (a.containerId && a.containerId === b.containerId) continue;
    if (sobrepoe(caixaTexto(a), caixaTexto(b), 2)) acha("texto×texto", `${rot(a)} × ${rot(b)}`);
  }
  // linha × texto: a linha corta um texto que não é rótulo dela nem texto da forma em que ela entra/sai
  for (const s of setas) {
    const ponta = new Set([s.startBinding?.elementId, s.endBinding?.elementId].filter(Boolean));
    const p = amostra(pts.get(s.id), 3);
    for (const t of textos) {
      // rótulo da própria seta: preso nela (containerId) ou no mesmo grupo (posicionador de rótulos)
      if (t.containerId === s.id || ponta.has(t.containerId) || mesmoGrupo(t, s)) continue;
      const pontaFormas = [...ponta].map((id) => porId.get(id)).filter(Boolean);
      if (pontaFormas.some((f) => mesmoGrupo(t, f))) continue;
      const b = caixaTexto(t);
      const dentro = p.filter(([x, y]) => x > b.x0 + 2 && x < b.x1 - 2 && y > b.y0 + 2 && y < b.y1 - 2).length;
      if (dentro >= 3) { acha("linha×texto", `linha cortando ${rot(t)}`); }
    }
  }
  // trilho: segmentos colineares de setas diferentes sobrepostos
  const segs = [];
  for (const s of setas) { const p = pts.get(s.id); for (let i = 0; i < p.length - 1; i++) segs.push({ s: s.id, a: p[i], b: p[i + 1] }); }
  const vistos = new Set();
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const u = segs[i], v = segs[j];
    if (u.s === v.s) continue;
    const hor = (g) => Math.abs(g.a[1] - g.b[1]) < 1, ver = (g) => Math.abs(g.a[0] - g.b[0]) < 1;
    let comum = 0;
    if (hor(u) && hor(v) && Math.abs(u.a[1] - v.a[1]) < 3) comum = Math.min(Math.max(u.a[0], u.b[0]), Math.max(v.a[0], v.b[0])) - Math.max(Math.min(u.a[0], u.b[0]), Math.min(v.a[0], v.b[0]));
    if (ver(u) && ver(v) && Math.abs(u.a[0] - v.a[0]) < 3) comum = Math.min(Math.max(u.a[1], u.b[1]), Math.max(v.a[1], v.b[1])) - Math.max(Math.min(u.a[1], u.b[1]), Math.min(v.a[1], v.b[1]));
    const k = [u.s, v.s].sort().join();
    if (comum >= 24 && !vistos.has(k)) { vistos.add(k); acha("trilho", `duas setas juntas por ${Math.round(comum)}px perto de (${Math.round(u.a[0])},${Math.round(u.a[1])})`); }
  }
  // colada: duas setas paralelas a 3-16 px por 100 px ou mais (lidas como uma só; achado da revisão 3)
  // raspa: seta correndo a 2-14 px da lateral de uma forma por 80 px ou mais
  const sobreposicao = (a0, a1, b0, b1) => Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const hor = (g) => Math.abs(g.a[1] - g.b[1]) < 1, ver = (g) => Math.abs(g.a[0] - g.b[0]) < 1;
  const coladas = new Set();
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const u = segs[i], v = segs[j];
    if (u.s === v.s) continue;
    let d = null, comum = 0;
    if (hor(u) && hor(v)) { d = Math.abs(u.a[1] - v.a[1]); comum = sobreposicao(u.a[0], u.b[0], v.a[0], v.b[0]); }
    if (ver(u) && ver(v)) { d = Math.abs(u.a[0] - v.a[0]); comum = sobreposicao(u.a[1], u.b[1], v.a[1], v.b[1]); }
    const k = [u.s, v.s].sort().join();
    if (d != null && d >= 3 && d <= 16 && comum >= 100 && !coladas.has(k)) {
      coladas.add(k);
      acha("colada", `setas a ${Math.round(d)}px por ${Math.round(comum)}px perto de (${Math.round(u.a[0])},${Math.round(u.a[1])})`);
    }
  }
  const raspadas = new Set();
  for (const g of segs) for (const f of formas.filter((f) => f.type === "rectangle")) {
    let d = null, comum = 0;
    if (ver(g)) { d = Math.min(Math.abs(g.a[0] - f.x), Math.abs(g.a[0] - f.x - f.width)); comum = sobreposicao(g.a[1], g.b[1], f.y, f.y + f.height); }
    if (hor(g)) { d = Math.min(Math.abs(g.a[1] - f.y), Math.abs(g.a[1] - f.y - f.height)); comum = sobreposicao(g.a[0], g.b[0], f.x, f.x + f.width); }
    const k = g.s + f.id;
    if (d != null && d >= 2 && d <= 14 && comum >= 80 && !raspadas.has(k)) {
      raspadas.add(k);
      acha("raspa", `seta a ${Math.round(d)}px da lateral de uma forma por ${Math.round(comum)}px em (${Math.round(f.x)},${Math.round(f.y)})`);
    }
  }
  // longe / ambíguo: rótulo solto preso à seta pelo grupo (o posicionador põe rótulo e seta no mesmo grupo)
  const distPontoCaixa = (x, y, b) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
  const distSetaCaixa = (s, b) => {
    const p = pts.get(s.id);
    let d = Infinity;
    for (const [x, y] of [...p, ...amostra(p, 3)]) d = Math.min(d, distPontoCaixa(x, y, b));
    return d;
  };
  // a caixa do texto sai da largura ESTIMADA do gerador (LARG, com ~21% de folga sobre a média medida
  // da fonte); rótulo é centrado, então a folga vira vão dos dois lados. Aqui vale o que o olho vê.
  const caixaVisivel = (t) => {
    const b = caixaTexto(t), cx = (b.x0 + b.x1) / 2;
    const linhas = String(t.text).split("\n");
    const meia = Math.min(b.x1 - b.x0, Math.max(...linhas.map((l) => l.length)) * t.fontSize * (MEDIA[t.fontFamily] || 0.5)) / 2;
    return { x0: cx - meia, y0: b.y0, x1: cx + meia, y1: b.y1 };
  };
  const rotulos = [];
  for (const s of setas) {
    for (const t of textos) {
      if (t.containerId || !mesmoGrupo(t, s)) continue;
      const b = caixaVisivel(t);
      const dono = distSetaCaixa(s, b);
      let outra = Infinity;
      for (const o of setas) if (o !== s && !mesmoGrupo(t, o)) outra = Math.min(outra, distSetaCaixa(o, b));
      rotulos.push({ t, dono, outra });
      if (dono > LIMIAR.rotuloSeta) acha("longe", `${rot(t)} a ${Math.round(dono)}px da própria seta`);
      else if (outra + LIMIAR.ambiguo <= dono) acha("ambíguo", `${rot(t)} a ${Math.round(dono)}px da dela e ${Math.round(outra)}px de outra`);
    }
  }
  // morto: área útil de cada parte (as partes começam nos títulos "1 · ", "2 · ", "3 · ", como no SVG)
  const util = areaUtil(els);
  // qual vista é cada parte: o gerador grava `vistas` no desenho (sem o campo, são as três)
  const vistas = cena.vistas || ["uml", "bpmn", "c4"];
  util.forEach((u, i) => {
    const v = vistas[i] || "c4";
    if (u.fracao < LIMIAR.areaUtil[v]) acha("morto", `${v.toUpperCase()} com ${Math.round(u.fracao * 100)}% de área útil (${u.w}×${u.h})`);
  });
  achados.medidas = { rotulos, util };
  return achados;
}

// fração do retângulo de cada parte que fica a até LIMIAR.raio px de tinta. Área (raia, pool interno,
// fronteira) conta só pela moldura: pool vazio é espaço morto mesmo pintado de cinza.
export function areaUtil(els) {
  const topos = [];
  for (let n = 1; n <= 3; n++) {
    const y = els.find((e) => e.type === "text" && e.text?.startsWith(`${n} · `))?.y;
    if (y == null) break;
    topos.push(y);
  }
  const { raio: R, celula: C } = LIMIAR;
  const out = [];
  for (let i = 0; i < topos.length; i++) {
    const y0p = topos[i] - 10, y1p = i < topos.length - 1 ? topos[i + 1] - 10 : Infinity;
    const parte = els.filter((e) => e.y >= y0p && e.y < y1p && !e.customData?.halo);
    const xs = [], ys = [];
    for (const e of parte) {
      // seta e linha: o x/y é o primeiro ponto, não o canto; a caixa sai dos pontos
      if (e.points) for (const [x, y] of e.points) { xs.push(e.x + x); ys.push(e.y + y); }
      else { xs.push(e.x, e.x + (e.width || 0)); ys.push(e.y, e.y + (e.height || 0)); }
    }
    const bx0 = Math.min(...xs), by0 = Math.min(...ys), bx1 = Math.max(...xs), by1 = Math.max(...ys);
    const W = Math.ceil((bx1 - bx0) / C) + 1, H = Math.ceil((by1 - by0) / C) + 1;
    const grade = new Uint8Array(W * H);
    const marca = (x0, y0, x1, y1) => {
      const i0 = Math.max(0, Math.floor((x0 - R - bx0) / C)), i1 = Math.min(W - 1, Math.floor((x1 + R - bx0) / C));
      const j0 = Math.max(0, Math.floor((y0 - R - by0) / C)), j1 = Math.min(H - 1, Math.floor((y1 + R - by0) / C));
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) grade[j * W + k] = 1;
    };
    const ehArea = (e) => e.type === "rectangle" && (e.backgroundColor === "transparent" || ((e.width > 600 || e.height > 200) && e.height > 60));
    const traco = (a, b) => {
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / C));
      for (let k = 0; k <= n; k++) { const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n; marca(x, y, x, y); }
    };
    for (const e of parte) {
      if (e.type === "arrow" || e.type === "line") {
        if (e.type === "arrow") continue;
        const p = e.points.map(([x, y]) => [e.x + x, e.y + y]);
        for (let k = 0; k < p.length - 1; k++) traco(p[k], p[k + 1]);
      } else if (ehArea(e)) {
        const [x0, y0, x1, y1] = [e.x, e.y, e.x + e.width, e.y + e.height];
        traco([x0, y0], [x1, y0]); traco([x1, y0], [x1, y1]); traco([x1, y1], [x0, y1]); traco([x0, y1], [x0, y0]);
      } else if (e.type === "text" && !e.containerId) {
        const b = caixaTexto(e);
        marca(b.x0, b.y0, b.x1, b.y1);
      } else if (e.type !== "text") marca(e.x, e.y, e.x + e.width, e.y + e.height);
    }
    let n = 0;
    for (const v of grade) n += v;
    out.push({ fracao: n / grade.length, w: Math.round(bx1 - bx0), h: Math.round(by1 - by0) });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const arqs = readdirSync(DIR).filter((f) => f.endsWith(".excalidraw")).filter((f) => !pedidos.length || pedidos.includes(f.replace(".excalidraw", "")));
  const total = {};
  let ruins = 0;
  const linhas = [];
  for (const a of arqs) {
    const achados = medir(JSON.parse(readFileSync(join(DIR, a), "utf8")));
    const conta = {};
    for (const x of achados) { conta[x.tipo] = (conta[x.tipo] || 0) + 1; total[x.tipo] = (total[x.tipo] || 0) + 1; }
    if (achados.length) ruins++;
    linhas.push({ id: a.replace(".excalidraw", ""), n: achados.length, conta, achados });
    if (medidas) {
      const m = achados.medidas, ds = m.rotulos.map((r) => r.dono).sort((p, q) => q - p);
      console.log(`M ${a.replace(".excalidraw", "").padEnd(28)} util ${m.util.map((u) => u.fracao.toFixed(2)).join(" ")}  tam ${m.util.map((u) => u.w + "x" + u.h).join(" ")}  rotulo-max ${Math.round(ds[0] || 0)} p90 ${Math.round(ds[Math.floor(ds.length * 0.1)] || 0)} n ${ds.length} amb ${m.rotulos.filter((r) => r.outra < r.dono).length}`);
    }
  }
  linhas.sort((p, q) => q.n - p.n);
  for (const l of linhas.filter((l) => l.n)) {
    console.log(`${String(l.n).padStart(3)} ${l.id.padEnd(30)} ${Object.entries(l.conta).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    if (detalhe) for (const x of l.achados.slice(0, 12)) console.log(`      ${x.tipo}: ${x.msg}`);
  }
  console.log(`\n${arqs.length} desenhos · ${ruins} com problema · ${Object.entries(total).map(([k, v]) => `${k} ${v}`).join(" · ") || "nenhum achado"}`);
  process.exit(ruins ? 1 : 0);
}
