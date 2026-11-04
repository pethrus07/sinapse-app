// Testes do coletor e da escrita do Aion. Nada sai para a rede: `pegar` é um fetch falso. Dados
// inventados (ativos de teste, valores redondos); nenhuma posição do Pedro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buscarCotacoes, buscarCripto, cnpjPorTicker, decisoesDaSelic, fatosRelevantes, ipca12m, lerCotacaoBrapi, lerCsvCvm, lerDoZip, lerFocusAnual,
  lerSerieSgs, limitador, ordemReuniao, paragrafoDoComunicado, proximaReuniao, semSegredo,
} from './fontes.mjs';
import { ativosParaColetar, coletar, tickerDe } from './coletar.mjs';
import { gravarAion, gravarBloco, validarObservacao, validarRegra, validarMetas } from './escrita.mjs';
import { blocosDaTrilha, ARQUIVOS_AION } from './indice.mjs';
import { detalhesDoInvestimento } from '../financas/pluggy.mjs';

const resposta = (corpo, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(corpo), arrayBuffer: async () => corpo });

test('SGS: data brasileira vira ISO e a série sai em ordem (a 4389 veio decrescente)', () => {
  const s = lerSerieSgs([{ data: '03/11/2030', valor: '10.5' }, { data: '30/10/2030', valor: '10.4' }, { data: 'x', valor: '1' }]);
  assert.deepEqual(s, [{ data: '2030-10-30', valor: 10.4 }, { data: '2030-11-03', valor: 10.5 }]);
});

test('Selic: cada troca de valor da meta é uma decisão; IPCA 12 meses compõe os 12 últimos', () => {
  const p = [10, 10, 10.5, 10.5, 11].map((v, i) => ({ data: `2030-01-0${i + 1}`, valor: v }));
  assert.deepEqual(decisoesDaSelic(p), [{ desde: '2030-01-03', de: 10, para: 10.5 }, { desde: '2030-01-05', de: 10.5, para: 11 }]);
  const doze = Array.from({ length: 12 }, (_, i) => ({ data: `2030-${String(i + 1).padStart(2, '0')}-01`, valor: 1 }));
  assert.equal(ipca12m(doze), 12.68); // 1,01^12 − 1
  assert.equal(ipca12m(doze.slice(1)), null);
});

test('Focus: só a data mais recente e a base de todos os respondentes', () => {
  const v = [
    { Indicador: 'IPCA', Data: '2030-01-10', DataReferencia: '2030', Mediana: 4, baseCalculo: 0 },
    { Indicador: 'IPCA', Data: '2030-01-10', DataReferencia: '2030', Mediana: 9, baseCalculo: 1 },
    { Indicador: 'IPCA', Data: '2030-01-03', DataReferencia: '2030', Mediana: 3, baseCalculo: 0 },
    { Indicador: 'Selic', Data: '2030-01-10', DataReferencia: '2031', Mediana: 10, baseCalculo: 0 },
  ];
  assert.deepEqual(lerFocusAnual(v, ['2030', '2031']), { data: '2030-01-10', medianas: { IPCA: { 2030: 4 }, Selic: { 2031: 10 } } });
  assert.ok(ordemReuniao('R1/2031') > ordemReuniao('R8/2030'));
});

test('Copom: o parágrafo do comunicado sai sem HTML; a próxima reunião vem do calendário', () => {
  const html = '<div><p>​O ambiente externo permanece <em>incerto</em> e exige cautela por parte de países emergentes.</p><p>Segundo.</p></div>';
  assert.equal(paragrafoDoComunicado(html), 'O ambiente externo permanece incerto e exige cautela por parte de países emergentes.');
  const cal = { fonte: 'teste', reunioes: [{ numero: 11, dias: '1 e 2 de março', decisao: '2030-03-02' }] };
  assert.deepEqual(proximaReuniao([{ numero: 10 }, { numero: 9 }], '2030-02-01', cal), { numero: 11, dias: '1 e 2 de março', decisao: '2030-03-02', fonteData: 'teste' });
  assert.equal(proximaReuniao([{ numero: 12 }], '2031-01-01', cal).dias, ''); // sem data cadastrada: não inventa
});

test('brapi: sem token só os 4 códigos de teste são chamados; o token não aparece em erro', async () => {
  const chamadas = [];
  const pegar = async (url) => { chamadas.push(url); return resposta({ results: [{ symbol: 'PETR4', regularMarketPrice: 10, regularMarketChangePercent: -1.5, regularMarketTime: '2030-01-02T15:00:00Z', historicalDataPrice: [{ date: 1893456000, close: 9.8 }], dividendsData: { cashDividends: [{ label: 'JCP', rate: 0.2, paymentDate: '2030-02-01T03:00:00Z', lastDatePrior: '2030-01-05T03:00:00Z', exDate: '2030-01-06T03:00:00Z' }] } }] }); };
  const r = await buscarCotacoes(pegar, null, ['PETR4', 'TEST11'], '', '2030-01-02');
  assert.equal(chamadas.length, 1);
  assert.deepEqual(r.semToken, ['TEST11']);
  assert.equal(r.cotacoes[0].variacaoDia, -1.5);
  assert.deepEqual(r.cotacoes[0].proventos[0], { tipo: 'JCP', valor: 0.2, pagamento: '2030-02-01', aprovado: '', dataCom: '2030-01-05', dataEx: '2030-01-06' });
  assert.equal(semSegredo('https://x/y?range=1&token=abc123&b=2'), 'https://x/y?range=1&token=***&b=2');
  const falha = async () => resposta({ message: 'Token inválido' }, 401);
  const r2 = await buscarCotacoes(falha, null, ['TEST11'], 'segredo-falso-123', '2030-01-02');
  assert.equal(r2.erros.length, 1);
  assert.ok(!JSON.stringify(r2).includes('segredo-falso-123'));
});

test('CoinGecko: símbolo vira id e a resposta cita a fonte', async () => {
  let pedida = '';
  const pegar = async (url) => { pedida = url; return resposta({ bitcoin: { brl: 100000, brl_24h_change: 2, last_updated_at: 1893456000 } }); };
  const r = await buscarCripto(pegar, null, ['BTC'], '', '2030-01-02');
  assert.match(pedida, /ids=bitcoin/);
  assert.equal(r.citar, 'Data provided by CoinGecko');
  assert.deepEqual(r.cotacoes[0].codigo, 'BTC');
});

test('limitador: teto da rodada e do mês param a fonte', async () => {
  const uso = { '2030-01|brapi.dev': 2 };
  const lim = limitador({ intervaloMs: 0, uso, mes: '2030-01', tetoPorHost: { 'brapi.dev': { mes: 3, rodada: 10 } } });
  await lim.antes('https://brapi.dev/a');
  await assert.rejects(lim.antes('https://brapi.dev/b'), /limite do mês/);
  const lim2 = limitador({ intervaloMs: 0, tetoPorHost: { 'x.io': { mes: 99, rodada: 1 } } });
  await lim2.antes('https://x.io/1');
  await assert.rejects(lim2.antes('https://x.io/2'), /limite da rodada/);
});

/** Zip mínimo (um arquivo, deflate) para testar o leitor. */
function zipDe(nome, conteudo) {
  const dado = deflateRawSync(Buffer.from(conteudo, 'latin1'));
  const n = Buffer.from(nome, 'latin1');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(dado.length, 18); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(dado.length, 20); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const ini = 30 + n.length + dado.length;
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 10); fim.writeUInt32LE(46 + n.length, 12); fim.writeUInt32LE(ini, 16);
  return Buffer.concat([local, n, dado, central, n, fim]);
}

test('CVM: lê o CSV de dentro do zip, liga ticker ao CNPJ e filtra fato relevante recente', () => {
  const fca = 'CNPJ_Companhia;Nome_Empresarial;Codigo_Negociacao\n11.111.111/0001-11;EMPRESA TESTE S.A.;TEST3\n';
  const z = zipDe('fca_valor_mobiliario_2030.csv', fca);
  const mapa = cnpjPorTicker(lerCsvCvm(lerDoZip(z, 'valor_mobiliario_2030.csv')), ['TEST3', 'FUND11']);
  assert.deepEqual(mapa, { TEST3: { cnpj: '11.111.111/0001-11', nome: 'EMPRESA TESTE S.A.' } });
  const ipe = [
    { CNPJ_Companhia: '11.111.111/0001-11', Categoria: 'Fato Relevante', Data_Entrega: '2030-01-20', Assunto: 'Aquisição', Link_Download: 'https://cvm/x' },
    { CNPJ_Companhia: '11.111.111/0001-11', Categoria: 'Assembleia', Data_Entrega: '2030-01-21', Assunto: 'AGO', Link_Download: '' },
    { CNPJ_Companhia: '11.111.111/0001-11', Categoria: 'Fato Relevante', Data_Entrega: '2029-01-01', Assunto: 'Velho', Link_Download: '' },
  ];
  assert.deepEqual(fatosRelevantes(ipe, mapa, '2030-02-01'), [{ codigo: 'TEST3', data: '2030-01-20', assunto: 'Aquisição', url: 'https://cvm/x' }]);
});

test('ativos para coletar: ticker pela descrição ou pelo código; cripto à parte; a lista de observação entra', () => {
  const ls = [
    { tipo: 'investimento', classe: 'Ação', descricao: 'Ação TEST3' },
    { tipo: 'investimento', classe: 'FII', descricao: 'FII', codigo: 'FUND11' },
    { tipo: 'investimento', classe: 'cripto', descricao: 'Bitcoin', codigo: 'BTC' },
    { tipo: 'investimento', classe: 'CDB', descricao: 'CDB Banco X' },
    { tipo: 'saida', descricao: 'Ação TEST4' },
  ];
  assert.equal(tickerDe({ descricao: 'FII FUND11' }), 'FUND11');
  assert.deepEqual(ativosParaColetar(ls, [{ codigo: 'obsv3', tipo: 'acao' }, { codigo: 'ethereum', tipo: 'cripto' }]), { bolsa: ['FUND11', 'OBSV3', 'TEST3'], cripto: ['BTC', 'ethereum'] });
});

test('coletar: rodada inteira com fetch falso; fonte que falha guarda o dado anterior e o erro', async () => {
  const pegar = async (url) => {
    if (url.includes('sgs.432')) return resposta([{ data: '01/01/2030', valor: '10' }, { data: '02/01/2030', valor: '10.5' }]);
    if (url.includes('sgs.')) return resposta([{ data: '01/01/2030', valor: '1' }]);
    if (url.includes('ExpectativasMercadoAnuais')) return resposta({ value: [{ Indicador: 'IPCA', Data: '2030-01-03', DataReferencia: '2030', Mediana: 4, baseCalculo: 0 }] });
    if (url.includes('ExpectativasMercadoSelic')) return resposta({ value: [{ Data: '2030-01-03', Reuniao: 'R1/2030', Mediana: 10.5 }] });
    if (url.includes('comunicados_detalhes')) return resposta({ conteudo: [{ textoComunicado: '<p>Texto falso do comunicado do Copom para teste de leitura.</p>' }] });
    if (url.includes('comunicados')) return resposta({ conteudo: [{ nro_reuniao: 10, dataReferencia: '2030-01-01', titulo: '10ª reunião - Copom eleva a taxa Selic para 10,50% a.a.' }] });
    if (url.includes('brapi')) return resposta({ message: 'fora do ar' }, 500);
    throw new Error('rede não esperada: ' + url);
  };
  const anterior = { cotacoes: { porCodigo: { PETR4: { codigo: 'PETR4', preco: 9, em: '2029-12-31' } }, semToken: [] } };
  const { mercado, uso } = await coletar({ pegar, anterior, hoje: '2030-01-03', agora: '2030-01-03T12:00:00Z', ativos: { bolsa: ['PETR4'], cripto: [] }, so: ['bcb', 'focus', 'copom', 'cotacao'] });
  assert.equal(mercado.bcb.selicMeta.valor, 10.5);
  assert.equal(mercado.bcb.selicMeta.decisoes.length, 1);
  assert.equal(mercado.copom.decisoes[0].titulo, 'Copom eleva a taxa Selic para 10,50% a.a.');
  assert.match(mercado.copom.decisoes[0].trecho, /Texto falso/);
  assert.equal(mercado.focus.medianas.IPCA['2030'], 4);
  assert.equal(mercado.cotacoes.porCodigo.PETR4.preco, 9); // a brapi falhou: ficou o de antes
  assert.ok(mercado.erros.some((e) => e.fonte === 'cotacao:PETR4'));
  assert.equal(uso['2030-01|brapi.dev'], 1);
});

test('escrita: regra precisa somar 100%; observação valida código e recusa texto sensível', () => {
  assert.throws(() => validarRegra({ alocacao: { fii: { alvo: 50 }, acao: { alvo: 30 } } }, '2030-01-01'), /somam 80%/);
  const r = validarRegra({ reservaMinima: '5.000,00', alocacao: { fii: { alvo: '60', tolerancia: '' }, acao: { alvo: 40, tolerancia: 10 } }, aportes: ['todo mês', ''], revisarEm: '2030-06' }, '2030-01-01');
  assert.deepEqual(r, { reservaMinima: 5000, alocacao: { fii: { alvo: 60, tolerancia: 5 }, acao: { alvo: 40, tolerancia: 10 } }, aportes: ['todo mês'], naoFazer: [], revisarEm: '2030-06', escritaEm: '2030-01-01' });
  assert.throws(() => validarObservacao({ ativos: [{ codigo: '../x', tipo: 'acao' }] }, '2030-01-01'), /código inválido/);
  assert.throws(() => validarObservacao({ ativos: [{ codigo: 'TEST3', tipo: 'acao', nota: 'cpf 123.456.789-09' }] }, '2030-01-01'), /parece ter documento/);
  assert.deepEqual(validarObservacao({ ativos: [{ codigo: 'test3', tipo: 'acao' }] }, '2030-01-01').ativos[0], { codigo: 'TEST3', tipo: 'acao', nota: '', desde: '2030-01-01' });
  assert.deepEqual(validarMetas({ reserva: '5000', carteira: '', meta3: { valor: '' } }), { reserva: 5000, carteira: null, meta3: { nome: 'sair de casa ou veículo', valor: null } });
});

test('escrita: troca só o bloco (CRLF fica), JSON quebrado é 409, o estudo soma bloco a bloco', () => {
  const vault = mkdtempSync(join(tmpdir(), 'aion-'));
  const pasta = join(vault, '04-NEGOCIO', 'financeiro');
  mkdirSync(pasta, { recursive: true });
  const arq = join(pasta, 'aion-regra.md');
  writeFileSync(arq, '---\r\ntipo: aion\r\n---\r\n\r\nTexto do Pedro.\r\n\r\n```aion-regra\r\n{}\r\n```\r\n');
  gravarBloco(vault, ARQUIVOS_AION.regra, { a: 1 }, '2030-01-01', 't', 'e');
  const t = readFileSync(arq, 'utf8');
  assert.ok(t.includes('Texto do Pedro.\r\n'));
  assert.ok(t.includes('```aion-regra\r\n{\r\n  "a": 1\r\n}\r\n```'));
  writeFileSync(arq, '```aion-regra\n{ quebrado\n```\n');
  assert.throws(() => gravarBloco(vault, ARQUIVOS_AION.regra, {}, '2030-01-01', 't', 'e'), (e) => e.code === 409);
  gravarAion(vault, { acao: 'estudo', bloco: 1, progresso: 'estudando' }, '2030-01-01');
  gravarAion(vault, { acao: 'estudo', bloco: 2, progresso: 'dominado' }, '2030-01-02');
  const est = readFileSync(join(pasta, 'aion-estudo.md'), 'utf8');
  assert.match(est, /"1": "estudando"/);
  assert.match(est, /"2": "dominado"/);
  assert.match(est, /\[\[aion\]\]/);
  assert.throws(() => gravarAion(vault, { acao: 'estudo', bloco: 1, progresso: 'feito' }, '2030-01-01'), /progresso inválido/);
});

test('trilha: a tabela de blocos da nota vira lista; investimento da API traz código, aplicado e indexador', () => {
  const corpo = '| # | bloco | o que aprender | material |\n|---|---|---|---|\n| 1 | Dinheiro e juros | valor do dinheiro no tempo | [oficial] BCB, *Caderno* |\n| 2 | Inflação e **Selic** | IPCA | [BCB](https://x) |\n';
  assert.deepEqual(blocosDaTrilha(corpo).map((b) => [b.n, b.titulo, b.material]), [[1, 'Dinheiro e juros', '[oficial] BCB, Caderno'], [2, 'Inflação e Selic', 'BCB']]);
  assert.deepEqual(detalhesDoInvestimento({ type: 'EQUITY', code: 'test3', quantity: 3, amountOriginal: null }), { codigo: 'TEST3', quantidade: 3 });
  assert.deepEqual(detalhesDoInvestimento({ type: 'FIXED_INCOME', amountOriginal: 1000, rate: 110, rateType: 'CDI', purchaseDate: '2030-01-02T00:00:00Z', quantity: 1 }, false), { quantidade: 1, aportado: 1000, desde: '2030-01-02', indexador: '110% CDI' });
  const l = lerCotacaoBrapi({ symbol: 'test3', historicalDataPrice: [] }, '2030-01-01');
  assert.equal(l.codigo, 'TEST3');
});
