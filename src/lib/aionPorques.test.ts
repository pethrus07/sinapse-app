// Testes dos porquês do Aion: cada fonte devolve o tipo certo (causa, fato, opinião, estimativa,
// hipótese, sem notícia), com fonte e data; sem nada ligado, o pop-up diz isso em vez de inventar.
// Dados de mercado inventados (TEST3, FUND11, datas em 2030). Rodar: node --test src/lib/aionPorques.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Aion, Mercado } from '../types';
import { FONTES_PORQUE, porquesDoAlvo, todosOsPorques, type FontePorque } from './aionPorques.ts';

const mercado = (): Mercado => ({
  versao: 1, geradoEm: '2030-03-10T12:00:00Z', erros: [],
  bcb: {
    cdi: { fonte: 'BC', url: 'u', nome: 'n', valor: 12, data: '2030-03-09' },
    ipca: { fonte: 'Banco Central, SGS 433', url: 'u', nome: 'n', mensal: [{ data: '2030-01-01', valor: 0.4 }, { data: '2030-02-01', valor: 0.6 }], doze: 5, ultimo: { data: '2030-02-01', valor: 0.6 } },
    dolar: { fonte: 'BC', url: 'u', nome: 'n', valor: 5.5, data: '2030-03-09', pontos: [{ data: '2030-02-09', valor: 5 }, { data: '2030-03-09', valor: 5.5 }] },
  },
  copom: { fonte: 'BC Copom', url: 'u', decisoes: [{ numero: 10, data: '2030-02-01', titulo: 'Copom mantém a taxa Selic em 12,00% a.a.', trecho: 'O cenário segue incerto.' }], proxima: { numero: 11, dias: '1 e 2 de abril', decisao: '2030-04-02', fonteData: 'calendário de teste' } },
  focus: { fonte: 'Focus', url: 'u', data: '2030-03-06', medianas: { Selic: { 2030: 11, 2031: 10 }, IPCA: { 2030: 4, 2031: 3.5 } }, selicPorReuniao: [] },
  cotacoes: {
    fonte: 'brapi.dev', url: 'u', comToken: false, semToken: ['FUND11'],
    porCodigo: {
      TEST3: { codigo: 'TEST3', preco: 10, variacaoDia: -3.2, em: '2030-03-10T15:00:00', proventos: [{ tipo: 'DIVIDENDO', valor: 0.3, pagamento: '2030-04-01', aprovado: '', dataCom: '2030-03-07', dataEx: '2030-03-08' }] },
      CALM3: { codigo: 'CALM3', preco: 20, variacaoDia: 0.4, em: '2030-03-10T15:00:00' },
    },
  },
  cvm: { fonte: 'CVM', url: 'u', nota: '', fatos: [{ codigo: 'TEST3', data: '2030-03-01', assunto: 'Venda de ativo', url: 'https://cvm/doc' }], empresas: { TEST3: { cnpj: 'x', nome: 'EMPRESA TESTE' } }, semEmpresa: ['FUND11'] },
});
const aion = (m: Mercado | null = mercado()): Aion => ({ mercado: m, observacao: null, regra: null, metas: null, estudo: null, trilha: { nota: '', rel: '', blocos: [] }, chaves: { brapi: false, coingecko: false }, erros: [] });
const ctx = { hoje: '2030-03-10' };

test('Selic: a decisão do Copom é causa conhecida; o texto do comunicado é opinião de quem disse', () => {
  const e = porquesDoAlvo('selic', aion(), ctx, undefined, 10);
  const causa = e.itens.find((p) => p.id === 'copom-10')!;
  assert.equal(causa.tipo, 'causa');
  assert.equal(causa.bloco, 2);
  const op = e.itens.find((p) => p.tipo === 'opiniao')!;
  assert.equal(op.quem, 'Comitê de Política Monetária do BC');
  assert.match(op.texto, /incerto/);
  assert.ok(e.itens.some((p) => p.tipo === 'estimativa' && p.fonteId === 'focus'));
  assert.equal(e.semNoticia, '');
});

test('ativo: data ex recente é causa; fato relevante é fato; queda grande sem outra fonte = sem notícia', () => {
  const e = porquesDoAlvo('TEST3', aion(), ctx, undefined, 10);
  const tipos = Object.fromEntries(e.itens.map((p) => [p.fonteId, p.tipo]));
  assert.deepEqual(tipos, { movimento: 'sem-noticia', proventos: 'causa', cvm: 'fato' });
  assert.ok(e.itens.every((p) => p.fonte.nome && p.data));
  assert.ok(e.faltando.includes('notícia em tempo real: fonte ainda não escolhida'));
});

test('ativo sem cotação e sem token: diz "sem notícia específica" e o que falta, nunca um motivo', () => {
  const e = porquesDoAlvo('FUND11', aion(), ctx);
  assert.equal(e.itens.length, 0);
  assert.match(e.semNoticia, /Sem notícia específica/);
  assert.deepEqual(e.faltando, ['cotação: precisa do token da brapi', 'fato relevante: fundo imobiliário ainda não ligado à CVM', 'notícia em tempo real: fonte ainda não escolhida']);
});

test('variação pequena é hipótese de vaivém normal, não causa', () => {
  const e = porquesDoAlvo('CALM3', aion(), ctx);
  assert.equal(e.itens[0].tipo, 'hipotese');
  assert.match(e.itens[0].texto, /vaivém normal/);
});

test('sem mercado nenhum: nenhum porquê, nenhum erro', () => {
  assert.deepEqual(todosOsPorques(aion(null), ctx), []);
  assert.match(porquesDoAlvo('reserva', aion(null), ctx).semNoticia, /Sem notícia ligada/);
});

test('camada de fontes: fonte nova entra sem mudar o resto; a de notícia em tempo real está desligada', () => {
  const noticias = FONTES_PORQUE.find((f) => f.id === 'noticias')!;
  assert.equal(noticias.ligada, false);
  assert.equal(noticias.tempoReal, true);
  const falsa: FontePorque = { id: 'falsa', nome: 'Notícia falsa', tempoReal: true, ligada: true, explica: '', porques: () => [{ id: 'n1', alvos: ['FUND11'], data: '2030-03-10', titulo: 'Fundo anuncia algo', texto: '...', tipo: 'fato', fonte: { nome: 'Fonte X', url: 'u' }, bloco: 5, fonteId: 'falsa' }] };
  const todos = todosOsPorques(aion(), ctx, [...FONTES_PORQUE, falsa]);
  const e = porquesDoAlvo('FUND11', aion(), ctx, todos);
  assert.equal(e.itens[0].titulo, 'Fundo anuncia algo');
  assert.equal(e.semNoticia, '');
  // ordem: mais novo primeiro
  assert.ok(todos.every((p, i) => i === 0 || todos[i - 1].data >= p.data));
});

test('IPCA traz o juro real do CDI com a conta à vista', () => {
  const p = porquesDoAlvo('ipca', aion(), ctx).itens.find((x) => x.fonteId === 'ipca')!;
  assert.equal(p.tipo, 'fato');
  assert.match(p.texto, /6,67%/); // 1,12 / 1,05 − 1
});
