// Plugin do Vite: adiciona endpoints de ESCRITA no vault ao dev server.
// POST /api/note      -> cria/edita uma nota (.md) e reindexa
// POST /api/progress  -> atualiza só o `progresso` de uma nota e reindexa
// POST /api/vaga      -> põe/tira uma frente da vaga (`vaga: true` no frontmatter) e reindexa
// POST /api/compromisso -> marca/desmarca "feito" num compromisso das atas (estado LOCAL do app,
//                          ~/.sinapse/compromissos-feitos.json; não escreve no vault nem no Atas)
// GET  /api/ata/<id>  -> serve o ata.html local de uma reunião que tem compromisso no índice
// POST /api/tarefa    -> muda o estado de uma tarefa "- [ ]" de nota de projeto, ou acrescenta uma
// GET/POST /api/desenho?nota=<id> -> lê/grava o desenho Excalidraw (09-DESENHOS/<id>.excalidraw)
import { readFileSync, writeFileSync, existsSync, mkdirSync, watch } from 'node:fs';
import { resolve, join, dirname, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { buildIndex, slugify } from './build-index.mjs';
import { caminhoAtas, lerFeitos, marcarFeito } from './compromissos.mjs';
import { readdirSync } from 'node:fs';
import { gravarMes as gravarMesRazao, hashId, pareceSensivel } from './financas/nucleo.mjs';
import { criterioDaTransacao, hojeSP } from './financas/pluggy.mjs';

// Pasta local da Métis (fora do git): regras e bruto do banco. O endpoint de classificar lê o
// bruto só para montar a regra "lembrar para os próximos"; nada dele volta para o app ou o vault.
const BASE_FINANCAS = () => process.env.SINAPSE_FINANCAS || join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'sinapse-financas');

/** A transação crua do banco cujo hash é este fitid (procura do dia mais novo para o mais velho). */
function brutoDoFitid(fitid) {
  const raiz = join(BASE_FINANCAS(), 'bruto', 'pluggy');
  if (!existsSync(raiz)) return null;
  for (const dia of readdirSync(raiz).sort().reverse()) {
    for (const f of readdirSync(join(raiz, dia)).filter((x) => /transac/.test(x) && x.endsWith('.json'))) {
      let lista;
      try { lista = JSON.parse(readFileSync(join(raiz, dia, f), 'utf8')); } catch { continue; }
      const tx = (Array.isArray(lista) ? lista : lista.results || []).find((t) => t && t.id && hashId('pluggy', t.id) === fitid);
      if (tx) return tx;
    }
  }
  return null;
}

/** Acrescenta no INÍCIO do regras.json local (a primeira que casa decide) a regra nova. */
function lembrarRegra(fitid, categoria) {
  const tx = brutoDoFitid(fitid);
  if (!tx) return { lembrou: false, motivo: 'a transação não está no bruto local' };
  const quando = criterioDaTransacao(tx);
  if (!quando) return { lembrou: false, motivo: 'a transação não tem documento nem nome para reconhecer' };
  const arq = join(BASE_FINANCAS(), 'regras', 'regras.json');
  const regras = existsSync(arq) ? JSON.parse(readFileSync(arq, 'utf8')) : {};
  regras.regras = Array.isArray(regras.regras) ? regras.regras : [];
  const igual = (r) => JSON.stringify(r.quando) === JSON.stringify(quando);
  regras.regras = [{ quando, categoria, _criada: 'pelo app em ' + new Date().toISOString().slice(0, 10) }, ...regras.regras.filter((r) => !igual(r))];
  mkdirSync(dirname(arq), { recursive: true });
  writeFileSync(arq, JSON.stringify(regras, null, 2), 'utf8');
  return { lembrou: true, por: quando.documento ? 'documento' : 'nome' };
}

const AREA_FOLDER = {
  estudo: '02-ESTUDO',
  projetos: '03-PROJETOS',
  negocio: '04-NEGOCIO',
  ideias: '05-IDEIAS',
  pessoas: '06-PESSOAS',
  fontes: '07-FONTES',
  diario: '01-DIARIO',
};
const FIELDS = ['tipo', 'area', 'tags', 'status', 'progresso', 'trilha', 'ordem', 'cliente', 'stack', 'criado'];

// Junta os chunks como BUFFER e decodifica uma vez em UTF-8. Concatenar em string
// quebra caractere multibyte partido entre dois chunks (acento vira "�").
function readBody(req) {
  return new Promise((res, rej) => {
    const partes = [];
    req.on('data', (c) => partes.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => res(Buffer.concat(partes).toString('utf8')));
    req.on('error', rej);
  });
}
function sendJson(res, obj, code = 200) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
}
function clean(obj) {
  // normaliza datas (evita virar timestamp ISO) e remove chaves vazias
  for (const k of Object.keys(obj)) {
    if (obj[k] instanceof Date) obj[k] = obj[k].toISOString().slice(0, 10);
    if (obj[k] === '' || obj[k] == null) delete obj[k];
  }
  return obj;
}

/* ---------- vaga: edição mínima do frontmatter ----------
   Não usa matter.stringify: ele re-serializa o YAML inteiro (lista em bloco, aspas,
   datas) e a nota inteira mudaria por causa de uma linha. Aqui só a linha `vaga:`
   entra ou sai; o resto do arquivo fica byte a byte igual. `vaga: false` não é
   escrito: campo ausente já quer dizer "fora da vaga". */
const MAX_VAGAS = 3;
// mesmo formato de scripts/build-index.mjs (RE_TAREFA): "- [ ] texto", "- [/] texto", "- [x] texto"
const RE_TAREFA_API = /^(\s*[-*]\s+\[)( |x|X|\/)(\]\s+)(.+)$/;
const FM = /^---(\r?\n)([\s\S]*?)\r?\n---/;

/**
 * Caminho relativo vindo do navegador -> arquivo DENTRO do vault. `join(VAULT, '../x')` escreveria
 * fora (o /api/note e o /api/progress aceitavam qualquer `rel`).
 */
function dentroDoVault(VAULT, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw erro('caminho inválido', 400);
  const full = resolve(VAULT, rel);
  const dentro = relative(VAULT, full);
  if (!dentro || dentro.startsWith('..') || isAbsolute(dentro)) throw erro('fora do vault', 400);
  return full;
}

/**
 * Escrita só de quem é o próprio app. Uma página qualquer aberta no navegador consegue mandar um
 * POST "simples" (text/plain, sem preflight) para o localhost; o CORS só esconde a resposta, a
 * escrita já aconteceu. Exigir JSON força o preflight, e a origem (quando vem) tem que ser local.
 */
function postConfiavel(req) {
  const tipo = String(req.headers['content-type'] || '').toLowerCase();
  if (!tipo.startsWith('application/json')) return false;
  const origem = req.headers.origin;
  if (!origem) return true;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origem).hostname); } catch { return false; }
}

/** "1.234,56", "1234,56", "1234.56" ou número -> reais com 2 casas (centavo inteiro). */
export function valorBR(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  let t = String(v ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(t)) return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // "1.500" é mil e quinhentos
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function erro(msg, code) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

// Caminho relativo -> arquivo dentro do vault, que existe e é nota de projeto.
function notaDeProjeto(VAULT, rel) {
  if (typeof rel !== 'string' || !rel.toLowerCase().endsWith('.md')) throw erro('nota inválida', 400);
  const full = resolve(VAULT, rel);
  const dentro = relative(VAULT, full);
  if (!dentro || dentro.startsWith('..') || isAbsolute(dentro)) throw erro('fora do vault', 400);
  if (!existsSync(full)) throw erro('nota não encontrada: ' + rel, 404);
  const texto = readFileSync(full, 'utf8');
  const m = texto.match(FM);
  if (!m || !/^tipo:\s*projeto\s*$/m.test(m[2])) throw erro('só nota de projeto ocupa vaga: ' + rel, 400);
  return { full, texto, m };
}

function comVaga({ texto, m }, valor) {
  const eol = m[1];
  const linhas = m[2].split(/\r?\n/).filter((l) => !/^vaga:/.test(l));
  if (valor) {
    const i = linhas.findIndex((l) => /^status:/.test(l));
    linhas.splice(i >= 0 ? i + 1 : linhas.length, 0, 'vaga: true');
  }
  const fm = '---' + eol + linhas.join(eol) + eol + '---';
  return fm + texto.slice(m[0].length);
}

export function vaultApi() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const APP_ROOT = resolve(__dirname, '..');
  const VAULT = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(APP_ROOT, '..', 'sinapse');
  // INDEX_OUT: o e2e aponta para fora de src/data, para o vault temporário não sobrescrever o índice real
  const OUT = process.env.INDEX_OUT ? resolve(process.env.INDEX_OUT) : resolve(APP_ROOT, 'src', 'data');
  let versao = 0;
  let ultimo = null;
  const reindex = () => {
    ultimo = buildIndex(VAULT, OUT);
    versao += 1;
    return ultimo;
  };

  return {
    name: 'vault-api',
    configureServer(server) {
      // Editar um .md na mao tem que valer tanto quanto escrever pela interface.
      let pendente = null;
      try {
        watch(VAULT, { recursive: true }, (_ev, arquivo) => {
          if (!arquivo || !String(arquivo).toLowerCase().endsWith('.md')) return;
          clearTimeout(pendente);
          pendente = setTimeout(() => {
            try {
              reindex();
              server.config.logger.info(`[vault] reindexado (v${versao}) apos mudanca em ${arquivo}`);
            } catch (e) {
              server.config.logger.warn('[vault] reindex falhou: ' + String(e && e.message));
            }
          }, 400);
        });
      } catch (e) {
        server.config.logger.warn('[vault] watcher indisponivel: ' + String(e && e.message));
      }

      // Ata nova (ou refeita) no Atas: só o ata.json conta. O sessao.json muda a cada 5 s
      // durante a gravação e não traz compromisso nenhum.
      const ATAS_SALVAS = join(caminhoAtas(), 'atas-salvas');
      if (existsSync(ATAS_SALVAS)) {
        let pendenteAta = null;
        try {
          watch(ATAS_SALVAS, { recursive: true }, (_ev, arquivo) => {
            if (!arquivo || basename(String(arquivo)).toLowerCase() !== 'ata.json') return;
            clearTimeout(pendenteAta);
            pendenteAta = setTimeout(() => {
              try {
                reindex();
              } catch (e) {
                server.config.logger.warn('[atas] reindex falhou: ' + String(e && e.message));
              }
            }, 800);
          });
        } catch (e) {
          server.config.logger.warn('[atas] watcher indisponivel: ' + String(e && e.message));
        }
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        try {
          const url = req.url.split('?')[0];
          if (req.method !== 'GET' && req.method !== 'HEAD' && !postConfiavel(req))
            return sendJson(res, { error: 'escrita só pelo próprio app (JSON, origem local)' }, 403);

          // ---- GET /api/versao e /api/indice: indice VIVO ----
          // O JSON empacotado (src/data/*.json) esta em server.watch.ignored, entao o
          // Vite serve do cache e reindex feito fora da sessao (CLI, edicao a mao,
          // outra aba) nunca chegava no navegador. O app usa o JSON so pro primeiro
          // paint e busca a verdade aqui.
          if (url === '/api/versao' && req.method === 'GET') {
            return sendJson(res, { versao });
          }
          if (url === '/api/indice' && req.method === 'GET') {
            if (!ultimo) ultimo = reindex();
            return sendJson(res, { versao, ...ultimo });
          }

          if (url === '/api/note' && req.method === 'POST') {
            const p = JSON.parse((await readBody(req)) || '{}');
            let rel = p.rel;
            if (!rel) {
              const folder = AREA_FOLDER[(p.area || '').toLowerCase()] || '00-INBOX';
              const slug = slugify(p.id || p.title || 'nota-sem-titulo') || 'nota';
              rel = `${folder}/${slug}.md`;
            }
            if (!/\.md$/i.test(rel)) return sendJson(res, { error: 'nota precisa terminar em .md' }, 400);
            let full;
            try { full = dentroDoVault(VAULT, rel); } catch (e) { return sendJson(res, { error: e.message }, e.code); }
            let data = {};
            let body = p.body != null ? p.body : '';
            if (existsSync(full)) {
              const cur = matter(readFileSync(full, 'utf8'));
              data = cur.data || {};
              if (p.body == null) body = cur.content;
            } else if (!p.criado) {
              data.criado = new Date().toISOString().slice(0, 10);
            }
            for (const k of FIELDS) if (p[k] !== undefined) data[k] = p[k];
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, matter.stringify(body, clean(data)));
            const idx = reindex();
            return sendJson(res, { ok: true, rel, id: basename(rel, '.md'), ...idx });
          }

          if (url === '/api/progress' && req.method === 'POST') {
            const p = JSON.parse((await readBody(req)) || '{}');
            let full;
            try { full = dentroDoVault(VAULT, p.rel); } catch (e) { return sendJson(res, { error: e.message }, e.code); }
            if (!existsSync(full)) return sendJson(res, { error: 'nota não encontrada' }, 404);
            const cur = matter(readFileSync(full, 'utf8'));
            cur.data.progresso = p.progresso;
            writeFileSync(full, matter.stringify(cur.content, clean(cur.data)));
            const idx = reindex();
            return sendJson(res, { ok: true, ...idx });
          }

          // ---- /api/vaga: { rel, vaga: true|false, sai?: rel } ----
          // Máximo de 3 vagas também aqui, não só na tela: entrar com as 3 ocupadas
          // exige dizer qual sai (`sai`), e as duas escritas vão juntas.
          if (url === '/api/vaga' && req.method === 'POST') {
            const p = JSON.parse((await readBody(req)) || '{}');
            const valor = p.vaga === true;
            try {
              const entra = notaDeProjeto(VAULT, p.rel);
              const sai = p.sai ? notaDeProjeto(VAULT, p.sai) : null;
              if (valor) {
                const idx = reindex(); // fresco: a nota pode ter sido editada à mão agora
                const ocupadas = idx.notes.filter((n) => n.vaga && n.rel !== p.rel && n.rel !== p.sai).length;
                if (ocupadas >= MAX_VAGAS)
                  return sendJson(res, { error: `as ${MAX_VAGAS} vagas estão ocupadas: diga qual sai` }, 409);
              }
              if (sai) writeFileSync(sai.full, comVaga(sai, false));
              writeFileSync(entra.full, comVaga(entra, valor));
            } catch (e) {
              if (e && e.code) return sendJson(res, { error: e.message }, e.code);
              throw e;
            }
            const idx = reindex();
            return sendJson(res, { ok: true, ...idx });
          }

          // ---- /api/tarefa: { rel, linha, estado } muda o marcador; { rel, nova } acrescenta ----
          // Edição mínima, como na vaga: só a linha da tarefa muda (ou entra uma linha nova na
          // seção "## Tarefas", criada antes de "## Conexões" se não existir).
          if (url === '/api/tarefa' && req.method === 'POST') {
            const p = JSON.parse((await readBody(req)) || '{}');
            try {
              const nota = notaDeProjeto(VAULT, p.rel);
              const eol = nota.m[1];
              const linhas = nota.texto.split(/\r?\n/);
              if (typeof p.nova === 'string') {
                const texto = p.nova.replace(/[\r\n]+/g, ' ').trim();
                if (!texto) throw erro('tarefa vazia', 400);
                const nova = '- [ ] ' + texto;
                let i = linhas.findIndex((l) => /^##\s+Tarefas\s*$/.test(l));
                if (i < 0) {
                  let c = linhas.findIndex((l) => /^##\s+Conex/.test(l));
                  if (c < 0) c = linhas.length;
                  linhas.splice(c, 0, '## Tarefas', '', nova, '');
                } else {
                  let fim = i + 1;
                  while (fim < linhas.length && !/^#{1,2}\s/.test(linhas[fim])) fim++;
                  while (fim > i + 1 && linhas[fim - 1].trim() === '') fim--;
                  linhas.splice(fim, 0, nova);
                }
              } else {
                const marca = { 'a-fazer': ' ', fazendo: '/', feito: 'x' }[p.estado];
                if (!marca) throw erro('estado inválido', 400);
                const i = linhas.indexOf(p.linha);
                if (i < 0 || !RE_TAREFA_API.test(p.linha)) throw erro('tarefa não encontrada (a nota mudou?)', 409);
                linhas[i] = p.linha.replace(RE_TAREFA_API, (_, a, _m, b, t) => a + marca + b + t);
              }
              writeFileSync(nota.full, linhas.join(eol));
            } catch (e) {
              if (e && e.code) return sendJson(res, { error: e.message }, e.code);
              throw e;
            }
            const idx = reindex();
            return sendJson(res, { ok: true, ...idx });
          }

          // ---- /api/desenho?nota=<id>: GET lê, POST grava 09-DESENHOS/<id>.excalidraw ----
          // Gravar pelo app tira o campo `gerado`: daí em diante o desenho é do Pedro e o
          // gerador (scripts/gerar-desenhos.mjs) não o sobrescreve mais.
          if (url === '/api/desenho') {
            const nota = new URL(req.url, 'http://x').searchParams.get('nota') || '';
            if (!/^[\w.-]+$/.test(nota)) return sendJson(res, { error: 'nota inválida' }, 400);
            const arq = join(VAULT, '09-DESENHOS', nota + '.excalidraw');
            if (req.method === 'GET') {
              if (!existsSync(arq)) return sendJson(res, { error: 'sem desenho' }, 404);
              return sendJson(res, JSON.parse(readFileSync(arq, 'utf8')));
            }
            if (req.method === 'POST') {
              const p = JSON.parse((await readBody(req)) || '{}');
              if (!Array.isArray(p.elements)) return sendJson(res, { error: 'cena inválida' }, 400);
              const cena = {
                type: 'excalidraw',
                version: 2,
                source: 'sinapse-app',
                elements: p.elements,
                appState: { viewBackgroundColor: p.appState?.viewBackgroundColor || '#ffffff', gridSize: null },
                files: p.files || {},
              };
              mkdirSync(dirname(arq), { recursive: true });
              writeFileSync(arq, JSON.stringify(cena, null, 1));
              return sendJson(res, { ok: true });
            }
          }

          // ---- /api/compromisso: { id, feito: true|false } ----
          // Só aceita id que está no índice agora (ou já marcado, para desfazer). Grava fora do
          // vault e do git; o Atas não é tocado.
          if (url === '/api/compromisso' && req.method === 'POST') {
            const p = JSON.parse((await readBody(req)) || '{}');
            const id = typeof p.id === 'string' ? p.id : '';
            const atual = ultimo || reindex();
            const conhecido = (atual.compromissos?.itens || []).some((c) => c.id === id) || !!lerFeitos()[id];
            if (!id || !conhecido) return sendJson(res, { error: 'compromisso não encontrado' }, 404);
            marcarFeito(id, p.feito !== false);
            const idx = reindex();
            return sendJson(res, { ok: true, ...idx });
          }

          // ---- GET /api/ata/<id>: a ata local (HTML interno do Atas), só de reunião do índice ----
          if (url.startsWith('/api/ata/') && req.method === 'GET') {
            const id = decodeURIComponent(url.slice('/api/ata/'.length));
            const atual = ultimo || reindex();
            const ok = (atual.compromissos?.itens || []).some((c) => c.reuniao.id === id && c.reuniao.temHtml);
            const arq = join(caminhoAtas(), 'atas-salvas', id, 'ata.html');
            if (!ok || /[\\/]|\.\./.test(id) || !existsSync(arq)) {
              res.statusCode = 404;
              return res.end('ata não encontrada');
            }
            res.statusCode = 200;
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            return res.end(readFileSync(arq));
          }

          // ---- /api/financeiro: lançar, liquidar e remover no arquivo do mês ----
          // A fonte da verdade continua sendo o .md. Este endpoint existe pra
          // lançar pela interface sem abrir editor — e sem quebrar o bloco JSON.
          if (url === '/api/financeiro' && req.method === 'POST') {
            const p = JSON.parse((await readBody(req)) || '{}');
            const acao = p.acao || 'lancar';

            const hoje = hojeSP();
            const mesDe = (venc) => (venc && /^\d{4}-\d{2}/.test(venc) ? venc.slice(0, 7) : hoje.slice(0, 7));
            const MES_OK = /^\d{4}-(0[1-9]|1[0-2])$/; // o mês vira nome de arquivo: nada de "../"
            const relDoMes = (mes) => `04-NEGOCIO/financeiro/${mes}.md`;
            const BLOCO = /```financeiro\s*\n([\s\S]*?)```/;

            // JSON quebrado no bloco (edição à mão): ERRO, nunca lista vazia. Lista vazia fazia o
            // próximo lançamento regravar o mês só com ele e apagar todos os outros.
            function lerMes(mes) {
              if (!MES_OK.test(mes)) throw erro('mês inválido: ' + mes, 400);
              const full = join(VAULT, relDoMes(mes));
              if (!existsSync(full)) return { full, mes, texto: '', lista: [], existe: false };
              const texto = readFileSync(full, 'utf8');
              const m = texto.match(BLOCO);
              let lista = [];
              if (m) {
                try { lista = JSON.parse(m[1]).lancamentos || []; } catch { throw erro(`o bloco financeiro de ${relDoMes(mes)} tem JSON inválido: corrija o arquivo antes (nada foi gravado)`, 409); }
              }
              return { full, mes, texto, lista, existe: true };
            }

            // mesma gravação da sincronização (scripts/financas/nucleo.mjs): troca só o bloco e deixa
            // o resto do arquivo (frontmatter, texto, CRLF) byte a byte igual
            function gravarMes(st, lista) {
              gravarMesRazao(VAULT, st.mes, st.existe ? { arquivo: st.full, texto: st.texto } : null, lista, hoje);
            }

            // o que se digita aqui vai para o vault (git): documento, conta, chave Pix ficam de fora
            const sensivel = (l) => ['descricao', 'cliente', 'obs', 'instituicao'].find((c) => l[c] && pareceSensivel(String(l[c])));

            try {
            if (acao === 'lancar') {
              const l = p.lancamento || {};
              const valor = valorBR(l.valor);
              if (!l.descricao || !Number.isFinite(valor) || valor <= 0)
                return sendJson(res, { error: 'descrição e valor (> 0) são obrigatórios' }, 400);
              const campo = sensivel(l);
              if (campo) return sendJson(res, { error: `o campo ${campo} parece ter documento, conta, cartão, e-mail ou telefone: tire antes de gravar` }, 400);
              const venc = (l.vencimento || '').slice(0, 10);
              // sem dia, o mes pode ser dito explicitamente: cartao de outubro vive no
              // arquivo de outubro, senao a projecao joga tudo no mes corrente
              const mes = venc ? mesDe(venc) : (MES_OK.test(l.mes || '') ? l.mes : mesDe(''));
              const st = lerMes(mes);
              // saldo lançado à mão (cripto, corretora que não vem pelo Open Finance)
              if (l.tipo === 'investimento') {
                const data = /^\d{4}-\d{2}-\d{2}$/.test(l.data || '') ? l.data : hoje;
                const st = lerMes(data.slice(0, 7));
                const instituicao = String(l.instituicao || '').trim();
                const base = slugify(['investimento', instituicao, l.descricao, data].join(' ')).slice(0, 60) || 'investimento';
                let id = base;
                for (let i = 2; st.lista.some((x) => x.id === id); i++) id = `${base}-${i}`;
                const novo = {
                  id, tipo: 'investimento', descricao: String(l.descricao).trim(), instituicao,
                  classe: String(l.classe || 'cripto').trim(), liquidez: String(l.liquidez || '').trim(),
                  data, valor, status: 'posicao', reserva: false, vencimento: '', obs: (l.obs || '').trim(),
                };
                gravarMes(st, [...st.lista, novo]);
                const idx = reindex();
                return sendJson(res, { ok: true, id, mes: st.mes, rel: relDoMes(st.mes), ...idx });
              }
              const tipo = ['saida', 'reserva'].includes(l.tipo) ? l.tipo : 'entrada';
              const base = slugify([venc || mes, l.cliente || '', l.descricao].join(' ')).slice(0, 60) || 'lancamento';
              let id = base;
              for (let i = 2; st.lista.some((x) => x.id === id); i++) id = `${base}-${i}`;
              const novo = {
                id,
                tipo,
                descricao: String(l.descricao).trim(),
                valor,
                vencimento: venc,
                status: ['a-receber', 'recebido', 'a-pagar', 'pago'].includes(l.status)
                  ? l.status
                  : tipo === 'entrada' ? 'a-receber' : 'a-pagar',
                cliente: (l.cliente || '').trim(),
                categoria: (l.categoria || '').trim(),
                nota: (l.nota || '').trim(),
                recorrente: !!l.recorrente,
                semPrazo: !!l.semPrazo,
                ...(l.pontual ? { pontual: true } : {}),
                obs: (l.obs || '').trim(),
              };
              const lista = [...st.lista, novo];
              gravarMes(st, lista);
              const idx = reindex();
              return sendJson(res, { ok: true, id, mes, rel: relDoMes(mes), ...idx });
            }

            if (acao === 'liquidar' || acao === 'reabrir' || acao === 'remover') {
              const mes = (p.mes || '').slice(0, 7);
              if (!mes || !p.id) return sendJson(res, { error: 'mes e id são obrigatórios' }, 400);
              const st = lerMes(mes);
              if (!st.existe) return sendJson(res, { error: 'mês não encontrado: ' + mes }, 404);
              const achou = st.lista.some((x) => x.id === p.id);
              if (!achou) return sendJson(res, { error: 'lançamento não encontrado: ' + p.id }, 404);

              let lista;
              if (acao === 'remover') {
                lista = st.lista.filter((x) => x.id !== p.id);
              } else {
                lista = st.lista.map((x) => {
                  if (x.id !== p.id) return x;
                  if (acao === 'reabrir')
                    return { ...x, status: x.tipo === 'entrada' ? 'a-receber' : 'a-pagar', liquidadoEm: '' };
                  return {
                    ...x,
                    // reserva usa os status de saida: liquidar reserva e 'pago' (guardado)
                    status: x.tipo === 'entrada' ? 'recebido' : 'pago',
                    liquidadoEm: /^\d{4}-\d{2}-\d{2}/.test(p.em || '') ? p.em.slice(0, 10) : hoje,
                  };
                });
              }
              gravarMes(st, lista);
              const idx = reindex();
              return sendJson(res, { ok: true, acao, id: p.id, mes, ...idx });
            }

            // classificar: troca a categoria de um lançamento; `lembrar` grava a regra no regras.json
            // LOCAL (%LOCALAPPDATA%), nunca no repo nem no vault. `pontual` liga/desliga a marca.
            if (acao === 'classificar' || acao === 'pontual') {
              const mes = (p.mes || '').slice(0, 7);
              const st = mes ? lerMes(mes) : null;
              if (!st || !st.existe) return sendJson(res, { error: 'mês não encontrado: ' + mes }, 404);
              const alvo = st.lista.find((x) => x.id === p.id);
              if (!alvo) return sendJson(res, { error: 'lançamento não encontrado: ' + p.id }, 404);
              let lembrete = null;
              let lista;
              if (acao === 'pontual') {
                lista = st.lista.map((x) => {
                  if (x.id !== p.id) return x;
                  const { pontual, ...resto } = x;
                  return p.valor === false ? resto : { ...resto, pontual: true };
                });
              } else {
                const categoria = String(p.categoria || '').trim().toLowerCase();
                if (!categoria || categoria === 'a classificar') return sendJson(res, { error: 'escolha uma categoria' }, 400);
                lista = st.lista.map((x) => (x.id === p.id ? { ...x, categoria } : x));
                if (p.lembrar) lembrete = alvo.fitid ? lembrarRegra(alvo.fitid, categoria) : { lembrou: false, motivo: 'lançamento sem origem no banco' };
              }
              gravarMes(st, lista);
              const idx = reindex();
              return sendJson(res, { ok: true, acao, id: p.id, mes, lembrete, ...idx });
            }

            // natureza: sobrescreve fixo/variável/pontual de um gasto ('' volta ao mapa da categoria)
            if (acao === 'natureza') {
              const mes = (p.mes || '').slice(0, 7);
              const st = mes ? lerMes(mes) : null;
              if (!st || !st.existe) return sendJson(res, { error: 'mês não encontrado: ' + mes }, 404);
              if (!st.lista.some((x) => x.id === p.id)) return sendJson(res, { error: 'lançamento não encontrado: ' + p.id }, 404);
              const valor = String(p.valor || '');
              if (!['', 'fixo', 'variavel', 'pontual'].includes(valor)) return sendJson(res, { error: 'natureza inválida: ' + valor }, 400);
              const lista = st.lista.map((x) => {
                if (x.id !== p.id) return x;
                const { natureza, ...resto } = x;
                return valor ? { ...resto, natureza: valor } : resto;
              });
              gravarMes(st, lista);
              const idx = reindex();
              return sendJson(res, { ok: true, acao, id: p.id, mes, ...idx });
            }

            // orçamento: { tetos: { categoria: valor }, metaReserva? } -> 04-NEGOCIO/financeiro/orcamento.md.
            // Caminho FIXO (nada vem do navegador). Teto vazio ou 0 sai do arquivo. Só o bloco é trocado.
            if (acao === 'orcamento') {
              const tetos = {};
              const entrada = p.tetos && typeof p.tetos === 'object' && !Array.isArray(p.tetos) ? p.tetos : null;
              if (!entrada) return sendJson(res, { error: 'tetos ausentes' }, 400);
              for (const [c, v] of Object.entries(entrada)) {
                const k = String(c).trim().toLowerCase();
                if (!/^[\p{L}\p{N} ._-]{1,40}$/u.test(k)) return sendJson(res, { error: 'categoria inválida: ' + k.slice(0, 40) }, 400);
                if (v === '' || v == null) continue;
                const valor = valorBR(v);
                if (!Number.isFinite(valor) || valor < 0) return sendJson(res, { error: `teto inválido em ${k}` }, 400);
                if (valor > 0) tetos[k] = valor;
              }
              let meta;
              if (p.metaReserva !== undefined && p.metaReserva !== '' && p.metaReserva !== null) {
                meta = valorBR(p.metaReserva);
                if (!Number.isFinite(meta) || meta <= 0) return sendJson(res, { error: 'meta da reserva inválida' }, 400);
              }
              const rel = '04-NEGOCIO/financeiro/orcamento.md';
              const full = dentroDoVault(VAULT, rel);
              const json = JSON.stringify({ tetos, ...(meta ? { metaReserva: meta } : {}) }, null, 2);
              const BLOCO_ORC = /```financeiro-orcamento\s*\n[\s\S]*?```/;
              let texto;
              if (existsSync(full)) {
                const atual = readFileSync(full, 'utf8');
                const eol = atual.includes('\r\n') ? '\r\n' : '\n';
                const bloco = ('```financeiro-orcamento\n' + json + '\n```').replace(/\n/g, eol);
                texto = BLOCO_ORC.test(atual) ? atual.replace(BLOCO_ORC, () => bloco) : atual.replace(/\s*$/, eol + eol + bloco + eol);
              } else {
                texto = `---\ntipo: financeiro\narea: negocio\ntags:\n  - financeiro\n  - orcamento\ncriado: '${hoje}'\n---\n\n# Orçamento · teto mensal por categoria\n\n> Definido pelo Pedro na Métis (aba Plano). O app compara o gasto de cada mês com o teto; a\n> categoria sem teto aparece como "sem teto definido".\n\n\`\`\`financeiro-orcamento\n${json}\n\`\`\`\n`;
              }
              writeFileSync(full, texto, 'utf8');
              const idx = reindex();
              return sendJson(res, { ok: true, acao, rel, ...idx });
            }

            return sendJson(res, { error: 'ação desconhecida: ' + acao }, 400);
            } catch (e) {
              if (e && e.code) return sendJson(res, { error: e.message }, e.code);
              throw e;
            }
          }

          return next();
        } catch (e) {
          return sendJson(res, { error: String((e && e.message) || e) }, 500);
        }
      });
    },
  };
}
