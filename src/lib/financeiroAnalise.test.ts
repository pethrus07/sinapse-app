// Testes das análises do Financeiro. Dados FALSOS (categorias e clientes inventados).
// Rodar: node --test src/lib/financeiroAnalise.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Lancamento } from '../types';
import {
  avisosFinanceiro, clientesRealizado, comRetrato, ehGasto, gastosPorCategoria, grupoDe, lancamentosDaCategoria,
  entradaRecorrente, mesesParciais, patrimonio, posicoesAtuais, recorrenteDoMes, rendaRecorrente, retratoDe,
} from './financeiroAnalise.ts';
import { rotuloCategoria } from './financeiro.ts';

let seq = 0;
function L(p: Partial<Lancamento>): Lancamento {
  seq++;
  const venc = p.vencimento ?? '';
  return { id: 'x' + seq, tipo: 'saida', descricao: 'item ' + seq, valor: 100, vencimento: venc, status: 'pago', mes: (p.liquidadoEm || venc || '2030-03').slice(0, 7), rel: '', ...p } as Lancamento;
}
const gasto = (mes: string, dia: string, categoria: string, valor: number, extra: Partial<Lancamento> = {}) =>
  L({ categoria, valor, vencimento: `${mes}-${dia}`, liquidadoEm: `${mes}-${dia}`, origem: 'teste', ...extra });

test('ehGasto: saída paga e compra no cartão contam; fatura paga, aberto, reserva e investimento não', () => {
  assert.equal(ehGasto(gasto('2030-03', '05', 'mercado', 50)), true);
  assert.equal(ehGasto(gasto('2030-03', '05', 'vestuario', 50, { viaCartao: true })), true);
  assert.equal(ehGasto(gasto('2030-03', '05', 'cartao', 900)), false);
  assert.equal(ehGasto(L({ status: 'a-pagar', categoria: 'moradia' })), false);
  assert.equal(ehGasto(L({ tipo: 'reserva', categoria: 'reserva' })), false);
  assert.equal(ehGasto(L({ tipo: 'investimento', status: 'posicao' })), false);
});

test('mesesParciais: o mês em que o banco começou no meio, os de antes e o de hoje', () => {
  const ls = [gasto('2030-01', '24', 'mercado', 10), gasto('2030-02', '03', 'mercado', 10)];
  const p = mesesParciais(ls, '2030-04');
  assert.ok(p.has('2030-01') && p.has('2029-12') && p.has('2030-04'));
  assert.ok(!p.has('2030-02') && !p.has('2030-03'));
});

test('gastosPorCategoria: média de 3 meses completos (sem o parcial e sem pontual) e destaque do que fugiu', () => {
  const ls = [
    gasto('2030-01', '20', 'mercado', 999), // mês parcial: fora da média
    ...['2030-02', '2030-03', '2030-04'].map((m) => gasto(m, '10', 'mercado', 400)),
    gasto('2030-05', '10', 'mercado', 700), // +300 sobre 400: acima
    ...['2030-02', '2030-03', '2030-04'].map((m) => gasto(m, '12', 'transporte', 200)),
    gasto('2030-05', '12', 'transporte', 220), // +20: dentro
    gasto('2030-05', '15', 'casa', 1500, { pontual: true }), // pontual: não vira "nova"
    gasto('2030-05', '16', 'lazer', 180), // não existia: nova
  ];
  const g = gastosPorCategoria(ls, '2030-06', '2030-05');
  assert.deepEqual(g.meses, ['2030-03', '2030-04', '2030-05', '2030-06']);
  assert.equal(g.foco, '2030-05');
  const por = Object.fromEntries(g.linhas.map((l) => [l.categoria, l]));
  assert.equal(por.mercado.media, 400);
  assert.equal(por.mercado.baseMedia, 3);
  assert.equal(por.mercado.desvio, 'acima');
  assert.equal(por.transporte.desvio, '');
  assert.equal(por.casa.atual, 1500);
  assert.equal(por.casa.atualRecorrente, 0);
  assert.equal(por.casa.desvio, '');
  assert.equal(por.lazer.desvio, 'nova');
  assert.equal(g.linhas[0].categoria, 'casa'); // ordem: maior gasto no foco
  assert.equal(g.totais[2], 700 + 220 + 1500 + 180);
  // mês em andamento: "abaixo" não vale (o mês não acabou)
  const ls2 = [...['2030-02', '2030-03', '2030-04'].map((m) => gasto(m, '10', 'mercado', 400)), gasto('2030-05', '02', 'mercado', 50)];
  assert.equal(gastosPorCategoria(ls2, '2030-05').linhas[0].desvio, '');
  // sem meses completos antes: sem média (não chuta)
  const novo = gastosPorCategoria([gasto('2030-05', '20', 'mercado', 100)], '2030-06', '2030-05');
  assert.equal(novo.linhas[0].media, null);
});

test('lancamentosDaCategoria: só os gastos daquela categoria naquele mês', () => {
  const a = gasto('2030-05', '03', 'mercado', 30), b = gasto('2030-05', '01', 'mercado', 20);
  const ls = [a, b, gasto('2030-04', '03', 'mercado', 10), gasto('2030-05', '03', 'lazer', 10)];
  assert.deepEqual(lancamentosDaCategoria(ls, 'mercado', '2030-05').map((l) => l.id), [b.id, a.id]);
});

test('recorrenteDoMes: gasto recorrente sem os pontuais e sobra recorrente', () => {
  const ls = [
    gasto('2030-05', '03', 'mercado', 600),
    gasto('2030-05', '10', 'emprestimo', 1700, { pontual: true, descricao: 'Empréstimo' }),
    gasto('2030-05', '11', 'cartao', 900), // fatura: fora
    L({ tipo: 'entrada', status: 'recebido', valor: 2650, vencimento: '2030-05-05', liquidadoEm: '2030-05-05', recorrente: true }),
    L({ tipo: 'entrada', status: 'a-receber', valor: 300, vencimento: '2030-05-20', recorrente: true }),
    L({ tipo: 'entrada', status: 'recebido', valor: 999, vencimento: '2030-05-07', liquidadoEm: '2030-05-07' }), // pontual de entrada: fora
  ];
  const r = recorrenteDoMes(ls, '2030-05');
  assert.deepEqual([r.gasto, r.pontual, r.gastoRecorrente, r.entradasRecorrentes, r.sobraRecorrente], [2300, 1700, 600, 2950, 2350]);
  assert.deepEqual(r.pontuais, [{ descricao: 'Empréstimo', valor: 1700 }]);
});

test('grupoDe: classe, liquidez e nome', () => {
  assert.equal(grupoDe({ classe: 'CDB', liquidez: 'diaria' }), 'CDB liquidez diária');
  assert.equal(grupoDe({ classe: 'CDB', liquidez: 'no-vencimento' }), 'Renda fixa');
  assert.equal(grupoDe({ classe: 'FII', liquidez: 'bolsa-d2' }), 'FII');
  assert.equal(grupoDe({ classe: 'Ação' }), 'Ação');
  assert.equal(grupoDe({ classe: 'cripto' }), 'Cripto');
  assert.equal(grupoDe({ descricao: 'Bitcoin na corretora' }), 'Cripto');
  assert.equal(grupoDe({ liquidez: 'diaria' }), 'CDB liquidez diária');
  assert.equal(grupoDe({}), 'Outros');
});

const pos = (p: Partial<Lancamento>) => L({ tipo: 'investimento', status: 'posicao', vencimento: '', ...p });

test('posicoesAtuais: duas aplicações com o mesmo nome não se fundem; resgatada some; manual fica pela última data', () => {
  const ls = [
    pos({ descricao: 'CDB Banco · liquidez diária', classe: 'CDB', liquidez: 'diaria', valor: 100, data: '2030-04-30', origem: 'pluggy', fitid: 'aaaa-2030-04' }),
    pos({ descricao: 'CDB Banco · liquidez diária', classe: 'CDB', liquidez: 'diaria', valor: 1000, data: '2030-05-03', origem: 'pluggy', fitid: 'aaaa-2030-05' }),
    pos({ descricao: 'CDB Banco · liquidez diária', classe: 'CDB', liquidez: 'diaria', valor: 500, data: '2030-05-03', origem: 'pluggy', fitid: 'bbbb-2030-05' }),
    pos({ descricao: 'FII FALS11', classe: 'FII', liquidez: 'bolsa-d2', valor: 300, data: '2030-04-30', origem: 'pluggy', fitid: 'cccc-2030-04' }), // resgatado: não veio na última
    pos({ descricao: 'Cripto', instituicao: 'Corretora X', classe: 'cripto', valor: 80, data: '2030-04-01' }),
    pos({ descricao: 'Cripto', instituicao: 'Corretora X', classe: 'cripto', valor: 120, data: '2030-04-20' }),
  ];
  const a = posicoesAtuais(ls);
  assert.deepEqual(a.map((p) => [p.grupo, p.valor]), [['CDB liquidez diária', 1000], ['CDB liquidez diária', 500], ['Cripto', 120]]);
  const p = patrimonio(ls, [], '2030-05-03');
  assert.equal(p.total, 1620);
  assert.equal(p.reservaLiquida, 1500);
  assert.equal(p.falta, 3500);
  assert.deepEqual(p.porGrupo, [{ grupo: 'CDB liquidez diária', valor: 1500 }, { grupo: 'Cripto', valor: 120 }]);
});

test('retrato: um por dia; o de hoje substitui o do mesmo dia, nunca duplica', () => {
  const r1 = retratoDe([{ grupo: 'FII', liquidez: 'bolsa-d2', valor: 300 }, { grupo: 'CDB liquidez diária', liquidez: 'diaria', valor: 700 }], '2030-05-01');
  assert.deepEqual(r1, { data: '2030-05-01', total: 1000, diaria: 700, porGrupo: { FII: 300, 'CDB liquidez diária': 700 } });
  const r2 = { ...r1, total: 1100 };
  const lista = comRetrato(comRetrato([], r1), r2);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].total, 1100);
  assert.equal(comRetrato(lista, { ...r1, data: '2030-04-30' })[0].data, '2030-04-30');
});

test('clientesRealizado: pago, quando, atraso em dias e o que falta até o fim', () => {
  const e = (p: Partial<Lancamento>) => L({ tipo: 'entrada', cliente: 'Cliente Alfa', valor: 500, ...p });
  const ls = [
    e({ vencimento: '2030-03-26', status: 'recebido', liquidadoEm: '2030-03-28' }), // 2 dias de atraso
    e({ vencimento: '2030-04-26', status: 'recebido', liquidadoEm: '2030-04-26' }), // em dia
    e({ vencimento: '2030-05-26', status: 'a-receber' }), // vencido em 05/06
    e({ vencimento: '2030-06-26', status: 'a-receber' }),
    e({ vencimento: '', status: 'a-receber', semPrazo: true, valor: 9999 }), // sem prazo aberto: fora
    e({ vencimento: '', status: 'recebido', semPrazo: true, valor: 100, liquidadoEm: '2030-05-02' }), // sem prazo pago: conta
    L({ tipo: 'entrada', cliente: '', valor: 50, status: 'recebido' }),
  ];
  const [c] = clientesRealizado(ls, '2030-06-05');
  assert.deepEqual([c.cliente, c.recebido, c.vencido, c.diasVencido, c.falta, c.fim, c.atrasoMedio], ['Cliente Alfa', 1100, 500, 10, 1000, '2030-06', 2]);
  assert.deepEqual(c.pagamentos.map((p) => [p.pagoEm, p.atraso]), [['2030-05-02', 0], ['2030-04-26', 0], ['2030-03-28', 2]]);
});

test('avisosFinanceiro: fatura nos próximos 5 dias, falha da sincronização, parada e a classificar', () => {
  const ls = [
    L({ categoria: 'cartao', status: 'a-pagar', vencimento: '2030-05-06', valor: 604.28, confianca: 'medido' }),
    L({ categoria: 'cartao', status: 'a-pagar', vencimento: '2030-06-06', valor: 300 }), // longe
    L({ categoria: 'a classificar', valor: 20 }), L({ categoria: 'a classificar', valor: 30 }),
  ];
  const a = avisosFinanceiro(ls, '2030-05-03', { ultimaSync: '2030-05-02T20:00:00Z', ultimaFalha: { em: '2030-05-03T20:00:00Z', mensagem: 'rede' } });
  assert.deepEqual(a.map((x) => x.tipo), ['fatura', 'sync-falhou', 'a-classificar']);
  assert.deepEqual(a[0], { tipo: 'fatura', valor: 604.28, vencimento: '2030-05-06', dias: 3, medido: true });
  assert.deepEqual(a[2], { tipo: 'a-classificar', qtd: 2, valor: 50 });
  // falha antiga (antes da última que deu certo) não avisa; sincronização parada há 5 dias avisa
  const b = avisosFinanceiro([], '2030-05-08', { ultimaSync: '2030-05-03T20:00:00Z', ultimaFalha: { em: '2030-05-01T20:00:00Z', mensagem: 'x' } });
  assert.deepEqual(b, [{ tipo: 'sync-parada', desde: '2030-05-03', dias: 5 }]);
});

test('entradaRecorrente: recorrente, contrato em sequência (k/n ou 2+ meses); projeto e parcela solta não', () => {
  const e = (p: Partial<Lancamento>) => L({ tipo: 'entrada', status: 'a-receber', cliente: 'Cliente Alfa', ...p });
  const parceria = e({ categoria: 'mensalidade', descricao: 'Alfa · parceria, parcela 1/6', vencimento: '2030-05-05' });
  const serieA = e({ categoria: 'parcela', descricao: 'Beta · plataformas', vencimento: '2030-05-26', cliente: 'Cliente Beta' });
  const serieB = e({ categoria: 'parcela', descricao: 'Beta · plataformas', vencimento: '2030-06-26', cliente: 'Cliente Beta' });
  const solta = e({ categoria: 'parcela', descricao: 'Publicação na loja', vencimento: '2030-05-21' });
  const projeto = e({ categoria: 'projeto', descricao: 'Etapa 2/3', vencimento: '2030-05-20' });
  const marcada = e({ recorrente: true, categoria: 'salario', vencimento: '2030-05-05' });
  const ls = [parceria, serieA, serieB, solta, projeto, marcada];
  assert.deepEqual(ls.map((l) => entradaRecorrente(l, ls)), [true, true, true, false, false, true]);
  assert.equal(entradaRecorrente({ ...marcada, pontual: true }, ls), false);
});

test('rendaRecorrente: até quando a renda que se repete se sustenta (queda no mês depois do razão)', () => {
  const e = (mes: string, valor: number, p: Partial<Lancamento> = {}) => L({ tipo: 'entrada', status: 'a-receber', valor, vencimento: `${mes}-05`, mes, ...p });
  const ls: Lancamento[] = [];
  for (const m of ['2030-05', '2030-06', '2030-07']) {
    ls.push(e(m, 2000, { recorrente: true, cliente: 'Salário' }));                                  // sem fim
    ls.push(e(m, 1000, { recorrente: true, ate: '2030-07', cliente: 'Cliente Alfa' }));              // acaba em jul
    ls.push(e(m, 300, { categoria: 'parcela', descricao: `Beta · parcela ${m.slice(5)}/12`, cliente: 'Cliente Beta' }));
  }
  ls.push(gasto('2030-04', '10', 'mercado', 1800), gasto('2030-03', '10', 'mercado', 1800), gasto('2030-02', '01', 'mercado', 1800));
  const r = rendaRecorrente(ls, '2030-05');
  assert.deepEqual(r.meses, ['2030-05', '2030-06', '2030-07', '2030-08']);
  assert.deepEqual(r.entradas, [3300, 3300, 3300, 2000]);
  assert.equal(r.gastoBase, 1800);
  assert.deepEqual([r.ateQuando, r.caiEm, r.antes, r.depois, r.semFim], ['2030-07', '2030-08', 3300, 2000, 2000]);
  assert.deepEqual(r.sobra, [1500, 1500, 1500, 200]);
});

test('clientesRealizado: salário sem data de fim é "sem fim", contrato com ate não', () => {
  const ls = [
    L({ tipo: 'entrada', cliente: 'Fonte Alfa', recorrente: true, status: 'a-receber', vencimento: '2030-06-05' }),
    L({ tipo: 'entrada', cliente: 'Cliente Beta', recorrente: true, ate: '2030-09', status: 'a-receber', vencimento: '2030-06-26' }),
  ];
  const por = Object.fromEntries(clientesRealizado(ls, '2030-06-01').map((c) => [c.cliente, c.semFim]));
  assert.deepEqual(por, { 'Fonte Alfa': true, 'Cliente Beta': false });
});

test('rotuloCategoria: rótulo de tela com acento; o id não muda', () => {
  assert.equal(rotuloCategoria('emprestimo'), 'Empréstimo');
  assert.equal(rotuloCategoria('alimentacao'), 'Alimentação');
  assert.equal(rotuloCategoria('pix a pessoa física'), 'Pix a pessoa física');
  assert.equal(rotuloCategoria('algo novo'), 'Algo novo');
  assert.equal(rotuloCategoria(''), 'Sem categoria');
});
