// Testes das séries dos gráficos do Aion. Dados FALSOS: ativos de teste (TEST3, FUND11), valores
// redondos, anos fictícios (2030). Rodar: node --test src/lib/aionSeries.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Aion, Lancamento, Mercado } from '../types';
import { ritmoDeAporte } from './aion.ts';
import {
  acumulado12, aportesPorMes, avisoPoucoDado, caminhoDasMetas, eventosDoAtivo, patrimonioPorMes, posicaoNa52, rendaPassivaMeses, rendimentoIndexado,
  serieEconomia, variacaoNoDia,
} from './aionSeries.ts';

let seq = 0;
const L = (p: Partial<Lancamento>): Lancamento => ({ id: 's' + ++seq, tipo: 'saida', descricao: 'x', valor: 0, vencimento: '', status: 'pago', mes: '2030-03', rel: '', ...p } as Lancamento);
/** Retrato de um mês: reserva (liquidez diária) + um FII, da mesma sincronização. */
const retrato = (mes: string, reserva: number, fii: number) => [
  L({ tipo: 'investimento', status: 'posicao', descricao: 'CDB Teste · liquidez diária', classe: 'CDB', liquidez: 'diaria', valor: reserva, data: `${mes}-05`, origem: 'pluggy', fitid: `res-${mes}`, instituicao: 'Banco Teste' }),
  L({ tipo: 'investimento', status: 'posicao', descricao: 'FII FUND11', classe: 'FII', liquidez: 'bolsa-d2', valor: fii, data: `${mes}-05`, origem: 'pluggy', fitid: `fii-${mes}`, instituicao: 'Banco Teste' }),
];
const aporte = (mes: string, valor: number) => L({ tipo: 'reserva', descricao: 'Guarda', valor, status: 'pago', vencimento: `${mes}-10`, liquidadoEm: `${mes}-10`, mes });

test('pouco dado: 1 mês diz que é 1 mês; 3 ou mais não avisa', () => {
  assert.equal(avisoPoucoDado(1), '1 mês de dado; o gráfico cresce com o tempo.');
  assert.equal(avisoPoucoDado(2, 'semana'), '2 semanas de dado; o gráfico cresce com o tempo.');
  assert.equal(avisoPoucoDado(3), '');
  assert.match(avisoPoucoDado(0), /Ainda sem meses/);
});

test('patrimônio mês a mês: só os meses com retrato, reserva × resto, posição da sincronização do mês', () => {
  const ls = [...retrato('2030-01', 1000, 500), ...retrato('2030-03', 1300, 520)];
  const p = patrimonioPorMes(ls);
  assert.deepEqual(p.map((x) => [x.mes, x.reserva, x.resto, x.total]), [['2030-01', 1000, 500, 1500], ['2030-03', 1300, 520, 1820]]);
  assert.equal(patrimonioPorMes(retrato('2030-01', 1000, 500)).length, 1); // 1 ponto: o gráfico mostra 1 e avisa
});

test('aportes e renda passiva por mês: começam no primeiro mês do razão; o mês de hoje vem "andando"', () => {
  const ls = [...retrato('2030-01', 1000, 500), aporte('2030-01', 200), aporte('2030-03', 300), aporte('2030-04', 50),
    L({ tipo: 'entrada', descricao: 'Rendimentos FUND11', categoria: 'rendimentos', valor: 5, status: 'recebido', vencimento: '2030-03-15', liquidadoEm: '2030-03-15', mes: '2030-03' })];
  const { meses, ritmo } = aportesPorMes(ls, '2030-04');
  assert.deepEqual(meses.map((m) => [m.mes, m.valor, !!m.andando]), [['2030-01', 200, false], ['2030-02', 0, false], ['2030-03', 300, false], ['2030-04', 50, true]]);
  assert.equal(ritmo.ritmo, 166.67);
  const rp = rendaPassivaMeses(ls, '2030-04');
  assert.deepEqual(rp.map((m) => [m.mes, m.valor]), [['2030-01', 0], ['2030-02', 0], ['2030-03', 5], ['2030-04', 0]]);
});

test('base 100: aporte não vira rendimento; CDI e IPCA compõem a partir do mês seguinte; mês sem retrato fica sem ponto', () => {
  // jan: 1.000; fev: sem retrato, aporte 100; mar: 1.122 → (1.122 − 100) / 1.000 = 1,022 → 102,2
  const pat = [{ mes: '2030-01', data: '2030-01-05', reserva: 1000, resto: 0, total: 1000 }, { mes: '2030-03', data: '2030-03-05', reserva: 1122, resto: 0, total: 1122 }];
  const cdi = [{ data: '2030-01-01', valor: 1 }, { data: '2030-02-01', valor: 1 }, { data: '2030-03-01', valor: 1 }];
  const ipca = [{ data: '2030-02-01', valor: 0.5 }];
  const r = rendimentoIndexado(pat, [{ mes: '2030-02', valor: 100 }], cdi, ipca, '2030-03');
  assert.equal(r.base, '2030-01');
  assert.deepEqual(r.pontos.map((p) => [p.mes, p.carteira, p.cdi, p.ipca]), [['2030-01', 100, 100, 100], ['2030-02', null, 101, 100.5], ['2030-03', 102.2, 102.01, null]]);
  assert.equal(r.aviso, '2 meses de dado; o gráfico cresce com o tempo.');
  const um = rendimentoIndexado(pat.slice(0, 1), [], cdi, ipca, '2030-01');
  assert.equal(um.pontos.length, 1);
  assert.equal(um.aviso, '1 mês de dado; o gráfico cresce com o tempo.');
});

test('economia: CDI e IPCA acumulados em 12 meses começam no 12º mês; Selic vem do mensal', () => {
  const doze = Array.from({ length: 13 }, (_, i) => ({ data: `20${30 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, valor: 1 }));
  const a = acumulado12(doze);
  assert.equal(a.length, 2);
  assert.equal(a[0].valor, 12.68);
  const m = { bcb: { selicMeta: { mensal: [{ data: '2030-01-01', valor: 10 }] }, cdiMensal: { pontos: doze }, ipca: { mensal: doze.slice(0, 5) } } } as unknown as Mercado;
  assert.deepEqual(serieEconomia(m).map((s) => [s.id, s.pontos.length]), [['selic', 1], ['cdi', 2]]); // IPCA com 5 meses: sem 12 meses, não entra
});

test('preço com eventos: resultado, fato relevante, data com e ex, Copom; cada um com fonte; fora do histórico não entra', () => {
  const hist = [{ data: '2030-01-02', fechamento: 10 }, { data: '2030-01-03', fechamento: 9.7 }, { data: '2030-01-06', fechamento: 9.8 }, { data: '2030-01-07', fechamento: 10.2 }];
  const aion = {
    mercado: {
      cotacoes: { porCodigo: { TEST3: { codigo: 'TEST3', preco: 10.2, variacaoDia: 4, em: '2030-01-07', historico: hist, min52: 8, max52: 12, proventos: [{ tipo: 'DIVIDENDO', valor: 0.3, pagamento: '2030-02-01', aprovado: '', dataCom: '2030-01-02', dataEx: '2030-01-03' }] } } },
      cvm: { resultados: [{ codigo: 'TEST3', data: '2030-01-06', assunto: 'Resultado 4T29', url: '' }, { codigo: 'TEST3', data: '2029-06-01', assunto: 'velho', url: '' }], fatos: [{ codigo: 'TEST3', data: '2030-01-07', assunto: 'Venda de ativo', url: 'https://cvm/x' }] },
      copom: { fonte: 'BC', url: 'https://bc', decisoes: [{ numero: 99, data: '2030-01-02', titulo: 'Copom mantém a Selic' }] },
    },
  } as unknown as Aion;
  const ev = eventosDoAtivo('TEST3', aion);
  assert.deepEqual(ev.map((e) => [e.data, e.tipo]), [['2030-01-02', 'data-com'], ['2030-01-02', 'decisao-copom'], ['2030-01-03', 'data-ex'], ['2030-01-06', 'resultado'], ['2030-01-07', 'fato-relevante']]);
  assert.ok(ev.every((e) => e.porque.fonte.nome && e.porque.fonte.url));
  assert.equal(ev.find((e) => e.tipo === 'data-ex')!.porque.tipo, 'causa');
  assert.match(ev.find((e) => e.tipo === 'data-ex')!.porque.texto, /caiu 3,00%/);
  assert.match(ev.find((e) => e.tipo === 'decisao-copom')!.porque.texto, /contexto, não prova/);
  assert.deepEqual(variacaoNoDia(hist, '2030-01-04'), { data: '2030-01-06', pct: 1.03 }); // fim de semana: o próximo pregão
  assert.equal(variacaoNoDia(hist, '2030-01-02'), null); // sem pregão anterior no histórico
  assert.equal(posicaoNa52({ codigo: 'X', preco: 10, min52: 8, max52: 12, variacaoDia: 0, em: '' }), 0.5);
  assert.equal(posicaoNa52({ codigo: 'X', preco: null, variacaoDia: null, em: '' }), null);
  assert.deepEqual(eventosDoAtivo('FUND11', aion), []); // sem histórico de preço: sem eventos
});

test('caminho das metas: realizado + projeção pelo ritmo; faixa de metade a 1,5× quando a estimativa é fraca', () => {
  const ls = [...retrato('2030-03', 4000, 1000), aporte('2030-03', 500)];
  const ritmo = ritmoDeAporte(ls, '2030-04');
  assert.equal(ritmo.fraca, true);
  const c = caminhoDasMetas(patrimonioPorMes(ls), ritmo, { reserva: 5000, carteira: 3000 }, { reserva: 4000, fora: 1000 }, 0, '2030-04');
  assert.equal(c.ritmo, 500);
  assert.equal(c.baixo, 250);
  assert.equal(c.alto, 750);
  assert.equal(c.reserva.chega.base, '2030-06'); // faltam 1.000 a 500/mês: 2 meses
  assert.equal(c.reserva.chega.alto, '2030-06'); // 750 + 750 ≥ 1.000
  assert.equal(c.reserva.chega.baixo, '2030-08'); // 250 × 4
  assert.equal(c.reserva.realizado[0].valor, 4000);
  assert.equal(c.reserva.projecao[0].mes, '2030-04');
  assert.ok(c.reserva.projecao.every((p) => p.baixo <= p.base && p.base <= p.alto));
  assert.equal(c.carteira.chega.base, '2030-10'); // reserva cheia em jun; depois 500/mês: 1.000 + 250 (jun) + 4 × 500 ≥ 3.000 em out
  assert.match(c.faixa, /metade a uma vez e meia/);
});
