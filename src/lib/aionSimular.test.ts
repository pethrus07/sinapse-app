// Testes das contas da simulação do Aion: juros compostos, IR regressivo, desconto da inflação,
// faixa dos cenários, resgate, isenções. Premissas inventadas (Selic 12%, IPCA 4%).
// Rodar: node --test src/lib/aionSimular.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Mercado } from '../types';
import {
  aliquotaRendaFixa, fatorInflacao, fatorRendaFixa, fatorVariavel, olharParaTras, premissasDoMercado, PREMISSAS_PADRAO, retratoNoMes, simular,
  type EntradaSimulacao, type Premissas,
} from './aionSimular.ts';

const prem = (extra: Partial<Premissas> = {}): Premissas => ({
  ...PREMISSAS_PADRAO, pctCdi: { ...PREMISSAS_PADRAO.pctCdi }, volatilidade: { ...PREMISSAS_PADRAO.volatilidade },
  selicPorAno: { 2030: 12, 2031: 12, 2032: 12, 2033: 12, 2034: 12, 2035: 12 }, ipcaPorAno: { 2030: 4, 2031: 4, 2032: 4, 2033: 4, 2034: 4, 2035: 4 },
  spreadCdi: 0, origem: { selic: 't', ipca: 't' }, ...extra,
});
const perto = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const entrada = (e: Partial<EntradaSimulacao>): EntradaSimulacao => ({ inicial: {}, aporteMensal: 0, divisaoAporte: {}, eventos: [], meses: 60, anoHoje: 2030, mesHoje: 1, ...e });

test('IR regressivo da renda fixa pelos dias', () => {
  assert.equal(aliquotaRendaFixa(30), 0.225);
  assert.equal(aliquotaRendaFixa(180), 0.225);
  assert.equal(aliquotaRendaFixa(181), 0.2);
  assert.equal(aliquotaRendaFixa(360), 0.2);
  assert.equal(aliquotaRendaFixa(720), 0.175);
  assert.equal(aliquotaRendaFixa(721), 0.15);
});

test('juros compostos: 12% ao ano em 12 meses dá 12% (taxa mensal equivalente), com o % do CDI', () => {
  perto(fatorRendaFixa(prem(), 'reserva', 'base', 0, 12, 2030, 1), 1.12, 1e-9);
  perto(fatorRendaFixa(prem(), 'reserva', 'base', 0, 24, 2030, 1), 1.12 ** 2, 1e-9);
  const p = prem({ pctCdi: { reserva: 50 } });
  perto(fatorRendaFixa(p, 'reserva', 'base', 0, 12, 2030, 1), 1.06, 1e-9);
  perto(fatorRendaFixa(prem(), 'reserva', 'ruim', 0, 12, 2030, 1), 1.11, 1e-9); // Selic − 1 ponto
  perto(fatorRendaFixa(prem(), 'reserva', 'bom', 0, 12, 2030, 1), 1.13, 1e-9);
});

test('inflação: 4% ao ano desconta 4% em 12 meses; o real é o líquido dividido por ela', () => {
  perto(fatorInflacao(prem(), 12, 2030, 1), 1.04, 1e-9);
  const r = retratoNoMes(entrada({ inicial: { reserva: 1000 } }), prem(), 'base', 12);
  assert.equal(r.bruto, 1120);
  assert.equal(r.ir, 24); // 120 de ganho × 20% (360 dias)
  assert.equal(r.liquido, 1096);
  perto(r.real, 1096 / 1.04);
});

test('IR por lote: aporte novo paga 22,5%, o antigo 15%', () => {
  const e = entrada({ inicial: { reserva: 1000 }, eventos: [{ mes: 30, tipo: 'reserva', valor: 1000 }] });
  const r = retratoNoMes(e, prem(), 'base', 36);
  const gAntigo = 1000 * (1.12 ** 3 - 1);
  const gNovo = 1000 * (1.12 ** 0.5 - 1);
  perto(r.ir, gAntigo * 0.15 + gNovo * 0.225);
});

test('renda variável: base é a mediana lognormal; ruim e bom ficam a ±1 desvio; a faixa abre com o tempo', () => {
  const b = fatorVariavel(12, 20, 1, 'base');
  perto(b, Math.exp(Math.log(1.12) - 0.02), 1e-12);
  perto(fatorVariavel(12, 20, 1, 'bom') / b, Math.exp(0.2), 1e-12);
  perto(fatorVariavel(12, 20, 1, 'ruim') / b, Math.exp(-0.2), 1e-12);
  const faixa = (t: number) => fatorVariavel(12, 20, t, 'bom') - fatorVariavel(12, 20, t, 'ruim');
  assert.ok(faixa(5) > faixa(3) && faixa(3) > faixa(1));
  assert.equal(fatorVariavel(12, 20, 0, 'ruim'), 1);
});

test('cenários: ruim ≤ base ≤ bom em todo horizonte; aporte mensal entra dividido pela regra', () => {
  const e = entrada({ inicial: { reserva: 2000, fii: 1000, acao: 500 }, aporteMensal: 300, divisaoAporte: { reserva: 50, fii: 30, acao: 20 } });
  const s = simular(e, prem());
  for (const h of [12, 36, 60]) {
    const x = s.horizontes[h];
    assert.ok(x.ruim.real <= x.base.real && x.base.real <= x.bom.real, `horizonte ${h}`);
    assert.equal(x.base.aplicado, 3500 + 300 * h);
  }
  assert.ok(s.cenarios.base.length >= 21);
});

test('isenções: ação até R$ 20 mil e cripto até R$ 35 mil não pagam; FII paga 20% (ou menos com parte isenta)', () => {
  const acao = retratoNoMes(entrada({ inicial: { acao: 10000 } }), prem(), 'bom', 12);
  assert.equal(acao.ir, 0);
  const acaoGrande = retratoNoMes(entrada({ inicial: { acao: 30000 } }), prem(), 'bom', 12);
  perto(acaoGrande.ir, (acaoGrande.bruto - 30000) * 0.15);
  const fii = retratoNoMes(entrada({ inicial: { fii: 1000 } }), prem(), 'bom', 12);
  perto(fii.ir, (fii.bruto - 1000) * 0.2);
  const fiiIsento = retratoNoMes(entrada({ inicial: { fii: 1000 } }), prem({ fiiParteIsenta: 1 }), 'bom', 12);
  assert.equal(fiiIsento.ir, 0);
  const perda = retratoNoMes(entrada({ inicial: { acao: 30000 } }), prem(), 'ruim', 12);
  assert.ok(perda.bruto < 30000 && perda.ir === 0); // prejuízo não paga
});

test('resgate tira a fração do que havia do tipo; o "e se" de aportar mais aumenta o resultado', () => {
  const sem = retratoNoMes(entrada({ inicial: { reserva: 1000 } }), prem(), 'base', 24);
  const com = retratoNoMes(entrada({ inicial: { reserva: 1000 }, eventos: [{ mes: 12, tipo: 'reserva', valor: -560 }] }), prem(), 'base', 24);
  perto(com.bruto, sem.bruto * 0.5, 0.02); // no mês 12 havia 1.120: resgatar 560 tira metade
  const mais = retratoNoMes(entrada({ inicial: { reserva: 1000 }, aporteMensal: 100, divisaoAporte: { reserva: 100 } }), prem(), 'base', 24);
  assert.ok(mais.liquido > sem.liquido + 2400);
});

test('premissas do mercado: Focus por ano, ano sem Focus repete o último; spread do CDI medido', () => {
  const m = { versao: 1, geradoEm: '', erros: [], focus: { fonte: 'f', url: 'u', data: '2030-01-03', medianas: { Selic: { 2030: 11, 2031: 10 }, IPCA: { 2030: 4.5 } }, selicPorReuniao: [] }, bcb: { selicMeta: { fonte: 'f', url: 'u', nome: 'n', valor: 11.25, data: '', decisoes: [] }, cdi: { fonte: 'f', url: 'u', nome: 'n', valor: 11.15, data: '' } } } as Mercado;
  const p = premissasDoMercado(m, 2030, 4);
  assert.deepEqual(p.selicPorAno, { 2030: 11, 2031: 10, 2032: 10, 2033: 10 });
  assert.deepEqual(p.ipcaPorAno, { 2030: 4.5, 2031: 4.5, 2032: 4.5, 2033: 4.5 });
  assert.equal(p.spreadCdi, -0.1);
  const vazio = premissasDoMercado(null, 2030, 2);
  assert.deepEqual(vazio.selicPorAno, { 2030: 0, 2031: 0 });
  assert.match(vazio.origem.selic, /sem dado/);
});

test('olhar para trás: aporte no começo do mês rende o mês inteiro; o ganho real desconta o IPCA', () => {
  const cdi = [{ data: '2030-01-01', valor: 1 }, { data: '2030-02-01', valor: 1 }];
  const ipca = [{ data: '2030-01-01', valor: 0.5 }, { data: '2030-02-01', valor: 0.5 }];
  const r = olharParaTras(cdi, ipca, 100, '2030-01')!;
  perto(r.saldo, (100 * 1.01 + 100) * 1.01);
  perto(r.corrigido, (100 * 1.005 + 100) * 1.005);
  perto(r.ganhoReal, r.saldo - r.corrigido);
  assert.equal(olharParaTras(cdi, ipca, 100, '2031-01'), null);
});
