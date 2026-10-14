// Importa exportações do NotebookLM para o vault, como material CRU de inbox.
//
// Uso:  node scripts/importar-notebooklm.mjs <pasta-com-a-exportacao> [--dry] [--vault CAMINHO]
//
// Entrada esperada (qualquer rota de exportação serve, desde que vire arquivo):
//   <pasta>/<Nome do Notebook>/<qualquer>.md|.txt|.html   → 1 pasta por notebook
//   <pasta>/<qualquer>.md                                 → notebook "(avulso)"
// Um arquivo com vários títulos "# " é fatiado em uma nota por título — é assim
// que sai o "converter todas as notas em fonte" e a maioria dos exportadores.
//
// Saída: 00-INBOX/notebooklm/<slug-notebook>/*.md + 1 MOC por notebook.
// Nada cai direto nas áreas do vault: isso aqui é INBOX, quem promove é você no
// review. O MOC existe pra as notas entrarem no grafo ligadas, e não como 100
// nós órfãos no meio das suas 122.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, extname, basename, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, slugify } from './build-index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const SEM_REINDEX = argv.includes('--sem-reindex'); // p/ testar contra um vault de mentira sem sujar src/data
const vaultFlag = argv.indexOf('--vault');
const VAULT = vaultFlag >= 0 ? resolve(argv[vaultFlag + 1]) : (process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(APP_ROOT, '..', 'sinapse'));
const RAW = argv.filter((a, i) => !a.startsWith('--') && i !== vaultFlag + 1)[0];

if (!RAW) {
  console.error('uso: node scripts/importar-notebooklm.mjs <pasta-com-a-exportacao> [--dry] [--vault CAMINHO]');
  process.exit(1);
}
const RAW_DIR = resolve(RAW);
for (const [rotulo, p] of [['pasta da exportação', RAW_DIR], ['vault', VAULT]]) {
  if (!existsSync(p)) { console.error(`[nlm] ${rotulo} não existe: ${p}`); process.exit(1); }
}

const EXTS = new Set(['.md', '.txt', '.html', '.htm']);
const DESTINO = join(VAULT, '00-INBOX', 'notebooklm');
const HOJE = new Date().toISOString().slice(0, 10);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (EXTS.has(extname(name).toLowerCase())) acc.push(p);
  }
  return acc;
}

// ids do vault inteiro = nome do arquivo sem .md. O índice resolve wikilink por
// esse nome, então colisão silenciosa faz duas notas virarem uma no grafo.
function idsExistentes(dir, acc = new Set()) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) idsExistentes(p, acc);
    else if (extname(name).toLowerCase() === '.md') acc.add(basename(name, '.md').toLowerCase());
  }
  return acc;
}

const limpar = (s) => s.replace(/\r\n/g, '\n').replace(/ /g, ' ');

function texto(file) {
  let s = limpar(readFileSync(file, 'utf8'));
  if (/\.html?$/i.test(file)) {
    s = s
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n');
  }
  return s.replace(/^---\n[\s\S]*?\n---\n/, '').trim(); // frontmatter alheio fora
}

// Um arquivo pode ser 1 nota ou um bundle de várias. Fatia pelo nível de título
// mais raso que aparecer 2+ vezes (# ou ##) — cobre bundle e nota simples.
function fatiar(conteudo, fallbackTitulo) {
  for (const nivel of ['#', '##']) {
    const re = new RegExp(`^${nivel} +(.+)$`, 'gm');
    const marcas = [...conteudo.matchAll(re)];
    if (marcas.length >= 2) {
      return marcas.map((m, i) => ({
        titulo: m[1].trim().replace(/[*_`]/g, ''),
        corpo: conteudo.slice(m.index + m[0].length, i + 1 < marcas.length ? marcas[i + 1].index : undefined).trim(),
      }));
    }
  }
  const h = conteudo.match(/^#{1,3} +(.+)$/m);
  const titulo = h ? h[1].trim().replace(/[*_`]/g, '') : fallbackTitulo;
  const corpo = h ? conteudo.replace(h[0], '').trim() : conteudo;
  return [{ titulo, corpo }];
}

const arquivos = walk(RAW_DIR);
if (!arquivos.length) { console.error(`[nlm] nenhum .md/.txt/.html em ${RAW_DIR}`); process.exit(1); }

const usados = idsExistentes(VAULT);
const porNotebook = new Map();

for (const file of arquivos) {
  const rel = relative(RAW_DIR, file);
  const partes = rel.split(sep);
  const notebook = partes.length > 1 ? partes[0] : '(avulso)';
  const conteudo = texto(file);
  if (!conteudo) continue;
  for (const { titulo, corpo } of fatiar(conteudo, basename(file, extname(file)))) {
    if (!corpo.trim()) continue;
    const lista = porNotebook.get(notebook) || [];
    lista.push({ titulo: titulo || basename(file, extname(file)), corpo, origem: rel });
    porNotebook.set(notebook, lista);
  }
}

function idUnico(base) {
  let id = base.slice(0, 70).replace(/-+$/, '');
  let n = 2;
  while (usados.has(id.toLowerCase())) id = `${base.slice(0, 66).replace(/-+$/, '')}-${n++}`;
  usados.add(id.toLowerCase());
  return id;
}

const escapar = (s) => `"${String(s).replace(/"/g, "'")}"`;
let escritas = 0;

for (const [notebook, notas] of porNotebook) {
  const slugNb = slugify(notebook) || 'avulso';
  const dir = join(DESTINO, slugNb);
  const mocId = idUnico(`MOC-nlm-${slugNb}`);
  const itens = [];

  for (const nota of notas) {
    const id = idUnico(`nlm-${slugNb}-${slugify(nota.titulo) || 'nota'}`);
    itens.push({ id, titulo: nota.titulo });
    // Resumo de IA sobre material de terceiro é fonte, e fonte não tem ciclo de vida:
    // sem `status` (o vault só aceita o vocabulário de 7 status — a régua trava o resto).
    // O "ainda cru" fica na tag `inbox`.
    const md = `---
tipo: fonte
area: notebooklm
tags: [notebooklm, inbox, ${slugNb}]
origem: notebooklm
notebook: ${escapar(notebook)}
criado: ${HOJE}
---

# ${nota.titulo}

${nota.corpo}

## Conexões
- Veio de: [[${mocId}]]
- Relaciona-se com: (a ligar no processamento)
- Onde aplico: (a ligar no processamento)
`;
    if (!DRY) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${id}.md`), md, 'utf8'); }
    escritas++;
  }

  const moc = `---
tipo: moc
area: notebooklm
tags: [notebooklm, moc, inbox, ${slugNb}]
origem: notebooklm
criado: ${HOJE}
---

# 📓 ${notebook} (NotebookLM)

Importado em ${HOJE} — **${itens.length} ${itens.length === 1 ? 'nota' : 'notas'}** ainda CRUAS.

No processamento (feito pelo Claude): cada item vira nota atômica na área certa (ou é apagado). Resumo de IA
sobre material de terceiro é **fonte** → [[MOC-fontes]]; nota atômica é o que
*você* concluiu.

## Notas importadas
${itens.map((i) => `- [ ] [[${i.id}|${i.titulo}]]`).join('\n')}

## Conexões
- Inbox: [[_sobre]]
`;
  if (!DRY) { mkdirSync(dir, { recursive: true }); writeFileSync(join(DESTINO, `${mocId}.md`), moc, 'utf8'); }
  console.log(`[nlm] ${notebook} → ${itens.length} notas (${slugNb}/)`);
}

console.log(`[nlm] ${DRY ? 'SIMULAÇÃO — nada escrito. ' : ''}${escritas} notas · ${porNotebook.size} notebooks → ${relative(VAULT, DESTINO)}`);

if (!DRY && !SEM_REINDEX) {
  const { stats } = buildIndex(VAULT, resolve(APP_ROOT, 'src', 'data'));
  console.log(`[nlm] vault reindexado: ${stats.notes} notas · ${stats.links} conexoes`);
  console.log('[nlm] ⚠️  o vault é um repo git — se algum notebook tem material de cliente, ignore 00-INBOX/notebooklm/ antes de commitar.');
}
