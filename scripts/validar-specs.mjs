// Confere as especificações de desenho no formato 2 (docs/desenhos-formato.md).
// Uso: node scripts/validar-specs.mjs [id ...]   (sem id = todas)   · sai 1 se alguma reprovar.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(RAIZ, '..', '..', 'sinapse');
const DIR = join(VAULT, '09-DESENHOS', 'specs');

const TIPO_ATOR = new Set(['humano', 'sistema', 'tempo']);
const TIPO_EL = new Set(['inicio', 'inicio-timer', 'inicio-mensagem', 'tarefa', 'gateway', 'fim']);
const TIPO_CONT = new Set(['app', 'api', 'job', 'banco', 'arquivos', 'mobile']);
const SENSIVEL = /\b\d{1,3}(\.\d{1,3}){3}\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|senha\s*[:=]|token\s*[:=]|sk-[a-z0-9]{8}/i;

export function validar(spec) {
  const e = [];
  const curto = (t, max, onde) => { if (typeof t !== 'string' || !t.trim()) e.push(`${onde}: texto vazio`); else if (t.length > max) e.push(`${onde}: "${t}" passa de ${max} caracteres`); };
  const faixa = (lista, min, max, onde) => { if (!Array.isArray(lista) || lista.length < min || lista.length > max) e.push(`${onde}: ${Array.isArray(lista) ? lista.length : 0} (esperado ${min}–${max})`); };
  if (spec.versao !== 2) e.push('versao precisa ser 2');
  curto(spec.titulo, 70, 'titulo');
  // pastas: destinos que a spec aceita além do próprio nome (trava de identidade do publicador)
  if (spec.pastas !== undefined && (!Array.isArray(spec.pastas) || spec.pastas.some((p) => typeof p !== 'string' || !p.trim())))
    e.push('pastas: lista de nomes de pasta');
  // "sistema": false = projeto sem sistema (arte, documento, repositório vazio): não gera nem publica
  // desenho; a spec fica só como registro do porquê
  if (spec.sistema !== undefined && spec.sistema !== false) e.push('sistema: só aceita false (omitir quando há sistema)');
  if (spec.sistema === false) { curto(spec.motivo, 200, 'motivo'); return e; }
  // vistas: só parte das três (projeto pequeno: papel de parede, estudo de caso). Vista fora da lista
  // não é conferida nem desenhada.
  const VISTAS = ['uml', 'bpmn', 'c4'];
  if (spec.vistas !== undefined && (!Array.isArray(spec.vistas) || !spec.vistas.length || spec.vistas.some((v) => !VISTAS.includes(v))))
    e.push('vistas: lista com uml, bpmn e/ou c4');
  const tem = (v) => !Array.isArray(spec.vistas) || spec.vistas.includes(v);
  curto(spec.resumo, 260, 'resumo');
  if (SENSIVEL.test(JSON.stringify(spec))) e.push('parece ter dado sensível (IP, CPF, senha, token)');

  // UML casos de uso
  if (tem('uml')) {
  const u = spec.casosDeUso || {};
  curto(u.sistema, 40, 'casosDeUso.sistema');
  faixa(u.atores, 1, 6, 'casosDeUso.atores');
  faixa(u.casos, 3, 10, 'casosDeUso.casos');
  const atores = new Set((u.atores || []).map((a) => a.id));
  const casos = new Set((u.casos || []).map((c) => c.id));
  for (const a of u.atores || []) { curto(a.nome, 40, `ator ${a.id}`); if (!TIPO_ATOR.has(a.tipo)) e.push(`ator ${a.id}: tipo "${a.tipo}"`); }
  for (const c of u.casos || []) curto(c.nome, 40, `caso ${c.id}`);
  const usados = new Set();
  for (const s of u.associacoes || []) {
    if (!atores.has(s.ator)) e.push(`associação: ator "${s.ator}" não existe`);
    if (!casos.has(s.caso)) e.push(`associação: caso "${s.caso}" não existe`);
    usados.add(s.caso); usados.add('ator:' + s.ator);
  }
  for (const r of u.relacoes || []) {
    if (!casos.has(r.de) || !casos.has(r.para)) e.push(`relação ${r.de}→${r.para}: caso inexistente`);
    if (!['include', 'extend'].includes(r.tipo)) e.push(`relação ${r.de}→${r.para}: tipo "${r.tipo}"`);
    usados.add(r.de); usados.add(r.para);
  }
  for (const c of casos) if (!usados.has(c)) e.push(`caso "${c}" solto (sem ator nem relação)`);
  for (const a of atores) if (!usados.has('ator:' + a)) e.push(`ator "${a}" sem associação`);

  }

  // BPMN
  if (tem('bpmn')) {
  const p = spec.processo || {};
  curto(p.nome, 60, 'processo.nome');
  faixa(p.raias, 1, 4, 'processo.raias');
  faixa(p.elementos, 5, 14, 'processo.elementos');
  const raias = new Set((p.raias || []).map((r) => r.id));
  const els = new Map((p.elementos || []).map((x) => [x.id, x]));
  const ext = new Set((p.externos || []).map((x) => x.id));
  for (const r of p.raias || []) curto(r.nome, 40, `raia ${r.id}`);
  for (const x of p.externos || []) curto(x.nome, 40, `externo ${x.id}`);
  for (const x of p.elementos || []) {
    if (!TIPO_EL.has(x.tipo)) e.push(`elemento ${x.id}: tipo "${x.tipo}"`);
    if (x.multiplo !== undefined && (x.tipo !== 'tarefa' || x.multiplo !== 'paralelo')) e.push(`elemento ${x.id}: "multiplo" só vale "paralelo" e só em tarefa`);
    if (!raias.has(x.raia)) e.push(`elemento ${x.id}: raia "${x.raia}" não existe`);
    curto(x.nome, 40, `elemento ${x.id}`);
    if (x.tipo === 'gateway' && !/\?$/.test(x.nome || '')) e.push(`gateway ${x.id}: nome deve ser pergunta terminada em "?"`);
  }
  const inicios = (p.elementos || []).filter((x) => x.tipo.startsWith('inicio'));
  if (inicios.length !== 1) e.push(`processo: ${inicios.length} eventos de início (precisa 1)`);
  if (!(p.elementos || []).some((x) => x.tipo === 'fim')) e.push('processo: sem evento de fim');
  const entra = new Map(), sai = new Map();
  for (const f of p.fluxos || []) {
    if (!els.has(f.de) || !els.has(f.para)) { e.push(`fluxo ${f.de}→${f.para}: elemento inexistente`); continue; }
    sai.set(f.de, (sai.get(f.de) || 0) + 1); entra.set(f.para, (entra.get(f.para) || 0) + 1);
    if (els.get(f.de).tipo === 'gateway' && !f.rotulo) e.push(`fluxo ${f.de}→${f.para}: saída de gateway sem rótulo`);
  }
  for (const [id, x] of els) {
    if (!x.tipo.startsWith('inicio') && !entra.get(id)) e.push(`elemento ${id}: ninguém chega nele`);
    if (x.tipo !== 'fim' && !sai.get(id)) e.push(`elemento ${id}: não sai para lugar nenhum`);
    if (x.tipo === 'fim' && sai.get(id)) e.push(`fim ${id}: não pode ter saída`);
    if (x.tipo === 'gateway' && (sai.get(id) || 0) < 2) e.push(`gateway ${id}: precisa de 2+ saídas`);
  }
  for (const m of p.mensagens || []) {
    const ok = (els.has(m.de) && ext.has(m.para)) || (ext.has(m.de) && els.has(m.para));
    if (!ok) e.push(`mensagem ${m.de}→${m.para}: precisa ligar elemento ↔ externo`);
  }

  }

  // C4 containers
  if (tem('c4')) {
  const c = spec.arquitetura || {};
  curto(c.sistema, 40, 'arquitetura.sistema');
  faixa(c.containers, 2, 7, 'arquitetura.containers');
  faixa(c.pessoas || [], 0, 4, 'arquitetura.pessoas');
  faixa(c.externos || [], 0, 5, 'arquitetura.externos');
  const nos = new Set([...(c.pessoas || []), ...(c.containers || []), ...(c.externos || [])].map((x) => x.id));
  for (const x of c.containers || []) {
    curto(x.nome, 40, `container ${x.id}`); curto(x.tecnologia, 40, `container ${x.id}.tecnologia`); curto(x.descricao, 60, `container ${x.id}.descricao`);
    if (!TIPO_CONT.has(x.tipo)) e.push(`container ${x.id}: tipo "${x.tipo}"`);
  }
  for (const x of [...(c.pessoas || []), ...(c.externos || [])]) { curto(x.nome, 40, x.id); curto(x.descricao, 60, `${x.id}.descricao`); }
  const ligados = new Set();
  for (const r of c.relacoes || []) {
    if (!nos.has(r.de) || !nos.has(r.para)) e.push(`relação C4 ${r.de}→${r.para}: inexistente`);
    curto(r.rotulo, 30, `relação ${r.de}→${r.para}`);
    ligados.add(r.de); ligados.add(r.para);
  }
  for (const id of nos) if (!ligados.has(id)) e.push(`C4: "${id}" sem relação`);
  }
  return e;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const pedidos = process.argv.slice(2);
  const arqs = (pedidos.length ? pedidos.map((x) => x + '.json') : readdirSync(DIR).filter((f) => f.endsWith('.json')));
  let ruins = 0;
  for (const a of arqs) {
    let spec;
    try { spec = JSON.parse(readFileSync(join(DIR, a), 'utf8')); } catch (err) { console.log(`✗ ${a}: não abre (${err.message})`); ruins++; continue; }
    const erros = validar(spec);
    if (erros.length) { ruins++; console.log(`✗ ${a}`); for (const x of erros) console.log('   ' + x); }
    else console.log(`✓ ${a}`);
  }
  console.log(`${arqs.length - ruins} de ${arqs.length} passaram`);
  process.exit(ruins ? 1 : 0);
}
