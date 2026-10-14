// Lógica de indexação do vault, reutilizável (CLI + API do dev server).
// Fonte da verdade = os .md; isto gera um índice derivado e o retorna.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';

/* ---------- Frentes: movimento pelo git ----------
   "Último movimento" de uma frente = último commit nas pastas que a nota declara em
   `pastas:` (relativas a ~/Projetos, como no verificar-pastas.py do vault). Sem pasta,
   vale o último commit da própria nota no vault. Os commits dos últimos 30 dias vão
   junto para o app medir as horas pelo método de sessões (src/lib/frentes.ts).
   Cache de 60 s: o watcher reindexa a cada .md salvo e o git não muda nesse ritmo. */
const STATUS_FRENTE = new Set(['ativo', 'aguardando', 'em-producao', 'pausado']);
const JANELA_COMMITS = 30 * 86400; // segundos
const CACHE_GIT_MS = 60_000;
const cacheGit = new Map();

function git(dir, args) {
  const chave = dir + '|' + args.join(' ');
  const hit = cacheGit.get(chave);
  if (hit && Date.now() - hit.em < CACHE_GIT_MS) return hit.saida;
  let saida = '';
  try {
    saida = execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
      windowsHide: true,
    });
  } catch {
    saida = ''; // não é repositório, pasta sem commit ou git ausente: sem movimento
  }
  cacheGit.set(chave, { em: Date.now(), saida });
  return saida;
}

// Timestamps (segundos) dos commits que mexeram na pasta, do mais novo para o mais velho.
// `-- .` restringe à pasta: `qa-parresia/analise-5cvb` não herda os commits do repo inteiro.
function commitsDaPasta(dir) {
  if (!existsSync(dir)) return [];
  return git(dir, ['log', '--format=%ct', '--max-count=300', '--', '.'])
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
}

function atividadeDaFrente(VAULT, PROJETOS, rel, pastas) {
  const agora = Math.floor(Date.now() / 1000);
  const todos = new Set();
  for (const p of pastas) for (const t of commitsDaPasta(resolve(PROJETOS, p))) todos.add(t);
  if (todos.size) {
    const lista = [...todos].sort((a, b) => b - a);
    return { ultimo: lista[0], commits: lista.filter((t) => agora - t <= JANELA_COMMITS), fonte: 'pastas' };
  }
  // sem pasta (ou pasta sem git): o último commit da nota no vault diz quando a frente andou
  const t = Number(git(VAULT, ['log', '-1', '--format=%ct', '--', rel]).trim());
  return { ultimo: Number.isFinite(t) && t > 0 ? t : null, commits: [], fonte: 'nota' };
}

function listaDe(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (v == null || v === '') return [];
  return String(v).split(',').map((x) => x.trim()).filter(Boolean);
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '_templates', '_attachments']);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.git')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (extname(name).toLowerCase() === '.md') acc.push(p);
  }
  return acc;
}

export function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// YAML sem quotes vira Date; data-só é meia-noite UTC, então o slice do ISO dá o dia certo.
function toYmd(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : s;
}

export function buildIndex(VAULT, OUT) {
  // pastas de projeto: as de `pastas:` são relativas a ~/Projetos (o pai do vault)
  const PROJETOS = process.env.PROJETOS_PATH ? resolve(process.env.PROJETOS_PATH) : resolve(VAULT, '..');
  const files = walk(VAULT);
  const notes = [];
  const roadmaps = []; // notas `tipo: roadmap` → alimentam o canvas do roadmap do sistema
  // Agenda: `tipo: agenda` traz a rotina em bloco JSON; `quando:` em qualquer nota vira evento;
  // `tipo: diario` (ou o antigo `daily`) alimenta o link do dia na grade.
  const agenda = { blocos: [], semanal: [], mensal: [], datas: [], dailys: [], fonte: '' };
  // Financeiro: um arquivo por mes (`tipo: financeiro`) com bloco JSON de lancamentos.
  const financeiro = { lancamentos: [], meses: [] };

  for (const file of files) {
    const rel = relative(VAULT, file).replace(/\\/g, '/');
    const src = readFileSync(file, 'utf8');
    const fm = matter(src);
    const data = fm.data || {};
    const content = fm.content || '';
    const id = basename(file, '.md');
    // bloco ```roadmap { "items": [...] } ``` → canvas (aba Sistema)
    if ((data.tipo || '').toString() === 'roadmap') {
      const m = content.match(/```roadmap\s*\n([\s\S]*?)```/);
      if (m) {
        try {
          const parsed = JSON.parse(m[1]);
          roadmaps.push({ rel, id, title: (data.title || id).toString(), projeto: (data.projeto || '').toString(), items: parsed.items || [] });
        } catch { /* JSON inválido → ignora, não quebra o índice */ }
      }
    }
    const h1 = content.match(/^#\s+(.+)$/m);
    const title = data.title || (h1 ? h1[1].trim() : id);
    const area = (data.area || rel.split('/')[0] || '').toString();
    const type = (data.tipo || 'nota').toString();

    // ---- agenda: rotina em bloco JSON, dailys e eventos por frontmatter ----
    if (type === 'agenda') {
      const m = content.match(/```agenda\s*\n([\s\S]*?)```/);
      if (m) {
        try {
          const p = JSON.parse(m[1]);
          agenda.fonte = id;
          for (const k of ['blocos', 'semanal', 'mensal', 'datas'])
            if (Array.isArray(p[k])) agenda[k].push(...p[k]);
        } catch { /* JSON inválido → ignora, não quebra o índice */ }
      }
    }
    if (type === 'financeiro') {
      const m = content.match(/```financeiro\s*\n([\s\S]*?)```/);
      const mes = toYmd(data.mes).slice(0, 7) || String(data.mes || id).slice(0, 7);
      if (m) {
        try {
          const p = JSON.parse(m[1]);
          const arr = Array.isArray(p.lancamentos) ? p.lancamentos : [];
          financeiro.meses.push({ mes, rel, id, total: arr.length });
          for (const l of arr) financeiro.lancamentos.push({ ...l, mes, rel });
        } catch { /* JSON invalido -> ignora, nao quebra o indice */ }
      }
    }
    if (type === 'daily' || type === 'diario') {
      const dia = /^\d{4}-\d{2}-\d{2}$/.test(id) ? id : toYmd(data.criado);
      if (dia) agenda.dailys.push({ dia, id, rel });
    }
    // qualquer nota com `quando:` entra no calendário como evento próprio
    if (data.quando) {
      agenda.datas.push({
        de: toYmd(data.quando),
        ate: toYmd(data.fim),
        titulo: title,
        frente: (data.frente || '').toString(),
        hora: (data.hora || '').toString(),
        onde: (data.onde || '').toString(),
        link: (data.link || '').toString(),
        nota: id,
        deNota: true,
      });
    }
    let tags = data.tags || [];
    if (typeof tags === 'string') tags = [tags];
    const status = (data.status || '').toString();
    const vaga = data.vaga === true || String(data.vaga).toLowerCase() === 'true';
    // Frente = projeto vivo (ou com vaga). Só essas pagam o custo do git.
    const frente = type === 'projeto' && (vaga || STATUS_FRENTE.has(status));
    const pastas = listaDe(data.pastas);
    notes.push({
      ...(frente
        ? {
            vaga,
            pastas,
            cutucar: toYmd(data.cutucar),
            esperando: (data.esperando || '').toString(),
            proximo: (data.proximo || '').toString(),
            motivo: (data.motivo || '').toString(),
            atividade: atividadeDaFrente(VAULT, PROJETOS, rel, pastas),
          }
        : {}),
      id,
      rel,
      title,
      area,
      type,
      tags,
      status: (data.status || '').toString(),
      progresso: (data.progresso || '').toString(),
      trilha: (data.trilha || '').toString(),
      ordem: data.ordem != null && data.ordem !== '' ? Number(data.ordem) : null,
      cliente: (data.cliente || '').toString(),
      stack: (data.stack || '').toString(),
      body: content,
    });
  }

  const idByKey = new Map();
  for (const n of notes) {
    for (const k of [n.id.toLowerCase(), slugify(n.id), n.title.toLowerCase(), slugify(n.title)]) {
      if (k && !idByKey.has(k)) idByKey.set(k, n.id);
    }
  }
  const resolveTarget = (t) => idByKey.get(t.toLowerCase()) || idByKey.get(slugify(t)) || null;

  // Uma passada só: ou casa código (bloco cercado ou trecho em crase) e o devolve, ou casa um wikilink.
  const CODE_OR_WL = /```[\s\S]*?```|`[^`\n]*`|\[\[([^\]]+)\]\]/g;
  const linksByNote = new Map();
  const ghostLinksByNote = new Map();
  const ghosts = new Map();

  for (const n of notes) {
    const set = new Set();
    // `[[x]]` dentro de código (bloco ``` ou `trecho`) é exemplo, não link — igual ao
    // Obsidian e à régua do vault (scripts/saude-vault.py). Só o texto fora de código vira link.
    n.body = n.body.replace(CODE_OR_WL, (m, inner) => {
      if (inner === undefined) return m; // era código: devolve intacto
      const [rawTarget, rawAlias] = inner.split('|');
      const target = rawTarget.trim();
      const alias = (rawAlias ?? rawTarget).trim();
      const resolved = resolveTarget(target);
      if (resolved) {
        if (resolved !== n.id) set.add(resolved);
        return `[${alias}](wl:${resolved})`;
      }
      const gkey = 'ghost:' + slugify(target);
      if (!ghosts.has(gkey)) ghosts.set(gkey, target);
      if (!ghostLinksByNote.has(n.id)) ghostLinksByNote.set(n.id, new Set());
      ghostLinksByNote.get(n.id).add(gkey);
      return `[${alias}](wlx:${gkey})`;
    });
    linksByNote.set(n.id, set);
  }

  const backlinks = new Map();
  for (const [from, set] of linksByNote)
    for (const to of set) {
      if (!backlinks.has(to)) backlinks.set(to, new Set());
      backlinks.get(to).add(from);
    }

  const outNotes = notes.map((n) => {
    const links = [...(linksByNote.get(n.id) || [])];
    const bl = [...(backlinks.get(n.id) || [])];
    return { ...n, links, backlinks: bl, degree: links.length + bl.length };
  });

  const nodes = outNotes.map((n) => ({ id: n.id, title: n.title, area: n.area, type: n.type, degree: n.degree }));
  for (const [gkey, disp] of ghosts)
    nodes.push({ id: gkey, title: disp, area: '(sementes)', type: 'ghost', degree: 0, ghost: true });

  const edges = [];
  const seen = new Set();
  for (const [from, set] of linksByNote)
    for (const to of set) {
      const k = from + '->' + to;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ source: from, target: to });
    }
  for (const [from, set] of ghostLinksByNote)
    for (const to of set) {
      const k = from + '->' + to;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({ source: from, target: to, ghost: true });
    }

  const byArea = {};
  for (const n of outNotes) byArea[n.area] = (byArea[n.area] || 0) + 1;
  const with3 = outNotes.filter((n) => n.links.length + n.backlinks.length >= 3).length;
  const stats = {
    notes: outNotes.length,
    links: edges.filter((e) => !e.ghost).length,
    ghosts: ghosts.size,
    with3,
    byArea,
    generatedFrom: VAULT,
  };

  const graph = { nodes, edges };
  const roadmap = roadmaps[0] || { items: [] }; // 1 roadmap de sistema por vault (por ora)
  // O financeiro alimenta o calendario: vencimento ABERTO vira data na agenda.
  // Sem isso a mesma data existiria em dois lugares e uma das duas envelheceria.
  //
  // AGRUPADO por (dia, cliente, direcao): o ciclo do Desbravando sao 6 lancamentos
  // no dia 26, mas e UMA cobranca — 6 chips no mesmo dia afogam a grade. O detalhe
  // item por item vive na view Financeiro, que e o lugar dele.
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const grupos = new Map();
  for (const l of financeiro.lancamentos) {
    if (!l.vencimento) continue;
    if (l.status !== 'a-receber' && l.status !== 'a-pagar') continue;
    if (l.tipo === 'reserva') continue; // guardar e decisao, nao compromisso com data
    const saida = l.tipo === 'saida';
    const chave = [l.vencimento, saida ? 'saida' : 'entrada', l.cliente || ''].join('|');
    const g = grupos.get(chave) || { de: l.vencimento, saida, cliente: l.cliente || '', total: 0, itens: 0, nota: '', desc: '' };
    g.total += Number(l.valor) || 0;
    g.itens += 1;
    if (!g.nota && l.nota) g.nota = l.nota;
    if (!g.desc) g.desc = l.descricao || '';
    grupos.set(chave, g);
  }
  for (const g of grupos.values()) {
    const quem = g.cliente || g.desc;
    const sufixo = g.itens > 1 ? ` (${g.itens} itens)` : '';
    agenda.datas.push({
      de: g.de,
      titulo: `${g.saida ? 'Pagar' : 'Receber'} R$ ${brl(g.total)} · ${quem}${sufixo}`,
      frente: g.saida ? 'pagar' : 'receber',
      nota: g.nota,
      doFinanceiro: true,
    });
  }
  financeiro.lancamentos.sort((a, b) => String(a.vencimento || '9999').localeCompare(String(b.vencimento || '9999')));
  financeiro.meses.sort((a, b) => String(a.mes).localeCompare(String(b.mes)));
  agenda.datas.sort((a, b) => String(a.de).localeCompare(String(b.de)));
  agenda.dailys.sort((a, b) => a.dia.localeCompare(b.dia));
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(outNotes));
    writeFileSync(join(OUT, 'graph.json'), JSON.stringify(graph));
    writeFileSync(join(OUT, 'stats.json'), JSON.stringify(stats));
    writeFileSync(join(OUT, 'roadmap.json'), JSON.stringify(roadmap));
    writeFileSync(join(OUT, 'agenda.json'), JSON.stringify(agenda));
    writeFileSync(join(OUT, 'financeiro.json'), JSON.stringify(financeiro));
  }
  return { notes: outNotes, graph, stats, roadmap, agenda, financeiro };
}
