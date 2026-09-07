// Plugin do Vite: adiciona endpoints de ESCRITA no vault ao dev server.
// POST /api/note      -> cria/edita uma nota (.md) e reindexa
// POST /api/progress  -> atualiza só o `progresso` de uma nota e reindexa
import { readFileSync, writeFileSync, existsSync, mkdirSync, watch } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { buildIndex, slugify } from './build-index.mjs';

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

export function vaultApi() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const APP_ROOT = resolve(__dirname, '..');
  const VAULT = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(APP_ROOT, '..', 'sinapse');
  const OUT = resolve(APP_ROOT, 'src', 'data');
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
