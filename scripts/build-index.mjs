// Lógica de indexação do vault, reutilizável (CLI + API do dev server).
// Fonte da verdade = os .md; isto gera um índice derivado e o retorna.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import matter from 'gray-matter';

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
    notes.push({
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
