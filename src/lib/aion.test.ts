// Testes do modelo do Aion (carteira × regra, rendimento × CDI e IPCA, renda passiva, ritmo de
// aporte, metas). Dados FALSOS: ativos de teste (TEST3, FUND11), valores redondos.
// Rodar: node --test src/lib/aion.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Lancamento, Mercado, RegraAion } from '../types';
import { acumulado, carteiraPorTipo, metasNoRitmo, posicoesAion, rendaPassiva, rendimentoDaCarteira, ritmoDeAporte, tickerDe } from './aion.ts';

let seq = 0;
const L = (p: Partial<Lancamento>): Lancamento => ({ id: 'a' + ++seq, tipo: 'saida', descricao: 'x', valor: 0, vencimento: '', status: 'pago', mes: '2030-03', rel: '', ...p } as Lancamento);
const pos = (descricao: string, classe: string, valor: number, extra: Partial<Lancamento> = {}) =>
  L({ tipo: 'investimento', status: 'posicao', descricao, classe, valor, data: '2030-03-10', origem: 'pluggy', fitid: 'f' + seq + '-2030-03', instituicao: 'Banco Teste', liquidez: classe === 'CDB' ? 'diaria' : 'bolsa-d2', ...extra });

const razao = () => [
  pos('CDB Banco Teste · liquidez diária', 'CDB', 3000),
  pos('FII FUND11', 'FII', 1500),
  pos('Ação TEST3', 'Ação', 500, { codigo: 'TEST3' }),
  L({ tipo: 'investimento', status: 'posicao', descricao: 'Bitcoin', classe: 'cripto', codigo: 'BTC', valor: 1000, data: '2030-03-01', instituicao: 'Carteira' }),
];

test('posições: tipo pela liquidez e pela classe; ticker pelo código ou pela descrição', () => {
  const p = posicoesAion(razao());
  assert.deepEqual(p.map((x) => [x.tipo, x.ticker]), [['reserva', ''], ['fii', 'FUND11'], ['acao', 'TEST3'], ['cripto', 'BTC']]);
  assert.equal(tickerDe({ descricao: 'FII ABCD11 · Banco' }), 'ABCD11');
});

test('carteira × regra: reserva em reais contra o mínimo; o resto em % fora da reserva com tolerância', () => {
  const regra: RegraAion = { reservaMinima: 5000, alocacao: { fii: { alvo: 50, tolerancia: 5 }, acao: { alvo: 30, tolerancia: 5 }, 'renda-fixa': { alvo: 20, tolerancia: 5 } }, aportes: [], naoFazer: [], revisarEm: '', escritaEm: '' };
  const c = carteiraPorTipo(posicoesAion(razao()), regra);
  assert.equal(c.total, 6000);
  assert.equal(c.fora, 3000);
  const por = Object.fromEntries(c.linhas.map((l) => [l.tipo, l]));
  assert.equal(por.reserva.situacao, 'abaixo'); // 3.000 < 5.000
  assert.equal(por.fii.pctFora, 50);
  assert.equal(por.fii.situacao, 'dentro');
  assert.equal(por.acao.desvio, -13.33); // 16,67% contra 30%
  assert.equal(por.acao.situacao, 'abaixo');
  assert.equal(por['renda-fixa'].valor, 0); // tem alvo e não tem posição: aparece com 0
  assert.equal(por['renda-fixa'].situacao, 'abaixo');
  assert.equal(por.cripto.situacao, 'sem-regra'); // tem posição e não está na regra
  const sem = carteiraPorTipo(posicoesAion(razao()), null);
  assert.equal(sem.temRegra, false);
  assert.ok(sem.linhas.filter((l) => l.tipo !== 'reserva').every((l) => l.situacao === 'sem-regra'));
});

const mercado = (): Mercado => ({
  versao: 1, geradoEm: '2030-04-01T12:00:00Z', erros: [],
  bcb: {
    cdiMensal: { fonte: 'f', url: 'u', nome: 'n', pontos: [{ data: '2030-01-01', valor: 1 }, { data: '2030-02-01', valor: 1 }, { data: '2030-03-01', valor: 1 }] },
    ipca: { fonte: 'f', url: 'u', nome: 'n', mensal: [{ data: '2030-01-01', valor: 0.5 }, { data: '2030-02-01', valor: 0.5 }], doze: 6, ultimo: { data: '2030-02-01', valor: 0.5 } },
  },
});

test('acumulado compõe a série mensal; rendimento usa o aplicado e compara com CDI e IPCA do período', () => {
  assert.deepEqual(acumulado(mercado().bcb!.cdiMensal!.pontos, '2030-01', '2030-03'), { pct: 3.03, meses: 3 });
  const ps = posicoesAion([pos('CDB Banco Teste', 'CDB', 1100, { aportado: 1000, desde: '2030-01-15' }), pos('FII FUND11', 'FII', 900)]);
  const r = rendimentoDaCarteira(ps, mercado(), [], '2030-04-01');
  assert.equal(r.base, 'aportado');
  assert.equal(r.ganho, 100);
  assert.equal(r.pct, 10);
  assert.equal(r.cdi!.pct, 3.03);
  assert.equal(r.ipca!.pct, 1);
  assert.equal(r.cobertura, 0.55); // só 1.100 de 2.000 têm base
});

test('rendimento sem aplicado: dois retratos descontam o aporte; um retrato só = sem base', () => {
  const ps = posicoesAion([pos('FII FUND11', 'FII', 900)]);
  const dois = rendimentoDaCarteira(ps, mercado(), [{ data: '2030-01-31', total: 1000 }, { data: '2030-03-31', total: 1300 }], '2030-04-01', 200);
  assert.equal(dois.base, 'retratos');
  assert.equal(dois.ganho, 100);
  assert.equal(dois.cdi!.meses, 2); // fev e mar
  const um = rendimentoDaCarteira(ps, mercado(), [{ data: '2030-03-31', total: 1300 }], '2030-04-01');
  assert.equal(um.base, 'nenhuma');
  assert.equal(um.pct, null);
  assert.match(um.explica, /um retrato/);
});

test('renda passiva: dividendo, JCP e rendimento que entraram no mês; o aberto não conta', () => {
  const ls = [
    L({ tipo: 'entrada', status: 'recebido', descricao: 'Dividendos TEST3', valor: 12.5, liquidadoEm: '2030-03-10' }),
    L({ tipo: 'entrada', status: 'recebido', descricao: 'Pix', categoria: 'rendimentos', valor: 7.5, liquidadoEm: '2030-03-20' }),
    L({ tipo: 'entrada', status: 'a-receber', descricao: 'Rendimento FUND11', valor: 9, vencimento: '2030-03-25' }),
    L({ tipo: 'entrada', status: 'recebido', descricao: 'Cliente', valor: 999, liquidadoEm: '2030-03-05' }),
  ];
  assert.equal(rendaPassiva(ls, '2030-03').total, 20);
});

test('ritmo de aporte: média dos meses fechados, mês sem aporte conta zero; menos de 3 meses é fraca', () => {
  const ls = [
    L({ tipo: 'saida', descricao: 'Mercado', valor: 50, liquidadoEm: '2030-01-05' }), // o razão começa em janeiro
    L({ tipo: 'reserva', descricao: 'Reserva', valor: 300, liquidadoEm: '2030-01-06' }),
    L({ tipo: 'saida', descricao: 'Aplicação FII', categoria: 'investimento', valor: 300, liquidadoEm: '2030-03-10' }),
    L({ tipo: 'reserva', descricao: 'Reserva', valor: 999, liquidadoEm: '2030-04-02' }), // mês de hoje: fora
    L({ tipo: 'reserva', descricao: 'Reserva', valor: 500, status: 'a-pagar', vencimento: '2030-02-10' }), // não pago: fora
  ];
  const r = ritmoDeAporte(ls, '2030-04');
  assert.deepEqual(r.meses, [{ mes: '2030-01', valor: 300 }, { mes: '2030-02', valor: 0 }, { mes: '2030-03', valor: 300 }]);
  assert.equal(r.ritmo, 200);
  assert.equal(r.fraca, false);
  assert.equal(ritmoDeAporte(ls.slice(0, 2), '2030-02').fraca, true);
});

test('metas: o aporte enche a reserva, depois a carteira; sem valor a meta 3 não tem data', () => {
  const [res, car, m3] = metasNoRitmo(4000, 4500, 500, null, 0, '2030-01');
  assert.equal(res.chegaEm, '2030-03'); // faltam 1.000 a R$ 500/mês
  assert.equal(car.chegaEm, '2030-04'); // depois mais 500
  assert.equal(m3.alvo, null);
  assert.equal(m3.chegaEm, '');
  const comJuros = metasNoRitmo(4000, 5000, 500, null, 12, '2030-01');
  assert.equal(comJuros[0].chegaEm, '2030-03'); // com juros chega no mesmo mês ou antes, nunca depois
  const comMeta3 = metasNoRitmo(5000, 5000, 1000, { reserva: 5000, carteira: 5000, meta3: { nome: 'carro', valor: 3000 } }, 0, '2030-01');
  assert.equal(comMeta3[2].chegaEm, '2030-04');
  const semRitmo = metasNoRitmo(100, 0, 0, null, 10, '2030-01');
  assert.equal(semRitmo[0].chegaEm, '');
});
