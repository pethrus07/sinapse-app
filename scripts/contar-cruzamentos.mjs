// Mede o roteamento: conta, por parte do desenho (uml/bpmn/c4), cruzamentos entre setas e "feixes" (setas paralelas a
// < 32 px por >= 150 px). Uso: node scripts/contar-cruzamentos.mjs [ids...] (sem id: os 56; compara versões do gerador)
import { readFileSync, readdirSync } from "node:fs";
const DIR = (process.env.VAULT_PATH || new URL("../../sinapse/", import.meta.url).pathname.replace(/^/([A-Za-z]:)/, "$1")) + "/09-DESENHOS/";
const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(DIR).filter((f) => f.endsWith(".excalidraw")).map((f) => f.replace(".excalidraw", ""));
const tot = { uml: [0, 0], bpmn: [0, 0], c4: [0, 0] };
const linhas = [];
for (const id of ids) {
  const els = JSON.parse(readFileSync(DIR + id + ".excalidraw", "utf8")).elements.filter((e) => !e.isDeleted);
  const topo = [1, 2, 3].map((n) => els.find((e) => e.type === "text" && e.text.startsWith(`${n} · `))?.y ?? Infinity);
  const parte = (y) => (y >= topo[2] ? "c4" : y >= topo[1] ? "bpmn" : "uml");
  const segs = { uml: [], bpmn: [], c4: [] };
  for (const s of els.filter((e) => e.type === "arrow")) {
    const p = s.points.map(([x, y]) => [s.x + x, s.y + y]);
    const k = parte(p[0][1]);
    for (let i = 0; i < p.length - 1; i++) segs[k].push({ s: s.id, a: p[i], b: p[i + 1] });
  }
  const res = {};
  for (const k of Object.keys(segs)) {
    let cruz = 0, feixe = 0;
    const g = segs[k], vistos = new Set();
    const h = (u) => Math.abs(u.a[1] - u.b[1]) < 1, v = (u) => Math.abs(u.a[0] - u.b[0]) < 1;
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const u = g[i], w = g[j];
      if (u.s === w.s) continue;
      for (const [p, q] of [[u, w], [w, u]]) if (h(p) && v(q)) {
        const x = q.a[0], y = p.a[1];
        if (x > Math.min(p.a[0], p.b[0]) + 1 && x < Math.max(p.a[0], p.b[0]) - 1 && y > Math.min(q.a[1], q.b[1]) + 1 && y < Math.max(q.a[1], q.b[1]) - 1) cruz++;
      }
      let d = null, c = 0;
      if (h(u) && h(w)) { d = Math.abs(u.a[1] - w.a[1]); c = Math.min(Math.max(u.a[0], u.b[0]), Math.max(w.a[0], w.b[0])) - Math.max(Math.min(u.a[0], u.b[0]), Math.min(w.a[0], w.b[0])); }
      if (v(u) && v(w)) { d = Math.abs(u.a[0] - w.a[0]); c = Math.min(Math.max(u.a[1], u.b[1]), Math.max(w.a[1], w.b[1])) - Math.max(Math.min(u.a[1], u.b[1]), Math.min(w.a[1], w.b[1])); }
      const key = [u.s, w.s].sort().join();
      if (d != null && d > 2 && d < 32 && c >= 150 && !vistos.has(key)) { vistos.add(key); feixe++; }
    }
    res[k] = [cruz, feixe];
    tot[k][0] += cruz; tot[k][1] += feixe;
  }
  linhas.push(`${id.padEnd(30)} uml ${res.uml.join("/")}  bpmn ${res.bpmn.join("/")}  c4 ${res.c4.join("/")}`);
}
if (ids.length <= 8) console.log(linhas.join("\n"));
console.log("TOTAL (cruzamentos/feixes)", JSON.stringify(tot));
