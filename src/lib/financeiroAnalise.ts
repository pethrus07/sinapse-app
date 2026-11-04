// Análises do Financeiro além dos seis gráficos: gastos por categoria, recorrente × pontual,
// patrimônio, clientes (realizado × previsto) e avisos. Só lógica pura, testada em
// financeiroAnalise.test.ts. Usada pelo app e pelo sincronizador (retrato do patrimônio):
// por isso os imports levam a extensão .ts (o Node lê o arquivo direto).
// Nada é inventado: mês sem dado suficiente devolve o buraco ("sem média ainda") em vez de chutar.
import type { Lancamento } from '../types';
import { confiancaDe, diasEntre, ehCartao, mesPrevisto, mesRealizado, somarMes } from './financeiroGraficos.ts';

const n = (v: unknown) => Number(v) || 0;
const liquidado = (l: Lancamento) => l.status === 'recebido' || l.status === 'pago';
const aberto = (l: Lancamento) => l.status === 'a-receber' || l.status === 'a-pagar';
export const A_CLASSIFICAR = 'a classificar';
const SEM_CATEGORIA = 'sem categoria';

/* ------------------------------------------------------------- gasto do mês */

/**
 * O que foi GASTO: saída liquidada (no mês em que o dinheiro mexeu) e compra no cartão (no mês
 * da compra). O pagamento da fatura fica fora: contar a fatura e as compras dela dobraria.
 * Reserva e investimento não são gasto.
 */
export function ehGasto(l: Lancamento): boolean {
  if (l.tipo !== 'saida' || !liquidado(l)) return false;
  if (ehCartao(l) && !l.viaCartao) return false;
  return true;
}
export const ehPontual = (l: Lancamento) => naturezaDe(l) === 'pontual';
export const categoriaDe = (l: Lancamento) => (l.categoria || '').trim().toLowerCase() || SEM_CATEGORIA;

/* ------------------------------------------------------- natureza do gasto */

export type Natureza = 'fixo' | 'variavel' | 'pontual';
export const NATUREZAS: readonly Natureza[] = ['fixo', 'variavel', 'pontual'];
export const ROTULO_NATUREZA: Record<Natureza, string> = { fixo: 'Fixo', variavel: 'Variável', pontual: 'Pontual' };

/**
 * A natureza de cada categoria de gasto, num lugar só (testado em financeiroAnalise.test.ts).
 *  - fixo: vem todo mês, com valor parecido (moradia/contribuição, energia, água, internet,
 *    impostos/DAS, assinatura, parcela, educação);
 *  - variável: depende do mês (comida, mercado, transporte, pix a pessoa física, compras...);
 *  - pontual: não se repete (empréstimo, equipamento).
 * Categoria fora do mapa (ou "a classificar") é variável: o lado seguro é não chamar de fixo o
 * que não se sabe. O lançamento pode sobrescrever com `natureza` (ou `pontual: true`).
 */
export const NATUREZA_POR_CATEGORIA: Readonly<Record<string, Natureza>> = {
  moradia: 'fixo', casa: 'fixo', aluguel: 'fixo', condominio: 'fixo', energia: 'fixo', luz: 'fixo', agua: 'fixo',
  internet: 'fixo', telefone: 'fixo', celular: 'fixo', imposto: 'fixo', impostos: 'fixo', das: 'fixo',
  assinatura: 'fixo', parcela: 'fixo', educacao: 'fixo', seguro: 'fixo', infra: 'fixo', plano: 'fixo',
  alimentacao: 'variavel', 'comida fora': 'variavel', delivery: 'variavel', mercado: 'variavel', transporte: 'variavel',
  'pix a pessoa física': 'variavel', vestuario: 'variavel', lazer: 'variavel', compras: 'variavel', farmacia: 'variavel',
  saude: 'variavel', doacao: 'variavel', familia: 'variavel', outro: 'variavel', [A_CLASSIFICAR]: 'variavel', [SEM_CATEGORIA]: 'variavel',
  emprestimo: 'pontual', equipamento: 'pontual',
};

/**
 * Natureza de um gasto. Ordem: `natureza` do lançamento > `pontual: true` > `recorrente: true`
 * (saída marcada "repete todo mês" é fixo) > mapa da categoria > variável.
 */
export function naturezaDe(l: Lancamento): Natureza {
  if (l.natureza === 'fixo' || l.natureza === 'variavel' || l.natureza === 'pontual') return l.natureza;
  if (l.pontual) return 'pontual';
  if (l.tipo === 'saida' && l.recorrente) return 'fixo';
  return NATUREZA_POR_CATEGORIA[categoriaDe(l)] || 'variavel';
}

export const mediana = (vs: number[]) => {
  if (!vs.length) return 0;
  const s = [...vs].sort((a, b) => a - b);
  const k = Math.floor(s.length / 2);
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Fixo, variável e pontual de um mês (gasto = ehGasto, no mês em que o dinheiro mexeu). */
export function naturezaDoMes(ls: Lancamento[], mes: string): Record<Natureza, number> & { total: number } {
  const o = { fixo: 0, variavel: 0, pontual: 0, total: 0 };
  for (const l of ls) {
    if (!ehGasto(l) || mesRealizado(l) !== mes) continue;
    o[naturezaDe(l)] += n(l.valor);
    o.total += n(l.valor);
  }
  return { fixo: r2(o.fixo), variavel: r2(o.variavel), pontual: r2(o.pontual), total: r2(o.total) };
}

/** Meses completos (o banco cobria o mês inteiro), do mais recente para trás, até `max`. */
export function mesesCompletos(ls: Lancamento[], hojeMes: string, max = 6): string[] {
  const parciais = mesesParciais(ls, hojeMes);
  const temBanco = ls.some((l) => l.origem && l.liquidadoEm);
  const out: string[] = [];
  for (let m = somarMes(hojeMes, -1); out.length < max && m >= somarMes(hojeMes, -24); m = somarMes(m, -1)) {
    if (parciais.has(m)) continue;
    // sem banco nenhum, só vale mês com gasto lançado
    if (!temBanco && !ls.some((l) => ehGasto(l) && mesRealizado(l) === m)) continue;
    out.push(m);
  }
  return out;
}

export interface EstimativaGasto {
  fixo: number;
  variavel: number;
  total: number;                 // gasto que se repete: fixo + variável estimado
  base: 'mediana' | 'teto' | 'nenhum';
  meses: string[];               // meses completos usados (mais recente primeiro)
  fraca: boolean;                // menos de 3 meses completos na mediana
  tetoVariavel: number | null;   // soma dos tetos das categorias variáveis (null = sem teto)
}

/**
 * Gasto que se repete, de um jeito honesto:
 *  - fixo = mediana do fixo dos meses completos;
 *  - variável = mediana do variável dos meses completos, se houver 3 ou mais; com menos, o teto
 *    do orçamento das categorias variáveis (se o Pedro definiu); sem teto, a mediana do que houver,
 *    marcada como fraca. Pontual nunca entra.
 * A tela diz qual base usou e com quantos meses.
 */
export function gastoQueSeRepete(ls: Lancamento[], hojeMes: string, tetos?: Record<string, number> | null): EstimativaGasto {
  const meses = mesesCompletos(ls, hojeMes);
  const por = meses.map((m) => naturezaDoMes(ls, m));
  const fixo = r2(mediana(por.map((p) => p.fixo)));
  const varMed = r2(mediana(por.map((p) => p.variavel)));
  const variaveis = Object.entries(tetos || {}).filter(([c, v]) => v > 0 && (NATUREZA_POR_CATEGORIA[c] || 'variavel') === 'variavel');
  const tetoVariavel = variaveis.length ? r2(variaveis.reduce((s, [, v]) => s + v, 0)) : null;
  let base: EstimativaGasto['base'] = 'mediana';
  let variavel = varMed;
  if (!meses.length && tetoVariavel === null) base = 'nenhum';
  else if (meses.length < 3 && tetoVariavel !== null) { base = 'teto'; variavel = tetoVariavel; }
  return { fixo, variavel, total: r2(fixo + variavel), base, meses, fraca: base === 'mediana' && meses.length < 3, tetoVariavel };
}

/**
 * Meses em que o banco ainda não cobria o mês inteiro: o primeiro mês com lançamento do banco,
 * quando a primeira transação não é do dia 1 (a sincronização começou no meio). Média que usa
 * mês parcial mente para baixo, então ele fica fora da média (mas aparece no gráfico).
 */
export function mesesParciais(ls: Lancamento[], hojeMes: string): Set<string> {
  const datas = ls.filter((l) => l.origem && l.liquidadoEm).map((l) => l.liquidadoEm!.slice(0, 10)).sort();
  const s = new Set<string>([hojeMes]);
  if (datas.length && datas[0].slice(8, 10) !== '01') s.add(datas[0].slice(0, 7));
  // antes do banco, o gasto não estava no razão: esses meses também não servem de média
  if (datas.length) for (let m = somarMes(datas[0].slice(0, 7), -24); m < datas[0].slice(0, 7); m = somarMes(m, 1)) s.add(m);
  return s;
}

export interface LinhaCategoria {
  categoria: string;
  valores: number[];          // total por mês de `meses`
  recorrentes: number[];      // sem os pontuais
  media: number | null;       // média dos meses completos antes do foco (sem pontuais); null = sem base
  baseMedia: number;          // quantos meses entraram na média (até 3)
  atual: number;              // total no mês em foco
  atualRecorrente: number;
  desvio: 'acima' | 'abaixo' | 'nova' | '';
}
export interface GastosPorCategoria {
  meses: string[];
  foco: string;
  parciais: string[];
  linhas: LinhaCategoria[];   // do maior gasto no foco para o menor
  totais: number[];
}

/**
 * Gasto por categoria mês a mês, com a média dos últimos 3 meses completos antes do mês em
 * foco e o destaque do que fugiu dela: diferença de pelo menos R$ 50 e 30% da média.
 * Categoria que não existia nos meses da média e passou de R$ 100 é "nova".
 */
export function gastosPorCategoria(ls: Lancamento[], hojeMes: string, foco = hojeMes, nMeses = 4): GastosPorCategoria {
  const parciais = mesesParciais(ls, hojeMes);
  const fim = foco > hojeMes ? hojeMes : foco;
  const meses: string[] = [];
  // a janela termina no mês de hoje (o seletor mostra até ele); o foco pode ser qualquer mês dela
  for (let k = nMeses - 1; k >= 0; k--) meses.push(somarMes(hojeMes, -k));
  if (!meses.includes(fim)) meses.unshift(fim);
  const idx = new Map(meses.map((m, i) => [m, i]));
  const media3: string[] = [];
  for (let m = somarMes(fim, -1); media3.length < 3 && m >= somarMes(fim, -12); m = somarMes(m, -1)) if (!parciais.has(m)) media3.push(m);

  const por = new Map<string, { valores: number[]; recorrentes: number[]; base: Map<string, number> }>();
  for (const l of ls) {
    if (!ehGasto(l)) continue;
    const mes = mesRealizado(l);
    const c = categoriaDe(l);
    if (!por.has(c)) por.set(c, { valores: meses.map(() => 0), recorrentes: meses.map(() => 0), base: new Map() });
    const p = por.get(c)!;
    const i = idx.get(mes);
    if (i !== undefined) {
      p.valores[i] += n(l.valor);
      if (!ehPontual(l)) p.recorrentes[i] += n(l.valor);
    }
    if (media3.includes(mes) && !ehPontual(l)) p.base.set(mes, (p.base.get(mes) || 0) + n(l.valor));
  }
  const iFoco = meses.indexOf(fim);
  const linhas: LinhaCategoria[] = [];
  for (const [categoria, p] of por) {
    const media = media3.length ? media3.reduce((s, m) => s + (p.base.get(m) || 0), 0) / media3.length : null;
    const atual = p.valores[iFoco] || 0;
    const atualRecorrente = p.recorrentes[iFoco] || 0;
    if (!p.valores.some((v) => v > 0) && !media) continue;
    let desvio: LinhaCategoria['desvio'] = '';
    if (media !== null && media > 0) {
      const d = atualRecorrente - media;
      if (Math.abs(d) >= 50 && Math.abs(d) >= 0.3 * media) desvio = d > 0 ? 'acima' : 'abaixo';
    } else if (media !== null && atualRecorrente >= 100) desvio = 'nova';
    // mês em andamento: só "acima" vale (o "abaixo" é só o mês que ainda não acabou)
    if (fim === hojeMes && desvio === 'abaixo') desvio = '';
    linhas.push({ categoria, valores: p.valores, recorrentes: p.recorrentes, media, baseMedia: media3.length, atual, atualRecorrente, desvio });
  }
  linhas.sort((a, b) => b.atual - a.atual || (b.media || 0) - (a.media || 0) || a.categoria.localeCompare(b.categoria));
  const totais = meses.map((_, i) => linhas.reduce((s, x) => s + x.valores[i], 0));
  return { meses, foco: fim, parciais: meses.filter((m) => parciais.has(m)), linhas, totais };
}

/** Os lançamentos de uma categoria num mês (o clique na categoria). */
export function lancamentosDaCategoria(ls: Lancamento[], categoria: string, mes: string): Lancamento[] {
  return ls
    .filter((l) => ehGasto(l) && categoriaDe(l) === categoria && mesRealizado(l) === mes)
    .sort((a, b) => String(a.liquidadoEm || '').localeCompare(String(b.liquidadoEm || '')) || n(b.valor) - n(a.valor));
}

/* ------------------------------------------------------ recorrente × pontual */

/** Categorias de contrato que se repete (mensalidade, parcela, salário, assinatura). */
const CAT_RECORRENTE = new Set(['mensalidade', 'parcela', 'salario', 'salário', 'assinatura']);
/** Entrega única: entra uma vez e acabou. */
const CAT_AVULSA = new Set(['projeto', 'artes', 'arte', 'hora avulsa']);
const PARCELA_KN = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/;
const normSerie = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\d+\s*\/\s*\d+/g, '').replace(/[^a-z]+/g, ' ').trim();

/**
 * Entrada RECORRENTE (renda que se repete enquanto o contrato durar):
 *  - `recorrente: true` (com ou sem `ate`); ou
 *  - categoria de contrato (mensalidade, parcela, salário, assinatura) que é parte de uma
 *    sequência: "parcela 3/7" no nome (com total > 1) ou a mesma série em 2+ meses.
 * Fica de fora: `pontual: true`, entrega única (projeto, artes) e parcela solta sem sequência.
 */
export function entradaRecorrente(l: Lancamento, ls: Lancamento[]): boolean {
  if (l.tipo !== 'entrada' || l.pontual) return false;
  if (l.recorrente) return true;
  const c = (l.categoria || '').toLowerCase();
  if (CAT_AVULSA.has(c) || !CAT_RECORRENTE.has(c)) return false;
  const kn = (l.descricao || '').match(PARCELA_KN);
  if (kn && Number(kn[2]) > 1) return true;
  const serie = `${l.cliente || ''}|${normSerie(l.descricao || '')}`;
  const meses = new Set(ls.filter((x) => x.tipo === 'entrada' && `${x.cliente || ''}|${normSerie(x.descricao || '')}` === serie).map(mesPrevisto));
  return meses.size >= 2;
}

/** Gasto pontual: natureza pontual (`pontual: true`, `natureza: "pontual"` ou categoria pontual). */
export const gastoPontual = (l: Lancamento) => ehPontual(l);

export interface RecorrenteMes {
  mes: string;
  gasto: number;               // tudo que foi gasto no mês
  pontual: number;             // natureza pontual (empréstimo, compra grande que não se repete)
  fixo: number;                // natureza fixo
  variavel: number;            // natureza variável
  gastoRecorrente: number;     // gasto − pontual (= fixo + variável do mês)
  entradasRecorrentes: number; // renda que se repete prevista para o mês (recebida ou não)
  sobraRecorrente: number;     // entradas recorrentes − gasto recorrente
  pontuais: { descricao: string; valor: number }[];
}

export function recorrenteDoMes(ls: Lancamento[], mes: string): RecorrenteMes {
  let gasto = 0, pontual = 0, fixo = 0, entradas = 0;
  const pontuais: RecorrenteMes['pontuais'] = [];
  for (const l of ls) {
    if (ehGasto(l) && mesRealizado(l) === mes) {
      gasto += n(l.valor);
      const nat = naturezaDe(l);
      if (nat === 'pontual') { pontual += n(l.valor); pontuais.push({ descricao: l.descricao, valor: n(l.valor) }); }
      if (nat === 'fixo') fixo += n(l.valor);
    }
    if (l.tipo === 'entrada' && mesDaEntrada(l) === mes && entradaRecorrente(l, ls)) entradas += n(l.valor);
  }
  const r = r2;
  return { mes, gasto: r(gasto), pontual: r(pontual), fixo: r(fixo), variavel: r(gasto - pontual - fixo), gastoRecorrente: r(gasto - pontual), entradasRecorrentes: r(entradas), sobraRecorrente: r(entradas - (gasto - pontual)), pontuais };
}

/** Mês de uma entrada: o que entrou conta quando entrou; o aberto, quando vence. Sem prazo aberto: nenhum. */
function mesDaEntrada(l: Lancamento): string {
  if (liquidado(l)) return mesRealizado(l);
  if (aberto(l) && !l.semPrazo) return mesPrevisto(l);
  return '';
}

export interface RendaRecorrente {
  meses: string[];             // do mês de hoje até o mês depois do fim do razão
  entradas: number[];          // renda que se repete por mês
  gastoBase: number;           // gasto que se repete de referência (fixo + variável estimado)
  baseMeses: string[];         // os meses completos que entraram na estimativa
  estimativa: EstimativaGasto; // como o gastoBase foi estimado (mediana ou teto, com quantos meses)
  sobra: number[];             // entradas − gastoBase
  ateQuando: string;           // último mês antes da queda ('' = não cai até o fim do razão)
  caiEm: string;               // o mês da queda
  antes: number;               // renda recorrente no mês de hoje
  depois: number;              // renda recorrente no mês da queda
  semFim: number;              // a parte que segue sem data de fim (recorrente sem `ate`)
}

/**
 * Até quando a renda que se repete se sustenta. Para cada mês, de hoje em diante, soma a renda
 * recorrente prevista; no mês depois do fim do razão sobra só a que não tem data de fim
 * (`recorrente` sem `ate`, que vale para sempre). A queda é o primeiro mês em que a renda cai
 * 20% ou mais em relação ao mês de hoje. O gasto de referência é o gasto que se repete
 * (gastoQueSeRepete: fixo + variável pela mediana ou pelo teto; nunca o pontual).
 */
export function rendaRecorrente(ls: Lancamento[], hojeMes: string, tetos?: Record<string, number> | null): RendaRecorrente {
  const doRazao = [...new Set(ls.filter((l) => l.mes).map((l) => l.mes.slice(0, 7)))].sort();
  const ultimo = doRazao[doRazao.length - 1] || hojeMes;
  const depois = somarMes(ultimo, 1);
  const meses: string[] = [];
  for (let m = hojeMes; m <= depois && meses.length < 60; m = somarMes(m, 1)) meses.push(m);
  const rec = ls.filter((l) => entradaRecorrente(l, ls));
  const entradas = meses.map((m) => {
    if (m === depois) {
      // depois do razão: só o que se repete sem data de fim, pelo valor do último mês
      return rec.filter((l) => l.recorrente && !l.ate && mesDaEntrada(l) === ultimo).reduce((s, l) => s + n(l.valor), 0);
    }
    return rec.filter((l) => mesDaEntrada(l) === m).reduce((s, l) => s + n(l.valor), 0);
  });
  const estimativa = gastoQueSeRepete(ls, hojeMes, tetos);
  const baseMeses = estimativa.meses;
  const gastoBase = estimativa.total;
  const r = (v: number) => Math.round(v * 100) / 100;
  const antes = entradas[0] || 0;
  const iQueda = entradas.findIndex((v, i) => i > 0 && antes > 0 && v <= antes * 0.8);
  const semFim = entradas[entradas.length - 1] || 0;
  return {
    meses, entradas: entradas.map(r), gastoBase: r(gastoBase), baseMeses, estimativa, sobra: entradas.map((v) => r(v - gastoBase)),
    ateQuando: iQueda > 0 ? meses[iQueda - 1] : '', caiEm: iQueda > 0 ? meses[iQueda] : '', antes: r(antes), depois: r(iQueda > 0 ? entradas[iQueda] : antes), semFim: r(semFim),
  };
}

/* ----------------------------------------------------------------- patrimônio */

export const GRUPOS = ['CDB liquidez diária', 'Renda fixa', 'FII', 'Ação', 'Cripto', 'Outros'] as const;
export type Grupo = (typeof GRUPOS)[number];

/** Grupo de uma posição: pela `classe`; sem ela, pela liquidez e pelo nome. */
export function grupoDe(p: { classe?: string; liquidez?: string; descricao?: string }): Grupo {
  const c = (p.classe || '').toLowerCase();
  const d = (p.descricao || '').toLowerCase();
  if (c === 'cripto' || /\b(cripto|bitcoin|btc|ethereum|eth|usdt)\b/.test(d)) return 'Cripto';
  if (c === 'fii') return 'FII';
  if (c === 'ação' || c === 'acao' || c === 'etf' || c === 'bdr') return 'Ação';
  if (['cdb', 'rdb', 'lci', 'lca', 'tesouro'].includes(c) || p.liquidez === 'diaria' || p.liquidez === 'no-vencimento' || p.liquidez === 'carencia')
    return p.liquidez === 'diaria' ? 'CDB liquidez diária' : 'Renda fixa';
  return 'Outros';
}

export interface PosicaoAtual {
  chave: string; instituicao: string; descricao: string; grupo: Grupo; liquidez: string; valor: number; data: string; manual: boolean; reserva: boolean;
  /** Só para o Aion, e só quando o razão tem: classe, código, quantidade, aplicado, desde e indexador. */
  classe?: string; codigo?: string; quantidade?: number; aportado?: number; desde?: string; indexador?: string;
}
const CAMPOS_AION = ['classe', 'codigo', 'quantidade', 'aportado', 'desde', 'indexador'] as const;

/**
 * Posição de hoje de cada aplicação. As do banco valem só se vieram na sincronização mais
 * recente (aplicação resgatada some do banco e não pode ficar "viva" no razão). As lançadas à
 * mão (cripto) valem pela última data de cada uma.
 */
export function posicoesAtuais(ls: Lancamento[]): PosicaoAtual[] {
  const inv = ls.filter((l) => l.tipo === 'investimento' && (l.data || l.vencimento || l.mes));
  const dataDe = (l: Lancamento) => String(l.data || l.vencimento || l.mes || '').slice(0, 10);
  const chaveDe = (l: Lancamento) => (l.origem && l.fitid ? l.fitid.replace(/-\d{4}-\d{2}$/, '') : `${l.instituicao || ''}·${l.descricao}`);
  const ultimaSync = inv.filter((l) => l.origem).map(dataDe).sort().pop() || '';
  const ultima = new Map<string, Lancamento>();
  for (const l of [...inv].sort((a, b) => dataDe(a).localeCompare(dataDe(b)))) {
    if (l.origem && dataDe(l) !== ultimaSync) continue;
    ultima.set(chaveDe(l), l);
  }
  return [...ultima.entries()].map(([chave, l]) => ({
    chave, instituicao: l.instituicao || '', descricao: l.descricao, grupo: grupoDe(l), liquidez: l.liquidez || '',
    valor: n(l.valor), data: dataDe(l), manual: !l.origem, reserva: !!l.reserva,
    ...Object.fromEntries(CAMPOS_AION.filter((c) => (l as unknown as Record<string, unknown>)[c] != null && (l as unknown as Record<string, unknown>)[c] !== '').map((c) => [c, (l as unknown as Record<string, unknown>)[c]])),
  })).sort((a, b) => GRUPOS.indexOf(a.grupo) - GRUPOS.indexOf(b.grupo) || b.valor - a.valor);
}

export interface Retrato { data: string; total: number; diaria: number; porGrupo: Partial<Record<Grupo, number>> }

/** O retrato do patrimônio numa data (o que a sincronização guarda, um por dia). */
export function retratoDe(posicoes: { grupo: Grupo; liquidez: string; valor: number }[], data: string): Retrato {
  const porGrupo: Partial<Record<Grupo, number>> = {};
  let total = 0, diaria = 0;
  for (const p of posicoes) {
    porGrupo[p.grupo] = Math.round(((porGrupo[p.grupo] || 0) + p.valor) * 100) / 100;
    total += p.valor;
    if (p.liquidez === 'diaria') diaria += p.valor;
  }
  return { data, total: Math.round(total * 100) / 100, diaria: Math.round(diaria * 100) / 100, porGrupo };
}

/** Grava o retrato do dia numa lista de retratos: substitui o do mesmo dia, nunca duplica. */
export function comRetrato(retratos: Retrato[], r: Retrato): Retrato[] {
  return [...retratos.filter((x) => x.data !== r.data), r].sort((a, b) => a.data.localeCompare(b.data));
}

export interface Patrimonio {
  atuais: PosicaoAtual[];
  porGrupo: { grupo: Grupo; valor: number }[];
  total: number;
  reservaLiquida: number;      // a reserva: posição com `reserva: true` ou de liquidez diária (a caixinha)
  piso: number;
  falta: number;               // quanto falta para o piso (0 se passou)
  serie: Retrato[];            // retratos gravados + o de hoje (calculado do razão)
}

export function patrimonio(ls: Lancamento[], retratos: Retrato[], hoje: string, piso = 5000): Patrimonio {
  const atuais = posicoesAtuais(ls);
  const r = retratoDe(atuais, hoje);
  const porGrupo = GRUPOS.filter((g) => (r.porGrupo[g] || 0) > 0).map((g) => ({ grupo: g, valor: r.porGrupo[g]! }));
  const serie = atuais.length ? comRetrato(retratos || [], r) : [...(retratos || [])].sort((a, b) => a.data.localeCompare(b.data));
  const reserva = Math.round(atuais.filter((a) => a.reserva || a.liquidez === 'diaria').reduce((s, a) => s + a.valor, 0) * 100) / 100;
  return { atuais, porGrupo, total: r.total, reservaLiquida: reserva, piso, falta: Math.max(0, Math.round((piso - reserva) * 100) / 100), serie };
}

/* --------------------------------------------- clientes: realizado × previsto */

export interface PagamentoCliente { descricao: string; valor: number; vencimento: string; pagoEm: string; atraso: number }
export interface ClienteResumo {
  cliente: string;
  recebido: number;
  pagamentos: PagamentoCliente[];
  vencido: number;             // aberto com vencimento passado
  diasVencido: number;         // o mais antigo
  falta: number;               // aberto daqui até o fim (inclui o vencido)
  fim: string;                 // último mês previsto ('' = nada aberto)
  atrasoMedio: number;         // dias, só dos que pagaram atrasado (0 = em dia)
  semFim: boolean;             // tem renda que se repete sem data de fim (salário): o "fim" é só o do razão
}

/** Quanto cada cliente pagou, quando, com quantos dias de atraso, e o que falta até o fim do previsto. */
export function clientesRealizado(ls: Lancamento[], hoje: string): ClienteResumo[] {
  const m = new Map<string, ClienteResumo>();
  for (const l of ls) {
    if (l.tipo !== 'entrada' || !l.cliente) continue;
    if (l.semPrazo && !liquidado(l)) continue; // sem prazo: fora do que falta, mas o que já entrou conta
    const c = m.get(l.cliente) || { cliente: l.cliente, recebido: 0, pagamentos: [], vencido: 0, diasVencido: 0, falta: 0, fim: '', atrasoMedio: 0, semFim: false };
    const venc = (l.vencimento || '').slice(0, 10);
    if (liquidado(l)) {
      const pagoEm = (l.liquidadoEm || venc).slice(0, 10);
      c.recebido += n(l.valor);
      c.pagamentos.push({ descricao: l.descricao, valor: n(l.valor), vencimento: venc, pagoEm, atraso: venc && pagoEm ? Math.max(0, diasEntre(venc, pagoEm)) : 0 });
    } else if (aberto(l)) {
      c.falta += n(l.valor);
      const mp = mesPrevisto(l);
      if (mp > c.fim) c.fim = mp;
      if (l.recorrente && !l.ate) c.semFim = true;
      if (venc && venc < hoje) { c.vencido += n(l.valor); c.diasVencido = Math.max(c.diasVencido, diasEntre(venc, hoje)); }
    }
    m.set(l.cliente, c);
  }
  for (const c of m.values()) {
    c.pagamentos.sort((a, b) => b.pagoEm.localeCompare(a.pagoEm));
    const atrasados = c.pagamentos.filter((p) => p.atraso > 0);
    c.atrasoMedio = atrasados.length ? Math.round(atrasados.reduce((s, p) => s + p.atraso, 0) / atrasados.length) : 0;
    c.recebido = Math.round(c.recebido * 100) / 100;
    c.falta = Math.round(c.falta * 100) / 100;
  }
  return [...m.values()].sort((a, b) => b.recebido + b.falta - (a.recebido + a.falta) || a.cliente.localeCompare(b.cliente));
}

/* ------------------------------------------------------------------- avisos */

export type Aviso =
  | { tipo: 'fatura'; valor: number; vencimento: string; dias: number; medido: boolean }
  | { tipo: 'sync-falhou'; em: string; mensagem: string }
  | { tipo: 'sync-parada'; desde: string; dias: number }
  | { tipo: 'a-classificar'; qtd: number; valor: number };

/**
 * Avisos da Visão (a autorização do Open Finance já tem o seu em avisosConexao):
 * fatura do cartão que vence nos próximos 5 dias, sincronização que falhou depois da última que
 * deu certo, sincronização parada há mais de 3 dias e lançamento "a classificar" pendente.
 */
export function avisosFinanceiro(
  ls: Lancamento[], hoje: string,
  estado: { ultimaSync?: string; ultimaFalha?: { em: string; mensagem: string } | null } = {},
): Aviso[] {
  const out: Aviso[] = [];
  for (const l of ls) {
    if (!ehCartao(l) || l.viaCartao || !aberto(l) || !l.vencimento) continue;
    const dias = diasEntre(hoje, l.vencimento.slice(0, 10));
    if (dias >= 0 && dias <= 5) out.push({ tipo: 'fatura', valor: n(l.valor), vencimento: l.vencimento.slice(0, 10), dias, medido: confiancaDe(l) === 'medido' });
  }
  const sync = (estado.ultimaSync || '').slice(0, 19);
  const falha = estado.ultimaFalha;
  if (falha && falha.em && (!sync || falha.em.slice(0, 19) > sync)) out.push({ tipo: 'sync-falhou', em: falha.em, mensagem: falha.mensagem || '' });
  else if (sync) {
    const dias = diasEntre(sync.slice(0, 10), hoje);
    if (dias > 3) out.push({ tipo: 'sync-parada', desde: sync.slice(0, 10), dias });
  }
  const pend = ls.filter((l) => (l.categoria || '') === A_CLASSIFICAR);
  if (pend.length) out.push({ tipo: 'a-classificar', qtd: pend.length, valor: Math.round(pend.reduce((s, l) => s + n(l.valor), 0) * 100) / 100 });
  return out;
}
