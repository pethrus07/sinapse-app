// Testes das agregações dos gráficos. Dados FALSOS (clientes "Alfa", "Beta"...): nenhum
// valor real do razão entra no repo. Rodar: node --test src/lib/financeiroGraficos.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Lancamento } from '../types';
import {
  aReceberVencido, cartaoFuturo, confiancaDe, diasEntre, ehEstavel, fluxoMensal, investimentos,
  mesPrevisto, mesRealizado, OUTROS, receitaPorCliente, reservaAcumulada, somarMes,
} from './financeiroGraficos.ts';

let seq = 0;
function L(p: Partial<Lancamento>): Lancamento {
  const venc = p.vencimento ?? '';
  return {
    id: 'l' + seq++, tipo: 'entrada', descricao: 'x', valor: 100, vencimento: venc,
    status: p.tipo === 'saida' || p.tipo === 'reserva' ? 'a-pagar' : 'a-receber',
    mes: p.mes ?? (venc ? venc.slice(0, 7) : '2030-01'), rel: '', ...p,
  } as Lancamento;
}

test('somarMes vira o ano', () => {
  assert.equal(somarMes('2030-12', 1), '2031-01');
  assert.equal(somarMes('2030-01', -1), '2029-12');
  assert.equal(somarMes('2030-04', 13), '2031-05');
});

test('mesPrevisto usa vencimento, senão o arquivo; mesRealizado usa liquidadoEm', () => {
  assert.equal(mesPrevisto(L({ vencimento: '2030-02-05', mes: '2030-02' })), '2030-02');
  assert.equal(mesPrevisto(L({ vencimento: '', mes: '2030-03' })), '2030-03');
  assert.equal(mesRealizado(L({ vencimento: '2030-02-28', status: 'recebido', liquidadoEm: '2030-03-02' })), '2030-03');
  assert.equal(mesRealizado({ ...L({ vencimento: '2030-02-28', status: 'recebido' }), recebido_em: '2030-04-01' } as Lancamento), '2030-04');
});

test('fluxoMensal separa realizado de previsto e conta o liquidado no mês em que mexeu', () => {
  const ls = [
    L({ vencimento: '2030-01-10', valor: 1000, status: 'recebido', liquidadoEm: '2030-02-03' }),
    L({ vencimento: '2030-01-20', valor: 300 }),
    L({ tipo: 'saida', vencimento: '', mes: '2030-01', valor: 200 }),
    L({ tipo: 'saida', vencimento: '2030-02-05', valor: 50, status: 'pago', liquidadoEm: '2030-02-05' }),
    L({ tipo: 'reserva', mes: '2030-02', valor: 400 }),
    L({ tipo: 'saida', mes: '2030-02', valor: 9999, semPrazo: true }), // sem cronograma: fora
    L({ tipo: 'investimento', mes: '2030-02', valor: 5000, status: 'posicao' }), // saldo: fora
  ];
  const f = fluxoMensal(ls);
  assert.deepEqual(f.map((x) => x.mes), ['2030-01', '2030-02']);
  assert.deepEqual(f[0].entra, { realizado: 0, previsto: 300 });
  assert.deepEqual(f[0].sai, { realizado: 0, previsto: 200 });
  assert.deepEqual(f[1].entra, { realizado: 1000, previsto: 0 });
  assert.deepEqual(f[1].sai, { realizado: 50, previsto: 0 });
  assert.deepEqual(f[1].guarda, { realizado: 0, previsto: 400 });
});

test('fluxoMensal preenche mês vazio no meio do razão', () => {
  const f = fluxoMensal([L({ vencimento: '2030-01-10' }), L({ vencimento: '2030-03-10' })]);
  assert.deepEqual(f.map((x) => x.mes), ['2030-01', '2030-02', '2030-03']);
});

test('ehEstavel: recorrente sem fim é estável; `ate` antes do mês seguinte não é; parcela nunca', () => {
  assert.equal(ehEstavel(L({ recorrente: true }), '2030-05'), true);
  assert.equal(ehEstavel(L({ recorrente: true, ate: '2030-04' }), '2030-05'), false);
  assert.equal(ehEstavel(L({ recorrente: true, ate: '2030-06' }), '2030-05'), true);
  assert.equal(ehEstavel(L({ recorrente: false }), '2030-05'), false);
  assert.equal(ehEstavel(L({ tipo: 'saida', recorrente: true }), '2030-05'), false);
});

test('receitaPorCliente: queda depois do razão, estáveis embaixo, cor fixa por cliente', () => {
  const ls: Lancamento[] = [];
  for (const m of ['2030-01', '2030-02', '2030-03']) {
    ls.push(L({ cliente: 'Alfa', vencimento: m + '-05', valor: 2000, recorrente: true }));
    ls.push(L({ cliente: 'Beta', vencimento: m + '-20', valor: 250, recorrente: true }));
    ls.push(L({ cliente: 'Gama', vencimento: m + '-26', valor: 500, recorrente: true, ate: '2030-03' }));
  }
  ls.push(L({ cliente: 'Delta', vencimento: '2030-01-10', valor: 700 })); // parcela: termina em jan
  const r = receitaPorCliente(ls);
  assert.deepEqual(r.meses, ['2030-01', '2030-02', '2030-03', '2030-04']);
  assert.equal(r.mesDepois, '2030-04');
  assert.equal(r.estavel, 2250);
  assert.deepEqual(r.totais, [3450, 2750, 2750, 2250]);
  // estáveis primeiro (embaixo da pilha), depois quem termina por último
  assert.deepEqual(r.series.map((s) => s.cliente), ['Alfa', 'Beta', 'Gama', 'Delta']);
  const gama = r.series.find((s) => s.cliente === 'Gama')!;
  assert.equal(gama.fim, '2030-03');
  assert.equal(gama.valores[3], 0);
  assert.equal(r.series.find((s) => s.cliente === 'Alfa')!.fim, '');
  // slot segue o total no razão inteiro, não a posição na pilha
  assert.equal(r.series.find((s) => s.cliente === 'Alfa')!.slot, 0);
  assert.equal(gama.slot, 1);
});

test('receitaPorCliente dobra a cauda em "Outros" sem passar do máximo de séries', () => {
  const ls = ['A', 'B', 'C', 'D'].map((c, i) => L({ cliente: c, vencimento: '2030-01-05', valor: 100 * (4 - i) }));
  const r = receitaPorCliente(ls, 3);
  assert.deepEqual(r.series.map((s) => s.cliente).sort(), ['A', 'B', OUTROS].sort());
  assert.equal(r.series.find((s) => s.cliente === OUTROS)!.valores[0], 300);
  assert.equal(r.series.find((s) => s.cliente === OUTROS)!.slot, 2);
});

test('reservaAcumulada sem saldo de partida: base zero e o buraco declarado', () => {
  const ls = ['2030-01', '2030-02', '2030-03'].map((m) => L({ tipo: 'reserva', mes: m, valor: 2000 }));
  ls[0].status = 'pago'; ls[0].liquidadoEm = '2030-01-15';
  const r = reservaAcumulada(ls, '2030-02', 5000);
  assert.equal(r.base, 0);
  assert.equal(r.baseEm, '');
  assert.deepEqual(r.pontos, [
    { mes: '2030-01', guardado: 2000, programado: 2000 },
    { mes: '2030-02', guardado: 2000, programado: 4000 },
    { mes: '2030-03', guardado: null, programado: 6000 },
  ]);
  assert.equal(r.cruzaPisoEm, '2030-03');
});

test('reservaAcumulada parte da posição de investimento marcada reserva e não soma aporte anterior a ela', () => {
  const ls = [
    L({ tipo: 'reserva', mes: '2030-01', valor: 1000 }),
    L({ tipo: 'reserva', mes: '2030-02', valor: 1000 }),
    L({ tipo: 'investimento', descricao: 'Caixinha', instituicao: 'Banco X', liquidez: 'diaria', reserva: true, data: '2030-01-31', mes: '2030-01', valor: 5200, status: 'posicao' }),
  ];
  const r = reservaAcumulada(ls, '2030-02', 5000);
  assert.equal(r.base, 5200);
  assert.equal(r.baseEm, '2030-01-31');
  assert.deepEqual(r.pontos.map((p) => p.programado), [5200, 6200]);
  assert.equal(r.cruzaPisoEm, '2030-01');
});

test('aReceberVencido: só entrada aberta com data passada, dias de atraso por cliente', () => {
  const ls = [
    L({ cliente: 'Alfa', vencimento: '2030-01-05', valor: 2000 }),
    L({ cliente: 'Beta', vencimento: '2030-01-20', valor: 100 }),
    L({ cliente: 'Beta', vencimento: '2030-01-28', valor: 100 }),
    L({ cliente: 'Gama', vencimento: '2030-02-10', valor: 100 }), // futuro
    L({ cliente: 'Delta', vencimento: '', valor: 100 }),           // sem data: indefinido, não atraso
    L({ cliente: 'Eps', vencimento: '2030-01-01', valor: 100, status: 'recebido' }),
  ];
  const v = aReceberVencido(ls, '2030-02-03');
  assert.deepEqual(v.map((x) => [x.cliente, x.total, x.diasMax]), [['Alfa', 2000, 29], ['Beta', 200, 14]]);
  assert.equal(diasEntre('2030-02-28', '2030-03-01'), 1);
});

test('confiancaDe lê o campo ou a obs, e o extrapolado não vira "medido"', () => {
  assert.equal(confiancaDe(L({ confianca: 'medido', obs: 'EXTRAPOLADO' })), 'medido');
  assert.equal(confiancaDe(L({ obs: 'MEDIDO no banco (01/01).' })), 'medido');
  assert.equal(confiancaDe(L({ obs: 'EXTRAPOLADO, nao medido — conta de parcela' })), 'extrapolado');
  assert.equal(confiancaDe(L({ obs: '⚠️ NAO MEDIDO. estimativa antiga' })), 'estimado');
  assert.equal(confiancaDe(L({ obs: 'Não medido' })), 'estimado');
  assert.equal(confiancaDe(L({ obs: '' })), 'estimado');
});

test('cartaoFuturo: só cartão, do mês de hoje em diante, mês vale o item menos confiável', () => {
  const ls = [
    L({ tipo: 'saida', categoria: 'cartao', vencimento: '2030-01-05', valor: 700, obs: 'NAO MEDIDO' }),
    L({ tipo: 'saida', categoria: 'cartao', vencimento: '2030-02-05', valor: 300, obs: 'MEDIDO' }),
    L({ tipo: 'saida', categoria: 'cartao', vencimento: '2030-03-05', valor: 300, obs: 'MEDIDO' }),
    L({ tipo: 'saida', categoria: 'cartao', vencimento: '2030-03-20', valor: 20, obs: 'EXTRAPOLADO' }),
    L({ tipo: 'saida', categoria: 'moradia', vencimento: '2030-03-05', valor: 500 }),
  ];
  assert.deepEqual(cartaoFuturo(ls, '2030-02').map((c) => [c.mes, c.valor, c.confianca]), [
    ['2030-02', 300, 'medido'], ['2030-03', 320, 'extrapolado'],
  ]);
});

test('investimentos: última posição por aplicação, liquidez diária e série mês a mês', () => {
  const pos = (p: Partial<Lancamento>) => L({ tipo: 'investimento', status: 'posicao', ...p });
  const ls = [
    pos({ instituicao: 'Banco X', descricao: 'Caixinha', liquidez: 'diaria', data: '2030-01-31', valor: 1000 }),
    pos({ instituicao: 'Banco X', descricao: 'Caixinha', liquidez: 'diaria', data: '2030-03-31', valor: 1200 }),
    pos({ instituicao: 'Banco Y', descricao: 'CDB 2032', liquidez: 'no-vencimento', data: '2030-02-28', valor: 3000 }),
  ];
  const i = investimentos(ls);
  assert.equal(i.atuais.length, 2);
  assert.equal(i.total, 4200);
  assert.equal(i.diaria, 1200);
  assert.deepEqual(i.serie, [
    { mes: '2030-01', diaria: 1000, prazo: 0 },
    { mes: '2030-02', diaria: 1000, prazo: 3000 },
    { mes: '2030-03', diaria: 1200, prazo: 3000 },
  ]);
  assert.deepEqual(investimentos([]).serie, []);
});
