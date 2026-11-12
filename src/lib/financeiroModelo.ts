// Modelo das páginas da Métis v2 (Visão, Gastos, Entradas, Patrimônio, Pronoia, Plano):
// o mês num relance, natureza do gasto por mês, categorias × teto do orçamento, entradas por
// cliente, linha do tempo dos contratos de renda e o plano da reserva. Só lógica pura, testada em
// financeiroModelo.test.ts com dados inventados. Nada é inventado aqui: sem teto definido a linha
// diz "sem teto" (null), sem mês completo a estimativa diz "nenhum".
import type { Lancamento } from '../types';
import { mesPrevisto, mesRealizado, somarMes } from './financeiroGraficos.ts';
import {
  categoriaDe, ehGasto, entradaRecorrente, mediana, mesesCompletos, mesesParciais, naturezaDe, naturezaDoMes,
  NATUREZA_POR_CATEGORIA, NATUREZAS, type Natureza,
} from './financeiroAnalise.ts';

const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;
const liquidado = (l: Lancamento) => l.status === 'recebido' || l.status === 'pago';
const aberto = (l: Lancamento) => l.status === 'a-receber' || l.status === 'a-pagar';
export const PISO_RESERVA = 5000;

/* ------------------------------------------------------------ meses do seletor */

/**
 * Meses que o seletor oferece: do primeiro mês com dinheiro mexendo (gasto ou entrada liquidada)
 * até o mês de hoje, no máximo os últimos `max`. `parciais` = mês incompleto (banco começou no
 * meio, ou o mês de hoje).
 */
export function mesesDoSeletor(ls: Lancamento[], hojeMes: string, max = 12): { meses: string[]; parciais: string[] } {
  const usados = ls.filter((l) => (ehGasto(l) || (l.tipo === 'entrada' && liquidado(l)))).map(mesRealizado).filter((m) => m && m <= hojeMes).sort();
  const de = usados[0] && usados[0] > somarMes(hojeMes, -(max - 1)) ? usados[0] : somarMes(hojeMes, -(max - 1));
  const meses: string[] = [];
  for (let m = usados.length ? de : hojeMes; m <= hojeMes; m = somarMes(m, 1)) meses.push(m);
  const p = mesesParciais(ls, hojeMes);
  return { meses, parciais: meses.filter((m) => p.has(m)) };
}

/** Mês em foco por padrão: o último fechado; se ainda não há nenhum, o de hoje. */
export function focoPadrao(ls: Lancamento[], hojeMes: string): string {
  const { meses } = mesesDoSeletor(ls, hojeMes);
  const anterior = somarMes(hojeMes, -1);
  return meses.includes(anterior) ? anterior : hojeMes;
}

/**
 * Com que mês comparar `mes`: o anterior, se for completo; senão o último mês COMPLETO antes dele
 * (até 12 para trás); '' se não houver nenhum. Mês parcial (banco começou no meio, mês de hoje,
 * meses antes do banco) nunca é comparação: o número dele parece um mês normal e engana.
 */
export function mesDeComparacao(ls: Lancamento[], hojeMes: string, mes: string): { mes: string; anteriorParcial: boolean } {
  const parciais = mesesParciais(ls, hojeMes);
  const anterior = somarMes(mes, -1);
  for (let m = anterior; m >= somarMes(mes, -12); m = somarMes(m, -1)) if (!parciais.has(m)) return { mes: m, anteriorParcial: m !== anterior };
  return { mes: '', anteriorParcial: parciais.has(anterior) };
}

/* ------------------------------------------------------------ visão do mês */

export interface VisaoMes {
  mes: string;
  entrou: number;      // entrada liquidada no mês
  saiu: number;        // gasto do mês (saída paga + compra no cartão; a fatura paga não)
  guardado: number;    // reserva liquidada no mês (não é gasto)
  sobrou: number;      // entrou − saiu (antes de guardar)
  natureza: Record<Natureza, number> & { total: number };
}

export function visaoDoMes(ls: Lancamento[], mes: string): VisaoMes {
  let entrou = 0, guardado = 0;
  for (const l of ls) {
    if (!liquidado(l) || mesRealizado(l) !== mes) continue;
    if (l.tipo === 'entrada') entrou += n(l.valor);
    if (l.tipo === 'reserva') guardado += n(l.valor);
  }
  const natureza = naturezaDoMes(ls, mes);
  return { mes, entrou: r2(entrou), saiu: natureza.total, guardado: r2(guardado), sobrou: r2(entrou - natureza.total), natureza };
}

/* ------------------------------------------------------------ avisos */

/** Ordem de importância dos avisos: a Visão mostra só o primeiro; o resto fica em "Mais opções". */
export const PRIORIDADE_AVISO = ['sync-falhou', 'conexao-vencida', 'conexao-erro', 'fatura', 'conexao-renovar', 'sync-parada', 'a-classificar'];
export function ordenarAvisos<T extends { chave: string }>(xs: T[]): T[] {
  const p = (k: string) => { const i = PRIORIDADE_AVISO.indexOf(k); return i < 0 ? 99 : i; };
  return [...xs].sort((a, b) => p(a.chave) - p(b.chave));
}

/* ------------------------------------------------------------ natureza por mês */

export interface NaturezaPorMes {
  meses: string[];
  parciais: string[];
  linhas: (Record<Natureza, number> & { total: number })[];
}

/** Fixo, variável e pontual dos últimos `nMeses` até o mês de hoje (só meses com dado). */
export function naturezaPorMes(ls: Lancamento[], hojeMes: string, nMeses = 6): NaturezaPorMes {
  const { meses: todos, parciais } = mesesDoSeletor(ls, hojeMes, nMeses);
  const linhas = todos.map((m) => naturezaDoMes(ls, m));
  return { meses: todos, parciais, linhas };
}

/* ------------------------------------------------------------ categorias do mês */

export interface CategoriaMes {
  categoria: string;
  total: number;
  porNatureza: Record<Natureza, number>;
  natureza: Natureza;          // a natureza que mais pesa na categoria neste mês
  anterior: number;            // o mesmo no mês de comparação (o anterior, por padrão)
  teto: number | null;         // null = sem teto definido
  acima: number;               // quanto passou do teto (0 = dentro ou sem teto)
}

export function categoriasDoMes(ls: Lancamento[], mes: string, tetos?: Record<string, number> | null, comAnterior = false, contra = somarMes(mes, -1)): CategoriaMes[] {
  const ant = contra;
  const m = new Map<string, CategoriaMes>();
  const linha = (c: string) => {
    if (!m.has(c)) m.set(c, { categoria: c, total: 0, porNatureza: { fixo: 0, variavel: 0, pontual: 0 }, natureza: NATUREZA_POR_CATEGORIA[c] || 'variavel', anterior: 0, teto: null, acima: 0 });
    return m.get(c)!;
  };
  for (const l of ls) {
    if (!ehGasto(l)) continue;
    const mr = mesRealizado(l);
    if (mr === mes) { const x = linha(categoriaDe(l)); x.total += n(l.valor); x.porNatureza[naturezaDe(l)] += n(l.valor); }
    else if (mr === ant) linha(categoriaDe(l)).anterior += n(l.valor);
  }
  for (const [c, v] of Object.entries(tetos || {})) if (v > 0) linha(c).teto = v;
  for (const x of m.values()) {
    x.total = r2(x.total); x.anterior = r2(x.anterior);
    for (const k of NATUREZAS) x.porNatureza[k] = r2(x.porNatureza[k]);
    if (x.total > 0) x.natureza = NATUREZAS.reduce((a, k) => (x.porNatureza[k] > x.porNatureza[a] ? k : a), NATUREZAS[0]);
    x.acima = x.teto !== null && x.total > x.teto ? r2(x.total - x.teto) : 0;
  }
  return [...m.values()]
    .filter((x) => x.total > 0 || x.teto !== null || (comAnterior && x.anterior > 0))
    .sort((a, b) => b.total - a.total || (b.teto || 0) - (a.teto || 0) || a.categoria.localeCompare(b.categoria));
}

/** O que mudou de um mês para o outro (`contra`, por padrão o anterior), por categoria (maior diferença primeiro). */
export function comparacaoCategorias(ls: Lancamento[], mes: string, contra = somarMes(mes, -1)): { categoria: string; atual: number; anterior: number; delta: number }[] {
  return categoriasDoMes(ls, mes, null, true, contra)
    .filter((c) => c.total > 0 || c.anterior > 0)
    .map((c) => ({ categoria: c.categoria, atual: c.total, anterior: c.anterior, delta: r2(c.total - c.anterior) }))
    .filter((c) => c.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.categoria.localeCompare(b.categoria));
}

/** A lista do mês agrupada: natureza → categoria → lançamentos. */
export function gastosAgrupados(ls: Lancamento[], mes: string): { natureza: Natureza; total: number; categorias: { categoria: string; total: number; itens: Lancamento[] }[] }[] {
  const por = new Map<Natureza, Map<string, Lancamento[]>>();
  for (const l of ls) {
    if (!ehGasto(l) || mesRealizado(l) !== mes) continue;
    const nat = naturezaDe(l);
    if (!por.has(nat)) por.set(nat, new Map());
    const c = por.get(nat)!;
    const k = categoriaDe(l);
    if (!c.has(k)) c.set(k, []);
    c.get(k)!.push(l);
  }
  return NATUREZAS.filter((k) => por.has(k)).map((natureza) => {
    const categorias = [...por.get(natureza)!.entries()].map(([categoria, itens]) => ({
      categoria,
      total: r2(itens.reduce((s, l) => s + n(l.valor), 0)),
      itens: itens.sort((a, b) => String(a.liquidadoEm || a.vencimento).localeCompare(String(b.liquidadoEm || b.vencimento))),
    })).sort((a, b) => b.total - a.total);
    return { natureza, total: r2(categorias.reduce((s, c) => s + c.total, 0)), categorias };
  });
}

/* ------------------------------------------------------------ orçamento */

export interface LinhaOrcamento { categoria: string; teto: number | null; gasto: number; natureza: Natureza; situacao: 'acima' | 'perto' | 'dentro' | 'sem-teto' }

/** Teto × gasto por categoria no mês. "perto" = 90% do teto ou mais. */
export function orcamentoDoMes(ls: Lancamento[], mes: string, tetos?: Record<string, number> | null) {
  const linhas: LinhaOrcamento[] = categoriasDoMes(ls, mes, tetos).map((c) => ({
    categoria: c.categoria, teto: c.teto, gasto: c.total, natureza: c.natureza,
    situacao: c.teto === null ? 'sem-teto' : c.total > c.teto ? 'acima' : c.total >= 0.9 * c.teto ? 'perto' : 'dentro',
  }));
  const comTeto = linhas.filter((l) => l.teto !== null);
  return {
    linhas,
    temTeto: comTeto.length > 0,
    tetoTotal: r2(comTeto.reduce((s, l) => s + (l.teto || 0), 0)),
    gastoComTeto: r2(comTeto.reduce((s, l) => s + l.gasto, 0)),
    acima: linhas.filter((l) => l.situacao === 'acima').length,
  };
}

/**
 * Categorias para o formulário de tetos: as que tiveram gasto nos meses completos (ou no de hoje)
 * e as que já têm teto, com a mediana dos meses completos como referência (texto de apoio: o
 * campo nasce vazio, o teto é decisão do Pedro).
 */
export function categoriasParaTeto(ls: Lancamento[], hojeMes: string, tetos?: Record<string, number> | null) {
  const meses = mesesCompletos(ls, hojeMes);
  const usar = meses.length ? meses : [hojeMes];
  const por = new Map<string, Map<string, number>>();
  for (const l of ls) {
    if (!ehGasto(l) || naturezaDe(l) === 'pontual') continue;
    const m = mesRealizado(l);
    if (!usar.includes(m)) continue;
    const c = categoriaDe(l);
    if (!por.has(c)) por.set(c, new Map());
    por.get(c)!.set(m, (por.get(c)!.get(m) || 0) + n(l.valor));
  }
  for (const c of Object.keys(tetos || {})) if (!por.has(c)) por.set(c, new Map());
  return [...por.entries()].map(([categoria, vm]) => ({
    categoria,
    natureza: NATUREZA_POR_CATEGORIA[categoria] || 'variavel' as Natureza,
    referencia: r2(mediana(usar.map((m) => vm.get(m) || 0))),
    meses: usar.length,
    teto: tetos && tetos[categoria] > 0 ? tetos[categoria] : null,
  })).sort((a, b) => b.referencia - a.referencia || a.categoria.localeCompare(b.categoria));
}

/* ------------------------------------------------------------ entradas */

export interface EntradaCliente { cliente: string; previsto: number; recebido: number; falta: number; itens: Lancamento[] }

/**
 * Entradas previstas para o mês (pelo vencimento), por cliente: quanto já entrou e quanto falta.
 * Sem cliente vira "Sem cliente" (rendimento, Pix avulso). Sem prazo aberto fica fora.
 */
export function entradasPorCliente(ls: Lancamento[], mes: string): EntradaCliente[] {
  const m = new Map<string, EntradaCliente>();
  for (const l of ls) {
    if (l.tipo !== 'entrada' || (aberto(l) && l.semPrazo) || !(aberto(l) || liquidado(l))) continue;
    if (mesPrevisto(l) !== mes) continue;
    const k = (l.cliente || '').trim() || 'Sem cliente';
    const c = m.get(k) || { cliente: k, previsto: 0, recebido: 0, falta: 0, itens: [] };
    c.previsto += n(l.valor);
    if (liquidado(l)) c.recebido += n(l.valor); else c.falta += n(l.valor);
    c.itens.push(l);
    m.set(k, c);
  }
  return [...m.values()].map((c) => ({ ...c, previsto: r2(c.previsto), recebido: r2(c.recebido), falta: r2(c.falta) }))
    .sort((a, b) => b.previsto - a.previsto || a.cliente.localeCompare(b.cliente));
}

const normSerie = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\d+\s*\/\s*\d+/g, '').replace(/[^a-z]+/g, ' ').trim();

export interface Contrato {
  chave: string;
  cliente: string;
  rotulo: string;              // descrição sem o "k/n"
  inicio: string;              // primeiro mês previsto
  fim: string;                 // último mês previsto (ou o `ate`)
  semFim: boolean;             // recorrente sem `ate`: segue depois do razão
  valor: number;               // valor do mês de hoje (ou do último mês lançado)
}

/** Linha do tempo da renda que se repete: um contrato por cliente + série, com início e fim. */
export function contratosDeRenda(ls: Lancamento[], hojeMes: string): Contrato[] {
  const m = new Map<string, Lancamento[]>();
  for (const l of ls) {
    if (!entradaRecorrente(l, ls) || (aberto(l) && l.semPrazo)) continue;
    const k = `${l.cliente || ''}|${normSerie(l.descricao || '')}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(l);
  }
  const out: Contrato[] = [];
  for (const [chave, itens] of m) {
    const meses = itens.map(mesPrevisto).filter(Boolean).sort();
    const fimLanc = meses[meses.length - 1];
    if (!fimLanc) continue;
    const ate = itens.map((l) => l.ate || '').filter(Boolean).sort().pop() || '';
    const semFim = itens.some((l) => l.recorrente && !l.ate);
    const doMes = itens.filter((l) => mesPrevisto(l) === hojeMes);
    const ref = doMes.length ? doMes : itens.filter((l) => mesPrevisto(l) === fimLanc);
    const fim = ate && ate > fimLanc ? ate : fimLanc;
    if (!semFim && fim < hojeMes) continue; // acabou: não é renda que se repete daqui pra frente
    out.push({
      chave, cliente: itens[0].cliente || 'Sem cliente', rotulo: (itens[0].descricao || '').replace(/\s*\b\d{1,2}\s*\/\s*\d{1,2}\b/, '').trim(),
      inicio: meses[0], fim, semFim, valor: r2(ref.reduce((s, l) => s + n(l.valor), 0)),
    });
  }
  return out.sort((a, b) => Number(a.semFim) - Number(b.semFim) || a.fim.localeCompare(b.fim) || b.valor - a.valor);
}

/* ------------------------------------------------------------ plano da reserva */

export interface PlanoReserva {
  reserva: number;
  meta: number;
  falta: number;
  ritmo: number;               // aporte típico por mês (mediana dos meses completos com aporte pago)
  ritmoMeses: number;          // quantos meses entraram no ritmo
  chegaEm: string;             // mês em que bate a meta no ritmo ('' = já bateu ou sem ritmo)
  aporte: { mes: string; guardado: number; programado: number };
}

export function planoReserva(ls: Lancamento[], reserva: number, hojeMes: string, foco: string, meta = PISO_RESERVA): PlanoReserva {
  const doMes = (m: string, pago: boolean) => r2(ls.filter((l) => l.tipo === 'reserva' && (pago ? liquidado(l) && mesRealizado(l) === m : aberto(l) && !l.semPrazo && mesPrevisto(l) === m)).reduce((s, l) => s + n(l.valor), 0));
  const completos = [];
  for (let m = somarMes(hojeMes, -1); completos.length < 6 && m >= somarMes(hojeMes, -12); m = somarMes(m, -1)) if (doMes(m, true) > 0) completos.push(m);
  const ritmo = r2(mediana(completos.map((m) => doMes(m, true))));
  const falta = Math.max(0, r2(meta - reserva));
  const chegaEm = falta > 0 && ritmo > 0 ? somarMes(hojeMes, Math.ceil(falta / ritmo)) : '';
  const guardado = doMes(foco, true);
  return { reserva: r2(reserva), meta, falta, ritmo, ritmoMeses: completos.length, chegaEm, aporte: { mes: foco, guardado, programado: r2(guardado + doMes(foco, false)) } };
}

/* ------------------------------------------------------------ fluxo do dinheiro (Sankey) */

export type TipoNoFluxo = 'cliente' | 'saldo' | 'mes' | 'natureza' | 'reserva' | 'sobra' | 'categoria';
export interface NoFluxo { id: string; rotulo: string; valor: number; coluna: 0 | 1 | 2 | 3; tipo: TipoNoFluxo; natureza?: Natureza }
export interface LigacaoFluxo { de: string; para: string; valor: number }
export interface FluxoMes {
  mes: string;
  nos: NoFluxo[];
  ligacoes: LigacaoFluxo[];
  entrou: number;
  saiu: number;
  guardado: number;
  sobrou: number;   // entrou − saiu − guardado, quando positivo
  doSaldo: number;  // o que saiu além do que entrou (veio do saldo de antes)
}

/**
 * De onde veio e para onde foi o dinheiro do mês, em 4 colunas: clientes (e o saldo de antes,
 * quando o mês gastou mais do que entrou) → o mês → natureza, reserva e sobra → categorias.
 * Os dois lados fecham: o que chega no mês é o que sai dele. Categoria menor que `fatia` do gasto
 * vira "outras" dentro da sua natureza (sem isso o lado direito vira uma escada de fios).
 * Números das mesmas regras da Visão: entrada liquidada no mês, gasto de `naturezaDoMes`.
 */
export function fluxoDoMes(ls: Lancamento[], mes: string, fatia = 0.03): FluxoMes {
  const v = visaoDoMes(ls, mes);
  const nos: NoFluxo[] = [], ligacoes: LigacaoFluxo[] = [];
  const porCliente = new Map<string, number>();
  for (const l of ls) {
    if (l.tipo !== 'entrada' || !liquidado(l) || mesRealizado(l) !== mes) continue;
    const k = (l.cliente || '').trim() || 'Sem cliente';
    porCliente.set(k, (porCliente.get(k) || 0) + n(l.valor));
  }
  const doSaldo = Math.max(0, r2(v.saiu + v.guardado - v.entrou));
  const sobrou = Math.max(0, r2(v.entrou - v.saiu - v.guardado));
  const total = r2(v.entrou + doSaldo);
  if (total <= 0) return { mes, nos, ligacoes, entrou: v.entrou, saiu: v.saiu, guardado: v.guardado, sobrou, doSaldo };

  nos.push({ id: 'mes', rotulo: mes, valor: total, coluna: 1, tipo: 'mes' });
  for (const [c, val] of [...porCliente.entries()].sort((a, b) => b[1] - a[1])) {
    nos.push({ id: 'c:' + c, rotulo: c, valor: r2(val), coluna: 0, tipo: 'cliente' });
    ligacoes.push({ de: 'c:' + c, para: 'mes', valor: r2(val) });
  }
  if (doSaldo > 0) {
    nos.push({ id: 'saldo', rotulo: 'Do saldo de antes', valor: doSaldo, coluna: 0, tipo: 'saldo' });
    ligacoes.push({ de: 'saldo', para: 'mes', valor: doSaldo });
  }
  const cats = categoriasDoMes(ls, mes);
  for (const k of NATUREZAS) {
    const valNat = v.natureza[k];
    if (valNat <= 0) continue;
    nos.push({ id: 'n:' + k, rotulo: k, valor: valNat, coluna: 2, tipo: 'natureza', natureza: k });
    ligacoes.push({ de: 'mes', para: 'n:' + k, valor: valNat });
    let outras = 0;
    for (const c of [...cats].sort((a, b) => b.porNatureza[k] - a.porNatureza[k])) {
      const val = c.porNatureza[k];
      if (val <= 0) continue;
      if (val < fatia * v.saiu) { outras += val; continue; }
      const id = `g:${k}:${c.categoria}`;
      nos.push({ id, rotulo: c.categoria, valor: val, coluna: 3, tipo: 'categoria', natureza: k });
      ligacoes.push({ de: 'n:' + k, para: id, valor: val });
    }
    if (outras > 0) {
      const id = `g:${k}:outras`;
      nos.push({ id, rotulo: 'outras', valor: r2(outras), coluna: 3, tipo: 'categoria', natureza: k });
      ligacoes.push({ de: 'n:' + k, para: id, valor: r2(outras) });
    }
  }
  if (v.guardado > 0) {
    nos.push({ id: 'reserva', rotulo: 'Reserva', valor: v.guardado, coluna: 2, tipo: 'reserva' });
    ligacoes.push({ de: 'mes', para: 'reserva', valor: v.guardado });
  }
  if (sobrou > 0) {
    nos.push({ id: 'sobra', rotulo: 'Sobrou', valor: sobrou, coluna: 2, tipo: 'sobra' });
    ligacoes.push({ de: 'mes', para: 'sobra', valor: sobrou });
  }
  return { mes, nos, ligacoes, entrou: v.entrou, saiu: v.saiu, guardado: v.guardado, sobrou, doSaldo };
}
