// Testes do modelo da Métis v2 (natureza, gasto que se repete, orçamento, entradas, contratos,
// plano da reserva). Dados FALSOS: categorias, clientes e valores inventados.
// Rodar: node --test src/lib/financeiroModelo.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Lancamento } from '../types';
import { gastoQueSeRepete, mediana, mesesCompletos, NATUREZA_POR_CATEGORIA, naturezaDe, naturezaDoMes, rendaRecorrente } from './financeiroAnalise.ts';
import {
  categoriasDoMes, categoriasParaTeto, comparacaoCategorias, mesDeComparacao, contratosDeRenda, entradasPorCliente, focoPadrao, gastosAgrupados,
  mesesDoSeletor, naturezaPorMes, orcamentoDoMes, ordenarAvisos, planoReserva, visaoDoMes,
} from './financeiroModelo.ts';

let seq = 0;
function L(p: Partial<Lancamento>): Lancamento {
  seq++;
  const venc = p.vencimento ?? '';
  return { id: 'm' + seq, tipo: 'saida', descricao: 'item ' + seq, valor: 100, vencimento: venc, status: 'pago', mes: (p.liquidadoEm || venc || '2030-03').slice(0, 7), rel: '', ...p } as Lancamento;
}
const gasto = (mes: string, dia: string, categoria: string, valor: number, extra: Partial<Lancamento> = {}) =>
  L({ categoria, valor, vencimento: `${mes}-${dia}`, liquidadoEm: `${mes}-${dia}`, origem: 'teste', ...extra });
const entrada = (mes: string, dia: string, valor: number, extra: Partial<Lancamento> = {}) =>
  L({ tipo: 'entrada', valor, vencimento: `${mes}-${dia}`, status: 'recebido', liquidadoEm: `${mes}-${dia}`, ...extra });

test('NATUREZA_POR_CATEGORIA: fixo, variável e pontual das categorias que o razão usa', () => {
  for (const c of ['moradia', 'casa', 'impostos', 'assinatura', 'parcela', 'educacao', 'energia', 'agua', 'internet'])
    assert.equal(NATUREZA_POR_CATEGORIA[c], 'fixo', c);
  for (const c of ['alimentacao', 'mercado', 'transporte', 'pix a pessoa física', 'vestuario', 'lazer', 'compras', 'farmacia', 'a classificar'])
    assert.equal(NATUREZA_POR_CATEGORIA[c], 'variavel', c);
  for (const c of ['emprestimo', 'equipamento']) assert.equal(NATUREZA_POR_CATEGORIA[c], 'pontual', c);
});

test('naturezaDe: campo natureza > pontual > saída recorrente > mapa > variável', () => {
  assert.equal(naturezaDe(gasto('2030-03', '01', 'mercado', 10)), 'variavel');
  assert.equal(naturezaDe(gasto('2030-03', '01', 'Moradia', 10)), 'fixo'); // maiúscula não muda
  assert.equal(naturezaDe(gasto('2030-03', '01', 'categoria inventada', 10)), 'variavel');
  assert.equal(naturezaDe(gasto('2030-03', '01', 'transporte', 10, { recorrente: true })), 'fixo'); // ônibus todo mês
  assert.equal(naturezaDe(gasto('2030-03', '01', 'moradia', 10, { pontual: true })), 'pontual');
  assert.equal(naturezaDe(gasto('2030-03', '01', 'casa', 10, { natureza: 'variavel' })), 'variavel');
  assert.equal(naturezaDe(gasto('2030-03', '01', 'mercado', 10, { natureza: 'fixo', pontual: true })), 'fixo');
});

test('naturezaDoMes: só gasto (fatura paga e reserva fora), no mês em que o dinheiro mexeu', () => {
  const ls = [
    gasto('2030-03', '05', 'moradia', 500), gasto('2030-03', '06', 'mercado', 300), gasto('2030-03', '07', 'emprestimo', 900),
    gasto('2030-03', '08', 'cartao', 1200), L({ tipo: 'reserva', liquidadoEm: '2030-03-02', valor: 700 }),
    gasto('2030-04', '01', 'mercado', 50),
  ];
  assert.deepEqual(naturezaDoMes(ls, '2030-03'), { fixo: 500, variavel: 300, pontual: 900, total: 1700 });
});

test('mediana e meses completos (o mês em que o banco começou no meio e o de hoje ficam fora)', () => {
  assert.equal(mediana([]), 0);
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([4, 1, 2, 3]), 2.5);
  const ls = [gasto('2030-01', '24', 'mercado', 10), gasto('2030-02', '03', 'mercado', 10), gasto('2030-03', '03', 'mercado', 10)];
  assert.deepEqual(mesesCompletos(ls, '2030-04'), ['2030-03', '2030-02']);
});

test('gastoQueSeRepete: mediana com 3+ meses; com menos, o teto das variáveis; sem teto, fraca; pontual nunca', () => {
  const mes = (m: string, varv: number) => [gasto(m, '01', 'moradia', 500), gasto(m, '02', 'mercado', varv), gasto(m, '03', 'emprestimo', 2000)];
  const tres = [...mes('2030-01', 300), ...mes('2030-02', 900), ...mes('2030-03', 400)];
  const a = gastoQueSeRepete(tres, '2030-04');
  assert.deepEqual([a.fixo, a.variavel, a.total, a.base, a.fraca, a.meses.length], [500, 400, 900, 'mediana', false, 3]);
  // um mês só: sem teto, mediana fraca; com teto das variáveis, o teto (o de moradia não conta no variável)
  const um = mes('2030-03', 1200);
  const b = gastoQueSeRepete(um, '2030-04');
  assert.deepEqual([b.total, b.base, b.fraca, b.meses], [1700, 'mediana', true, ['2030-03']]);
  const c = gastoQueSeRepete(um, '2030-04', { mercado: 600, moradia: 450 });
  assert.deepEqual([c.fixo, c.variavel, c.total, c.base, c.tetoVariavel], [500, 600, 1100, 'teto', 600]);
  // nada completo e sem teto: nenhum
  assert.equal(gastoQueSeRepete([gasto('2030-04', '10', 'mercado', 10)], '2030-04').base, 'nenhum');
});

test('rendaRecorrente usa o gasto que se repete (fixo + variável), não o gasto inteiro', () => {
  const ls = [
    ...['2030-01', '2030-02', '2030-03'].flatMap((m) => [gasto(m, '01', 'moradia', 500), gasto(m, '02', 'mercado', 300), gasto(m, '03', 'equipamento', 3000)]),
    L({ tipo: 'entrada', status: 'a-receber', recorrente: true, valor: 2000, vencimento: '2030-04-05', mes: '2030-04' }),
  ];
  const r = rendaRecorrente(ls, '2030-04');
  assert.equal(r.gastoBase, 800);
  assert.equal(r.estimativa.base, 'mediana');
  assert.deepEqual(r.sobra.slice(0, 1), [1200]);
});

test('mesesDoSeletor e focoPadrao: do primeiro mês com dinheiro até hoje; foco no último fechado', () => {
  const ls = [gasto('2030-02', '20', 'mercado', 10), entrada('2030-03', '05', 100)];
  const s = mesesDoSeletor(ls, '2030-04');
  assert.deepEqual(s.meses, ['2030-02', '2030-03', '2030-04']);
  assert.deepEqual(s.parciais, ['2030-02', '2030-04']);
  assert.equal(focoPadrao(ls, '2030-04'), '2030-03');
  assert.equal(focoPadrao([], '2030-04'), '2030-04');
});

test('mesDeComparacao: anterior completo; parcial pula para o último completo; nenhum = vazio', () => {
  // banco começa em 24/01: jan parcial; fev, mar completos; abr = hoje
  const ls = [gasto('2030-01', '24', 'mercado', 10), gasto('2030-02', '03', 'mercado', 10), gasto('2030-03', '03', 'mercado', 10)];
  assert.deepEqual(mesDeComparacao(ls, '2030-04', '2030-03'), { mes: '2030-02', anteriorParcial: false });
  assert.deepEqual(mesDeComparacao(ls, '2030-04', '2030-02'), { mes: '', anteriorParcial: true });
  const ls2 = [gasto('2030-01', '24', 'mercado', 10), gasto('2030-03', '03', 'mercado', 10)];
  assert.deepEqual(mesDeComparacao([...ls2, gasto('2030-02', '20', 'lazer', 5)], '2030-05', '2030-04'), { mes: '2030-03', anteriorParcial: false });
  // comparação contra um mês escolhido
  const c = comparacaoCategorias([gasto('2030-03', '01', 'mercado', 300), gasto('2030-01', '01', 'mercado', 100), gasto('2030-02', '01', 'mercado', 999)], '2030-03', '2030-01');
  assert.deepEqual(c.map((x) => [x.categoria, x.delta]), [['mercado', 200]]);
});

test('visaoDoMes: entrou, saiu (gasto), guardado e sobrou', () => {
  const ls = [
    entrada('2030-03', '05', 3000), L({ tipo: 'entrada', status: 'a-receber', valor: 999, vencimento: '2030-03-20' }),
    gasto('2030-03', '06', 'moradia', 500), gasto('2030-03', '07', 'mercado', 400), gasto('2030-03', '09', 'cartao', 800),
    L({ tipo: 'reserva', liquidadoEm: '2030-03-10', vencimento: '2030-03-10', valor: 1000 }),
  ];
  const v = visaoDoMes(ls, '2030-03');
  assert.deepEqual([v.entrou, v.saiu, v.guardado, v.sobrou, v.natureza.fixo], [3000, 900, 1000, 2100, 500]);
});

test('ordenarAvisos: falha da sincronização antes da fatura, "a classificar" por último', () => {
  const xs = [{ chave: 'a-classificar' }, { chave: 'fatura' }, { chave: 'sync-falhou' }, { chave: 'conexao-renovar' }];
  assert.deepEqual(ordenarAvisos(xs).map((x) => x.chave), ['sync-falhou', 'fatura', 'conexao-renovar', 'a-classificar']);
});

test('naturezaPorMes: uma linha por mês, do primeiro com dado até hoje', () => {
  const ls = [gasto('2030-02', '01', 'moradia', 500), gasto('2030-03', '01', 'mercado', 200), gasto('2030-03', '02', 'emprestimo', 50)];
  const r = naturezaPorMes(ls, '2030-04');
  assert.deepEqual(r.meses, ['2030-02', '2030-03', '2030-04']);
  assert.deepEqual(r.linhas.map((l) => [l.fixo, l.variavel, l.pontual]), [[500, 0, 0], [0, 200, 50], [0, 0, 0]]);
});

test('categoriasDoMes: total por natureza, mês anterior, teto e quanto passou', () => {
  const ls = [
    gasto('2030-03', '01', 'casa', 250), gasto('2030-03', '02', 'casa', 900, { pontual: true }),
    gasto('2030-03', '03', 'mercado', 700), gasto('2030-02', '03', 'mercado', 400), gasto('2030-02', '04', 'lazer', 80),
  ];
  const c = categoriasDoMes(ls, '2030-03', { mercado: 600, farmacia: 100 });
  const por = Object.fromEntries(c.map((x) => [x.categoria, x]));
  assert.deepEqual(c.map((x) => x.categoria), ['casa', 'mercado', 'farmacia']); // lazer só no anterior: fora
  assert.deepEqual(por.casa.porNatureza, { fixo: 250, variavel: 0, pontual: 900 });
  assert.equal(por.casa.natureza, 'pontual');
  assert.deepEqual([por.mercado.anterior, por.mercado.teto, por.mercado.acima], [400, 600, 100]);
  assert.deepEqual([por.farmacia.total, por.farmacia.teto], [0, 100]);
  assert.equal(por.casa.teto, null);
  const d = comparacaoCategorias(ls, '2030-03');
  assert.deepEqual(d.map((x) => [x.categoria, x.delta]), [['casa', 1150], ['mercado', 300], ['lazer', -80]]);
});

test('gastosAgrupados: natureza → categoria → lançamentos, em ordem de valor', () => {
  const ls = [gasto('2030-03', '05', 'mercado', 100), gasto('2030-03', '01', 'mercado', 50), gasto('2030-03', '02', 'moradia', 500), gasto('2030-03', '03', 'lazer', 300)];
  const g = gastosAgrupados(ls, '2030-03');
  assert.deepEqual(g.map((x) => [x.natureza, x.total]), [['fixo', 500], ['variavel', 450]]);
  assert.deepEqual(g[1].categorias.map((c) => c.categoria), ['lazer', 'mercado']);
  assert.deepEqual(g[1].categorias[1].itens.map((l) => l.liquidadoEm), ['2030-03-01', '2030-03-05']);
});

test('orcamentoDoMes e categoriasParaTeto: sem teto não inventa; referência = mediana dos meses completos', () => {
  const ls = [...['2030-01', '2030-02', '2030-03'].map((m, i) => gasto(m, '01', 'mercado', [300, 500, 400][i])), gasto('2030-03', '02', 'lazer', 95), gasto('2030-03', '03', 'emprestimo', 999)];
  const sem = orcamentoDoMes(ls, '2030-03', null);
  assert.equal(sem.temTeto, false);
  assert.ok(sem.linhas.every((l) => l.teto === null && l.situacao === 'sem-teto'));
  const com = orcamentoDoMes(ls, '2030-03', { mercado: 350, lazer: 100 });
  const s = Object.fromEntries(com.linhas.map((l) => [l.categoria, l.situacao]));
  assert.deepEqual(s, { emprestimo: 'sem-teto', mercado: 'acima', lazer: 'perto' });
  assert.deepEqual([com.tetoTotal, com.gastoComTeto, com.acima], [450, 495, 1]);
  const cats = categoriasParaTeto(ls, '2030-04', { farmacia: 80 });
  assert.deepEqual(cats.map((c) => [c.categoria, c.referencia, c.teto]), [['mercado', 400, null], ['farmacia', 0, 80], ['lazer', 0, null]]);
});

test('entradasPorCliente: previsto do mês, o que entrou e o que falta', () => {
  const ls = [
    entrada('2030-03', '05', 2000, { cliente: 'Cliente Alfa' }),
    L({ tipo: 'entrada', status: 'a-receber', valor: 500, vencimento: '2030-03-26', cliente: 'Cliente Beta' }),
    entrada('2030-03', '10', 300, { cliente: 'Cliente Beta' }),
    entrada('2030-03', '15', 12),
    L({ tipo: 'entrada', status: 'a-receber', valor: 9999, vencimento: '', semPrazo: true, cliente: 'Cliente Alfa', mes: '2030-03' }),
  ];
  const e = entradasPorCliente(ls, '2030-03');
  assert.deepEqual(e.map((x) => [x.cliente, x.previsto, x.recebido, x.falta]), [['Cliente Alfa', 2000, 2000, 0], ['Cliente Beta', 800, 300, 500], ['Sem cliente', 12, 12, 0]]);
});

test('contratosDeRenda: início, fim, sem fim, e o que já acabou fica fora', () => {
  const ls: Lancamento[] = [];
  for (const m of ['2030-03', '2030-04', '2030-05']) {
    ls.push(L({ tipo: 'entrada', status: 'a-receber', valor: 2000, vencimento: `${m}-05`, cliente: 'Fonte Alfa', recorrente: true, descricao: 'Fonte Alfa · mensal' }));
    ls.push(L({ tipo: 'entrada', status: 'a-receber', valor: 500, vencimento: `${m}-26`, cliente: 'Cliente Gama', recorrente: true, ate: '2030-08', descricao: 'Gama · acordo' }));
  }
  ls.push(L({ tipo: 'entrada', status: 'a-receber', valor: 300, vencimento: '2030-04-12', cliente: 'Cliente Delta', categoria: 'parcela', descricao: 'Delta · parcela 3/4' }));
  ls.push(L({ tipo: 'entrada', status: 'recebido', valor: 300, vencimento: '2030-01-12', liquidadoEm: '2030-01-12', cliente: 'Cliente Velho', categoria: 'parcela', descricao: 'Velho · parcela 4/4' }));
  const c = contratosDeRenda(ls, '2030-04');
  assert.deepEqual(c.map((x) => [x.cliente, x.inicio, x.fim, x.semFim, x.valor]), [
    ['Cliente Delta', '2030-04', '2030-04', false, 300],
    ['Cliente Gama', '2030-03', '2030-08', false, 500],
    ['Fonte Alfa', '2030-03', '2030-05', true, 2000],
  ]);
  assert.equal(c[0].rotulo, 'Delta · parcela');
});

test('planoReserva: quanto falta para a meta, ritmo de aporte e o aporte do mês', () => {
  const ap = (m: string, valor: number, pago = true) => L({ tipo: 'reserva', valor, vencimento: `${m}-06`, status: pago ? 'pago' : 'a-pagar', ...(pago ? { liquidadoEm: `${m}-06` } : {}) });
  const ls = [ap('2030-01', 1000), ap('2030-02', 1000), ap('2030-03', 500), ap('2030-04', 300), ap('2030-04', 700, false)];
  const p = planoReserva(ls, 2000, '2030-04', '2030-04');
  assert.deepEqual([p.meta, p.falta, p.ritmo, p.ritmoMeses, p.chegaEm], [5000, 3000, 1000, 3, '2030-07']);
  assert.deepEqual(p.aporte, { mes: '2030-04', guardado: 300, programado: 1000 });
  assert.equal(planoReserva(ls, 6000, '2030-04', '2030-04').chegaEm, '');
});
