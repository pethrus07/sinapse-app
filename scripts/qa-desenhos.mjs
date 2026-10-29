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
// Sai 1 se algum desenho tiver problema.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(AQUI, "..", "..", "sinapse");
const DIR = join(VAULT, "09-DESENHOS");
const args = process.argv.slice(2);
const detalhe = args.includes("--detalhe");
const pedidos = args.filter((a) => !a.startsWith("--"));

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
  return achados;
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
  }
  linhas.sort((p, q) => q.n - p.n);
  for (const l of linhas.filter((l) => l.n)) {
    console.log(`${String(l.n).padStart(3)} ${l.id.padEnd(30)} ${Object.entries(l.conta).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    if (detalhe) for (const x of l.achados.slice(0, 12)) console.log(`      ${x.tipo}: ${x.msg}`);
  }
  console.log(`\n${arqs.length} desenhos · ${ruins} com problema · ${Object.entries(total).map(([k, v]) => `${k} ${v}`).join(" · ") || "nenhum achado"}`);
  process.exit(ruins ? 1 : 0);
}
