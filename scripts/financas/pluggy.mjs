// Cliente da API da Pluggy (Meu Pluggy, uso pessoal) e os normalizadores que transformam a
// resposta no formato do núcleo. Só LEITURA: nenhum endpoint de escrita ou de pagamento é chamado.
// Docs: https://docs.pluggy.ai/en/docs/guides/meu-pluggy-personal-use
//   POST /auth {clientId, clientSecret} → { apiKey }   (header X-API-KEY nas outras)
//   GET /items/{id}                     → status, consentExpiresAt, lastUpdatedAt
//   GET /accounts?itemId=               → contas (BANK) e cartões (CREDIT), paginado por page
//   GET /v2/transactions?accountId=&dateFrom=&dateTo=&after=  → cursor em `next`
//   GET /bills?accountId=               → faturas do cartão (dueDate, billClosingDate, totalAmount)
//   GET /investments?itemId=            → investimentos (balance, institution, type, subtype)
// GET /v2/items NÃO funciona para Meu Pluggy: o itemId vem do Dashboard, à mão.
// Erro de rede/HTTP nunca imprime o corpo da resposta (pode ter dado do banco): só o status.

export const BASE = 'https://api.pluggy.ai';

export function criarCliente(cred, { fetch: f = globalThis.fetch, base = BASE } = {}) {
  let apiKey = '';
  let obtidaEm = 0;
  async function autenticar() {
    const r = await f(`${base}/auth`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: cred.clientId, clientSecret: cred.clientSecret }),
    });
    if (!r.ok) throw new Error(`autenticação recusada pela Pluggy (HTTP ${r.status}): confira clientId/clientSecret`);
    const j = await r.json();
    if (!j.apiKey) throw new Error('a Pluggy respondeu sem apiKey');
    apiKey = j.apiKey;
    obtidaEm = Date.now();
  }
  async function get(caminho, params = {}) {
    if (!apiKey || Date.now() - obtidaEm > 90 * 60 * 1000) await autenticar(); // a chave dura ~2 h
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString();
    const url = `${base}${caminho}${qs ? '?' + qs : ''}`;
    for (let tentativa = 0; ; tentativa++) {
      const r = await f(url, { headers: { 'X-API-KEY': apiKey, accept: 'application/json' } });
      if (r.status === 401 && tentativa === 0) { await autenticar(); continue; }
      if ((r.status === 429 || r.status >= 500) && tentativa < 3) { await new Promise((ok) => setTimeout(ok, 800 * (tentativa + 1))); continue; }
      if (!r.ok) { const e = new Error(`GET ${caminho} falhou (HTTP ${r.status})`); e.status = r.status; throw e; }
      return r.json();
    }
  }
  async function paginado(caminho, params) {
    const out = [];
    for (let page = 1; page < 200; page++) {
      const j = await get(caminho, { ...params, page, pageSize: 500 });
      out.push(...(j.results || []));
      if (!j.totalPages || page >= j.totalPages) break;
    }
    return out;
  }
  return {
    autenticar,
    item: (id) => get(`/items/${encodeURIComponent(id)}`),
    contas: (itemId) => paginado('/accounts', { itemId }),
    faturas: (accountId) => paginado('/bills', { accountId }),
    investimentos: (itemId) => paginado('/investments', { itemId }),
    async transacoes(accountId, dateFrom, dateTo) {
      const out = [];
      let after;
      try {
        for (let i = 0; i < 500; i++) {
          const j = await get('/v2/transactions', { accountId, dateFrom, dateTo, after });
          out.push(...(j.results || []));
          if (!j.next) break;
          after = new URLSearchParams(String(j.next).replace(/^\?/, '')).get('after') || undefined;
          if (!after) break;
        }
        return out;
      } catch (e) {
        if (e.status !== 404) throw e;
        // conta antiga sem a v2: cai no /transactions paginado (descontinuado em 31/12/2026)
        return paginado('/transactions', { accountId, from: dateFrom, to: dateTo });
      }
    },
  };
}

/* ------------------------------------------------------------------ normalização */

const digitos = (s) => String(s || '').replace(/\D/g, '');

/** Banco da conta por nome conhecido. Texto livre da conta nunca vira rótulo. */
export function bancoDe(conta, regras = {}) {
  const texto = `${conta.marketingName || ''} ${conta.name || ''}`.toLowerCase();
  for (const r of regras.contas || []) {
    if (r.tipo && r.tipo !== conta.type) continue; // BANK ou CREDIT
    if (r.padrao && texto.includes(String(r.padrao).toLowerCase())) return { rotulo: r.rotulo };
  }
  const banco = /\bnu\b|nubank|nu pagamentos/.test(texto) ? 'Nubank' : /inter\b|banco inter/.test(texto) ? 'Inter' : 'Banco';
  return { rotulo: `${banco} · ${conta.type === 'CREDIT' ? 'cartão' : 'conta'}` };
}

/** Últimos 4 dígitos, só para o --testar mostrar qual conta é. */
export const final4 = (conta) => {
  const d = digitos(conta.number);
  return d ? d.slice(-4) : '????';
};

function meioDe(tx) {
  const op = String(tx.operationType || tx.paymentData?.paymentMethod || '').toUpperCase();
  if (op.includes('PIX')) return 'pix';
  if (op.includes('TED') || op.includes('DOC') || op.includes('TRANSF')) return 'ted';
  if (op.includes('BOLETO')) return 'boleto';
  if (op === 'CARTAO' || /compra no d[eé]bito/i.test(tx.description || '')) return 'debito'; // cartão de débito na conta
  if (/\bpix\b/i.test(tx.description || '')) return 'pix';
  return 'outro';
}

export function normalizarTransacao(tx, conta, regras = {}) {
  const pd = tx.paymentData || {};
  const m = tx.merchant || {};
  const valor = Math.abs(Number(tx.amountInAccountCurrency ?? tx.amount) || 0);
  const cc = tx.creditCardMetadata || {};
  return {
    fonte: 'pluggy',
    idFonte: tx.id,
    data: String(tx.date || '').slice(0, 10),
    valor,
    direcao: tx.type === 'CREDIT' ? 'entrada' : 'saida',
    // só em memória, para as regras: nunca é gravado nem impresso
    texto: [tx.description, tx.descriptionRaw, pd.payer?.name, pd.receiver?.name, m.name, m.businessName, pd.reason].filter(Boolean).join(' '),
    documentos: [pd.payer?.documentNumber?.value, pd.receiver?.documentNumber?.value, m.cnpj].map(digitos).filter(Boolean),
    meio: meioDe(tx),
    conta: bancoDe(conta, regras).rotulo,
    viaCartao: conta.type === 'CREDIT',
    fatura: String(cc.billForecastDate || cc.billPostDate || '').slice(0, 7),
    categoriaFonte: tx.category || '',
    pendente: tx.status === 'PENDING',
  };
}

export function normalizarFatura(b, conta, regras = {}) {
  return {
    fonte: 'pluggy', idFonte: b.id,
    vencimento: String(b.dueDate || '').slice(0, 10),
    fechamento: String(b.billClosingDate || '').slice(0, 10),
    valor: Number(b.totalAmount) || 0,
    conta: bancoDe(conta, regras).rotulo,
  };
}

export function normalizarInvestimento(i, hoje) {
  return {
    fonte: 'pluggy', idFonte: i.id,
    nome: i.name || i.subtype || i.type || 'Investimento',
    instituicao: i.institution?.name || '',
    tipoFonte: [i.type, i.subtype].filter(Boolean).join(' '),
    saldo: Number(i.balance ?? i.amount ?? i.value) || 0,
    vencimentoTitulo: String(i.dueDate || '').slice(0, 10),
    data: hoje,
    ativo: !i.status || i.status === 'ACTIVE',
  };
}

/** fetch falso que responde de uma pasta de JSONs no formato da API (testes e --fixture). */
export function fetchDeFixture(lerJson) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const p = u.searchParams;
    const resp = (corpo, status = 200) => ({ ok: status < 400, status, json: async () => corpo });
    if (u.pathname === '/auth') {
      const b = JSON.parse(init.body || '{}');
      return b.clientId && b.clientSecret ? resp({ apiKey: 'chave-falsa' }) : resp({}, 401);
    }
    if (!init.headers || init.headers['X-API-KEY'] !== 'chave-falsa') return resp({}, 401);
    const m = u.pathname.match(/^\/items\/(.+)$/);
    if (m) return resp(lerJson(`item-${m[1]}.json`) ?? {}, lerJson(`item-${m[1]}.json`) ? 200 : 404);
    const pagina = (arq) => {
      const j = lerJson(arq);
      if (!j) return resp({ results: [], page: 1, total: 0, totalPages: 0 });
      return resp(j);
    };
    if (u.pathname === '/accounts') return pagina(`accounts-${p.get('itemId')}.json`);
    if (u.pathname === '/bills') return pagina(`bills-${p.get('accountId')}.json`);
    if (u.pathname === '/investments') return pagina(`investments-${p.get('itemId')}.json`);
    if (u.pathname === '/v2/transactions') {
      const after = p.get('after') || '1';
      const j = lerJson(`transactions-${p.get('accountId')}-${after}.json`) || { results: [], next: null };
      const de = p.get('dateFrom'), ate = p.get('dateTo');
      return resp({ ...j, results: j.results.filter((t) => (!de || t.date.slice(0, 10) >= de) && (!ate || t.date.slice(0, 10) <= ate)) });
    }
    return resp({}, 404);
  };
}
