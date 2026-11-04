// Aion · os PORQUÊS: por que um número, um tipo ou um ativo se mexeu, com fonte e data, separando
// o tipo de cada explicação. Lógica pura, testada em aionPorques.test.ts.
//
// Camada "fontes de porquê": cada fonte implementa a interface FontePorque e devolve porquês para
// alvos (ticker, 'selic', 'ipca', 'reserva'...). As de hoje usam só fonte permitida e o cache do
// coletor (Copom, IPCA, Focus, proventos da brapi, fatos relevantes da CVM, movimento do dia). A
// fonte de NOTÍCIA EM TEMPO REAL ainda não foi escolhida: ela entra como mais uma FontePorque
// (`ligada: true`, `tempoReal: true`) sem mudar as telas; até lá o pop-up diz que não há notícia ligada.
//
// Tipos de explicação (nunca misturar):
//   causa     causa conhecida, com fonte (o Copom mudou a Selic; a ação ficou ex-dividendo)
//   fato      dado oficial que ajuda a entender, sem dizer que é a causa (IPCA do mês, fato relevante)
//   opiniao   o que alguém disse, com o nome de quem (o comunicado do Copom, nas palavras dele)
//   estimativa expectativa de alguém (mediana do Focus)
//   hipotese  o Aion liga por proximidade, sem prova (moveu junto com...)
//   sem-noticia não há nada ligado que explique: dito com todas as letras
import type { Aion, Cotacao, Mercado, TipoCarteira } from '../types';

export type TipoPorque = 'causa' | 'fato' | 'opiniao' | 'estimativa' | 'hipotese' | 'sem-noticia';
export const ROTULO_PORQUE: Record<TipoPorque, string> = {
  causa: 'causa conhecida', fato: 'fato', opiniao: 'opinião', estimativa: 'estimativa', hipotese: 'hipótese', 'sem-noticia': 'sem notícia',
};

export interface Porque {
  id: string;
  alvos: string[];          // a que se refere: ticker (PETR4), tipo ('fii'), 'selic', 'cdi', 'ipca', 'dolar', 'focus', 'reserva', 'carteira'
  data: string;             // AAAA-MM-DD do fato (ou da coleta, para cotação)
  titulo: string;
  texto: string;
  tipo: TipoPorque;
  quem?: string;            // de quem é a opinião ou a estimativa
  fonte: { nome: string; url: string };
  bloco: number | null;     // bloco da trilha que explica o conceito
  fonteId: string;
  historico?: boolean;      // só na lista completa (Porquês), não no pop-up: ex.: decisões antigas do Copom
}

export interface ContextoPorque { hoje: string; tiposDoAlvo?: Record<string, TipoCarteira> }

export interface FontePorque {
  id: string;
  nome: string;
  tempoReal: boolean;       // false = histórico (sai com atraso)
  ligada: boolean;
  explica: string;
  porques(aion: Aion, ctx: ContextoPorque): Porque[];
}

const br = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const pct = (v: number | null | undefined, casas = 2) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
const dias = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const RF_ALVOS = ['selic', 'cdi', 'reserva', 'renda-fixa', 'copom'];

/* ------------------------------------------------------------ fontes de hoje */

const copom: FontePorque = {
  id: 'copom', nome: 'Copom (comunicados do Banco Central)', tempoReal: false, ligada: true,
  explica: 'Decisões da Selic e o primeiro parágrafo do comunicado de cada reunião. Mudam o rendimento da reserva e da renda fixa pós-fixada.',
  porques({ mercado: m }, ctx) {
    const out: Porque[] = [];
    for (const [i, d] of (m?.copom?.decisoes || []).entries()) {
      const fonte = { nome: m!.copom!.fonte, url: m!.copom!.url };
      out.push({
        id: `copom-${d.numero}`, alvos: RF_ALVOS, data: d.data, fonteId: 'copom', bloco: 2,
        titulo: `${d.numero}ª reunião do Copom: ${d.titulo.replace(/\s+/g, ' ')}`,
        texto: i === 0
          ? 'A Selic é a meta que o Copom decide; o CDI anda junto (fica um pouco abaixo) e é ele que a reserva e o CDB pós-fixado pagam. Quando a Selic muda, o rendimento delas muda a partir do dia seguinte.'
          : 'Decisão anterior: o caminho da Selic até a de hoje.',
        tipo: 'causa', fonte, historico: i > 0,
      });
      if (i === 0 && d.trecho) out.push({
        id: `copom-${d.numero}-texto`, alvos: [...RF_ALVOS, 'acao', 'fii', 'dolar', 'carteira-fora'], data: d.data, fonteId: 'copom', bloco: 9,
        titulo: `Por que o Copom decidiu assim (${d.numero}ª reunião)`, texto: `“${d.trecho}”`, tipo: 'opiniao', quem: 'Comitê de Política Monetária do BC', fonte,
      });
    }
    const prox = m?.copom?.proxima;
    if (prox && prox.numero) out.push({
      id: `copom-${prox.numero}-proxima`, alvos: RF_ALVOS, data: prox.decisao || ctxHoje(m), fonteId: 'copom', bloco: 2,
      titulo: `Próxima reunião: ${prox.numero}ª${prox.dias ? `, ${prox.dias}` : ' (data não cadastrada)'}`,
      texto: (prox.decisao === ctx.hoje ? 'A decisão sai hoje, no fim do dia: o comunicado entra na próxima coleta. ' : prox.decisao && prox.decisao < ctx.hoje ? 'A decisão já saiu: rode a coleta para trazer o comunicado. ' : '')
        + (prox.dias ? `Data do ${prox.fonteData}. Confira no site do BC.` : 'O BC não tem API do calendário: a data entra à mão em scripts/aion/fontes.mjs (CALENDARIO_COPOM).'),
      tipo: 'fato', fonte: { nome: 'calendário do Copom (Banco Central)', url: 'https://www.bcb.gov.br/publicacoes/calendarioreunioescopom' },
    });
    return out;
  },
};
const ctxHoje = (m: Mercado | null | undefined) => (m?.geradoEm || '').slice(0, 10);

const ipca: FontePorque = {
  id: 'ipca', nome: 'IPCA (IBGE, pela série 433 do BC)', tempoReal: false, ligada: true,
  explica: 'A inflação oficial do mês. Ela decide quanto o rendimento vale de verdade (o juro real) e pesa na decisão do Copom.',
  porques({ mercado: m }) {
    const s = m?.bcb?.ipca;
    if (!s?.ultimo) return [];
    const mes = s.ultimo.data.slice(0, 7);
    const ant = s.mensal.length > 1 ? s.mensal[s.mensal.length - 2] : null;
    return [{
      id: `ipca-${mes}`, alvos: ['ipca', 'reserva', 'renda-fixa', 'carteira'], data: s.ultimo.data, fonteId: 'ipca', bloco: 2,
      titulo: `IPCA de ${mes.slice(5)}/${mes.slice(0, 4)}: ${pct(s.ultimo.valor)} no mês${s.doze != null ? `, ${pct(s.doze)} em 12 meses` : ''}`,
      texto: `${ant ? `No mês anterior foi ${pct(ant.valor)}. ` : ''}O rendimento real é o que sobra depois da inflação: com o CDI em ${pct(m?.bcb?.cdi?.valor)} ao ano e o IPCA em ${pct(s.doze)} em 12 meses, o juro real de quem está no CDI fica perto de ${s.doze != null && m?.bcb?.cdi?.valor != null ? pct(((1 + m.bcb.cdi.valor / 100) / (1 + s.doze / 100) - 1) * 100) : '—'} ao ano.`,
      tipo: 'fato', fonte: { nome: `${s.fonte} (dado do IBGE)`, url: 'https://www.ibge.gov.br/explica/inflacao.php' },
    }];
  },
};

const focus: FontePorque = {
  id: 'focus', nome: 'Relatório Focus (Banco Central)', tempoReal: false, ligada: true,
  explica: 'A mediana do que o mercado espera para IPCA, Selic, PIB e câmbio. É estimativa de quem responde, não previsão do Aion.',
  porques({ mercado: m }, ctx) {
    const f = m?.focus;
    if (!f?.data) return [];
    const ano = ctx.hoje.slice(0, 4), prox = String(Number(ano) + 1);
    const md = f.medianas;
    return [{
      id: `focus-${f.data}`, alvos: ['focus', 'ipca', 'selic', 'cdi', 'dolar', 'reserva', 'renda-fixa', 'simulacao'], data: f.data, fonteId: 'focus', bloco: 9,
      titulo: `Focus de ${br(f.data)}: Selic ${pct(md.Selic?.[ano])} no fim de ${ano} e ${pct(md.Selic?.[prox])} no de ${prox}`,
      texto: `IPCA esperado ${pct(md.IPCA?.[ano])} em ${ano} e ${pct(md.IPCA?.[prox])} em ${prox}. É a mediana das instituições que respondem ao BC toda semana: quando ela cai, o mercado espera juro menor à frente.`,
      tipo: 'estimativa', quem: 'mediana das instituições do Focus', fonte: { nome: f.fonte, url: f.url },
    }];
  },
};

/** Provento com data ex nos últimos 7 dias ou à frente (até 60 dias). */
function proventosDe(c: Cotacao, hoje: string): Porque[] {
  const out: Porque[] = [];
  for (const p of c.proventos || []) {
    const ex = p.dataEx || p.dataCom;
    if (!ex) continue;
    const d = dias(ex, hoje);
    const valor = p.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });
    if (d >= 0 && d <= 7) out.push({
      id: `prov-${c.codigo}-${ex}-${p.tipo}`, alvos: [c.codigo], data: ex, fonteId: 'proventos', bloco: 6,
      titulo: `${c.codigo} ficou "ex" ${p.tipo.toLowerCase()} em ${br(ex)} (${valor} por cota/ação)`,
      texto: `Na data ex a cotação abre descontada do provento: quem compra dali em diante não recebe. Uma queda perto de ${valor} nesse dia é a mecânica do provento, não notícia. Pagamento em ${br(p.pagamento) || 'data a definir'}.`,
      tipo: 'causa', fonte: { nome: 'brapi.dev (proventos)', url: 'https://brapi.dev' },
    });
    else if (d < 0 && d >= -60) out.push({
      id: `prov-${c.codigo}-${ex}-${p.tipo}-futuro`, alvos: [c.codigo, 'renda-passiva'], data: ex, fonteId: 'proventos', bloco: 6,
      titulo: `${c.codigo}: ${p.tipo.toLowerCase()} de ${valor}, data com ${br(p.dataCom)}`,
      texto: `Quem tiver o ativo no fim do dia ${br(p.dataCom)} recebe em ${br(p.pagamento) || 'data a definir'}. No dia seguinte (ex) a cotação costuma cair perto desse valor.`,
      tipo: 'fato', fonte: { nome: 'brapi.dev (proventos)', url: 'https://brapi.dev' },
    });
  }
  return out;
}

const proventos: FontePorque = {
  id: 'proventos', nome: 'Proventos (dividendos, JCP, rendimentos), pela brapi', tempoReal: false, ligada: true,
  explica: 'Datas com, ex e de pagamento dos ativos com cotação. Explicam quedas no dia ex e a renda passiva que vem.',
  porques({ mercado: m }, ctx) {
    return Object.values(m?.cotacoes?.porCodigo || {}).flatMap((c) => proventosDe(c, ctx.hoje));
  },
};

const cvm: FontePorque = {
  id: 'cvm', nome: 'Fatos relevantes (CVM, dados abertos)', tempoReal: false, ligada: true,
  explica: 'O que a companhia comunicou ao mercado como fato relevante. A CVM atualiza os dados abertos uma vez por semana: é histórico, não alerta na hora. FII ainda não está ligado.',
  porques({ mercado: m }) {
    return (m?.cvm?.fatos || []).map((f) => ({
      id: `cvm-${f.codigo}-${f.data}-${f.assunto.slice(0, 20)}`, alvos: [f.codigo], data: f.data, fonteId: 'cvm', bloco: 6,
      titulo: `${f.codigo}: fato relevante de ${br(f.data)}`, texto: `${f.assunto}. Fato relevante é o que a empresa é obrigada a contar ao mercado porque pode mexer no preço; se mexeu e quanto, a cotação do dia diz.`,
      tipo: 'fato' as const, fonte: { nome: `CVM, documento de ${m!.cvm!.empresas[f.codigo]?.nome || f.codigo}`, url: f.url || m!.cvm!.url },
    }));
  },
};

const LIMIAR_PEQUENO = 1; // % no dia: abaixo disto, "variação pequena, comum sem notícia"

const movimento: FontePorque = {
  id: 'movimento', nome: 'Movimento do dia (cotação)', tempoReal: false, ligada: true,
  explica: 'A variação do dia de cada ativo com cotação. Sozinha não explica nada: quando não há outra fonte, o Aion diz que não há notícia ligada.',
  porques({ mercado: m }, ctx) {
    const out: Porque[] = [];
    const todas = [...Object.values(m?.cotacoes?.porCodigo || {}), ...Object.values(m?.cripto?.porCodigo || {})];
    for (const c of todas) {
      if (c.variacaoDia == null) continue;
      const cripto = !!m?.cripto?.porCodigo?.[c.codigo];
      const v = c.variacaoDia;
      const pequeno = Math.abs(v) < LIMIAR_PEQUENO;
      out.push({
        id: `mov-${c.codigo}-${c.em.slice(0, 10)}`, alvos: [c.codigo], data: c.em.slice(0, 10), fonteId: 'movimento', bloco: cripto ? 8 : 7,
        titulo: `${c.codigo} ${v >= 0 ? 'subiu' : 'caiu'} ${pct(Math.abs(v))} ${cripto ? 'em 24 horas' : 'no dia'}`,
        texto: pequeno
          ? 'Variação pequena: é o vaivém normal de um dia, que quase nunca tem notícia própria.'
          : 'Sem notícia específica ligada a este movimento. Sem a fonte de notícia em tempo real e sem o índice da bolsa (precisa do token da brapi), o Aion não sabe dizer se foi o ativo ou o mercado inteiro.',
        tipo: pequeno ? 'hipotese' : 'sem-noticia', fonte: cripto ? { nome: `${m!.cripto!.fonte} · ${m!.cripto!.citar}`, url: m!.cripto!.url } : { nome: m?.cotacoes?.fonte || 'brapi.dev', url: m?.cotacoes?.url || 'https://brapi.dev' },
      });
    }
    void ctx;
    return out;
  },
};

const dolar: FontePorque = {
  id: 'dolar', nome: 'Dólar (BC, série 1)', tempoReal: false, ligada: true,
  explica: 'O dólar comercial do BC. O Aion mostra quanto andou em 30 dias; o porquê do câmbio ainda não tem fonte de notícia ligada.',
  porques({ mercado: m }) {
    const d = m?.bcb?.dolar;
    if (!d?.pontos?.length || d.pontos.length < 2) return [];
    const a = d.pontos[0], b = d.pontos[d.pontos.length - 1];
    const v = ((b.valor / a.valor) - 1) * 100;
    return [{
      id: `dolar-${b.data}`, alvos: ['dolar', 'cripto'], data: b.data, fonteId: 'dolar', bloco: 9,
      titulo: `Dólar ${v >= 0 ? 'subiu' : 'caiu'} ${pct(Math.abs(v))} desde ${br(a.data)}`,
      texto: 'Sem notícia específica ligada. O câmbio reage a juros aqui e lá fora, contas do governo e risco global (bloco 9 da trilha); cripto cotada em real também sente o dólar.',
      tipo: 'sem-noticia', fonte: { nome: d.fonte, url: d.url },
    }];
  },
};

/** A fonte que falta: notícia em tempo real. Ainda não escolhida (termos de uso a conferir). */
export const NOTICIAS_TEMPO_REAL: FontePorque = {
  id: 'noticias', nome: 'Notícias em tempo real', tempoReal: true, ligada: false,
  explica: 'Ainda não escolhida: precisa de uma fonte cujos termos permitam uso assim. Quando entrar, é mais uma fonte desta lista e aparece em todos os pop-ups.',
  porques: () => [],
};

export const FONTES_PORQUE: FontePorque[] = [copom, ipca, focus, proventos, cvm, movimento, dolar, NOTICIAS_TEMPO_REAL];

/** Todos os porquês ligados, do mais novo para o mais velho (sem repetir id). */
export function todosOsPorques(aion: Aion, ctx: ContextoPorque, fontes = FONTES_PORQUE): Porque[] {
  const vistos = new Set<string>();
  const out: Porque[] = [];
  for (const f of fontes) {
    if (!f.ligada) continue;
    for (const p of f.porques(aion, ctx)) if (!vistos.has(p.id)) { vistos.add(p.id); out.push(p); }
  }
  return out.sort((a, b) => b.data.localeCompare(a.data) || a.id.localeCompare(b.id));
}

export interface ExplicacaoAlvo {
  itens: Porque[];
  semNoticia: string;      // o que dizer quando nada explica (sempre preenchido para ativo)
  faltando: string[];      // fontes que faltam para este alvo (token da brapi, notícia em tempo real...)
}

/**
 * Os porquês de um alvo (até `max`, os mais novos). Ativo sem nada ligado: "sem notícia específica"
 * com o motivo (sem cotação, sem token, sem fonte de notícia). Nunca inventa motivo.
 */
export function porquesDoAlvo(alvo: string, aion: Aion, ctx: ContextoPorque, todos?: Porque[], max = 4): ExplicacaoAlvo {
  // no pop-up: sem o histórico; causa conhecida primeiro, depois o que já aconteceu (mais novo antes),
  // o que ainda vem por último
  const lista = (todos || todosOsPorques(aion, ctx)).filter((p) => p.alvos.includes(alvo) && !p.historico)
    .sort((a, b) => Number(a.tipo !== 'causa') - Number(b.tipo !== 'causa') || Number(a.data > ctx.hoje) - Number(b.data > ctx.hoje) || b.data.localeCompare(a.data));
  const m = aion.mercado;
  const faltando: string[] = [];
  const ehAtivo = /^[A-Z0-9-]{4,}$/.test(alvo) && !['FOCUS'].includes(alvo);
  if (ehAtivo) {
    const temCot = !!(m?.cotacoes?.porCodigo?.[alvo] || m?.cripto?.porCodigo?.[alvo]);
    if (!temCot && m?.cotacoes?.semToken?.includes(alvo)) faltando.push('cotação: precisa do token da brapi');
    else if (!temCot) faltando.push('cotação: ainda não coletada');
    if (m?.cvm?.semEmpresa?.includes(alvo)) faltando.push('fato relevante: fundo imobiliário ainda não ligado à CVM');
  }
  faltando.push('notícia em tempo real: fonte ainda não escolhida');
  const itens = lista.slice(0, max);
  const explicam = itens.some((p) => p.tipo === 'causa' || p.tipo === 'fato' || p.tipo === 'opiniao');
  const semNoticia = explicam ? '' : ehAtivo
    ? 'Sem notícia específica ligada a este ativo. Se ele se mexeu, o Aion não sabe dizer por quê: pode ter sido o setor ou a bolsa inteira.'
    : 'Sem notícia ligada a este número.';
  return { itens, semNoticia, faltando };
}
