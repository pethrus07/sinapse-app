// Indexa o vault markdown -> grafo (nós + arestas) + notas + stats.
// A fonte da verdade continua sendo os .md; isto só gera um índice derivado.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const VAULT = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(APP_ROOT, '..', 'sinapse');
const OUT = resolve(APP_ROOT, 'src', 'data');

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

function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const files = walk(VAULT);
const notes = [];

for (const file of files) {
  const rel = relative(VAULT, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');
  const fm = matter(src);
  const data = fm.data || {};
  const content = fm.content || '';
  const id = basename(file, '.md');
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

// mapa de resolução: id e título (várias formas) -> id
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

// backlinks
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

// grafo
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

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'notes.json'), JSON.stringify(outNotes));
writeFileSync(join(OUT, 'graph.json'), JSON.stringify({ nodes, edges }));
writeFileSync(join(OUT, 'stats.json'), JSON.stringify(stats));

console.log(`[index-vault] ${stats.notes} notas · ${stats.links} conexoes · ${stats.ghosts} sementes  (de ${VAULT})`);
