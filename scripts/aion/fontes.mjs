// Aion · fontes de dado de mercado. Só fontes que os termos permitem (ver docs/aion-formato.md):
//   Banco Central SGS (Selic, CDI, IPCA, dólar) e Olinda/Focus, sem chave;
//   Copom: comunicados do site do BC (api/servico/sitebcb/copom), sem chave;
//   brapi.dev (cotação de ação e FII; sem token só 4 ações de teste, com token grátis 15 mil req/mês);
//   CoinGecko (cripto; endpoint público sem chave, ou Demo com chave; exige citar "Data provided by CoinGecko");
//   CVM dados abertos (fatos relevantes, IPE; ticker → CNPJ pelo FCA), saem com atraso: histórico, não alerta.
// PROIBIDO aqui: raspar o site da B3, Yahoo Finance/yfinance, Status Invest, Fundamentus.
//
// Tudo recebe `pegar(url, opcoes)` (um fetch) por parâmetro: o teste passa um falso e nada sai
// para a rede. Cada função devolve dado já limpo, com `fonte`, `url` e `em` (data do dado), nunca a
// resposta crua. Chave/token só entram no cabeçalho ou na query da chamada e nunca são gravados.
import { inflateRawSync } from 'node:zlib';

// O SGS limita "ultimos/N" a 20 valores: a janela vai por data (dataInicial/dataFinal, dd/mm/aaaa).
const br = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
export const URL_SGS = (codigo, dias, hoje = new Date()) => `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${br(new Date(hoje.getTime() - dias * 86400000))}&dataFinal=${br(hoje)}`;
export const URL_OLINDA = 'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata';
export const URL_COPOM = 'https://www.bcb.gov.br/api/servico/sitebcb/copom';
export const URL_BRAPI = 'https://brapi.dev/api/quote';
export const URL_CG_PUBLICO = 'https://api.coingecko.com/api/v3';
export const URL_CVM = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC';
/** Ações que a brapi responde sem token (documentação da brapi, conferido em 04/11/2026). */
export const BRAPI_SEM_TOKEN = ['PETR4', 'MGLU3', 'VALE3', 'ITUB4'];

/* SGS: os códigos que o Aion usa (conferidos em 04/11/2026 contra a API do BC). */
export const SERIES = {
  selicMeta: { codigo: 432, nome: 'Selic meta (% a.a.)', dias: 800 },
  cdiAnual: { codigo: 4389, nome: 'CDI anualizado base 252 (% a.a.)', dias: 15 },
  cdiMensal: { codigo: 4391, nome: 'CDI acumulado no mês (%)', dias: 2200 },
  ipcaMensal: { codigo: 433, nome: 'IPCA mensal (%)', dias: 2200 },
  dolar: { codigo: 1, nome: 'Dólar comercial venda (R$)', dias: 45 },
};

/* ------------------------------------------------------------ utilidades */

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
/** "13/10/2026" → "2026-10-13". */
export const dataBR = (s) => { const [d, m, a] = String(s || '').split('/'); return a && m && d ? `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : ''; };
const num = (v) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : null; };

/**
 * Limite de requisição: espaço mínimo entre chamadas ao mesmo host e um teto por rodada. A brapi
 * grátis dá 15 mil/mês; a CoinGecko pública ~5–15/min. `uso` é o contador do mês (persistido pelo
 * coletor em uso.json), para o teto mensal valer entre rodadas.
 */
export function limitador({ intervaloMs = 400, intervaloPorHost = {}, tetoPorHost = {}, uso = {}, mes = '' } = {}) {
  const ultimo = new Map();
  const naRodada = new Map();
  return {
    uso,
    async antes(url) {
      const host = new URL(url).host;
      const teto = tetoPorHost[host];
      const chaveMes = `${mes}|${host}`;
      if (teto && (uso[chaveMes] || 0) >= teto.mes) throw Object.assign(new Error(`limite do mês atingido em ${host} (${teto.mes})`), { limite: true });
      if (teto && (naRodada.get(host) || 0) >= teto.rodada) throw Object.assign(new Error(`limite da rodada atingido em ${host} (${teto.rodada})`), { limite: true });
      const espera = (ultimo.get(host) || 0) + (intervaloPorHost[host] ?? intervaloMs) - Date.now();
      if (espera > 0) await pausa(espera);
      ultimo.set(host, Date.now());
      naRodada.set(host, (naRodada.get(host) || 0) + 1);
      uso[chaveMes] = (uso[chaveMes] || 0) + 1;
    },
  };
}

async function json(pegar, lim, url, opcoes = {}) {
  if (lim) await lim.antes(url);
  const r = await pegar(url, { headers: { accept: 'application/json', 'user-agent': 'sinapse-aion/1 (uso pessoal)', ...(opcoes.headers || {}) } });
  const texto = await r.text();
  let j;
  try { j = JSON.parse(texto); } catch { throw new Error(`resposta não é JSON (${r.status}) em ${semSegredo(url)}`); }
  if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) ? String(j.message || j.error).slice(0, 200) : `HTTP ${r.status}`), { status: r.status, corpo: j });
  return j;
}
async function binario(pegar, lim, url) {
  if (lim) await lim.antes(url);
  const r = await pegar(url, { headers: { 'user-agent': 'sinapse-aion/1 (uso pessoal)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
/** URL sem token (para log e mensagem de erro). */
export const semSegredo = (url) => String(url).replace(/([?&](token|x_cg_demo_api_key)=)[^&]+/gi, '$1***');

/* ------------------------------------------------------------ Banco Central */

/** Série do SGS: [{ data: 'AAAA-MM-DD', valor }] do mais velho para o mais novo. */
export function lerSerieSgs(lista) {
  // a série 4389 chegou em ordem decrescente em 04/11/2026: ordena sempre
  return (Array.isArray(lista) ? lista : []).map((x) => ({ data: dataBR(x.data), valor: num(x.valor) })).filter((x) => x.data && x.valor !== null).sort((a, b) => a.data.localeCompare(b.data));
}

export async function buscarSgs(pegar, lim, chave) {
  const s = SERIES[chave];
  const url = URL_SGS(s.codigo, s.dias);
  return { fonte: `Banco Central, SGS ${s.codigo}`, nome: s.nome, url: `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${s.codigo}/dados/ultimos/1?formato=json`, pontos: lerSerieSgs(await json(pegar, lim, url)) };
}

/**
 * Decisões da Selic a partir da série 432 (meta): cada troca de valor é uma decisão do Copom, que
 * vale a partir do dia seguinte à reunião. Devolve as trocas, a mais nova por último.
 */
export function decisoesDaSelic(pontos) {
  const out = [];
  for (let i = 1; i < pontos.length; i++) if (pontos[i].valor !== pontos[i - 1].valor) out.push({ desde: pontos[i].data, de: pontos[i - 1].valor, para: pontos[i].valor });
  return out;
}

/** IPCA acumulado em 12 meses a partir dos 12 últimos meses da série 433. null sem 12 meses. */
export function ipca12m(pontos) {
  if (pontos.length < 12) return null;
  const ult = pontos.slice(-12);
  return Math.round((ult.reduce((f, p) => f * (1 + p.valor / 100), 1) - 1) * 10000) / 100;
}

const INDICADORES_FOCUS = ['IPCA', 'Selic', 'PIB Total', 'Câmbio'];

/** Mediana do Focus por indicador e ano, da data mais recente publicada (base de cálculo 0 = todos os respondentes). */
export function lerFocusAnual(valores, anos) {
  const out = {};
  const datas = (valores || []).map((v) => v.Data).filter(Boolean).sort();
  const data = datas[datas.length - 1] || '';
  for (const v of valores || []) {
    if (v.Data !== data || Number(v.baseCalculo || 0) !== 0) continue;
    if (!anos.includes(String(v.DataReferencia))) continue;
    out[v.Indicador] = out[v.Indicador] || {};
    out[v.Indicador][String(v.DataReferencia)] = num(v.Mediana);
  }
  return { data, medianas: out };
}

export async function buscarFocus(pegar, lim, hojeAno) {
  const anos = [0, 1, 2, 3, 4, 5].map((k) => String(hojeAno + k));
  const filtro = `(${INDICADORES_FOCUS.map((i) => `Indicador eq '${i}'`).join(' or ')}) and baseCalculo eq 0`;
  const url = `${URL_OLINDA}/ExpectativasMercadoAnuais?$top=400&$orderby=Data%20desc&$format=json&$select=Indicador,Data,DataReferencia,Mediana,baseCalculo&$filter=${encodeURIComponent(filtro)}`;
  const j = await json(pegar, lim, url);
  const { data, medianas } = lerFocusAnual(j.value, anos);
  // Selic por reunião: a próxima reunião ainda não decidida é a primeira da lista da última data
  const urlR = `${URL_OLINDA}/ExpectativasMercadoSelic?$top=40&$orderby=Data%20desc&$format=json&$select=Data,Reuniao,Mediana,baseCalculo&$filter=${encodeURIComponent('baseCalculo eq 0')}`;
  const jr = await json(pegar, lim, urlR);
  const doDia = (jr.value || []).filter((v) => v.Data === (jr.value?.[0]?.Data));
  const reunioes = doDia.map((v) => ({ reuniao: String(v.Reuniao), mediana: num(v.Mediana) }))
    .sort((a, b) => ordemReuniao(a.reuniao) - ordemReuniao(b.reuniao));
  return { fonte: 'Banco Central, Relatório Focus (API Olinda)', url: 'https://www.bcb.gov.br/publicacoes/focus', data, medianas, selicPorReuniao: reunioes.slice(0, 4) };
}
/** "R7/2026" → 2026*10+7, para ordenar. */
export const ordemReuniao = (r) => { const m = /^R(\d+)\/(\d{4})$/.exec(String(r)); return m ? Number(m[2]) * 10 + Number(m[1]) : 0; };

/** Primeiro parágrafo do comunicado (o "porquê" que o próprio Copom escreve), sem HTML. */
export function paragrafoDoComunicado(html, max = 600) {
  const ps = String(html || '').split(/<\/p>/i).map((p) => p.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[​\s]+/g, ' ').trim()).filter((p) => p.length > 40);
  const t = ps[0] || '';
  return t.length > max ? t.slice(0, max).replace(/\s\S*$/, '') + '…' : t;
}

export async function buscarCopom(pegar, lim, n = 8) {
  const lista = await json(pegar, lim, `${URL_COPOM}/comunicados?quantidade=${n}`);
  const decisoes = (lista.conteudo || []).map((c) => ({ numero: Number(c.nro_reuniao), data: String(c.dataReferencia || '').slice(0, 10), titulo: String(c.titulo || '').replace(/^\d+ª reunião - /i, '').replace(/\s+/g, ' ').trim() }))
    .filter((c) => c.numero && c.data);
  // o texto só das duas últimas (o porquê do Copom; as outras ficam com o título)
  for (const d of decisoes.slice(0, 2)) {
    try {
      const det = await json(pegar, lim, `${URL_COPOM}/comunicados_detalhes?nro_reuniao=${d.numero}`);
      d.trecho = paragrafoDoComunicado(det.conteudo?.[0]?.textoComunicado);
    } catch { /* sem o texto: fica o título */ }
  }
  return { fonte: 'Banco Central, comunicados do Copom', url: 'https://www.bcb.gov.br/publicacoes/comunicadoscopom', decisoes };
}

/**
 * Calendário das reuniões do Copom. O BC não tem API do calendário (procurado em 04/11/2026); as
 * datas abaixo são as que o BC publicou em 24/06/2025 para 2026, conferidas em 04/11/2026 em
 * fontes que reproduzem o calendário. A tela mostra a origem e pede para conferir no site do BC.
 * Ano sem calendário aqui: a tela diz "data não cadastrada".
 */
export const CALENDARIO_COPOM = {
  fonte: 'calendário do Copom publicado pelo BC em 24/06/2025 (conferido em 04/11/2026)',
  url: 'https://www.bcb.gov.br/publicacoes/calendarioreunioescopom',
  reunioes: [
    { numero: 282, dias: '3 e 4 de novembro de 2026', decisao: '2026-11-04' },
    { numero: 283, dias: '8 e 9 de dezembro de 2026', decisao: '2026-12-09' },
  ],
};

/** A próxima reunião depois da última decisão publicada (número + data do calendário, se houver). */
export function proximaReuniao(decisoes, hoje, calendario = CALENDARIO_COPOM) {
  const ultima = Math.max(0, ...decisoes.map((d) => d.numero));
  const numero = ultima ? ultima + 1 : 0;
  const cal = calendario.reunioes.find((r) => r.numero === numero) || calendario.reunioes.find((r) => r.decisao >= hoje);
  return { numero: cal?.numero || numero, dias: cal?.dias || '', decisao: cal?.decisao || '', fonteData: cal ? calendario.fonte : '' };
}

/* ------------------------------------------------------------ brapi (cotação) */

/** Uma cotação da brapi → o que o Aion guarda (nada de logo, nada que dependa de rede no app). */
export function lerCotacaoBrapi(r, agora) {
  const hist = (r.historicalDataPrice || []).map((h) => ({ data: new Date(Number(h.date) * 1000).toISOString().slice(0, 10), fechamento: num(h.close) })).filter((h) => h.fechamento !== null);
  const div = (r.dividendsData?.cashDividends || []).map((d) => ({
    tipo: String(d.label || d.relatedTo || 'provento').slice(0, 40),
    valor: num(d.rate), pagamento: String(d.paymentDate || '').slice(0, 10), aprovado: String(d.approvedOn || '').slice(0, 10),
    dataCom: String(d.lastDatePrior || '').slice(0, 10), dataEx: String(d.exDate || '').slice(0, 10),
  })).filter((d) => d.valor !== null).sort((a, b) => (b.dataCom || b.pagamento).localeCompare(a.dataCom || a.pagamento)).slice(0, 12);
  return {
    codigo: String(r.symbol || '').toUpperCase(), nome: String(r.longName || r.shortName || ''),
    preco: num(r.regularMarketPrice), variacaoDia: num(r.regularMarketChangePercent), fechamentoAnterior: num(r.regularMarketPreviousClose),
    em: String(r.regularMarketTime || agora).slice(0, 19), min52: num(r.fiftyTwoWeekLow), max52: num(r.fiftyTwoWeekHigh),
    pl: num(r.priceEarnings), lpa: num(r.earningsPerShare), historico: hist.slice(-70), proventos: div,
  };
}

/**
 * Cotações de uma lista de códigos. Sem token, só os 4 de teste vão (os outros voltam em
 * `semToken`). Uma chamada por código (o plano grátis não aceita vários de uma vez).
 */
export async function buscarCotacoes(pegar, lim, codigos, token, agora) {
  const cotacoes = [];
  const semToken = [];
  const erros = [];
  for (const c of [...new Set(codigos.map((x) => x.toUpperCase()))]) {
    if (!token && !BRAPI_SEM_TOKEN.includes(c)) { semToken.push(c); continue; }
    const url = `${URL_BRAPI}/${encodeURIComponent(c)}?range=3mo&interval=1d&dividends=true${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    try {
      const j = await json(pegar, lim, url);
      if (j.results?.[0]) cotacoes.push(lerCotacaoBrapi(j.results[0], agora));
    } catch (e) {
      if (e.limite) { erros.push({ codigo: c, erro: e.message }); break; }
      erros.push({ codigo: c, erro: semSegredo(e.message) });
    }
  }
  return { fonte: 'brapi.dev', url: 'https://brapi.dev', cotacoes, semToken, erros };
}

/* ------------------------------------------------------------ CoinGecko (cripto) */

/** Ids da CoinGecko para os símbolos mais comuns; outro símbolo entra pelo id direto (ex.: "solana"). */
export const ID_COINGECKO = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', USDT: 'tether', USDC: 'usd-coin', BNB: 'binancecoin', XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin' };
export const idCripto = (s) => ID_COINGECKO[String(s).toUpperCase()] || String(s).toLowerCase();

export async function buscarCripto(pegar, lim, simbolos, chave, agora) {
  const ids = [...new Set(simbolos.map(idCripto))].filter((x) => /^[a-z0-9-]{2,60}$/.test(x));
  if (!ids.length) return { fonte: 'CoinGecko', citar: 'Data provided by CoinGecko', url: 'https://www.coingecko.com', cotacoes: [] };
  const extra = chave ? `&x_cg_demo_api_key=${encodeURIComponent(chave)}` : '';
  const url = `${URL_CG_PUBLICO}/simple/price?ids=${ids.join(',')}&vs_currencies=brl&include_24hr_change=true&include_last_updated_at=true${extra}`;
  const j = await json(pegar, lim, url);
  const simboloDe = (id) => Object.entries(ID_COINGECKO).find(([, v]) => v === id)?.[0] || id.toUpperCase();
  const cotacoes = ids.filter((id) => j[id]).map((id) => ({
    codigo: simboloDe(id), id, preco: num(j[id].brl), variacaoDia: num(j[id].brl_24h_change),
    em: j[id].last_updated_at ? new Date(j[id].last_updated_at * 1000).toISOString().slice(0, 19) : String(agora).slice(0, 19),
  }));
  return { fonte: 'CoinGecko', citar: 'Data provided by CoinGecko', url: 'https://www.coingecko.com', cotacoes };
}

/* ------------------------------------------------------------ CVM (fatos relevantes) */

/** Lê um arquivo de dentro de um .zip (método 0 ou 8) pelo diretório central. Sem dependência. */
export function lerDoZip(buf, nomeQueTermina) {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('zip sem diretório central');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip corrompido');
    const metodo = buf.readUInt16LE(p + 10);
    const tam = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + nl).toString('latin1');
    if (nome.endsWith(nomeQueTermina)) {
      const lnl = buf.readUInt16LE(local + 26), lel = buf.readUInt16LE(local + 28);
      const ini = local + 30 + lnl + lel;
      const dado = buf.slice(ini, ini + tam);
      return metodo === 0 ? dado : inflateRawSync(dado);
    }
    p += 46 + nl + el + cl;
  }
  return null;
}

/** CSV da CVM (`;`, latin1, sem aspas na prática) → objetos. */
export function lerCsvCvm(buf) {
  const linhas = buf.toString('latin1').split(/\r?\n/).filter(Boolean);
  const cab = (linhas.shift() || '').split(';');
  return linhas.map((l) => { const c = l.split(';'); return Object.fromEntries(cab.map((h, i) => [h, c[i] ?? ''])); });
}

/** Ticker → CNPJ da companhia, pelo formulário cadastral (FCA, valor mobiliário). */
export function cnpjPorTicker(linhasFca, tickers) {
  const quero = new Set(tickers.map((t) => t.toUpperCase()));
  const out = {};
  for (const l of linhasFca) {
    const t = String(l.Codigo_Negociacao || '').toUpperCase().trim();
    if (quero.has(t) && !out[t]) out[t] = { cnpj: l.CNPJ_Companhia, nome: l.Nome_Empresarial };
  }
  return out;
}

/** Fatos relevantes dos últimos `dias` das companhias pedidas (por CNPJ), do mais novo para o mais velho. */
export function fatosRelevantes(linhasIpe, mapa, hoje, dias = 120) {
  const porCnpj = new Map(Object.entries(mapa).map(([t, v]) => [v.cnpj, t]));
  const desde = new Date(Date.parse(hoje + 'T12:00:00Z') - dias * 86400000).toISOString().slice(0, 10);
  return linhasIpe
    .filter((l) => l.Categoria === 'Fato Relevante' && porCnpj.has(l.CNPJ_Companhia) && String(l.Data_Entrega) >= desde)
    .map((l) => ({ codigo: porCnpj.get(l.CNPJ_Companhia), data: String(l.Data_Entrega).slice(0, 10), assunto: String(l.Assunto || '').slice(0, 200), url: String(l.Link_Download || '') }))
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, 40);
}

export async function buscarCvm(pegar, lim, tickers, hoje) {
  const ano = hoje.slice(0, 4);
  const fca = lerDoZip(await binario(pegar, lim, `${URL_CVM}/FCA/DADOS/fca_cia_aberta_${ano}.zip`), `valor_mobiliario_${ano}.csv`);
  const mapa = fca ? cnpjPorTicker(lerCsvCvm(fca), tickers) : {};
  const ipe = Object.keys(mapa).length ? lerDoZip(await binario(pegar, lim, `${URL_CVM}/IPE/DADOS/ipe_cia_aberta_${ano}.zip`), `ipe_cia_aberta_${ano}.csv`) : null;
  return {
    fonte: 'CVM, dados abertos (IPE: fatos relevantes; FCA: código de negociação)', url: 'https://dados.cvm.gov.br/dataset/cia_aberta-doc-ipe',
    nota: 'A CVM atualiza os dados abertos uma vez por semana: serve para histórico, não para alerta na hora.',
    empresas: mapa, fatos: ipe ? fatosRelevantes(lerCsvCvm(ipe), mapa, hoje) : [],
    semEmpresa: tickers.filter((t) => !mapa[t.toUpperCase()]),
  };
}
