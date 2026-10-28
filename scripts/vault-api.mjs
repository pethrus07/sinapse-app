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
            const full = join(VAULT, rel);
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
            const full = join(VAULT, p.rel || '');
            if (!p.rel || !existsSync(full)) return sendJson(res, { error: 'nota não encontrada' }, 404);
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

            const mesDe = (venc) => (venc && /^\d{4}-\d{2}/.test(venc) ? venc.slice(0, 7) : new Date().toISOString().slice(0, 7));
            const relDoMes = (mes) => `04-NEGOCIO/financeiro/${mes}.md`;
            const BLOCO = /```financeiro\s*\n([\s\S]*?)```/;

            function lerMes(mes) {
              const full = join(VAULT, relDoMes(mes));
              if (!existsSync(full)) return { full, mes, data: null, corpo: null, lista: [] };
              const cur = matter(readFileSync(full, 'utf8'));
              const m = cur.content.match(BLOCO);
              let lista = [];
              if (m) {
                try { lista = JSON.parse(m[1]).lancamentos || []; } catch { lista = []; }
              }
              return { full, mes, data: cur.data || {}, corpo: cur.content, lista };
            }

            function gravarMes(st, lista) {
              const json = JSON.stringify({ lancamentos: lista }, null, 2);
              let corpo;
              if (st.corpo && BLOCO.test(st.corpo)) {
                corpo = st.corpo.replace(BLOCO, '```financeiro\n' + json + '\n```');
              } else if (st.corpo) {
                corpo = st.corpo.trimEnd() + '\n\n```financeiro\n' + json + '\n```\n';
              } else {
                const [ano, m2] = st.mes.split('-');
                const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
                corpo = `\n# 💰 Financeiro · ${nomes[Number(m2) - 1]} de ${ano}\n\n> Um arquivo por mês. O bloco abaixo é a fonte; o app lê, soma e joga os vencimentos abertos no [[AGENDA|calendário]].\n\n\`\`\`financeiro\n${json}\n\`\`\`\n\n## Conexões\n- Calendário: [[AGENDA]] · foco: [[AGORA]]\n- Negócio: [[MOC-negocio]]\n`;
              }
              const meta = st.data && Object.keys(st.data).length ? st.data : {
                tipo: 'financeiro', area: 'negocio', tags: ['financeiro', 'caixa', st.mes], mes: st.mes,
                criado: new Date().toISOString().slice(0, 10),
              };
              mkdirSync(dirname(st.full), { recursive: true });
              writeFileSync(st.full, matter.stringify(corpo, clean(meta)));
            }

            if (acao === 'lancar') {
              const l = p.lancamento || {};
              const valor = Number(String(l.valor).toString().replace(',', '.'));
              if (!l.descricao || !Number.isFinite(valor) || valor <= 0)
                return sendJson(res, { error: 'descrição e valor (> 0) são obrigatórios' }, 400);
              const venc = (l.vencimento || '').slice(0, 10);
              // sem dia, o mes pode ser dito explicitamente: cartao de outubro vive no
              // arquivo de outubro, senao a projecao joga tudo no mes corrente
              const mes = venc ? mesDe(venc) : (/^\d{4}-\d{2}$/.test(l.mes || '') ? l.mes : mesDe(''));
              const st = lerMes(mes);
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
              if (!st.corpo) return sendJson(res, { error: 'mês não encontrado: ' + mes }, 404);
              const achou = st.lista.some((x) => x.id === p.id);
              if (!achou) return sendJson(res, { error: 'lançamento não encontrado: ' + p.id }, 404);

              let lista;
              if (acao === 'remover') {
                lista = st.lista.filter((x) => x.id !== p.id);
              } else {
                lista = st.lista.map((x) => {
                  if (x.id !== p.id) return x;
                  if (acao === 'reabrir')
                    return { ...x, status: x.tipo === 'saida' ? 'a-pagar' : 'a-receber', liquidadoEm: '' };
                  return {
                    ...x,
                    status: x.tipo === 'saida' ? 'pago' : 'recebido',
                    liquidadoEm: (p.em || new Date().toISOString().slice(0, 10)).slice(0, 10),
                  };
                });
              }
              gravarMes(st, lista);
              const idx = reindex();
              return sendJson(res, { ok: true, acao, id: p.id, mes, ...idx });
            }

            return sendJson(res, { error: 'ação desconhecida: ' + acao }, 400);
          }

          return next();
        } catch (e) {
          return sendJson(res, { error: String((e && e.message) || e) }, 500);
        }
      });
    },
  };
}
