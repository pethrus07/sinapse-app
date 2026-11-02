// Para onde vai cada desenho, e o que o publicador recusa. Só lê (vault, specs e pastas de projeto);
// quem grava é o publicar-desenhos.mjs. Rodar sozinho imprime o plano, sem tocar em nada:
//   node scripts/destinos-desenhos.mjs [id ...]
//
// Trava de identidade (01/11/2026): o destino vem do `pastas:` da nota, e um `pastas:` errado já
// mandou desenho de um projeto para o repositório de outro (qa-parresia → koynus, seguranca-frota-wp
// → frota-wp-padrao, Fábrica → celiware-estudio e sv660n-guia). Agora uma pasta só recebe o desenho
// se o NOME dela contém o nome do desenho (título "Sinapse App · ..." → sinapseapp), o id da spec,
// ou um nome declarado na própria spec (`"pastas": ["retifica-os"]`). A spec é quem diz para onde
// pode ir; a nota só escolhe dentre essas.
//
// "Só onde há sistema": spec com `"sistema": false` não gera nem publica; as pastas da nota dela
// entram em `semSistema` (o publicador limpa o docs/arquitetura gerado de lá).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const VAULT = process.env.VAULT_PATH || path.resolve(AQUI, "../../sinapse");
export const PROJETOS = process.env.PROJETOS_PATH || path.join(os.homedir(), "Projetos");
export const VISTAS = ["1-casos-de-uso", "2-processo", "3-arquitetura"];

// nome fixado à mão quando o título não serve: "Estudo de caso · ..." daria o mesmo nome para dois
// projetos, e "Stela 4.0" / "No bailado da sanfona" dão nomes que ninguém procuraria
const NOMES = { "estudo-tv-aoc": "estudo-tv-aoc", "galeria-pessoal": "estudo-galeria-ia", stela: "stela", "bailado-da-sanfona": "bailado-da-sanfona" };
export const semAcento = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const nomeDe = (id, spec) => NOMES[id] || semAcento(spec.titulo.split(" · ")[0]).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const junto = (t) => semAcento(t).replace(/[^a-z0-9]/g, "");

// nomes que a pasta pode ter para receber o desenho
export function nomesAceitos(id, spec) {
  return [...new Set([nomeDe(id, spec), id, ...(spec.pastas || [])].map(junto).filter(Boolean))];
}
export function pastaAceita(id, spec, pasta) {
  const nome = junto(path.basename(pasta));
  if ((spec.pastas || []).some((p) => junto(p) === junto(pasta) || junto(p) === nome)) return true;
  return nomesAceitos(id, { ...spec, pastas: [] }).some((n) => nome.includes(n));
}

// id da nota → pastas do frontmatter (lido do disco, não do índice do app)
export function pastasDasNotas(vault = VAULT) {
  const mapa = new Map();
  const andar = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name.startsWith(".") || d.name === "node_modules" || d.name === "_templates") continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) andar(p);
      else if (d.name.endsWith(".md")) {
        try {
          const fm = matter(fs.readFileSync(p, "utf8")).data;
          const pastas = Array.isArray(fm.pastas) ? fm.pastas.map(String) : fm.pastas ? [String(fm.pastas)] : [];
          mapa.set(d.name.slice(0, -3), pastas);
        } catch { /* nota com frontmatter quebrado: a régua do vault acusa */ }
      }
    }
  };
  andar(vault);
  return mapa;
}

export function lerSpecs(vault = VAULT, pedidas = []) {
  const dir = path.join(vault, "09-DESENHOS", "specs");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))
    .filter((i) => !pedidas.length || pedidas.includes(i))
    .map((id) => ({ id, spec: JSON.parse(fs.readFileSync(path.join(dir, id + ".json"), "utf8")) }));
}

// arquivos que o publicador escreve para um desenho de nome `nome`
export const arquivosDe = (nome) => [`${nome}.excalidraw`, ...VISTAS.map((v) => `${nome}-${v}.svg`)];

export function planejar({ vault = VAULT, projetos = PROJETOS, pedidas = [] } = {}) {
  const notas = pastasDasNotas(vault);
  const specs = lerSpecs(vault, pedidas);
  const destinos = new Map(); // pasta absoluta → [{ id, spec, nome }]
  const barrados = [], semPasta = [], semSistema = [], duplos = [], inexistentes = [];
  for (const { id, spec } of specs) {
    // spec sem nota própria no vault (frota-wp-padrao, 01/11) vai para as pastas que ela declara
    const pastas = notas.has(id) ? notas.get(id) : spec.pastas || [];
    if (spec.sistema === false) { semSistema.push({ id, spec, nome: nomeDe(id, spec), pastas }); continue; }
    // "pastas": [] explícito = o desenho fica só no Sinapse (guarda-chuva "Desbravando UTV", 01/11)
    if (!pastas.length || (Array.isArray(spec.pastas) && !spec.pastas.length)) { semPasta.push(id); continue; }
    const aceitas = [];
    for (const p of pastas) {
      const dir = path.join(projetos, p);
      if (!fs.existsSync(dir)) { inexistentes.push({ id, pasta: p }); continue; }
      if (!pastaAceita(id, spec, p)) { barrados.push({ id, pasta: p, motivo: `a pasta não tem o nome do desenho (${nomesAceitos(id, spec).join(" / ")}); se for mesmo dela, declarar em "pastas" da spec` }); continue; }
      aceitas.push(p);
      if (!destinos.has(dir)) destinos.set(dir, []);
      destinos.get(dir).push({ id, spec, nome: nomeDe(id, spec) });
    }
    if (pastas.length > 1) duplos.push({ id, pastas, aceitas });
  }
  // intrusos: arquivos com cara de gerados (<nome>-1-casos-de-uso.svg) que não são de nenhum desenho
  // que vai para aquela pasta: cópia de outro projeto deixada por um `pastas:` errado
  const intrusos = [];
  const todasPastas = new Set([...destinos.keys(), ...[...notas.values()].flat().map((p) => path.join(projetos, p))]);
  for (const dir of todasPastas) {
    const alvo = path.join(dir, "docs", "arquitetura");
    if (!fs.existsSync(alvo)) continue;
    const meus = new Set((destinos.get(dir) || []).flatMap((i) => arquivosDe(i.nome)));
    for (const f of fs.readdirSync(alvo)) {
      const m = /^(.+)-(1-casos-de-uso|3-arquitetura)\.svg$/.exec(f);
      if (m && !meus.has(f) && !intrusos.some((i) => i.pasta === path.relative(projetos, dir) && i.nome === m[1])) intrusos.push({ pasta: path.relative(projetos, dir), nome: m[1], arquivos: arquivosDe(m[1]).filter((a) => fs.existsSync(path.join(alvo, a))) });
    }
  }
  return { destinos, barrados, semPasta, semSistema, duplos, inexistentes, intrusos };
}

// --exceto=a,b ou --exceto a,b → ["a","b"] (nome da pasta relativo a PROJETOS, com / ou \)
export function lerExceto(args) {
  const i = args.findIndex((a) => a === "--exceto" || a.startsWith("--exceto="));
  if (i < 0) return [];
  const v = args[i].includes("=") ? args[i].split("=")[1] : args[i + 1] || "";
  return v.split(",").map((x) => x.trim().replace(/\\/g, "/").replace(/\/$/, "")).filter(Boolean);
}
// tira do plano as pastas da lista: não grava nem limpa nada nelas
export function aplicarExceto(plano, exceto, projetos = PROJETOS) {
  const fora = new Set(exceto.map((x) => x.toLowerCase()));
  const rel = (dir) => path.relative(projetos, dir).replace(/\\/g, "/").toLowerCase();
  for (const dir of [...plano.destinos.keys()]) if (fora.has(rel(dir))) plano.destinos.delete(dir);
  plano.intrusos = plano.intrusos.filter((i) => !fora.has(i.pasta.replace(/\\/g, "/").toLowerCase()));
  plano.semSistema = plano.semSistema.map((s) => ({ ...s, pastas: s.pastas.filter((p) => !fora.has(p.replace(/\\/g, "/").toLowerCase())) }));
  plano.foraDaRodada = new Set([...fora]);
  return plano;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const p = planejar({ pedidas: process.argv.slice(2).filter((a) => !a.startsWith("--")) });
  for (const [dir, itens] of p.destinos) console.log(`${path.relative(PROJETOS, dir).padEnd(42)} ← ${itens.map((i) => `${i.id} (${i.nome})`).join(", ")}`);
  if (p.barrados.length) { console.log("\nBARRADOS pela trava de identidade:"); for (const b of p.barrados) console.log(`  ${b.id} → ${b.pasta}: ${b.motivo}`); }
  if (p.duplos.length) { console.log("\nNotas com `pastas:` para mais de uma pasta:"); for (const d of p.duplos) console.log(`  ${d.id}: [${d.pastas.join(", ")}] → aceitas: [${d.aceitas.join(", ")}]`); }
  if (p.intrusos.length) { console.log("\nDesenho de outro projeto dentro de docs/arquitetura (sai na próxima publicação):"); for (const i of p.intrusos) console.log(`  ${i.pasta}: ${i.nome} (${i.arquivos.length} arquivos)`); }
  if (p.semSistema.length) console.log(`\nsem sistema (não gera nem publica): ${p.semSistema.map((s) => s.id + (s.pastas.length ? ` [${s.pastas.join(", ")}]` : "")).join(", ")}`);
  if (p.inexistentes.length) console.log(`\npasta declarada que não existe: ${p.inexistentes.map((i) => `${i.id} → ${i.pasta}`).join(", ")}`);
  if (p.semPasta.length) console.log(`\nsem pasta de projeto (ficam só no Sinapse): ${p.semPasta.join(", ")}`);
}
