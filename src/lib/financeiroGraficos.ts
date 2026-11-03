// Agregações dos gráficos do Financeiro. Só lógica pura (sem React, sem DOM), para
// poder testar com `node --test src/lib/financeiroGraficos.test.ts`.
// Nada é inventado aqui: tudo sai dos lançamentos do vault. Quando falta dado (saldo de
// partida da reserva, meses depois do razão), a função devolve o buraco explícito em vez
// de preencher.
import type { ConfiancaValor, Lancamento } from '../types';

const n = (v: unknown) => Number(v) || 0;
const liquidado = (l: Lancamento) => l.status === 'recebido' || l.status === 'pago';
const aberto = (l: Lancamento) => l.status === 'a-receber' || l.status === 'a-pagar';

/** Mês em que o lançamento é PREVISTO: o do vencimento; sem dia, o do arquivo. */
export function mesPrevisto(l: Lancamento): string {
  return (l.vencimento && /^\d{4}-\d{2}/.test(l.vencimento) ? l.vencimento : l.mes || '').slice(0, 7);
}

/** Mês em que o dinheiro MEXEU: liquidadoEm (ou o antigo recebido_em); sem ele, o previsto. */
export function mesRealizado(l: Lancamento): string {
  const d = l.liquidadoEm || (l as { recebido_em?: string }).recebido_em || '';
  return /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : mesPrevisto(l);
}

/** 'AAAA-MM' + k meses. */
export function somarMes(mes: string, k: number): string {
  const [a, m] = mes.split('-').map(Number);
  const t = a * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

function intervaloMeses(de: string, ate: string): string[] {
  const out: string[] = [];
  for (let m = de; m <= ate && out.length < 240; m = somarMes(m, 1)) out.push(m);
  return out;
}

function mesesDoRazao(ls: Lancamento[]): string[] {
  const s = new Set<string>();
  for (const l of ls) if (l.mes) s.add(l.mes.slice(0, 7));
  const arr = [...s].sort();
  return arr.length ? intervaloMeses(arr[0], arr[arr.length - 1]) : [];
}

/* ------------------------------------------------------------------ 1 · fluxo do mês */

export interface Par { realizado: number; previsto: number }
export interface LinhaFluxo { mes: string; entra: Par; sai: Par; guarda: Par }

/**
 * Entradas × saídas × reserva por mês. O realizado conta no mês em que liquidou
 * (`liquidadoEm`); o aberto conta no mês previsto. `semPrazo` fica fora (não tem mês),
 * e investimento também (é saldo, não fluxo).
 */
export function fluxoMensal(ls: Lancamento[]): LinhaFluxo[] {
  const meses = mesesDoRazao(ls);
  const map = new Map<string, LinhaFluxo>();
  const linha = (mes: string) => {
    if (!map.has(mes)) map.set(mes, { mes, entra: { realizado: 0, previsto: 0 }, sai: { realizado: 0, previsto: 0 }, guarda: { realizado: 0, previsto: 0 } });
    return map.get(mes)!;
  };
  for (const m of meses) linha(m);
  for (const l of ls) {
    if (l.tipo === 'investimento') continue;
    if (aberto(l) && l.semPrazo) continue;
    if (!liquidado(l) && !aberto(l)) continue;
    const mes = liquidado(l) ? mesRealizado(l) : mesPrevisto(l);
    if (!mes) continue;
    const alvo = linha(mes)[l.tipo === 'saida' ? 'sai' : l.tipo === 'reserva' ? 'guarda' : 'entra'];
    if (liquidado(l)) alvo.realizado += n(l.valor); else alvo.previsto += n(l.valor);
  }
  return [...map.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

/* ------------------------------------------------- 2 · receita por cliente e fim */

export const OUTROS = 'Outros';

export interface SerieCliente {
  cliente: string;
  slot: number;            // posição fixa na paleta categórica (segue o cliente, não o rank do mês)
  valores: number[];       // um por mês de `meses`
  estavel: boolean;        // continua depois do fim do razão
  fim: string;             // último mês com entrada; '' se estável
}
export interface ReceitaPorCliente {
  meses: string[];         // meses do razão + 1 mês depois (só o estável)
  mesDepois: string;       // o mês que vem depois do razão
  series: SerieCliente[];  // ordem de empilhar: estáveis embaixo
  estavel: number;         // receita estável: a que segue depois do razão
  totais: number[];        // total por mês
}

/**
 * Uma entrada é ESTÁVEL quando é recorrente e não tem fim declarado (`ate`) antes do mês
 * depois do razão. Parcela (recorrente: false) sempre termina; acordo com prazo leva `ate`.
 */
export function ehEstavel(l: Lancamento, mesDepois: string): boolean {
  if (l.tipo !== 'entrada' || !l.recorrente) return false;
  return !l.ate || l.ate >= mesDepois;
}

export function receitaPorCliente(ls: Lancamento[], maxSeries = 6): ReceitaPorCliente {
  const entradas = ls.filter((l) => l.tipo === 'entrada' && !(aberto(l) && l.semPrazo) && (aberto(l) || liquidado(l)));
  const razao = mesesDoRazao(ls);
  if (!razao.length) return { meses: [], mesDepois: '', series: [], estavel: 0, totais: [] };
  const ultimo = razao[razao.length - 1];
  const mesDepois = somarMes(ultimo, 1);
  const meses = [...razao, mesDepois];
  const idx = new Map(meses.map((m, i) => [m, i]));

  // total por cliente no razão inteiro decide quem tem cor própria (fixa) e quem vira "Outros"
  const total = new Map<string, number>();
  for (const l of entradas) total.set(l.cliente || '(sem cliente)', (total.get(l.cliente || '(sem cliente)') || 0) + n(l.valor));
  const ranking = [...total.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
  const proprios = ranking.length > maxSeries ? ranking.slice(0, maxSeries - 1) : ranking;
  const nomeSerie = (c: string) => (proprios.includes(c) ? c : OUTROS);

  const series = new Map<string, SerieCliente>();
  const serie = (c: string) => {
    if (!series.has(c)) series.set(c, { cliente: c, slot: c === OUTROS ? proprios.length : proprios.indexOf(c), valores: meses.map(() => 0), estavel: false, fim: '' });
    return series.get(c)!;
  };
  let estavel = 0;
  for (const l of entradas) {
    const mes = mesPrevisto(l);
    const i = idx.get(mes);
    if (i === undefined) continue;
    const s = serie(nomeSerie(l.cliente || '(sem cliente)'));
    s.valores[i] += n(l.valor);
    if (mes > s.fim) s.fim = mes;
    if (mes === ultimo && ehEstavel(l, mesDepois)) {
      s.valores[meses.length - 1] += n(l.valor);
      s.estavel = true;
      estavel += n(l.valor);
    }
  }
  for (const s of series.values()) if (s.estavel) s.fim = '';
  const ordenadas = [...series.values()].sort(
    (a, b) => Number(b.estavel) - Number(a.estavel) || (b.fim || '9999').localeCompare(a.fim || '9999') || a.slot - b.slot,
  );
  const totais = meses.map((_, i) => ordenadas.reduce((s, x) => s + x.valores[i], 0));
  return { meses, mesDepois, series: ordenadas, estavel, totais };
}

/* ---------------------------------------------------------- 3 · reserva acumulada */

export interface PontoReserva { mes: string; guardado: number | null; programado: number }
export interface ReservaAcumulada {
  pontos: PontoReserva[];
  base: number;             // saldo de partida (posição de investimento marcada reserva)
  baseEm: string;           // data dessa posição; '' = não há saldo de partida no razão
  piso: number;
  cruzaPisoEm: string;      // primeiro mês em que o programado alcança o piso ('' = não alcança)
}

/**
 * Acumulado da reserva. A base é a soma das últimas posições de investimento com
 * `reserva: true`; sem nenhuma, a base é zero e `baseEm` fica vazio (o gráfico avisa).
 * Aportes contam a partir do mês seguinte à base, para não somar duas vezes.
 * `guardado` = só o que foi marcado pago (até o mês de hoje); `programado` = pago + aberto.
 */
export function reservaAcumulada(ls: Lancamento[], hojeMes: string, piso = 5000): ReservaAcumulada {
  const inv = investimentos(ls);
  const daReserva = inv.atuais.filter((p) => p.reserva);
  const base = daReserva.reduce((s, p) => s + p.valor, 0);
  const baseEm = daReserva.map((p) => p.data).sort().pop() || '';
  const baseMes = baseEm.slice(0, 7);

  const meses = mesesDoRazao(ls);
  const aportes = ls.filter((l) => l.tipo === 'reserva' && !(aberto(l) && l.semPrazo));
  let g = base, p = base;
  let cruzaPisoEm = '';
  const pontos: PontoReserva[] = [];
  for (const mes of meses) {
    if (!baseMes || mes > baseMes) {
      for (const l of aportes) {
        if (liquidado(l) && mesRealizado(l) === mes) { g += n(l.valor); p += n(l.valor); }
        else if (aberto(l) && mesPrevisto(l) === mes) p += n(l.valor);
      }
    }
    pontos.push({ mes, guardado: mes <= hojeMes ? g : null, programado: p });
    if (!cruzaPisoEm && p >= piso) cruzaPisoEm = mes;
  }
  return { pontos, base, baseEm, piso, cruzaPisoEm };
}

/* ------------------------------------------------------- 4 · a receber vencido */

export interface VencidoCliente {
  cliente: string;
  total: number;
  diasMax: number;
  itens: { descricao: string; valor: number; vencimento: string; dias: number }[];
}

export function diasEntre(de: string, ate: string): number {
  const a = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  const b = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** Entrada aberta com vencimento antes de hoje. Sem data não é atraso, é indefinição. */
export function aReceberVencido(ls: Lancamento[], hoje: string): VencidoCliente[] {
  const m = new Map<string, VencidoCliente>();
  for (const l of ls) {
    if (l.tipo !== 'entrada' || l.status !== 'a-receber' || !l.vencimento || l.vencimento >= hoje) continue;
    const c = l.cliente || '(sem cliente)';
    const cur = m.get(c) || { cliente: c, total: 0, diasMax: 0, itens: [] };
    const dias = diasEntre(l.vencimento.slice(0, 10), hoje);
    cur.total += n(l.valor);
    cur.diasMax = Math.max(cur.diasMax, dias);
    cur.itens.push({ descricao: l.descricao, valor: n(l.valor), vencimento: l.vencimento, dias });
    m.set(c, cur);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.diasMax - a.diasMax);
}

/* ------------------------------------------------------- 5 · cartão no futuro */

/**
 * Confiança do valor: campo `confianca` quando existe; senão, lida da obs do jeito que o
 * razão de 2026 escreve ("MEDIDO no banco", "EXTRAPOLADO, nao medido", "NAO MEDIDO ... estimativa").
 * A ordem importa: a obs do extrapolado também diz "nao medido".
 */
export function confiancaDe(l: Lancamento): ConfiancaValor {
  if (l.confianca === 'medido' || l.confianca === 'extrapolado' || l.confianca === 'estimado') return l.confianca;
  const o = (l.obs || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/EXTRAPOLAD/.test(o)) return 'extrapolado';
  if (/NAO MEDIDO|ESTIMATIVA|ESTIMAD/.test(o)) return 'estimado';
  if (/MEDIDO/.test(o)) return 'medido';
  return 'estimado';
}

export const ehCartao = (l: Lancamento) =>
  l.tipo === 'saida' && ((l.categoria || '').toLowerCase() === 'cartao' || (l.categoria || '').toLowerCase() === 'cartão');

export interface MesCartao { mes: string; valor: number; confianca: ConfiancaValor; aberto: boolean }

/** Faturas do cartão do mês de hoje em diante, com a confiança de cada uma. */
export function cartaoFuturo(ls: Lancamento[], hojeMes: string): MesCartao[] {
  const m = new Map<string, MesCartao>();
  const ordem: Record<ConfiancaValor, number> = { medido: 0, extrapolado: 1, estimado: 2 };
  for (const l of ls) {
    if (!ehCartao(l)) continue;
    const mes = mesPrevisto(l);
    if (!mes || mes < hojeMes) continue;
    const c = confiancaDe(l);
    const cur = m.get(mes) || { mes, valor: 0, confianca: c, aberto: false };
    cur.valor += n(l.valor);
    if (ordem[c] > ordem[cur.confianca]) cur.confianca = c; // o mês vale o seu item menos confiável
    cur.aberto = cur.aberto || aberto(l);
    m.set(mes, cur);
  }
  return [...m.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

/* ------------------------------------------------------------ 6 · investimentos */

export interface Posicao {
  chave: string;           // instituição + descrição: identifica a aplicação no tempo
  instituicao: string;
  descricao: string;
  liquidez: string;
  valor: number;           // saldo na data
  data: string;            // AAAA-MM-DD da posição
  reserva: boolean;
}
export interface Investimentos {
  atuais: Posicao[];                                       // última posição de cada aplicação
  total: number;
  diaria: number;                                          // liquidez diária (o que sai no mesmo dia)
  serie: { mes: string; diaria: number; prazo: number }[]; // patrimônio mês a mês
}

/** Posições de investimento (`tipo: "investimento"`). Formato em docs/financeiro-formato.md. */
export function investimentos(ls: Lancamento[]): Investimentos {
  const pos: Posicao[] = ls
    .filter((l) => l.tipo === 'investimento')
    .map((l) => ({
      chave: `${l.instituicao || ''}·${l.descricao}`,
      instituicao: l.instituicao || '',
      descricao: l.descricao,
      liquidez: l.liquidez || '',
      valor: n(l.valor),
      data: (l.data || l.vencimento || l.mes || '').slice(0, 10),
      reserva: !!l.reserva,
    }))
    .filter((p) => p.data)
    .sort((a, b) => a.data.localeCompare(b.data));
  const ultima = new Map<string, Posicao>();
  for (const p of pos) ultima.set(p.chave, p);
  const atuais = [...ultima.values()];
  const total = atuais.reduce((s, p) => s + p.valor, 0);
  const diaria = atuais.filter((p) => p.liquidez === 'diaria').reduce((s, p) => s + p.valor, 0);

  const serie: Investimentos['serie'] = [];
  if (pos.length) {
    const meses = intervaloMeses(pos[0].data.slice(0, 7), pos[pos.length - 1].data.slice(0, 7));
    const vigente = new Map<string, Posicao>();
    let i = 0;
    for (const mes of meses) {
      while (i < pos.length && pos[i].data.slice(0, 7) <= mes) { vigente.set(pos[i].chave, pos[i]); i++; }
      let d = 0, pz = 0;
      for (const p of vigente.values()) if (p.liquidez === 'diaria') d += p.valor; else pz += p.valor;
      serie.push({ mes, diaria: d, prazo: pz });
    }
  }
  return { atuais, total, diaria, serie };
}
