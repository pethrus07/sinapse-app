// Somas e rótulos do módulo financeiro. Nenhum valor é inventado aqui:
// tudo vem dos lançamentos do vault.
import type { Financeiro, Lancamento, StatusLancamento } from '../types';

export const brl = (v: number) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const STATUS_LABEL: Record<StatusLancamento, string> = {
  'a-receber': 'a receber',
  recebido: 'recebido',
  'a-pagar': 'a pagar',
  pago: 'pago',
  posicao: 'saldo',
};

/** Reserva reusa os status de saida, mas "a pagar" nao descreve guardar dinheiro. */
export function rotuloStatus(l: Lancamento): string {
  if (l.tipo === 'reserva') return l.status === 'pago' ? 'guardado' : 'a guardar';
  if (l.tipo === 'investimento') return 'saldo';
  return STATUS_LABEL[l.status] || l.status;
}

/**
 * Rótulo de tela da categoria. O id gravado no razão (e nas regras) não muda: "alimentacao"
 * continua "alimentacao" no arquivo; só a tela mostra "Alimentação".
 */
const ROTULOS: Record<string, string> = {
  'a classificar': 'A classificar', 'sem categoria': 'Sem categoria',
  alimentacao: 'Alimentação', arte: 'Arte', artes: 'Artes', assinatura: 'Assinaturas', cartao: 'Cartão',
  casa: 'Casa', ciclo: 'Ciclo', cliente: 'Cliente', compras: 'Compras', doacao: 'Doação', educacao: 'Educação',
  emprestimo: 'Empréstimo', equipamento: 'Equipamento', estorno: 'Estorno', familia: 'Família', farmacia: 'Farmácia',
  'hora avulsa': 'Hora avulsa', imposto: 'Impostos', impostos: 'Impostos', infra: 'Infra', lazer: 'Lazer',
  mensalidade: 'Mensalidade', mercado: 'Mercado', moradia: 'Moradia', outro: 'Outro', parcela: 'Parcela',
  'pix a pessoa física': 'Pix a pessoa física', 'pix recebido de pessoa física': 'Pix recebido de pessoa física',
  projeto: 'Projeto', reserva: 'Reserva', rendimentos: 'Rendimentos', salario: 'Salário', saude: 'Saúde',
  transporte: 'Transporte', vestuario: 'Vestuário',
};
export function rotuloCategoria(id: string | undefined): string {
  const k = (id || '').trim().toLowerCase();
  if (!k) return 'Sem categoria';
  if (ROTULOS[k]) return ROTULOS[k];
  return k.charAt(0).toUpperCase() + k.slice(1);
}

/** Sugestões do <datalist> — não restringe, só evita digitar de novo. */
export const CATEGORIAS = [
  'mensalidade', 'ciclo', 'arte', 'projeto', 'parcela', 'hora avulsa',
  'infra', 'assinatura', 'imposto', 'equipamento', 'outro',
];

export const estaAberto = (l: Lancamento) =>
  l.status === 'a-receber' || l.status === 'a-pagar';

const vazio: Financeiro = { lancamentos: [], meses: [] };
export function normalizarFin(f?: Partial<Financeiro> | null): Financeiro {
  if (!f) return vazio;
  return { lancamentos: f.lancamentos ?? [], meses: f.meses ?? [], conexoes: f.conexoes ?? [], ultimaSync: f.ultimaSync ?? '', ultimaFalha: f.ultimaFalha ?? null, retratos: f.retratos ?? [] };
}

export interface Resumo {
  aReceber: number; qtdReceber: number;
  aPagar: number; qtdPagar: number;
  atrasado: number; qtdAtrasado: number;
  semData: number; qtdSemData: number;
  semDataReceber: number; semDataPagar: number;
  recebido: number; pago: number;
  guardar: number; guardado: number;
  saldoPrevisto: number;
}

/**
 * `atrasado` só conta o que tem vencimento no passado E segue aberto — item sem
 * data não é atrasado, é indefinido, e some se misturar com os dois.
 */
export function resumir(lancamentos: Lancamento[], hoje: string): Resumo {
  const r: Resumo = {
    aReceber: 0, qtdReceber: 0, aPagar: 0, qtdPagar: 0,
    atrasado: 0, qtdAtrasado: 0, semData: 0, qtdSemData: 0, semDataReceber: 0, semDataPagar: 0,
    recebido: 0, pago: 0, guardar: 0, guardado: 0, saldoPrevisto: 0,
  };
  for (const l of lancamentos) {
    if (l.tipo === 'investimento') continue; // saldo, nao fluxo
    if (l.viaCartao) continue; // compra no cartao: o dinheiro sai na fatura
    const v = Number(l.valor) || 0;
    if (l.status === 'a-receber') { r.aReceber += v; r.qtdReceber++; }
    if (l.tipo === 'reserva') {
      if (l.status === 'pago') r.guardado += v; else r.guardar += v;
    } else if (l.status === 'a-pagar') { r.aPagar += v; r.qtdPagar++; }
    if (l.status === 'recebido') r.recebido += v;
    if (l.status === 'pago') r.pago += v;
    if (estaAberto(l)) {
      if (!l.vencimento) {
        r.semData += v; r.qtdSemData++;
        if (l.status === 'a-pagar') r.semDataPagar += v; else r.semDataReceber += v;
      }
      else if (l.vencimento < hoje) { r.atrasado += v; r.qtdAtrasado++; }
    }
  }
  r.saldoPrevisto = r.aReceber - r.aPagar - r.guardar;
  return r;
}

export function agruparPorMes(lancamentos: Lancamento[]) {
  const map = new Map<string, Lancamento[]>();
  for (const l of lancamentos) {
    if (!map.has(l.mes)) map.set(l.mes, []);
    map.get(l.mes)!.push(l);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

/** Clientes já usados — alimenta o <datalist> pra não redigitar. */
export function clientesConhecidos(lancamentos: Lancamento[]): string[] {
  const s = new Set<string>();
  for (const l of lancamentos) if (l.cliente) s.add(l.cliente);
  return [...s].sort();
}

/**
 * Com salario dentro, "a receber" deixa de ser "o que cliente me deve" e passa a
 * ser previsao de entrada. A quebra por cliente devolve a leitura.
 */
export function aReceberPorCliente(lancamentos: Lancamento[]) {
  const m = new Map<string, { total: number; qtd: number }>();
  for (const l of lancamentos) {
    if (l.status !== 'a-receber') continue;
    const k = l.cliente || '(sem cliente)';
    const cur = m.get(k) || { total: 0, qtd: 0 };
    cur.total += Number(l.valor) || 0;
    cur.qtd += 1;
    m.set(k, cur);
  }
  return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
}

export interface LinhaProjecao {
  mes: string;
  entra: number;
  sai: number;
  guarda: number;
  sobra: number;          // entra - sai - guarda: o que fica livre pra gastar
  reservaAcum: number;
  itens: number;
  semDia: number;         // quantos itens deste mes nao tem dia definido
}

/**
 * Fluxo mes a mes. Conta apenas o ABERTO — o liquidado saiu do futuro.
 *
 * Item SEM DIA nao e ignorado: cai no mes do arquivo onde ele vive. Antes ele
 * desaparecia da projecao, e uma projecao sem o cartao dentro mente pra cima.
 */
export function projetar(lancamentos: Lancamento[], deMes: string): LinhaProjecao[] {
  const porMes = new Map<string, { entra: number; sai: number; guarda: number; itens: number; semDia: number }>();
  for (const l of lancamentos) {
    if (!estaAberto(l)) continue;
    if (l.semPrazo) continue; // sem cronograma: nao pertence a mes nenhum
    const mes = (l.vencimento ? l.vencimento.slice(0, 7) : l.mes) || '';
    if (!mes || mes < deMes) continue;
    const cur = porMes.get(mes) || { entra: 0, sai: 0, guarda: 0, itens: 0, semDia: 0 };
    const v = Number(l.valor) || 0;
    if (l.tipo === 'reserva') cur.guarda += v;
    else if (l.tipo === 'saida') cur.sai += v;
    else cur.entra += v;
    cur.itens += 1;
    if (!l.vencimento) cur.semDia += 1;
    porMes.set(mes, cur);
  }
  let reservaAcum = 0;
  return [...porMes.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, v]) => {
      reservaAcum += v.guarda;
      return {
        mes, entra: v.entra, sai: v.sai, guarda: v.guarda,
        sobra: v.entra - v.sai - v.guarda,
        reservaAcum, itens: v.itens, semDia: v.semDia,
      };
    });
}

/** Quantas saidas existem, pra view poder avisar que a projecao esta torta. */
export function contarSaidas(lancamentos: Lancamento[]) {
  const abertas = lancamentos.filter((l) => estaAberto(l));
  return {
    saidas: abertas.filter((l) => l.tipo === 'saida').length,
    reservas: abertas.filter((l) => l.tipo === 'reserva').length,
    entradas: abertas.filter((l) => l.tipo === 'entrada').length,
  };
}

/** O que ficou fora da projecao por nao ter cronograma — precisa aparecer em algum lugar. */
export function foraDaProjecao(lancamentos: Lancamento[]) {
  const fora = lancamentos.filter((l) => estaAberto(l) && l.semPrazo);
  return {
    itens: fora.length,
    receber: fora.filter((l) => l.tipo === 'entrada').reduce((s, l) => s + (Number(l.valor) || 0), 0),
    pagar: fora.filter((l) => l.tipo !== 'entrada').reduce((s, l) => s + (Number(l.valor) || 0), 0),
  };
}
