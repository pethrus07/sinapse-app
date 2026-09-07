// Matemática de datas da Agenda, sem dependência externa.
// Regra de ouro: data é string 'AAAA-MM-DD' e Date é sempre construído no fuso LOCAL
// (new Date(s) trataria a string como UTC e jogaria o dia para trás no Brasil).
import type { Agenda, Ocorrencia } from '../types';

export const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const DIA_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const MES_LONGO = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export const FRENTES: Record<string, { label: string; cor: string }> = {
  trabalho: { label: 'Trabalho', cor: '#4FA3F0' },
  faculdade: { label: 'Faculdade', cor: '#2CD4C0' },
  cliente: { label: 'Cliente', cor: '#E8A33D' },
  pessoal: { label: 'Pessoal', cor: '#9A8CF0' },
  receber: { label: 'A receber', cor: '#7BE0A3' },
  pagar: { label: 'A pagar', cor: '#F2739D' },
};
export const corDaFrente = (f?: string) => FRENTES[(f || '').toLowerCase()]?.cor || '#8A93A6';
export const labelDaFrente = (f?: string) => FRENTES[(f || '').toLowerCase()]?.label || 'Sem frente';

export const FAIXAS: { id: Faixa; label: string; hint: string }[] = [
  { id: 'dia', label: 'Dia', hint: 'trabalho' },
  { id: 'noite', label: 'Noite', hint: 'aula' },
  { id: 'livre', label: 'Livre', hint: 'sem ocupação fixa' },
];
export type Faixa = 'dia' | 'noite' | 'livre';

export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function hojeYmd(): string {
  return ymd(new Date());
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  c.setDate(c.getDate() + n);
  return c;
}

/** Domingo da semana de `d`. */
export function inicioDaSemana(d: Date): Date {
  return addDays(d, -d.getDay());
}

export function ultimoDiaDoMes(ano: number, mes0: number): number {
  return new Date(ano, mes0 + 1, 0).getDate();
}

const ORDINAIS = ['primeira', 'segunda', 'terceira', 'quarta'];
export const ROTULO_SEMANA: Record<string, string> = {
  primeira: 'primeira', segunda: 'segunda', terceira: 'terceira',
  quarta: 'quarta', ultima: 'última',
};

/**
 * `d` e a N-esima ocorrencia daquele dia da semana no mes?
 * "ultima" = nao existe outra igual 7 dias depois ainda dentro do mes.
 */
export function ehOcorrenciaDoMes(d: Date, semana: string, dow: number): boolean {
  if (d.getDay() !== dow) return false;
  const dia = d.getDate();
  if (semana === 'ultima') return dia + 7 > ultimoDiaDoMes(d.getFullYear(), d.getMonth());
  const i = ORDINAIS.indexOf(semana);
  if (i < 0) return false;
  return dia >= i * 7 + 1 && dia <= i * 7 + 7;
}

/** Diferença em dias inteiros entre duas datas 'AAAA-MM-DD' (b - a). */
export function diasEntre(a: string, b: string): number {
  const MS = 86400000;
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / MS);
}

export function rotuloRelativo(hoje: string, alvo: string): string {
  const n = diasEntre(hoje, alvo);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  if (n < 0) return `há ${-n} dias`;
  if (n < 7) return `em ${n} dias`;
  if (n < 14) return 'na semana que vem';
  return `em ${n} dias`;
}

export function dataCurta(s: string): string {
  const d = parseYmd(s);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const vazia: Agenda = { blocos: [], semanal: [], mensal: [], datas: [], dailys: [], fonte: '' };

export function normalizar(a?: Partial<Agenda> | null): Agenda {
  if (!a) return vazia;
  return {
    blocos: a.blocos ?? [],
    semanal: a.semanal ?? [],
    mensal: a.mensal ?? [],
    datas: a.datas ?? [],
    dailys: a.dailys ?? [],
    fonte: a.fonte ?? '',
  };
}

/**
 * Expande a rotina em ocorrências por dia, no intervalo pedido (inclusivo).
 * Recorrência não é armazenada dia a dia no vault — é calculada aqui, senão
 * a nota-fonte viraria um calendário escrito à mão que envelhece.
 */
export function expandir(agenda: Agenda, deYmd: string, ateYmd: string): Map<string, Ocorrencia[]> {
  const out = new Map<string, Ocorrencia[]>();
  const de = parseYmd(deYmd);
  const ate = parseYmd(ateYmd);
  const push = (dia: string, o: Ocorrencia) => {
    if (!out.has(dia)) out.set(dia, []);
    out.get(dia)!.push(o);
  };

  for (let d = de; d <= ate; d = addDays(d, 1)) {
    const dia = ymd(d);
    const dow = d.getDay();

    for (const b of agenda.blocos) {
      if (!(b.dias || []).includes(dow)) continue;
      push(dia, {
        titulo: b.titulo, frente: b.frente, faixa: (b.faixa as Faixa) || 'dia',
        hora: b.hora, onde: b.onde, link: b.link, nota: b.nota,
        kind: 'bloco', intermediavel: !!b.intermediavel,
      });
    }
    for (const s of agenda.semanal) {
      const dias = Array.isArray(s.dias) && s.dias.length ? s.dias : (s.dia != null ? [s.dia] : []);
      if (!dias.includes(dow)) continue;
      push(dia, {
        titulo: s.titulo, frente: s.frente, faixa: (s.faixa as Faixa) || 'dia',
        hora: s.hora, onde: s.onde, link: s.link, nota: s.nota, kind: 'semanal',
      });
    }
    for (const m of agenda.mensal) {
      if (m.semanaDoMes) {
        // ex.: ultima + dia 0 = ultimo domingo do mes
        if (!ehOcorrenciaDoMes(d, m.semanaDoMes, m.dia ?? 0)) continue;
      } else {
        const ultimo = ultimoDiaDoMes(d.getFullYear(), d.getMonth());
        // dia 31 num mês de 30 cai no último dia, senão o compromisso desaparece do mês
        const alvo = Math.min(m.diaDoMes ?? 1, ultimo);
        if (d.getDate() !== alvo) continue;
      }
      push(dia, {
        titulo: m.titulo, frente: m.frente, faixa: (m.faixa as Faixa) || '',
        hora: m.hora, onde: m.onde, link: m.link, nota: m.nota, kind: 'mensal',
      });
    }
  }

  for (const ev of agenda.datas) {
    if (!ev.de) continue;
    const fim = ev.ate && ev.ate >= ev.de ? ev.ate : ev.de;
    for (let d = parseYmd(ev.de); d <= parseYmd(fim); d = addDays(d, 1)) {
      const dia = ymd(d);
      if (dia < deYmd || dia > ateYmd) continue;
      push(dia, {
        titulo: ev.titulo, frente: ev.frente, faixa: (ev.faixa as Faixa) || '',
        hora: ev.hora, onde: ev.onde, link: ev.link, nota: ev.nota, kind: 'data',
        multi: fim !== ev.de, inicio: dia === ev.de, ultimo: dia === fim,
      });
    }
  }

  return out;
}

/**
 * Compromissos com data (mensal + datas) daqui pra frente — alimenta o Painel.
 * `maxPorRecorrencia` limita quantas vezes o MESMO item mensal aparece: sem isso o
 * ciclo de cobrança repetido afoga os prazos de data unica na lista.
 */
export function proximos(agenda: Agenda, hoje: string, dias: number, maxPorRecorrencia = 2) {
  const ate = ymd(addDays(parseYmd(hoje), dias));
  const mapa = expandir({ ...agenda, blocos: [], semanal: [] }, hoje, ate);
  const lista: { dia: string; oc: Ocorrencia }[] = [];
  for (const [dia, ocs] of mapa) {
    for (const oc of ocs) {
      // intervalo aparece uma vez só, no primeiro dia visível
      if (oc.multi && !oc.inicio && dia !== hoje) continue;
      lista.push({ dia, oc });
    }
  }
  lista.sort((a, b) => a.dia.localeCompare(b.dia));
  const vistos = new Map<string, number>();
  return lista.filter(({ oc }) => {
    if (oc.kind !== 'mensal') return true;
    const n = (vistos.get(oc.titulo) || 0) + 1;
    vistos.set(oc.titulo, n);
    return n <= maxPorRecorrencia;
  });
}

// Mesma estrutura do _templates/daily.md do vault — uma convenção só.
export const corpoDaDaily = (dia: string) =>
  [
    `# ${dia}`,
    '',
    '## 🎯 Hoje eu quero',
    '- ',
    '',
    '## 📝 Capturei / aprendi',
    '- ',
    '',
    '## 🔗 Notas que criei ou liguei',
    '- ',
    '',
    '## 🔁 Revisão (flashcards)',
    '- ',
    '',
  ].join('\n');
