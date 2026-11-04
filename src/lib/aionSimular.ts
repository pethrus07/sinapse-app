// Aion · simulação: "e se" e cenários bom/base/ruim em 1, 3 e 5 anos. Lógica pura, testada em
// aionSimular.test.ts (juros compostos, IR regressivo, desconto da inflação, faixa dos cenários).
//
// O que é (e o que não é): uma CONTA com premissas à vista, não previsão nem promessa de retorno.
//  - Renda fixa e reserva: CDI esperado = Selic do Focus para cada ano (mediana) + a diferença CDI ×
//    Selic medida hoje; × o % do CDI da aplicação (premissa). Cenário ruim/bom = Selic −/+ 1 ponto.
//  - Renda variável (FII, ação, cripto): sem prêmio de risco assumido, a base anual é o CDI esperado;
//    a faixa vem da volatilidade declarada (premissa editável): resultado = base × e^(±σ√t − σ²t/2),
//    o intervalo de ±1 desvio padrão (cerca de 2 em cada 3 resultados caem dentro, SE a volatilidade
//    for a declarada). Ruim e bom de todos os tipos juntos: supõe que tudo vai mal (ou bem) ao mesmo
//    tempo, então a faixa da carteira é mais larga que a real.
//  - Imposto pela regra geral (bloco 10 da trilha; conferir todo ano): renda fixa na tabela
//    regressiva por tempo de cada aporte (22,5% até 180 dias, 20% até 360, 17,5% até 720, 15% depois);
//    ação 15% do ganho se a venda do mês passar de R$ 20 mil (abaixo, isento); FII 20% do ganho na
//    venda da cota (conservador: aqui todo o ganho do FII paga, mas o rendimento mensal de FII é
//    isento para pessoa física, premissa `fiiParteIsenta`); cripto 15% do ganho se a venda do mês
//    passar de R$ 35 mil. Só conta o ganho daqui para a frente (o ganho que já existe não entra).
//  - Valor real: dividido pela inflação esperada (IPCA do Focus, mediana de cada ano).
import type { Mercado, TipoCarteira } from '../types';

export const HORIZONTES = [12, 36, 60] as const;
export type Cenario = 'ruim' | 'base' | 'bom';
export const CENARIOS: readonly Cenario[] = ['ruim', 'base', 'bom'];
const RF: readonly TipoCarteira[] = ['reserva', 'renda-fixa', 'outros'];

export interface Premissas {
  selicPorAno: Record<string, number>;     // % a.a., mediana do Focus (ou a meta de hoje repetida)
  ipcaPorAno: Record<string, number>;      // % a.a.
  spreadCdi: number;                        // CDI − Selic em pontos (medido; ex.: −0,10)
  deltaSelic: number;                       // cenário ruim/bom da renda fixa: ± pontos na Selic
  pctCdi: Partial<Record<TipoCarteira, number>>; // % do CDI que a aplicação paga
  volatilidade: Partial<Record<TipoCarteira, number>>; // σ anual em %
  fiiParteIsenta: number;                   // 0–1: quanto do ganho do FII é rendimento isento
  isencaoAcao: number;                      // R$ de venda no mês abaixo do qual a ação é isenta
  isencaoCripto: number;
  origem: { selic: string; ipca: string };  // de onde vieram (texto para a tela)
}

export const PREMISSAS_PADRAO = {
  deltaSelic: 1,
  pctCdi: { reserva: 100, 'renda-fixa': 100, outros: 100 } as Partial<Record<TipoCarteira, number>>,
  volatilidade: { fii: 15, acao: 25, cripto: 60 } as Partial<Record<TipoCarteira, number>>,
  fiiParteIsenta: 0,
  isencaoAcao: 20000,
  isencaoCripto: 35000,
};

/** Premissas a partir do mercado (Focus, Selic e CDI de hoje). Ano sem Focus repete o último ano conhecido. */
export function premissasDoMercado(m: Mercado | null, anoHoje: number, anos = 6): Premissas {
  const f = m?.focus?.medianas || {};
  const selicHoje = m?.bcb?.selicMeta?.valor ?? null;
  const cdiHoje = m?.bcb?.cdi?.valor ?? null;
  const ipca12 = m?.bcb?.ipca?.doze ?? null;
  const selicPorAno: Record<string, number> = {};
  const ipcaPorAno: Record<string, number> = {};
  let s = f.Selic?.[String(anoHoje)] ?? selicHoje ?? 0;
  let i = f.IPCA?.[String(anoHoje)] ?? ipca12 ?? 0;
  for (let k = 0; k < anos; k++) {
    const a = String(anoHoje + k);
    s = f.Selic?.[a] ?? s; i = f.IPCA?.[a] ?? i;
    selicPorAno[a] = s; ipcaPorAno[a] = i;
  }
  return {
    ...PREMISSAS_PADRAO, pctCdi: { ...PREMISSAS_PADRAO.pctCdi }, volatilidade: { ...PREMISSAS_PADRAO.volatilidade },
    selicPorAno, ipcaPorAno,
    spreadCdi: selicHoje !== null && cdiHoje !== null ? Math.round((cdiHoje - selicHoje) * 100) / 100 : -0.1,
    origem: {
      selic: f.Selic ? `mediana do Focus de ${m?.focus?.data} para cada ano` : selicHoje !== null ? `Selic meta de hoje (${selicHoje}%) repetida: sem Focus` : 'sem dado de juros: 0%',
      ipca: f.IPCA ? `mediana do Focus de ${m?.focus?.data} para cada ano` : ipca12 !== null ? `IPCA dos últimos 12 meses (${ipca12}%) repetido: sem Focus` : 'sem dado de inflação: 0%',
    },
  };
}

/** Alíquota de IR da renda fixa pelo tempo da aplicação (tabela regressiva, dias corridos). */
export function aliquotaRendaFixa(dias: number): number {
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.2;
  if (dias <= 720) return 0.175;
  return 0.15;
}

const anoDoMes = (anoHoje: number, mesHoje: number, k: number) => String(anoHoje + Math.floor((mesHoje - 1 + k) / 12));
const taxaMes = (pctAno: number) => Math.pow(1 + pctAno / 100, 1 / 12) - 1;

/** Fator do CDI esperado do mês k0 ao k1 (meses a partir de hoje), × `pct` do CDI, no cenário. */
export function fatorCdi(p: Premissas, pct: number, c: Cenario, k0: number, k1: number, anoHoje: number, mesHoje: number): number {
  const d = c === 'ruim' ? -p.deltaSelic : c === 'bom' ? p.deltaSelic : 0;
  let f = 1;
  for (let k = k0; k < k1; k++) {
    const selic = p.selicPorAno[anoDoMes(anoHoje, mesHoje, k)] ?? 0;
    f *= 1 + taxaMes(Math.max(0, selic + p.spreadCdi + d) * (pct / 100));
  }
  return f;
}

/** Fator de crescimento da renda fixa (o % do CDI do tipo) do mês k0 ao k1, no cenário. */
export function fatorRendaFixa(p: Premissas, tipo: TipoCarteira, c: Cenario, k0: number, k1: number, anoHoje: number, mesHoje: number): number {
  return fatorCdi(p, p.pctCdi[tipo] ?? 100, c, k0, k1, anoHoje, mesHoje);
}

/** Fator da renda variável em `anos`, cenário = z de −1, 0 ou +1 desvio padrão (lognormal). */
export function fatorVariavel(baseAno: number, sigmaAno: number, anos: number, c: Cenario): number {
  if (anos <= 0) return 1;
  const s = sigmaAno / 100;
  const mu = Math.log(1 + baseAno / 100) - (s * s) / 2;
  const z = c === 'ruim' ? -1 : c === 'bom' ? 1 : 0;
  return Math.exp(mu * anos + z * s * Math.sqrt(anos));
}

/** Inflação acumulada do mês 0 ao k (fator). */
export function fatorInflacao(p: Premissas, k: number, anoHoje: number, mesHoje: number): number {
  let f = 1;
  for (let j = 0; j < k; j++) f *= 1 + taxaMes(p.ipcaPorAno[anoDoMes(anoHoje, mesHoje, j)] ?? 0);
  return f;
}

/** CDI médio esperado (% a.a.) no horizonte, a base da renda variável (sem prêmio de risco assumido). */
export function cdiMedio(p: Premissas, meses: number, anoHoje: number, mesHoje: number) {
  return (Math.pow(fatorCdi(p, 100, 'base', 0, meses, anoHoje, mesHoje), 12 / meses) - 1) * 100;
}

export interface Evento { mes: number; tipo: TipoCarteira; valor: number; rotulo?: string } // valor > 0 aplica, < 0 resgata
export interface EntradaSimulacao {
  inicial: Partial<Record<TipoCarteira, number>>;
  aporteMensal: number;
  divisaoAporte: Partial<Record<TipoCarteira, number>>;   // % do aporte em cada tipo (soma 100)
  eventos: Evento[];
  meses: number;
  anoHoje: number;
  mesHoje: number;                                        // 1–12
}
export interface PontoSim { mes: number; bruto: number; ir: number; liquido: number; real: number; aplicado: number }
export interface Simulacao { cenarios: Record<Cenario, PontoSim[]>; horizontes: Record<number, Record<Cenario, PontoSim>>; premissas: Premissas }

interface Lote { k: number; tipo: TipoCarteira; principal: number }

/** Os lotes (o inicial, cada aporte e cada evento), com resgate proporcional ao que havia do tipo. */
function lotesAte(e: EntradaSimulacao, p: Premissas, c: Cenario, ate: number): Lote[] {
  const lotes: Lote[] = [];
  for (const [t, v] of Object.entries(e.inicial)) if ((v || 0) > 0) lotes.push({ k: 0, tipo: t as TipoCarteira, principal: v! });
  for (let k = 0; k < ate; k++) {
    if (e.aporteMensal > 0) for (const [t, pct] of Object.entries(e.divisaoAporte)) if ((pct || 0) > 0) lotes.push({ k: k + 1, tipo: t as TipoCarteira, principal: (e.aporteMensal * pct!) / 100 });
  }
  for (const ev of e.eventos.filter((x) => x.mes <= ate).sort((a, b) => a.mes - b.mes)) {
    if (ev.valor > 0) { lotes.push({ k: ev.mes, tipo: ev.tipo, principal: ev.valor }); continue; }
    // resgate: tira a mesma fração de cada lote do tipo que já existia naquele mês
    const doTipo = lotes.filter((l) => l.tipo === ev.tipo && l.k <= ev.mes);
    const valorNoMes = doTipo.reduce((s, l) => s + l.principal * fator(e, p, c, l, ev.mes), 0);
    const frac = valorNoMes > 0 ? Math.min(1, -ev.valor / valorNoMes) : 0;
    for (const l of doTipo) l.principal *= 1 - frac;
  }
  return lotes;
}

function fator(e: EntradaSimulacao, p: Premissas, c: Cenario, l: Lote, k: number): number {
  if (k <= l.k) return 1;
  if (RF.includes(l.tipo)) return fatorRendaFixa(p, l.tipo, c, l.k, k, e.anoHoje, e.mesHoje);
  const base = cdiMedio(p, Math.max(12, e.meses), e.anoHoje, e.mesHoje);
  return fatorVariavel(base, p.volatilidade[l.tipo] ?? 20, (k - l.k) / 12, c);
}

/** O retrato num mês k: bruto, imposto se resgatasse tudo naquele mês, líquido e real (em reais de hoje). */
export function retratoNoMes(e: EntradaSimulacao, p: Premissas, c: Cenario, k: number): PontoSim {
  const lotes = lotesAte(e, p, c, k);
  let bruto = 0, ir = 0, aplicado = 0;
  const ganhoPorTipo: Partial<Record<TipoCarteira, { valor: number; ganho: number }>> = {};
  for (const l of lotes) {
    const v = l.principal * fator(e, p, c, l, k);
    bruto += v; aplicado += l.principal;
    const g = v - l.principal;
    if (RF.includes(l.tipo)) { if (g > 0) ir += g * aliquotaRendaFixa((k - l.k) * 30); continue; }
    const t = ganhoPorTipo[l.tipo] || { valor: 0, ganho: 0 };
    t.valor += v; t.ganho += g;
    ganhoPorTipo[l.tipo] = t;
  }
  for (const [tipo, t] of Object.entries(ganhoPorTipo)) {
    if (!t || t.ganho <= 0) continue;
    if (tipo === 'acao' && t.valor > p.isencaoAcao) ir += 0.15 * t.ganho;
    if (tipo === 'cripto' && t.valor > p.isencaoCripto) ir += 0.15 * t.ganho;
    if (tipo === 'fii') ir += 0.2 * t.ganho * (1 - p.fiiParteIsenta);
  }
  const liquido = bruto - ir;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { mes: k, bruto: r(bruto), ir: r(ir), liquido: r(liquido), real: r(liquido / fatorInflacao(p, k, e.anoHoje, e.mesHoje)), aplicado: r(aplicado) };
}

/** A simulação inteira: a série mensal de cada cenário e os três horizontes. */
export function simular(e: EntradaSimulacao, p: Premissas, passo = 3): Simulacao {
  const cenarios = {} as Record<Cenario, PontoSim[]>;
  for (const c of CENARIOS) {
    const pts: PontoSim[] = [];
    for (let k = 0; k <= e.meses; k += passo) pts.push(retratoNoMes(e, p, c, k));
    if (pts[pts.length - 1].mes !== e.meses) pts.push(retratoNoMes(e, p, c, e.meses));
    cenarios[c] = pts;
  }
  const horizontes: Record<number, Record<Cenario, PontoSim>> = {};
  for (const h of HORIZONTES) if (h <= e.meses) horizontes[h] = Object.fromEntries(CENARIOS.map((c) => [c, retratoNoMes(e, p, c, h)])) as Record<Cenario, PontoSim>;
  return { cenarios, horizontes, premissas: p };
}

/**
 * Olhar para trás: R$ `porMes` aportados no começo de cada mês desde `deMes` no CDI (série mensal
 * 4391), quanto seriam no fim da série (bruto, sem IR), e quanto esses aportes valem corrigidos pelo
 * IPCA (433) até o último mês com IPCA: o ganho real é a diferença. null sem série que cubra.
 */
export function olharParaTras(cdi: { data: string; valor: number }[], ipca: { data: string; valor: number }[], porMes: number, deMes: string) {
  const cs = cdi.filter((p) => p.data.slice(0, 7) >= deMes);
  if (cs.length < 2) return null;
  const ipcaDe = new Map(ipca.map((p) => [p.data.slice(0, 7), p.valor]));
  let saldo = 0, aplicado = 0, corrigido = 0, mesesSemIpca = 0;
  for (const p of cs) {
    saldo = (saldo + porMes) * (1 + p.valor / 100);
    aplicado += porMes;
    const i = ipcaDe.get(p.data.slice(0, 7));
    if (i === undefined) mesesSemIpca++;
    corrigido = (corrigido + porMes) * (1 + (i ?? 0) / 100);
  }
  const r = (x: number) => Math.round(x * 100) / 100;
  return { meses: cs.length, de: cs[0].data.slice(0, 7), ate: cs[cs.length - 1].data.slice(0, 7), aplicado: r(aplicado), saldo: r(saldo), corrigido: r(corrigido), ganhoReal: r(saldo - corrigido), mesesSemIpca };
}
