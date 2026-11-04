// Aion · as SÉRIES dos gráficos (patrimônio, aportes, renda passiva, rendimento em base 100, juros e
// inflação, Focus semana a semana, preço com eventos, caminho das metas). Só lógica pura, testada em
// aionSeries.test.ts com dados inventados. Regra: com pouco dado, a série diz quanto tem ("1 mês de
// dado") em vez de esticar; nada de ponto inventado entre dois reais.
import type { Aion, Cotacao, Lancamento, Mercado, PontoSerie } from '../types';
import { posicoesAion, ritmoDeAporte, rendaPassivaPorMes, type Ritmo } from './aion.ts';
import { mesRealizado, somarMes } from './financeiroGraficos.ts';
import type { Porque } from './aionPorques.ts';

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const br = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const pct = (v: number, casas = 2) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
const dataDe = (l: Lancamento) => String(l.data || l.vencimento || l.mes || '').slice(0, 10);

/** O texto honesto para série curta: "1 mês de dado; o gráfico cresce com o tempo". '' com 3 ou mais. */
export function avisoPoucoDado(n: number, unidade: 'mês' | 'semana' | 'dia' = 'mês'): string {
  const plural = unidade === 'mês' ? 'meses' : unidade + 's';
  if (n <= 0) return `Ainda sem ${plural} de dado: o gráfico aparece quando o primeiro chegar.`;
  if (n < 3) return `${n} ${n === 1 ? unidade : plural} de dado; o gráfico cresce com o tempo.`;
  return '';
}

/* ------------------------------------------------------------ carteira mês a mês */

export interface MesPatrimonio { mes: string; data: string; reserva: number; resto: number; total: number }

/**
 * O patrimônio investido no fim de cada mês que tem retrato no razão (a sincronização grava uma
 * posição por aplicação por mês), dividido em reserva × resto. Mês sem retrato não entra (não se
 * inventa o meio). Cada mês usa as posições válidas até ele (a mesma regra da Carteira).
 */
export function patrimonioPorMes(ls: Lancamento[]): MesPatrimonio[] {
  const inv = ls.filter((l) => l.tipo === 'investimento' && dataDe(l));
  const meses = [...new Set(inv.map((l) => dataDe(l).slice(0, 7)))].sort();
  return meses.map((mes) => {
    const pos = posicoesAion(inv.filter((l) => dataDe(l).slice(0, 7) <= mes));
    const reserva = r2(pos.filter((p) => p.tipo === 'reserva').reduce((s, p) => s + p.valor, 0));
    const total = r2(pos.reduce((s, p) => s + p.valor, 0));
    return { mes, data: pos.map((p) => p.data).sort().pop() || `${mes}-01`, reserva, resto: r2(total - reserva), total };
  });
}

/** O primeiro mês com dinheiro mexendo no razão (para não desenhar meses vazios antes de tudo começar). */
export function primeiroMes(ls: Lancamento[]): string {
  const ms = ls.map((l) => (l.tipo === 'investimento' ? dataDe(l).slice(0, 7) : mesRealizado(l))).filter(Boolean).sort();
  return ms[0] || '';
}

export interface MesValor { mes: string; valor: number; andando?: boolean }

/** Aportes por mês: os meses fechados (como o ritmo conta) + o mês de hoje, marcado como "andando". */
export function aportesPorMes(ls: Lancamento[], hojeMes: string, k = 12): { meses: MesValor[]; ritmo: Ritmo } {
  const ritmo = ritmoDeAporte(ls, hojeMes, k);
  const meses: MesValor[] = ritmo.meses.map((m) => ({ ...m }));
  if (primeiroMes(ls) && primeiroMes(ls) <= hojeMes) meses.push({ mes: hojeMes, valor: ritmo.mesAtual, andando: true });
  return { meses, ritmo };
}

/** Renda passiva por mês, do primeiro mês do razão até hoje (o mês de hoje "andando"). */
export function rendaPassivaMeses(ls: Lancamento[], hojeMes: string, k = 12): MesValor[] {
  const ini = primeiroMes(ls);
  if (!ini) return [];
  return rendaPassivaPorMes(ls, hojeMes, k).filter((m) => m.mes >= ini).map((m) => ({ mes: m.mes, valor: m.total, ...(m.mes === hojeMes ? { andando: true } : {}) }));
}

/* ------------------------------------------------------------ rendimento em base 100 */

export interface PontoIndice { mes: string; carteira: number | null; cdi: number | null; ipca: number | null }
export interface Indexado { base: string; pontos: PontoIndice[]; mesesCarteira: number; aviso: string; explica: string }

/**
 * Carteira × CDI × IPCA na mesma base: 100 no primeiro mês com retrato do patrimônio. A carteira
 * anda pelo retorno do mês descontado o aporte: (valor do mês − aportes do mês) ÷ valor do mês
 * anterior. Assim aporte não vira rendimento. CDI e IPCA compõem a série mensal do BC a partir do mês
 * seguinte à base. Mês sem retrato fica sem ponto da carteira (o aporte dele soma no próximo); mês do
 * IPCA ainda não divulgado fica sem ponto do IPCA.
 */
export function rendimentoIndexado(pat: MesPatrimonio[], aportes: MesValor[], cdi: PontoSerie[], ipca: PontoSerie[], ateMes: string): Indexado {
  const vazio: Indexado = { base: '', pontos: [], mesesCarteira: 0, aviso: avisoPoucoDado(0), explica: 'Sem retrato do patrimônio no razão.' };
  const ps = pat.filter((p) => p.total > 0);
  if (!ps.length) return vazio;
  const base = ps[0].mes;
  const fim = [ateMes, ps[ps.length - 1].mes].sort().pop()!;
  const porMes = new Map(ps.map((p) => [p.mes, p]));
  const ap = new Map(aportes.map((a) => [a.mes, a.valor]));
  const taxa = (s: PontoSerie[]) => new Map(s.map((p) => [p.data.slice(0, 7), p.valor]));
  const tc = taxa(cdi), ti = taxa(ipca);
  const pontos: PontoIndice[] = [{ mes: base, carteira: 100, cdi: 100, ipca: 100 }];
  let ic = 100, iCdi: number | null = 100, iIpca: number | null = 100;
  let ultimoV = ps[0].total, acum = 0;
  for (let m = somarMes(base, 1); m <= fim; m = somarMes(m, 1)) {
    acum += ap.get(m) || 0;
    const p = porMes.get(m);
    let carteira: number | null = null;
    if (p) { ic = ic * ((p.total - acum) / ultimoV); ultimoV = p.total; acum = 0; carteira = r2(ic); }
    iCdi = iCdi !== null && tc.has(m) ? iCdi * (1 + tc.get(m)! / 100) : null;
    iIpca = iIpca !== null && ti.has(m) ? iIpca * (1 + ti.get(m)! / 100) : null;
    pontos.push({ mes: m, carteira, cdi: iCdi === null ? null : r2(iCdi), ipca: iIpca === null ? null : r2(iIpca) });
  }
  const n = ps.length;
  return {
    base, pontos, mesesCarteira: n, aviso: avisoPoucoDado(n),
    explica: `Base 100 em ${base.slice(5)}/${base.slice(0, 4)}, o primeiro retrato do patrimônio no razão. A carteira anda pelo valor de cada retrato menos o que foi aportado no mês; CDI (BC, SGS 4391) e IPCA (433) compõem mês a mês a partir do mês seguinte. O retrato é do dia da sincronização, não do último dia do mês: comparação aproximada.`,
  };
}

/* ------------------------------------------------------------ juros e inflação */

/** Acumulado em 12 meses, mês a mês, de uma série mensal em %. Começa no 12º mês. */
export function acumulado12(pontos: PontoSerie[]): PontoSerie[] {
  const out: PontoSerie[] = [];
  for (let i = 11; i < pontos.length; i++) {
    const f = pontos.slice(i - 11, i + 1).reduce((a, p) => a * (1 + p.valor / 100), 1);
    out.push({ data: pontos[i].data, valor: r2((f - 1) * 100) });
  }
  return out;
}

export interface SerieEco { id: 'selic' | 'cdi' | 'ipca'; rotulo: string; unidade: string; pontos: PontoSerie[]; fonte: { nome: string; url: string } }

/** Selic meta (fim de cada mês), CDI e IPCA acumulados em 12 meses: os três em % ao ano, comparáveis. */
export function serieEconomia(m: Mercado | null): SerieEco[] {
  const b = m?.bcb;
  const out: SerieEco[] = [];
  if (b?.selicMeta?.mensal?.length) out.push({ id: 'selic', rotulo: 'Selic meta', unidade: '% ao ano, no fim de cada mês', pontos: b.selicMeta.mensal, fonte: { nome: 'Banco Central, SGS 432', url: 'https://www3.bcb.gov.br/sgspub/' } });
  if (b?.cdiMensal?.pontos?.length) out.push({ id: 'cdi', rotulo: 'CDI', unidade: '% em 12 meses', pontos: acumulado12(b.cdiMensal.pontos), fonte: { nome: 'Banco Central, SGS 4391 (acumulado em 12 meses pelo Aion)', url: 'https://www3.bcb.gov.br/sgspub/' } });
  if (b?.ipca?.mensal?.length) out.push({ id: 'ipca', rotulo: 'IPCA', unidade: '% em 12 meses', pontos: acumulado12(b.ipca.mensal), fonte: { nome: 'IBGE, pela série 433 do BC (acumulado em 12 meses pelo Aion)', url: 'https://www.ibge.gov.br/explica/inflacao.php' } });
  return out.filter((s) => s.pontos.length);
}

/* ------------------------------------------------------------ preço com eventos */

export type TipoEvento = 'resultado' | 'fato-relevante' | 'data-com' | 'data-ex' | 'decisao-copom';
export const ROTULO_EVENTO: Record<TipoEvento, string> = { resultado: 'resultado', 'fato-relevante': 'fato relevante', 'data-com': 'data com', 'data-ex': 'data ex', 'decisao-copom': 'Copom' };
export interface Evento { data: string; tipo: TipoEvento; porque: Porque }

/** Variação do fechamento no dia (ou no primeiro pregão depois) em relação ao pregão anterior. */
export function variacaoNoDia(hist: { data: string; fechamento: number }[], dia: string): { data: string; pct: number } | null {
  const i = hist.findIndex((h) => h.data >= dia);
  if (i <= 0) return null;
  return { data: hist[i].data, pct: r2((hist[i].fechamento / hist[i - 1].fechamento - 1) * 100) };
}

/**
 * Os eventos de um ativo dentro do histórico de preço que existe: resultado do trimestre e fato
 * relevante (CVM), data com e data ex de provento (brapi) e decisões do Copom (BC). Cada um vira um
 * Porque com fonte, para o marcador do gráfico. A variação do preço naquele pregão vai junto, dita
 * como medida (não como prova de causa, salvo a data ex, cuja queda é a mecânica do provento).
 */
export function eventosDoAtivo(codigo: string, aion: Aion): Evento[] {
  const m = aion.mercado;
  const c: Cotacao | undefined = m?.cotacoes?.porCodigo?.[codigo] || m?.cripto?.porCodigo?.[codigo];
  const hist = c?.historico || [];
  if (!hist.length) return [];
  const de = hist[0].data, ate = hist[hist.length - 1].data;
  const dentro = (d: string) => d >= de && d <= ate;
  const mov = (d: string) => { const v = variacaoNoDia(hist, d); return v ? ` No pregão de ${br(v.data)} o preço ${v.pct >= 0 ? 'subiu' : 'caiu'} ${pct(Math.abs(v.pct))}.` : ''; };
  const out: Evento[] = [];
  for (const r of m?.cvm?.resultados || []) if (r.codigo === codigo && dentro(r.data)) out.push({
    data: r.data, tipo: 'resultado',
    porque: { id: `ev-res-${codigo}-${r.data}`, alvos: [codigo], data: r.data, fonteId: 'cvm', bloco: 6, tipo: 'fato', titulo: `${codigo}: resultado divulgado em ${br(r.data)} (${r.assunto})`, texto: `A companhia contou o resultado do trimestre.${mov(r.data)} Se o preço mexeu por isso, depende do que o mercado esperava: o Aion não tem a expectativa, então não afirma a causa.`, fonte: { nome: 'CVM, dados abertos (IPE, press-release)', url: r.url || 'https://dados.cvm.gov.br/dataset/cia_aberta-doc-ipe' } },
  });
  for (const f of m?.cvm?.fatos || []) if (f.codigo === codigo && dentro(f.data)) out.push({
    data: f.data, tipo: 'fato-relevante',
    porque: { id: `ev-fr-${codigo}-${f.data}-${f.assunto.slice(0, 12)}`, alvos: [codigo], data: f.data, fonteId: 'cvm', bloco: 6, tipo: 'fato', titulo: `${codigo}: fato relevante de ${br(f.data)}`, texto: `${f.assunto}.${mov(f.data)} Fato relevante é o que a empresa precisa contar porque pode mexer no preço; o tamanho do efeito, só a cotação diz.`, fonte: { nome: 'CVM, dados abertos (IPE)', url: f.url || 'https://dados.cvm.gov.br/dataset/cia_aberta-doc-ipe' } },
  });
  for (const p of c?.proventos || []) {
    const valor = p.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });
    const fonte = { nome: 'brapi.dev (proventos)', url: 'https://brapi.dev' };
    if (p.dataCom && dentro(p.dataCom)) out.push({ data: p.dataCom, tipo: 'data-com', porque: { id: `ev-com-${codigo}-${p.dataCom}-${p.tipo}`, alvos: [codigo], data: p.dataCom, fonteId: 'proventos', bloco: 6, tipo: 'fato', titulo: `${codigo}: data com de ${p.tipo.toLowerCase()} (${valor})`, texto: `Quem tinha o ativo no fim deste pregão ganhou o direito ao provento, pago em ${br(p.pagamento) || 'data a definir'}.`, fonte } });
    if (p.dataEx && dentro(p.dataEx)) out.push({ data: p.dataEx, tipo: 'data-ex', porque: { id: `ev-ex-${codigo}-${p.dataEx}-${p.tipo}`, alvos: [codigo], data: p.dataEx, fonteId: 'proventos', bloco: 6, tipo: 'causa', titulo: `${codigo}: data ex de ${p.tipo.toLowerCase()} (${valor})`, texto: `A cotação abre descontada mais ou menos do provento: queda perto de ${valor} neste dia é a mecânica, não notícia.${mov(p.dataEx)}`, fonte } });
  }
  for (const d of m?.copom?.decisoes || []) if (dentro(d.data)) out.push({
    data: d.data, tipo: 'decisao-copom',
    porque: { id: `ev-copom-${d.numero}-${codigo}`, alvos: [codigo], data: d.data, fonteId: 'copom', bloco: 2, tipo: 'fato', titulo: `${d.numero}ª reunião do Copom: ${d.titulo}`, texto: `A decisão sai à noite; o efeito aparece no pregão seguinte.${mov(somarDia(d.data, 1))} Juros mexem com a bolsa toda: para este ativo é contexto, não prova de causa.`, fonte: { nome: m!.copom!.fonte, url: m!.copom!.url } },
  });
  return out.sort((a, b) => a.data.localeCompare(b.data) || a.tipo.localeCompare(b.tipo));
}
const somarDia = (d: string, k: number) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);

/** Onde o preço de hoje está entre a mínima e a máxima de 52 semanas (0 a 1), ou null. */
export function posicaoNa52(c: Cotacao | null | undefined): number | null {
  if (!c || c.preco == null || c.min52 == null || c.max52 == null || c.max52 <= c.min52) return null;
  return Math.max(0, Math.min(1, (c.preco - c.min52) / (c.max52 - c.min52)));
}

/* ------------------------------------------------------------ caminho das metas */

export interface PontoCaminho { mes: string; base: number; baixo: number; alto: number }
export interface Caminho { id: 'reserva' | 'carteira'; alvo: number; realizado: MesValor[]; projecao: PontoCaminho[]; chega: { base: string; baixo: string; alto: string } }
export interface Caminhos { reserva: Caminho; carteira: Caminho; ritmo: number; baixo: number; alto: number; fraca: boolean; faixa: string }

/** Mês a mês da reserva e da carteira, aportando `r` por mês na ordem do Pedro (reserva até o alvo, depois a carteira). */
function projetar(res0: number, car0: number, r: number, alvoRes: number, taxaAno: number, meses: number) {
  const tm = Math.pow(1 + (taxaAno || 0) / 100, 1 / 12) - 1;
  let res = res0, car = car0;
  const out: { res: number; car: number }[] = [];
  for (let k = 1; k <= meses; k++) {
    res *= 1 + tm; car *= 1 + tm;
    let a = r;
    if (res < alvoRes) { const v = Math.min(a, alvoRes - res); res += v; a -= v; }
    car += a;
    out.push({ res: r2(res), car: r2(car) });
  }
  return out;
}

/**
 * O caminho até a reserva e a carteira: o que já foi (os retratos) e a projeção pelo ritmo real, com
 * faixa. Faixa: com estimativa fraca (menos de 3 meses fechados), de metade a uma vez e meia do ritmo;
 * com mais dado, o ritmo ± o desvio padrão dos meses. A meta 3 sem valor não tem caminho.
 */
export function caminhoDasMetas(pat: MesPatrimonio[], ritmo: Ritmo, alvos: { reserva: number; carteira: number }, atual: { reserva: number; fora: number }, taxaAno: number, hojeMes: string, meses = 60): Caminhos {
  const vals = ritmo.meses.map((m) => m.valor);
  const media = ritmo.ritmo;
  const dp = vals.length > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - media) ** 2, 0) / (vals.length - 1)) : 0;
  const baixo = ritmo.fraca ? media * 0.5 : Math.max(0, media - dp);
  const alto = ritmo.fraca ? media * 1.5 : media + dp;
  const [b, lo, hi] = [media, baixo, alto].map((r) => projetar(atual.reserva, atual.fora, r, alvos.reserva, taxaAno, meses));
  const quando = (serie: { res: number; car: number }[], campo: 'res' | 'car', alvo: number, agora: number) => {
    if (agora >= alvo) return hojeMes;
    const k = serie.findIndex((p) => p[campo] >= alvo - 0.005);
    return k < 0 ? '' : somarMes(hojeMes, k + 1);
  };
  const caminho = (id: 'reserva' | 'carteira', campo: 'res' | 'car', alvo: number, agora: number): Caminho => {
    const chega = { base: quando(b, campo, alvo, agora), baixo: quando(lo, campo, alvo, agora), alto: quando(hi, campo, alvo, agora) };
    // a projeção vai até a base chegar e mais 6 meses (ou até o fim do horizonte), para a faixa aparecer
    const kFim = chega.base ? Math.min(meses, Math.max(6, mesesEntre(hojeMes, chega.base) + 6)) : meses;
    const projecao: PontoCaminho[] = [{ mes: hojeMes, base: r2(agora), baixo: r2(agora), alto: r2(agora) }];
    for (let k = 0; k < kFim; k++) projecao.push({ mes: somarMes(hojeMes, k + 1), base: b[k][campo], baixo: lo[k][campo], alto: hi[k][campo] });
    const realizado = pat.map((p) => ({ mes: p.mes, valor: id === 'reserva' ? p.reserva : p.resto }));
    return { id, alvo, realizado, projecao, chega };
  };
  return {
    reserva: caminho('reserva', 'res', alvos.reserva, atual.reserva),
    carteira: caminho('carteira', 'car', alvos.carteira, atual.fora),
    ritmo: r2(media), baixo: r2(baixo), alto: r2(alto), fraca: ritmo.fraca,
    faixa: ritmo.fraca
      ? `Estimativa fraca (${ritmo.nMeses} ${ritmo.nMeses === 1 ? 'mês fechado' : 'meses fechados'}): a faixa vai de metade a uma vez e meia do ritmo.`
      : `A faixa é o ritmo ± o desvio padrão dos ${ritmo.nMeses} meses fechados (${r1(dp).toLocaleString('pt-BR')} por mês).`,
  };
}
export const mesesEntre = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
