// Lógica de indexação do vault, reutilizável (CLI + API do dev server).
// Fonte da verdade = os .md; isto gera um índice derivado e o retorna.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import { lerCompromissos } from './compromissos.mjs';
import { lerAion } from './aion/indice.mjs';

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

/* Cache em disco do `git log` por pasta, válido enquanto o HEAD do repositório não muda.
   O HEAD sai dos arquivos do .git (sem abrir processo): no Windows, abrir ~60 `git` custava
   ~15 s no primeiro índice depois de subir o servidor (medido em 28/10/2026). Só guarda saída
   de git de repositórios locais; fica fora do vault e do repo do app. */
const ARQ_CACHE = process.env.SINAPSE_CACHE_GIT || join(homedir(), '.sinapse', 'cache-git.json');
// Área de uma nota sem `area` no frontmatter, pela pasta (mesmo vocabulário do vault).
const AREA_DA_PASTA = {
  '01-DIARIO': 'diario', '02-ESTUDO': 'estudo', '03-PROJETOS': 'projetos', '04-NEGOCIO': 'negocio',
  '05-IDEIAS': 'ideias', '06-PESSOAS': 'pessoas', '07-FONTES': 'fontes', '08-CRESCIMENTO': 'crescimento',
};
// Estado da sincronização do banco (scripts/financas/sincronizar.mjs --gravar): fora do git e do
// vault. Só rótulo, status e datas — nenhum id de item ou conta.
const ARQ_ESTADO_FIN = () => join(process.env.SINAPSE_FINANCAS || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'sinapse-financas'), 'estado.json');
function lerEstadoFinancas() {
  try {
    const e = JSON.parse(readFileSync(ARQ_ESTADO_FIN(), 'utf8'));
    const conexoes = (e.conexoes || []).map((c) => ({
      rotulo: String(c.rotulo || 'conexão'), status: String(c.status || ''), execucao: String(c.execucao || ''),
      ultimaAtualizacao: String(c.ultimaAtualizacao || ''), autorizacaoVence: String(c.autorizacaoVence || ''), erro: String(c.erro || ''),
    }));
    const f = e.ultimaFalha && typeof e.ultimaFalha === 'object' ? { em: String(e.ultimaFalha.em || ''), mensagem: String(e.ultimaFalha.mensagem || '').slice(0, 300) } : null;
    return { conexoes, ultimaSync: String(e.ultimaSync || ''), ultimaFalha: f };
  } catch { return { conexoes: [], ultimaSync: '', ultimaFalha: null }; }
}
let cacheDisco = null;
let cacheSujo = false;
function lerCacheDisco() {
  if (cacheDisco) return cacheDisco;
  try { cacheDisco = JSON.parse(readFileSync(ARQ_CACHE, 'utf8')); } catch { cacheDisco = {}; }
  return cacheDisco;
}
function gravarCacheDisco() {
  if (!cacheSujo) return;
  try {
    mkdirSync(dirname(ARQ_CACHE), { recursive: true });
    writeFileSync(ARQ_CACHE, JSON.stringify(cacheDisco));
    cacheSujo = false;
  } catch { /* sem cache em disco: só fica mais lento */ }
}
// commit atual do repositório que contém `dir`, lido do .git; null se não der para saber
export function headDe(dir) {
  try {
    let d = resolve(dir);
    while (!existsSync(join(d, '.git'))) {
      const pai = dirname(d);
      if (pai === d) return null;
      d = pai;
    }
    let gd = join(d, '.git');
    if (statSync(gd).isFile()) gd = resolve(d, readFileSync(gd, 'utf8').replace(/^gitdir:\s*/, '').trim());
    const head = readFileSync(join(gd, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head;
    const ref = head.slice(4).trim();
    if (existsSync(join(gd, ref))) return readFileSync(join(gd, ref), 'utf8').trim();
    const packed = existsSync(join(gd, 'packed-refs')) ? readFileSync(join(gd, 'packed-refs'), 'utf8') : '';
    const linha = packed.split(/\r?\n/).find((l) => l.endsWith(' ' + ref));
    return linha ? linha.split(' ')[0] : null;
  } catch {
    return null;
  }
}

// `git log` de uma pasta com o cache em disco por HEAD (o resultado só muda com commit novo)
function gitLogCacheado(dir, args) {
  const head = headDe(dir);
  const chave = dir + '|' + args.join(' ');
  const c = lerCacheDisco();
  if (head && c[chave]?.head === head) return c[chave].saida;
  const saida = git(dir, args);
  if (head) { c[chave] = { head, saida }; cacheSujo = true; }
  return saida;
}

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

// Dia em que cada arquivo entrou no vault (primeiro commit que o adicionou), para o grafo no
// tempo: só ~1/5 das notas tem `criado:` no frontmatter. Um `git log` só, com cache por HEAD.
// `--no-renames`: nota renomeada conta do dia da renomeação (sem isso ela nunca aparece como
// adicionada e ficaria sem data).
function nascimentoNoGit(VAULT) {
  const saida = gitLogCacheado(VAULT, ['log', '--diff-filter=A', '--no-renames', '--name-only', '--format=@%cs', '--', '*.md']);
  const dia = new Map();
  let atual = '';
  for (const l of saida.split('\n')) {
    if (l.startsWith('@')) atual = l.slice(1).trim();
    else if (l.trim() && atual) dia.set(l.trim(), atual); // do mais novo para o mais velho: fica o mais antigo
  }
  return dia;
}

// Timestamps (segundos) dos commits que mexeram na pasta, do mais novo para o mais velho.
// `-- .` restringe à pasta: `qa-parresia/analise-5cvb` não herda os commits do repo inteiro.
// Mesma chamada da História (commitsPorDia): um `git log` por pasta, não dois.
const ARGS_LOG = ['log', '--format=%ct%x09%s', '--max-count=600', '--', '.'];
function commitsDaPasta(dir) {
  if (!existsSync(dir)) return [];
  return gitLogCacheado(dir, ARGS_LOG)
    .split(/\r?\n/)
    .map((l) => Number(l.split('\t')[0]))
    .filter((t) => Number.isFinite(t) && t > 0);
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

/* ---------- Página do projeto: tarefas, história e desenho ----------
   Tarefas = caixas de seleção da própria nota: `- [ ]` a fazer, `- [/]` fazendo, `- [x]` feito.
   A linha crua vai junto: é por ela que o /api/tarefa acha o que mudar no .md.
   História = commits das `pastas:` (agrupados por dia) + notas datadas que citam o projeto
   (históricos, diário) + a data de criação da nota. Desenho = 09-DESENHOS/<nota>.excalidraw. */
const RE_TAREFA = /^(\s*[-*]\s+\[)( |x|X|\/)(\]\s+)(.+)$/;
function extrairTarefas(conteudo) {
  const tarefas = [];
  let secao = '';
  for (const linha of conteudo.split(/\r?\n/)) {
    const h = linha.match(/^#{2,4}\s+(.+)$/);
    if (h) { secao = h[1].trim(); continue; }
    const m = linha.match(RE_TAREFA);
    if (!m) continue;
    const marca = m[2];
    tarefas.push({
      linha,
      texto: m[4].replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/\*\*|~~/g, '').trim(),
      estado: marca === ' ' ? 'a-fazer' : marca === '/' ? 'fazendo' : 'feito',
      secao,
    });
  }
  return tarefas;
}

// commits da pasta com assunto, agrupados por dia (o mais novo primeiro)
function commitsPorDia(dir) {
  if (!existsSync(dir)) return [];
  const dias = new Map();
  for (const l of gitLogCacheado(dir, ARGS_LOG).split(/\r?\n/)) {
    const [t, ...resto] = l.split('\t');
    const ts = Number(t);
    if (!Number.isFinite(ts) || !ts) continue;
    const dia = new Date(ts * 1000).toISOString().slice(0, 10);
    const d = dias.get(dia) || { data: dia, tipo: 'commit', qtd: 0, textos: [] };
    d.qtd += 1;
    if (d.textos.length < 4) d.textos.push(resto.join('\t').slice(0, 140));
    dias.set(dia, d);
  }
  return [...dias.values()];
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
  const financeiro = { lancamentos: [], meses: [], retratos: [], orcamento: null };

  const criadoFm = new Map(); // id → `criado:` do frontmatter (manda sobre o git, quando existe)
  for (const file of files) {
    const rel = relative(VAULT, file).replace(/\\/g, '/');
    const src = readFileSync(file, 'utf8');
    const fm = matter(src);
    const data = fm.data || {};
    const content = fm.content || '';
    const id = basename(file, '.md');
    if (toYmd(data.criado)) criadoFm.set(id, toYmd(data.criado));
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
    // sem `area` no frontmatter, a pasta do vault diz a área ("04-NEGOCIO" → "negocio"): senão a
    // pasta crua vira uma área à parte no menu
    const pasta = rel.split('/')[0] || '';
    const area = (data.area || AREA_DA_PASTA[pasta] || pasta).toString();
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
      // retratos do patrimônio (04-NEGOCIO/financeiro/patrimonio.md): um por dia de sincronização
      const mp = content.match(/```patrimonio\s*\n([\s\S]*?)```/);
      if (mp) {
        try {
          const p = JSON.parse(mp[1]);
          for (const r of Array.isArray(p.retratos) ? p.retratos : []) {
            if (r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.data))) financeiro.retratos.push({ data: r.data, total: Number(r.total) || 0, diaria: Number(r.diaria) || 0, porGrupo: r.porGrupo || {} });
          }
        } catch { /* JSON invalido -> ignora */ }
      }
      // orçamento (04-NEGOCIO/financeiro/orcamento.md): teto mensal por categoria, definido pelo Pedro
      const mo = content.match(/```financeiro-orcamento\s*\n([\s\S]*?)```/);
      if (mo && !financeiro.orcamento) {
        try {
          const p = JSON.parse(mo[1]);
          const tetos = {};
          for (const [c, v] of Object.entries(p && typeof p.tetos === 'object' && p.tetos ? p.tetos : {})) {
            const k = String(c).trim().toLowerCase();
            if (k && Number(v) > 0) tetos[k] = Number(v);
          }
          financeiro.orcamento = { tetos, rel, ...(Number(p.metaReserva) > 0 ? { metaReserva: Number(p.metaReserva) } : {}) };
        } catch { /* JSON invalido -> ignora */ }
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
      ...(type === 'projeto'
        ? { pastasProjeto: pastas, criado: toYmd(data.criado), tarefas: extrairTarefas(content) }
        : {}),
      ...(frente
        ? {
            vaga,
            pastas,
            cutucar: toYmd(data.cutucar),
            esperando: (data.esperando || '').toString(),
            proximo: (data.proximo || '').toString(),
            motivo: (data.motivo || '').toString(),
            // casa a reunião do Atas com esta frente quando o nome não basta (scripts/compromissos.mjs)
            atasProjeto: listaDe(data.atas_projeto),
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

  // história de cada projeto: commits + notas datadas que o citam + criação da nota
  const porId = new Map(outNotes.map((n) => [n.id, n]));
  for (const n of outNotes) {
    // desenho vale para qualquer nota (ferramenta, identidade, setup…), não só projeto
    if (existsSync(join(VAULT, '09-DESENHOS', n.id + '.excalidraw'))) n.desenho = true;
    if (n.type !== 'projeto') continue;
    const eventos = [];
    const vistos = new Set();
    for (const p of n.pastasProjeto || []) {
      for (const d of commitsPorDia(resolve(PROJETOS, p))) {
        const ja = eventos.find((e) => e.tipo === 'commit' && e.data === d.data);
        if (ja) { ja.qtd += d.qtd; ja.textos = [...ja.textos, ...d.textos].slice(0, 4); } else eventos.push(d);
      }
    }
    for (const outro of n.backlinks) {
      const o = porId.get(outro);
      const dia = (o?.id.match(/\d{4}-\d{2}-\d{2}/) || [])[0];
      if (o && dia && !vistos.has(o.id)) {
        vistos.add(o.id);
        eventos.push({ data: dia, tipo: o.type === 'diario' || o.type === 'daily' ? 'diario' : 'nota', nota: o.id, titulo: o.title });
      }
    }
    if (n.criado) eventos.push({ data: n.criado, tipo: 'criado', titulo: 'nota do projeto criada' });
    eventos.sort((a, b) => b.data.localeCompare(a.data));
    n.historia = eventos;
  }

  // nasceu: `criado:` da nota; senão o dia em que entrou no git do vault; nota ainda sem commit = hoje
  const noGit = nascimentoNoGit(VAULT);
  const hojeYmd = new Date().toISOString().slice(0, 10);
  const nodes = outNotes.map((n) => ({
    id: n.id, title: n.title, area: n.area, type: n.type, degree: n.degree,
    nasceu: criadoFm.get(n.id) || noGit.get(n.rel) || hojeYmd,
  }));
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
  // "O que prometi": encaminhamentos do Pedro nas atas do Atas (só leitura; nada vai ao vault)
  const compromissos = lerCompromissos(outNotes.filter((n) => n.atividade));
  const roadmap = roadmaps[0] || { items: [] }; // 1 roadmap de sistema por vault (por ora)
  // Aion (investimentos): cache de mercado local + arquivos aion-*.md do vault + a trilha de estudo
  const aion = lerAion(VAULT, outNotes);
  // O financeiro alimenta o calendario: vencimento ABERTO vira data na agenda.
  // Sem isso a mesma data existiria em dois lugares e uma das duas envelheceria.
  //
  // AGRUPADO por (dia, cliente, direcao): um ciclo de cliente pode ter 6 lancamentos
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
  // a autorização do Open Finance vence em 1 ano: o aviso cai na agenda 30 dias antes
  const estFin = lerEstadoFinancas();
  financeiro.conexoes = estFin.conexoes;
  financeiro.ultimaSync = estFin.ultimaSync;
  financeiro.ultimaFalha = estFin.ultimaFalha;
  financeiro.retratos.sort((a, b) => a.data.localeCompare(b.data));
  for (const c of estFin.conexoes) {
    const vence = c.autorizacaoVence.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vence)) continue;
    const de = new Date(Date.parse(vence + 'T12:00:00Z') - 30 * 86400000).toISOString().slice(0, 10);
    agenda.datas.push({ de, titulo: `Renovar autorização do Open Finance (${c.rotulo}) até ${vence.split('-').reverse().join('/')}`, frente: 'pagar', nota: 'financas-automaticas', doFinanceiro: true });
  }
  financeiro.lancamentos.sort((a, b) => String(a.vencimento || '9999').localeCompare(String(b.vencimento || '9999')));
  financeiro.meses.sort((a, b) => String(a.mes).localeCompare(String(b.mes)));
  agenda.datas.sort((a, b) => String(a.de).localeCompare(String(b.de)));
  agenda.dailys.sort((a, b) => a.dia.localeCompare(b.dia));
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    gravarCacheDisco();
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(outNotes));
    writeFileSync(join(OUT, 'graph.json'), JSON.stringify(graph));
    writeFileSync(join(OUT, 'stats.json'), JSON.stringify(stats));
    writeFileSync(join(OUT, 'roadmap.json'), JSON.stringify(roadmap));
    writeFileSync(join(OUT, 'agenda.json'), JSON.stringify(agenda));
    writeFileSync(join(OUT, 'financeiro.json'), JSON.stringify(financeiro));
    writeFileSync(join(OUT, 'aion.json'), JSON.stringify(aion));
    // gitignored como o resto de src/data; o app NÃO importa este arquivo (só o /api/indice o entrega)
    writeFileSync(join(OUT, 'compromissos.json'), JSON.stringify(compromissos));
  }
  return { notes: outNotes, graph, stats, roadmap, agenda, financeiro, aion, compromissos };
}
