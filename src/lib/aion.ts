// Aion · modelo da carteira, do rendimento, da renda passiva, do ritmo de aporte e das metas.
// Só lógica pura, testada em aion.test.ts com dados inventados. Regra do Aion: o Pedro decide; aqui
// nada recomenda. Sem dado, a função diz "sem base" (null / fraca) em vez de inventar número.
// Posições: as da Métis (posicoesAtuais, src/lib/financeiroAnalise.ts), uma por aplicação.
import type { Lancamento, Mercado, MetasAion, PontoSerie, RegraAion, TipoCarteira } from '../types';
import { posicoesAtuais, type PosicaoAtual } from './financeiroAnalise.ts';
import { mesRealizado, somarMes } from './financeiroGraficos.ts';

const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const dataBr = (d: string) => d.slice(0, 10).split('-').reverse().join('/');
const liquidado = (l: Lancamento) => l.status === 'recebido' || l.status === 'pago';
export const PISO_RESERVA = 5000;
export const META_CARTEIRA = 5000;

export const TIPOS: readonly TipoCarteira[] = ['reserva', 'renda-fixa', 'fii', 'acao', 'cripto', 'outros'];
export const ROTULO_TIPO: Record<TipoCarteira, string> = {
  reserva: 'Reserva (liquidez diária)', 'renda-fixa': 'Renda fixa', fii: 'Fundos imobiliários', acao: 'Ações', cripto: 'Cripto', outros: 'Outros',
};
export const ROTULO_CURTO: Record<TipoCarteira, string> = { reserva: 'Reserva', 'renda-fixa': 'Renda fixa', fii: 'FII', acao: 'Ação', cripto: 'Cripto', outros: 'Outros' };
/** Bloco da trilha que explica cada tipo (02-ESTUDO/trilha-investimentos-e-economia.md). */
export const BLOCO_DO_TIPO: Record<TipoCarteira, number> = { reserva: 4, 'renda-fixa': 3, fii: 5, acao: 6, cripto: 8, outros: 7 };

export interface PosicaoAion extends PosicaoAtual { tipo: TipoCarteira; ticker: string }

/** "Ação ABCD3", "FII ABCD11" → código de negociação; `codigo` gravado vence. Cripto: o código ou o nome. */
export function tickerDe(p: { codigo?: string; descricao?: string; grupo?: string; classe?: string }): string {
  if (p.codigo) return String(p.codigo).toUpperCase();
  const m = /\b([A-Z]{4}\d{1,2}[A-Z]?)\b/.exec(String(p.descricao || ''));
  return m ? m[1] : '';
}

export function tipoDe(p: PosicaoAtual): TipoCarteira {
  if (p.reserva || p.liquidez === 'diaria') return 'reserva';
  if (p.grupo === 'Renda fixa' || p.grupo === 'CDB liquidez diária') return 'renda-fixa';
  if (p.grupo === 'FII') return 'fii';
  if (p.grupo === 'Ação') return 'acao';
  if (p.grupo === 'Cripto') return 'cripto';
  return 'outros';
}

export function posicoesAion(ls: Lancamento[]): PosicaoAion[] {
  return posicoesAtuais(ls).map((p) => {
    const tipo = tipoDe(p);
    return { ...p, tipo, ticker: tipo === 'cripto' ? (p.codigo || p.descricao).toUpperCase() : tickerDe(p) };
  });
}

/* ------------------------------------------------------------ carteira por tipo × regra */

export type Situacao = 'dentro' | 'acima' | 'abaixo' | 'sem-regra';
export interface LinhaTipo {
  tipo: TipoCarteira;
  valor: number;
  pctTotal: number;              // % do total (com a reserva)
  pctFora: number | null;        // % da carteira fora da reserva (null para a reserva)
  alvo: number | null;           // % alvo da regra (fora da reserva)
  min: number | null; max: number | null;
  desvio: number | null;         // pontos percentuais em relação ao alvo
  situacao: Situacao;
  posicoes: PosicaoAion[];
}
export interface Carteira { total: number; reserva: number; fora: number; linhas: LinhaTipo[]; temRegra: boolean; reservaMinima: number }

/**
 * Por tipo, comparado com a regra. A reserva é medida em reais (contra o mínimo da regra ou o piso);
 * os outros tipos em % da carteira FORA da reserva (o Pedro só aceita risco fora dela). Tipo com
 * alvo na regra mas sem posição entra com 0 (o desvio dele também importa).
 */
export function carteiraPorTipo(pos: PosicaoAion[], regra: RegraAion | null, piso = PISO_RESERVA): Carteira {
  const total = r2(pos.reduce((s, p) => s + p.valor, 0));
  const reserva = r2(pos.filter((p) => p.tipo === 'reserva').reduce((s, p) => s + p.valor, 0));
  const fora = r2(total - reserva);
  const aloc = regra?.alocacao || {};
  const temRegra = Object.keys(aloc).length > 0;
  const reservaMinima = regra?.reservaMinima || piso;
  const linhas: LinhaTipo[] = [];
  for (const tipo of TIPOS) {
    const ps = pos.filter((p) => p.tipo === tipo);
    const valor = r2(ps.reduce((s, p) => s + p.valor, 0));
    const a = tipo === 'reserva' ? undefined : aloc[tipo as Exclude<TipoCarteira, 'reserva'>];
    if (!ps.length && !a) continue;
    const pctFora = tipo === 'reserva' ? null : fora > 0 ? r2((valor / fora) * 100) : 0;
    let situacao: Situacao = 'sem-regra';
    let desvio: number | null = null;
    if (tipo === 'reserva') situacao = valor < reservaMinima ? 'abaixo' : 'dentro';
    else if (a) {
      desvio = r2((pctFora || 0) - a.alvo);
      situacao = desvio > a.tolerancia ? 'acima' : desvio < -a.tolerancia ? 'abaixo' : 'dentro';
    }
    linhas.push({
      tipo, valor, pctTotal: total > 0 ? r2((valor / total) * 100) : 0, pctFora,
      alvo: a ? a.alvo : null, min: a ? Math.max(0, a.alvo - a.tolerancia) : null, max: a ? Math.min(100, a.alvo + a.tolerancia) : null,
      desvio, situacao, posicoes: ps.sort((x, y) => y.valor - x.valor),
    });
  }
  return { total, reserva, fora, linhas, temRegra, reservaMinima };
}

/* ------------------------------------------------------------ rendimento × CDI e IPCA */

/** Índice acumulado (%) de uma série mensal (CDI 4391, IPCA 433) entre dois meses, inclusive. */
export function acumulado(pontos: PontoSerie[], deMes: string, ateMes: string): { pct: number; meses: number } | null {
  const ps = pontos.filter((p) => p.data.slice(0, 7) >= deMes && p.data.slice(0, 7) <= ateMes);
  if (!ps.length) return null;
  return { pct: r2((ps.reduce((f, p) => f * (1 + p.valor / 100), 1) - 1) * 100), meses: ps.length };
}

export interface Rendimento {
  base: 'aportado' | 'retratos' | 'nenhuma';
  desde: string;                 // AAAA-MM-DD do dado mais antigo usado
  ate: string;
  aplicado: number;              // soma do aportado (base aportado) ou o total do primeiro retrato
  valor: number;
  ganho: number;
  pct: number | null;
  cdi: { pct: number; meses: number } | null;
  ipca: { pct: number; meses: number } | null;
  cobertura: number;             // quanto da carteira tem base (0–1)
  explica: string;
}

/**
 * Quanto a carteira rendeu, com a base dita. Ordem: (1) o valor aplicado de cada posição que tem
 * `aportado` e `desde` (vem da sincronização); (2) dois retratos do patrimônio ou mais (só serve se
 * não houve aporte entre eles: senão aporte parece rendimento, e a tela diz isso); (3) nenhuma.
 * CDI e IPCA do mesmo período por mês cheio (o mês do começo entra inteiro: aproximação dita).
 */
export function rendimentoDaCarteira(pos: PosicaoAion[], mercado: Mercado | null, retratos: { data: string; total: number }[], hoje: string, aportesNoPeriodo = 0): Rendimento {
  const vazio: Rendimento = { base: 'nenhuma', desde: '', ate: hoje, aplicado: 0, valor: 0, ganho: 0, pct: null, cdi: null, ipca: null, cobertura: 0, explica: '' };
  const total = pos.reduce((s, p) => s + p.valor, 0);
  const cdi = mercado?.bcb?.cdiMensal?.pontos || [];
  const ipca = mercado?.bcb?.ipca?.mensal || [];
  const ultimoMes = (ps: PontoSerie[]) => ps.length ? ps[ps.length - 1].data.slice(0, 7) : '';
  const comBase = pos.filter((p) => (p.aportado || 0) > 0 && p.desde);
  if (comBase.length) {
    const aplicado = r2(comBase.reduce((s, p) => s + (p.aportado || 0), 0));
    const valor = r2(comBase.reduce((s, p) => s + p.valor, 0));
    const desde = comBase.map((p) => p.desde!).sort()[0];
    return {
      base: 'aportado', desde, ate: hoje, aplicado, valor, ganho: r2(valor - aplicado), pct: aplicado > 0 ? r2(((valor - aplicado) / aplicado) * 100) : null,
      cdi: acumulado(cdi, desde.slice(0, 7), ultimoMes(cdi)), ipca: acumulado(ipca, desde.slice(0, 7), ultimoMes(ipca)),
      cobertura: total > 0 ? r2(valor / total) : 0,
      explica: `Valor aplicado de ${comBase.length} ${comBase.length === 1 ? 'aplicação' : 'aplicações'} (vem do banco), desde a mais antiga. O CDI e o IPCA contam do mês da aplicação mais antiga: comparação aproximada, porque cada aplicação começou num dia.`,
    };
  }
  const rs = [...retratos].filter((r) => r.total > 0).sort((a, b) => a.data.localeCompare(b.data));
  if (rs.length >= 2) {
    const a = rs[0], b = rs[rs.length - 1];
    const aplicado = r2(a.total + aportesNoPeriodo);
    return {
      base: 'retratos', desde: a.data, ate: b.data, aplicado, valor: b.total, ganho: r2(b.total - aplicado), pct: aplicado > 0 ? r2(((b.total - aplicado) / aplicado) * 100) : null,
      cdi: acumulado(cdi, somarMes(a.data.slice(0, 7), 1), b.data.slice(0, 7)), ipca: acumulado(ipca, somarMes(a.data.slice(0, 7), 1), b.data.slice(0, 7)),
      cobertura: 1,
      explica: `Retrato do patrimônio de ${dataBr(a.data)} contra o de ${dataBr(b.data)}, descontado o que foi aportado no meio (${aportesNoPeriodo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`,
    };
  }
  return { ...vazio, explica: rs.length === 1 ? `Só há um retrato do patrimônio (${dataBr(rs[0].data)}) e o razão ainda não tem o valor aplicado de cada posição: sem base para medir rendimento.` : 'Sem posição com valor aplicado e sem retratos do patrimônio: sem base para medir rendimento.' };
}

/* ------------------------------------------------------------ renda passiva */

const RE_RENDA = /dividend|rendiment|\bjcp\b|juros sobre|provento|amortiza/i;
const CAT_RENDA = new Set(['rendimentos', 'rendimento', 'dividendos', 'dividendo', 'jcp', 'proventos', 'juros']);
export const ehRendaPassiva = (l: Lancamento) => l.tipo === 'entrada' && (CAT_RENDA.has((l.categoria || '').trim().toLowerCase()) || RE_RENDA.test(l.descricao || ''));

/** Dividendos, JCP, rendimentos de FII e de aplicação que ENTRARAM no mês (o que o razão tem). */
export function rendaPassiva(ls: Lancamento[], mes: string) {
  const itens = ls.filter((l) => ehRendaPassiva(l) && liquidado(l) && mesRealizado(l) === mes);
  return { mes, total: r2(itens.reduce((s, l) => s + n(l.valor), 0)), itens };
}

/** Renda passiva dos últimos `k` meses (para a linha do tempo e a média). */
export function rendaPassivaPorMes(ls: Lancamento[], hojeMes: string, k = 6) {
  const meses: string[] = [];
  for (let i = k - 1; i >= 0; i--) meses.push(somarMes(hojeMes, -i));
  return meses.map((m) => ({ mes: m, total: rendaPassiva(ls, m).total }));
}

/* ------------------------------------------------------------ ritmo real de aporte */

const RE_APLICACAO = /aplica[cç][aã]o|investiment|aporte/i;
/** O que entrou de fato em reserva ou investimento: reserva paga + saída para aplicação. */
export const ehAporte = (l: Lancamento) => liquidado(l) && (l.tipo === 'reserva' || (l.tipo === 'saida' && (['investimento', 'aplicacao', 'aplicação', 'aporte'].includes((l.categoria || '').toLowerCase()) || RE_APLICACAO.test(l.descricao || ''))));

export interface Ritmo { meses: { mes: string; valor: number }[]; ritmo: number; nMeses: number; fraca: boolean; total: number; mesAtual: number }

/**
 * Ritmo real: a MÉDIA do que foi aportado por mês nos meses fechados desde o primeiro mês com
 * dinheiro mexendo no razão (até `max`), contando os meses sem aporte como zero. Média e não
 * mediana dos meses com aporte: aporte que falha num mês também é ritmo. Menos de 3 meses = fraca.
 */
export function ritmoDeAporte(ls: Lancamento[], hojeMes: string, max = 6): Ritmo {
  const usados = ls.filter((l) => liquidado(l) && l.tipo !== 'investimento').map(mesRealizado).filter((m) => m && m < hojeMes).sort();
  const primeiro = usados[0] || '';
  const meses: { mes: string; valor: number }[] = [];
  if (primeiro) for (let m = somarMes(hojeMes, -1); m >= primeiro && meses.length < max; m = somarMes(m, -1)) meses.unshift({ mes: m, valor: 0 });
  for (const l of ls) {
    if (!ehAporte(l)) continue;
    const x = meses.find((k) => k.mes === mesRealizado(l));
    if (x) x.valor = r2(x.valor + n(l.valor));
  }
  const total = r2(meses.reduce((s, m) => s + m.valor, 0));
  // o mês de hoje fica fora da média (está andando), mas a tela mostra o que já entrou nele
  const mesAtual = r2(ls.filter((l) => ehAporte(l) && mesRealizado(l) === hojeMes).reduce((s, l) => s + n(l.valor), 0));
  return { meses, ritmo: meses.length ? r2(total / meses.length) : 0, nMeses: meses.length, fraca: meses.length < 3, total, mesAtual };
}

/* ------------------------------------------------------------ metas */

export interface Meta { id: 'reserva' | 'carteira' | 'meta3'; nome: string; alvo: number | null; atual: number; falta: number; chegaEm: string; meses: number | null; explica: string }

/**
 * Quando chega cada meta, na ORDEM do Pedro: o aporte vai para a reserva até o piso, depois para a
 * carteira fora da reserva, depois para a meta 3 (sem valor: sem data). A reserva rende pelo CDI
 * (taxa ao ano dada), a carteira idem (premissa simples, dita na tela). Sem ritmo: sem data.
 * Mais de 20 anos: "depois de 20 anos" ('' + meses null).
 */
export function metasNoRitmo(atualReserva: number, atualFora: number, ritmoMes: number, metas: MetasAion | null, taxaAno: number, hojeMes: string): Meta[] {
  const alvoRes = metas?.reserva || PISO_RESERVA;
  const alvoCar = metas?.carteira || META_CARTEIRA;
  const alvo3 = metas?.meta3?.valor ?? null;
  const tm = Math.pow(1 + (taxaAno || 0) / 100, 1 / 12) - 1;
  let res = atualReserva, car = atualFora, m3 = 0;
  const chegou: Record<string, number | null> = { reserva: res >= alvoRes ? 0 : null, carteira: car >= alvoCar ? 0 : null, meta3: alvo3 !== null && m3 >= alvo3 ? 0 : null };
  if (ritmoMes > 0) {
    for (let k = 1; k <= 240; k++) {
      res *= 1 + tm; car *= 1 + tm; m3 *= 1 + tm;
      let a = ritmoMes;
      if (res < alvoRes) { const v = Math.min(a, alvoRes - res); res += v; a -= v; }
      if (a > 0 && car < alvoCar) { const v = Math.min(a, alvoCar - car); car += v; a -= v; }
      if (a > 0) m3 += a;
      if (chegou.reserva === null && res >= alvoRes - 0.005) chegou.reserva = k;
      if (chegou.carteira === null && car >= alvoCar - 0.005) chegou.carteira = k;
      if (alvo3 !== null && chegou.meta3 === null && m3 >= alvo3 - 0.005) chegou.meta3 = k;
      if (chegou.reserva !== null && chegou.carteira !== null && (alvo3 === null || chegou.meta3 !== null)) break;
    }
  }
  const linha = (id: Meta['id'], nome: string, alvo: number | null, atual: number, explica: string): Meta => {
    const k = chegou[id];
    return { id, nome, alvo, atual: r2(atual), falta: alvo === null ? 0 : Math.max(0, r2(alvo - atual)), chegaEm: k === null || k === undefined ? '' : somarMes(hojeMes, k), meses: k ?? null, explica };
  };
  return [
    linha('reserva', 'Reserva até o piso', alvoRes, atualReserva, 'Primeiro destino do aporte. A reserva não arrisca: liquidez diária.'),
    linha('carteira', 'Carteira fora da reserva', alvoCar, atualFora, 'Depois que a reserva chega ao piso, o aporte vai para cá. Aqui o risco é aceito.'),
    linha('meta3', metas?.meta3?.nome || 'sair de casa ou veículo', alvo3, 0, alvo3 === null ? 'Ainda sem valor: defina quando souber quanto custa (o Aion projeta a data a partir daí).' : 'Recebe o aporte depois das duas primeiras.'),
  ];
}
