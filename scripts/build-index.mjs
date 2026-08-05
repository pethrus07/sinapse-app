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

export function buildIndex(VAULT, OUT) {
  const files = walk(VAULT);
  const notes = [];
  const roadmaps = []; // notas `tipo: roadmap` → alimentam o canvas do roadmap do sistema

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

  const WL = /\[\[([^\]]+)\]\]/g;
  const linksByNote = new Map();
  const ghostLinksByNote = new Map();
  const ghosts = new Map();

  for (const n of notes) {
    const set = new Set();
    n.body = n.body.replace(WL, (_m, inner) => {
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
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(outNotes));
    writeFileSync(join(OUT, 'graph.json'), JSON.stringify(graph));
    writeFileSync(join(OUT, 'stats.json'), JSON.stringify(stats));
    writeFileSync(join(OUT, 'roadmap.json'), JSON.stringify(roadmap));
  }
  return { notes: outNotes, graph, stats, roadmap };
}
