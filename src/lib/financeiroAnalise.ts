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
export const ehPontual = (l: Lancamento) => !!l.pontual;
const categoriaDe = (l: Lancamento) => (l.categoria || '').trim() || SEM_CATEGORIA;

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

export interface RecorrenteMes {
  mes: string;
  gasto: number;               // tudo que foi gasto no mês
  pontual: number;             // marcado `pontual: true` (empréstimo, compra grande que não se repete)
  gastoRecorrente: number;     // gasto − pontual
  entradasRecorrentes: number; // entradas com `recorrente: true` previstas para o mês (recebidas ou não)
  sobraRecorrente: number;     // entradas recorrentes − gasto recorrente
  pontuais: { descricao: string; valor: number }[];
}

export function recorrenteDoMes(ls: Lancamento[], mes: string): RecorrenteMes {
  let gasto = 0, pontual = 0, entradas = 0;
  const pontuais: RecorrenteMes['pontuais'] = [];
  for (const l of ls) {
    if (ehGasto(l) && mesRealizado(l) === mes) {
      gasto += n(l.valor);
      if (ehPontual(l)) { pontual += n(l.valor); pontuais.push({ descricao: l.descricao, valor: n(l.valor) }); }
    }
    if (l.tipo === 'entrada' && l.recorrente && !l.semPrazo && (aberto(l) || liquidado(l)) && mesPrevisto(l) === mes) entradas += n(l.valor);
  }
  const r = (v: number) => Math.round(v * 100) / 100;
  return { mes, gasto: r(gasto), pontual: r(pontual), gastoRecorrente: r(gasto - pontual), entradasRecorrentes: r(entradas), sobraRecorrente: r(entradas - (gasto - pontual)), pontuais };
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

export interface PosicaoAtual { chave: string; instituicao: string; descricao: string; grupo: Grupo; liquidez: string; valor: number; data: string; manual: boolean }

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
    valor: n(l.valor), data: dataDe(l), manual: !l.origem,
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
  reservaLiquida: number;      // só liquidez diária
  piso: number;
  falta: number;               // quanto falta para o piso (0 se passou)
  serie: Retrato[];            // retratos gravados + o de hoje (calculado do razão)
}

export function patrimonio(ls: Lancamento[], retratos: Retrato[], hoje: string, piso = 5000): Patrimonio {
  const atuais = posicoesAtuais(ls);
  const r = retratoDe(atuais, hoje);
  const porGrupo = GRUPOS.filter((g) => (r.porGrupo[g] || 0) > 0).map((g) => ({ grupo: g, valor: r.porGrupo[g]! }));
  const serie = atuais.length ? comRetrato(retratos || [], r) : [...(retratos || [])].sort((a, b) => a.data.localeCompare(b.data));
  return { atuais, porGrupo, total: r.total, reservaLiquida: r.diaria, piso, falta: Math.max(0, Math.round((piso - r.diaria) * 100) / 100), serie };
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
}

/** Quanto cada cliente pagou, quando, com quantos dias de atraso, e o que falta até o fim do previsto. */
export function clientesRealizado(ls: Lancamento[], hoje: string): ClienteResumo[] {
  const m = new Map<string, ClienteResumo>();
  for (const l of ls) {
    if (l.tipo !== 'entrada' || !l.cliente) continue;
    if (l.semPrazo && !liquidado(l)) continue; // sem prazo: fora do que falta, mas o que já entrou conta
    const c = m.get(l.cliente) || { cliente: l.cliente, recebido: 0, pagamentos: [], vencido: 0, diasVencido: 0, falta: 0, fim: '', atrasoMedio: 0 };
    const venc = (l.vencimento || '').slice(0, 10);
    if (liquidado(l)) {
      const pagoEm = (l.liquidadoEm || venc).slice(0, 10);
      c.recebido += n(l.valor);
      c.pagamentos.push({ descricao: l.descricao, valor: n(l.valor), vencimento: venc, pagoEm, atraso: venc && pagoEm ? Math.max(0, diasEntre(venc, pagoEm)) : 0 });
    } else if (aberto(l)) {
      c.falta += n(l.valor);
      const mp = mesPrevisto(l);
      if (mp > c.fim) c.fim = mp;
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
