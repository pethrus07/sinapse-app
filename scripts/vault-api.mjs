// Plugin do Vite: adiciona endpoints de ESCRITA no vault ao dev server.
// POST /api/note      -> cria/edita uma nota (.md) e reindexa
// POST /api/progress  -> atualiza só o `progresso` de uma nota e reindexa
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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

function readBody(req) {
  return new Promise((res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => res(b));
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
  const reindex = () => buildIndex(VAULT, OUT);

  return {
    name: 'vault-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        try {
          const url = req.url.split('?')[0];

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

          return next();
        } catch (e) {
          return sendJson(res, { error: String((e && e.message) || e) }, 500);
        }
      });
    },
  };
}
