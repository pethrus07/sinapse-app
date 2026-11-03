// Testes da sincronização com dados FALSOS: respostas da API em fixtures/pluggy (formato da
// referência da Pluggy) e um vault temporário. Nunca toca a rede, o vault real ou o
// %LOCALAPPDATA% real. Rodar: node --test scripts/financas/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { aplicar, gravarMes, hashId, lerRazao, pareceSensivel, planejar, regraDe, normalizarRegras, sanear } from './nucleo.mjs';
import { bancoDe, criarCliente, fetchDeFixture, final4, normalizarTransacao } from './pluggy.mjs';
import { avisoConsentimento, rodar } from './sincronizar.mjs';
import { lerCredencial } from './credencial.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIX = join(AQUI, 'fixtures', 'pluggy');
const REGRAS = join(AQUI, 'regras.exemplo.json');
const ler = (f) => (existsSync(join(FIX, f)) ? JSON.parse(readFileSync(join(FIX, f), 'utf8')) : null);

const L = (p) => ({ tipo: 'entrada', descricao: 'x', valor: 100, vencimento: '', status: 'a-receber', cliente: '', categoria: '', recorrente: false, obs: '', ...p });

function vaultFalso() {
  const dir = mkdtempSync(join(tmpdir(), 'sinapse-fin-'));
  const vault = join(dir, 'sinapse');
  const pasta = join(vault, '04-NEGOCIO', 'financeiro');
  mkdirSync(pasta, { recursive: true });
  const md = (mes, lista, crlf = false) => {
    let t = `---\ntipo: financeiro\narea: negocio\nmes: ${mes}\n---\n\n# Falso ${mes}\n\nTexto que não pode sumir.\n\n\`\`\`financeiro\n${JSON.stringify({ lancamentos: lista }, null, 2)}\n\`\`\`\n\n## Conexões\n- rodapé preservado\n`;
    if (crlf) t = t.replace(/\n/g, '\r\n');
    writeFileSync(join(pasta, `${mes}.md`), t, 'utf8');
  };
  md('2030-02', [L({ id: '2030-02-05-alfa', valor: 2000, vencimento: '2030-02-05', status: 'recebido', liquidadoEm: '2030-02-05', cliente: 'Cliente Alfa' })]);
  md('2030-03', [
    L({ id: '2030-03-05-alfa', valor: 2000, vencimento: '2030-03-05', cliente: 'Cliente Alfa', recorrente: true }),
    L({ id: '2030-03-02-beta', valor: 250, vencimento: '2030-03-02', cliente: 'Cliente Beta', recorrente: true }),
    L({ id: '2030-03-08-gama', valor: 500, vencimento: '2030-03-08', cliente: 'Cliente Gama' }),
    L({ id: '2030-03-08-delta', valor: 500, vencimento: '2030-03-08', cliente: 'Cliente Delta' }),
    L({ id: '2030-03-cartao-de-credito-fatura', tipo: 'saida', descricao: 'Cartao de credito · fatura', valor: 300, vencimento: '2030-03-05', status: 'a-pagar', categoria: 'cartao', obs: 'EXTRAPOLADO, nao medido.' }),
    L({ id: '2030-03-reserva-de-mudanca', tipo: 'reserva', descricao: 'Reserva de mudança', valor: 1000, status: 'a-pagar', categoria: 'reserva' }),
  ], true);
  const base = join(dir, 'local');
  return { dir, vault, base };
}

/* ------------------------------------------------------------------ saneamento */

test('sanear tira CPF, CNPJ, conta, agência, cartão, e-mail e telefone', () => {
  const s = sanear('TED 222.333.444-55 CNPJ 12.345.678/0001-99 Ag 0001 Conta 12345-6 cartão **** 4321 fulano@exemplo.com +55 83 99999-1234 · Fim');
  for (const x of ['222', '12.345', '0001', '12345', '4321', '@', '99999']) assert.ok(!s.includes(x), `sobrou ${x} em "${s}"`);
  assert.ok(!pareceSensivel(s));
  assert.equal(sanear('Pix recebido · Cliente Alfa'), 'Pix recebido · Cliente Alfa');
  assert.ok(pareceSensivel('pix 123.456.789-09'));
});

test('hashId é estável e não revela o id', () => {
  assert.equal(hashId('pluggy', 'abc'), hashId('pluggy', 'abc'));
  assert.notEqual(hashId('pluggy', 'abc'), hashId('pluggy', 'abd'));
  assert.equal(hashId('pluggy', 'abc').length, 16);
  assert.ok(!hashId('pluggy', 'abc').includes('abc'));
});

test('regraDe: documento, texto sem acento, direção; regra vazia não casa tudo', () => {
  const r = normalizarRegras({ regras: [{ quando: {} , categoria: 'x' }, { quando: { texto: 'aplicação', direcao: 'saida' }, categoria: 'reserva' }, { quando: { documento: '11.222.333/0001-81' }, cliente: 'A' }] });
  assert.equal(regraDe({ texto: 'APLICACAO RDB', direcao: 'saida' }, r).categoria, 'reserva');
  assert.equal(regraDe({ texto: 'APLICACAO RDB', direcao: 'entrada' }, r), null);
  assert.equal(regraDe({ texto: '', documentos: ['11222333000181'], direcao: 'entrada' }, r).cliente, 'A');
});

/* ------------------------------------------------------------------ normalização Pluggy */

test('normalizarTransacao: direção pelo type, valor positivo, rótulo da conta sem número nem titular', () => {
  const contas = ler('accounts-00000000-0000-4000-8000-000000000001.json').results;
  const [nu, cartao, inter] = contas;
  assert.equal(bancoDe(nu).rotulo, 'Nubank · conta');
  assert.equal(bancoDe(cartao).rotulo, 'Nubank · cartão');
  assert.equal(bancoDe(inter).rotulo, 'Inter · conta');
  assert.equal(bancoDe({ marketingName: 'Nu Pagamentos', type: 'BANK' }).rotulo, 'Nubank · conta');
  assert.equal(final4(cartao), '4321');
  const tx = ler('transactions-a1111111-0000-4000-8000-000000000001-1.json').results[3];
  const t = normalizarTransacao(tx, nu);
  assert.equal(t.direcao, 'saida');
  assert.equal(t.valor, 312.4);
  assert.equal(t.data, '2030-03-05');
  const pix = normalizarTransacao(ler('transactions-a1111111-0000-4000-8000-000000000001-1.json').results[0], nu);
  assert.equal(pix.meio, 'pix');
  assert.deepEqual(pix.documentos, ['11222333000181', '12345678909']);
  const cc = normalizarTransacao(ler('transactions-a2222222-0000-4000-8000-000000000002-1.json').results[0], cartao);
  assert.equal(cc.viaCartao, true);
  assert.equal(cc.fatura, '2030-04');
});

test('compra no débito da conta vira "Compra no débito", não "Saída"', () => {
  const conta = { id: 'x', type: 'BANK', marketingName: 'Nu Pagamentos' };
  const t = normalizarTransacao({ id: '1', date: '2030-03-01', amount: -10, type: 'DEBIT', operationType: 'CARTAO', description: 'Compra no débito|LOJA FALSA' }, conta);
  assert.equal(t.meio, 'debito');
  assert.equal(planejar([{ ...t, fonte: 'teste' }], {}).relatorio.aClassificar[0].descricao, 'Compra no débito');
});

test('cliente HTTP: autentica, manda X-API-KEY, segue o cursor da v2 e respeita dateFrom', async () => {
  const chamadas = [];
  const f = fetchDeFixture(ler);
  const api = criarCliente({ clientId: 'a', clientSecret: 'b' }, { fetch: async (u, i) => { chamadas.push(String(u)); return f(u, i); } });
  const txs = await api.transacoes('a1111111-0000-4000-8000-000000000001', '2030-01-29', '2030-03-10');
  assert.equal(txs.length, 10); // 9 da página 1 + 1 da 2 (a de 15/01 fica fora)
  assert.ok(chamadas.some((u) => u.includes('after=2')));
  assert.equal((await api.contas('00000000-0000-4000-8000-000000000001')).length, 3);
  await assert.rejects(criarCliente({ clientId: '', clientSecret: '' }, { fetch: f }).autenticar(), /recusada/);
});

/* ------------------------------------------------------------------ núcleo */

test('planejar: duas transações iguais não liquidam o mesmo previsto; a segunda vira nova', () => {
  const razao = { '2030-03': { arquivo: '', texto: '', lista: [L({ id: 'p', valor: 100, vencimento: '2030-03-05' })] } };
  const t = (id) => ({ fonte: 'teste', idFonte: id, data: '2030-03-05', valor: 100, direcao: 'entrada', texto: '', meio: 'pix', conta: 'Banco · conta' });
  const p = planejar([t('1'), t('2')], razao);
  assert.equal(p.relatorio.casados.length, 1);
  assert.equal(p.relatorio.aClassificar.length, 1);
  assert.equal(razao['2030-03'].lista[0].status, 'a-receber'); // o original não foi mexido
});

test('planejar: fora de ±5 dias não casa', () => {
  const razao = { '2030-03': { arquivo: '', texto: '', lista: [L({ id: 'p', valor: 100, vencimento: '2030-03-01' })] } };
  const p = planejar([{ fonte: 't', idFonte: '1', data: '2030-03-07', valor: 100, direcao: 'entrada', texto: '', meio: 'pix' }], razao);
  assert.equal(p.relatorio.casados.length, 0);
});

/* conciliação: dados falsos, nenhum cliente, valor ou documento real */
const T = (p) => ({ fonte: 'teste', idFonte: p.id || p.data + p.valor, data: '2030-03-05', valor: 100, direcao: 'entrada', texto: '', meio: 'pix', conta: 'Banco · conta', ...p });
const R = (...listas) => Object.fromEntries(listas.map(([mes, lista]) => [mes, { arquivo: '', texto: '', lista }]));

test('planejar: lançamento já marcado recebido à mão (sem fitid) é conciliado, não duplica; só com regra que diz o cliente', () => {
  const razao = R(['2030-03', [L({ id: 'alfa-mar', valor: 340, vencimento: '2030-03-01', status: 'recebido', liquidadoEm: '2030-03-01', cliente: 'Cliente Alfa' })]]);
  const regras = { regras: [{ quando: { documento: '11222333000181', direcao: 'entrada' }, cliente: 'Cliente Alfa' }] };
  const t = T({ id: '1', data: '2030-03-04', valor: 340, documentos: ['11222333000181'] });
  const p = planejar([t], razao, regras);
  assert.equal(p.relatorio.casados.length, 1);
  assert.equal(p.relatorio.casados[0].itens[0].modo, 'conciliar');
  assert.equal(p.acoes[0].acao, 'conciliar');
  assert.equal(p.razao['2030-03'].lista[0].liquidadoEm, '2030-03-04');
  assert.equal(p.razao['2030-03'].lista.length, 1);
  // sem regra, o recebido à mão não é candidato: a transação vira nova
  assert.equal(planejar([t], razao, {}).relatorio.casados.length, 0);
});

test('planejar: um Pix que paga vários lançamentos do mesmo grupo de clientes casa pela soma', () => {
  const razao = R(['2030-03', [
    L({ id: 'parcela-beta', valor: 200, vencimento: '2030-03-20', cliente: 'Cliente Beta' }),
    L({ id: 'etapa-gama', valor: 630, vencimento: '2030-03-20', cliente: 'Cliente Gama' }),
    L({ id: 'outro-delta', valor: 200, vencimento: '2030-03-20', cliente: 'Cliente Delta' }),
  ]]);
  const regras = { regras: [{ quando: { documento: '99888777000166' }, cliente: 'Cliente Gama', clientes: ['Cliente Gama', 'Cliente Beta'] }] };
  const p = planejar([T({ data: '2030-03-19', valor: 830, documentos: ['99888777000166'] })], razao, regras);
  assert.equal(p.relatorio.casados.length, 1);
  assert.deepEqual(p.relatorio.casados[0].itens.map((i) => i.id).sort(), ['etapa-gama', 'parcela-beta']);
  assert.equal(p.razao['2030-03'].lista.find((l) => l.id === 'outro-delta').status, 'a-receber');
  assert.equal(p.acoes.length, 2);
  assert.equal(p.acoes[0].fitid, p.acoes[1].fitid);
});

test('planejar: cliente reconhecido mas o valor não fecha com o razão vira divergente e não grava', () => {
  const razao = R(['2030-03', [L({ id: 'alfa-mar', valor: 480, vencimento: '2030-03-26', status: 'recebido', liquidadoEm: '2030-03-26', cliente: 'Cliente Alfa' })]]);
  const regras = { regras: [{ quando: { texto: 'empresa alfa' }, cliente: 'Cliente Alfa' }] };
  const p = planejar([T({ data: '2030-03-27', valor: 720, texto: 'EMPRESA ALFA LTDA' })], razao, regras);
  assert.equal(p.relatorio.divergentes.length, 1);
  assert.equal(p.relatorio.divergentes[0].razao[0].id, 'alfa-mar');
  assert.equal(p.acoes.length, 0);
  // sem lançamento do cliente na janela: entra como novo, com o cliente da regra
  const p2 = planejar([T({ data: '2030-05-27', valor: 720, texto: 'EMPRESA ALFA LTDA' })], razao, regras);
  assert.equal(p2.relatorio.aClassificar.length + p2.relatorio.novos.length, 1);
  assert.equal(p2.acoes[0].lancamento.cliente, 'Cliente Alfa');
});

test('planejar: valorLivre + previsto liquida a fatura com o valor do banco, com tolerância própria da regra', () => {
  const razao = R(['2030-04', [L({ id: '2030-04-cartao-de-credito-fatura', tipo: 'saida', valor: 610, vencimento: '2030-04-05', status: 'a-pagar', categoria: 'cartao' })]]);
  const regras = { regras: [{ quando: { texto: 'pagamento de fatura', direcao: 'saida' }, categoria: 'cartao', previsto: 'cartao-de-credito-fatura', valorLivre: true, toleranciaDias: 10 }] };
  const p = planejar([T({ data: '2030-03-28', valor: 877.5, direcao: 'saida', texto: 'Pagamento de fatura' })], razao, regras);
  assert.equal(p.relatorio.casados.length, 1);
  const l = p.razao['2030-04'].lista[0];
  assert.deepEqual([l.status, l.valor, l.valorPrevisto, l.liquidadoEm], ['pago', 877.5, 610, '2030-03-28']);
  // sem toleranciaDias, 8 dias de distância não casam
  const semTol = { regras: [{ ...regras.regras[0], toleranciaDias: undefined }] };
  assert.equal(planejar([T({ data: '2030-03-28', valor: 877.5, direcao: 'saida', texto: 'Pagamento de fatura' })], razao, semTol).relatorio.casados.length, 0);
});

test('planejar: parcela sem data em mês anterior casa quando a regra aponta o previsto, na ordem das parcelas', () => {
  const razao = R(['2030-01', [
    L({ id: '2030-01-epsilon-parcela-3-5', valor: 120, cliente: 'Cliente Epsilon' }),
    L({ id: '2030-01-epsilon-parcela-2-5', valor: 120, cliente: 'Cliente Epsilon' }),
  ]]);
  const regras = { regras: [{ quando: { documento: '12345678909' }, cliente: 'Cliente Epsilon', previsto: 'epsilon-parcela' }] };
  // chegam do mais novo para o mais antigo, como a API manda: o pagamento mais antigo leva a parcela 2
  const p = planejar([T({ id: 'b', data: '2030-04-07', valor: 120, documentos: ['12345678909'] }), T({ id: 'a', data: '2030-03-07', valor: 120, documentos: ['12345678909'] })], razao, regras);
  assert.deepEqual(p.relatorio.casados.map((c) => [c.data, c.id]), [['2030-03-07', '2030-01-epsilon-parcela-2-5'], ['2030-04-07', '2030-01-epsilon-parcela-3-5']]);
  // sem a regra, parcela sem data só casa no mês do próprio arquivo
  assert.equal(planejar([T({ data: '2030-03-07', valor: 120 })], razao, {}).relatorio.casados.length, 0);
});

test('planejar: compra e estorno do mesmo valor, mesma conta, se anulam; estorno parcial fica', () => {
  const regras = { regras: [{ quando: { texto: 'estorno', direcao: 'entrada' }, estorno: true, categoria: 'estorno', descricao: 'Estorno' }, { quando: { texto: 'corrida' }, categoria: 'transporte', descricao: 'Transporte' }] };
  const ts = [
    T({ id: 'c1', data: '2030-03-02', valor: 15.5, direcao: 'saida', texto: 'Corrida app' }),
    T({ id: 'e1', data: '2030-03-02', valor: 15.5, texto: 'Estorno - compra' }),
    T({ id: 'c2', data: '2030-03-03', valor: 15.5, direcao: 'saida', texto: 'Corrida app' }),
    T({ id: 'e2', data: '2030-03-04', valor: 11, texto: 'Estorno - compra' }),
  ];
  const p = planejar(ts, {}, regras);
  assert.equal(p.relatorio.ignorados.estorno, 2);
  assert.deepEqual(p.relatorio.novos.map((x) => [x.descricao, x.valor]).sort(), [['Estorno', 11], ['Transporte', 15.5]]);
});

test('gravarMes preserva o resto do arquivo e o CRLF', () => {
  const { vault } = vaultFalso();
  const r = lerRazao(vault);
  const antes = r['2030-03'].texto;
  gravarMes(vault, '2030-03', r['2030-03'], r['2030-03'].lista, '2030-03-10');
  assert.equal(readFileSync(r['2030-03'].arquivo, 'utf8'), antes);
});

/* ------------------------------------------------------------------ ponta a ponta */

test('sincronizar --simular não grava nada e relata casados, novos, a classificar, ignorados', async () => {
  const { vault, base } = vaultFalso();
  const antes = readFileSync(join(vault, '04-NEGOCIO', 'financeiro', '2030-03.md'), 'utf8');
  const linhas = [];
  const r = await rodar(['--fixture', FIX, '--vault', vault, '--regras', REGRAS, '--hoje', '2030-03-10'], { log: (s) => linhas.push(s), env: { SINAPSE_FINANCAS: base } });
  assert.equal(r.modo, 'simular');
  assert.equal(readFileSync(join(vault, '04-NEGOCIO', 'financeiro', '2030-03.md'), 'utf8'), antes);
  assert.ok(!existsSync(join(vault, '04-NEGOCIO', 'financeiro', '2030-04.md')));
  assert.ok(!existsSync(base));
  const rel = r.relatorio;
  assert.deepEqual(rel.casados.map((c) => c.id).sort(), ['2030-03-02-beta', '2030-03-05-alfa', '2030-03-cartao-de-credito-fatura', '2030-03-reserva-de-mudanca']);
  assert.deepEqual(rel.novos.map((x) => x.descricao).sort(), ['Delivery', 'Netflix']);
  assert.deepEqual(rel.aClassificar.map((x) => x.descricao).sort(), ['Compra no cartão', 'Pix enviado', 'Transferência recebida']);
  assert.deepEqual(rel.ignorados, { jaImportado: 0, regra: 0, categoria: 1, pendente: 1, estorno: 0 });
  assert.equal(rel.divergentes.length, 0);
  assert.equal(rel.ambiguos.length, 1);
  assert.deepEqual(rel.ambiguos[0].opcoes.sort(), ['2030-03-08-delta', '2030-03-08-gama']);
  assert.equal(r.faturas.atualizadas.length, 1);
  assert.equal(r.faturas.abertas.length, 1);
  assert.equal(r.investimentos.posicoes.length, 2); // o resgatado fica fora
  // terminal: nada cru
  const tudo = linhas.join('\n');
  for (const x of ['FULANA', 'BELTRANO', 'CICRANO', 'PADARIA', 'EMPRESA ALFA', 'LOJA FULANO', '123.456', '9999999', '88888888', 'chave-falsa', '11222333'])
    assert.ok(!tudo.includes(x), `terminal mostrou ${x}`);
  assert.ok(tudo.includes('RENOVAR'), 'aviso de autorização a menos de 30 dias');
  assert.ok(tudo.includes('final 4321'));
});

test('sincronizar --gravar liquida, lança saneado, abre a fatura futura, guarda bruto e estado; repetir não duplica', async () => {
  const { vault, base } = vaultFalso();
  const env = { SINAPSE_FINANCAS: base };
  const args = ['--fixture', FIX, '--vault', vault, '--regras', REGRAS, '--hoje', '2030-03-10', '--gravar'];
  const r1 = await rodar(args, { log: () => {}, env });
  assert.deepEqual(r1.meses, ['2030-02', '2030-03', '2030-04']);

  const razao = lerRazao(vault);
  const mar = razao['2030-03'].lista;
  const por = (id) => mar.find((l) => l.id === id);
  assert.equal(por('2030-03-05-alfa').status, 'recebido');
  assert.equal(por('2030-03-05-alfa').liquidadoEm, '2030-03-06');
  assert.equal(por('2030-03-05-alfa').origem, 'pluggy');
  assert.match(por('2030-03-05-alfa').fitid, /^[0-9a-f]{16}$/);
  assert.equal(por('2030-03-cartao-de-credito-fatura').valor, 312.4);
  assert.equal(por('2030-03-cartao-de-credito-fatura').confianca, 'medido');
  assert.equal(por('2030-03-cartao-de-credito-fatura').status, 'pago');
  assert.equal(por('2030-03-reserva-de-mudanca').status, 'pago');
  assert.equal(por('2030-03-08-gama').status, 'a-receber'); // ambíguo: ninguém liquidou
  const netflix = mar.find((l) => l.descricao === 'Netflix');
  assert.equal(netflix.viaCartao, true);
  assert.equal(netflix.fatura, '2030-04');
  assert.equal(netflix.conta, 'Nubank · cartão');
  const aClass = mar.filter((l) => l.categoria === 'a classificar');
  assert.equal(aClass.length, 2);
  const inv = mar.filter((l) => l.tipo === 'investimento');
  assert.deepEqual(inv.map((l) => [l.descricao, l.liquidez, l.reserva, l.valor]).sort(), [['CDB Banco Falso 2032', 'no-vencimento', false, 1500], ['Caixinha da reserva', 'diaria', true, 6200]]);
  assert.equal(razao['2030-02'].lista.find((l) => l.descricao === 'Transferência recebida').categoria, 'a classificar');
  const abr = razao['2030-04'].lista;
  assert.equal(abr.length, 1);
  assert.equal(abr[0].valor, 259.9);
  assert.equal(abr[0].status, 'a-pagar');

  // o resto do arquivo ficou, e o CRLF também
  const txt = readFileSync(join(vault, '04-NEGOCIO', 'financeiro', '2030-03.md'), 'utf8');
  assert.ok(txt.includes('Texto que não pode sumir.'));
  assert.ok(txt.includes('rodapé preservado'));
  assert.ok(txt.includes('\r\n'));
  // nada sensível foi para o vault
  for (const f of readdirSync(join(vault, '04-NEGOCIO', 'financeiro'))) {
    const t = readFileSync(join(vault, '04-NEGOCIO', 'financeiro', f), 'utf8');
    for (const x of ['FULANA', 'BELTRANO', 'CICRANO', 'PADARIA', 'JOSE', 'EMPRESA ALFA', 'LOJA FULANO', '123.456', '12345678000199', '9999999', '88888888', 'f0000001', 'c0000001', 'a1111111', '00000000-0000'])
      assert.ok(!t.includes(x), `${f} contém ${x}`);
  }
  // bruto e estado fora do vault
  const dia = join(base, 'bruto', 'pluggy', '2030-03-10');
  assert.ok(readdirSync(dia).length >= 5);
  const estado = JSON.parse(readFileSync(join(base, 'estado.json'), 'utf8'));
  assert.equal(estado.conexoes[0].autorizacaoVence, '2030-04-01T00:00:00.000Z');
  assert.ok(!JSON.stringify(estado).includes('00000000-0000'));

  // segunda rodada: nada novo
  const r2 = await rodar(args, { log: () => {}, env });
  assert.equal(r2.relatorio.casados.length, 0);
  assert.equal(r2.relatorio.novos.length + r2.relatorio.aClassificar.length, 0);
  assert.equal(r2.relatorio.ignorados.jaImportado, 9);
  const depois = lerRazao(vault);
  assert.equal(depois['2030-03'].lista.length, mar.length);
  assert.equal(depois['2030-04'].lista.length, 1);
});

test('aplicar trava se algo gravável ainda parecer dado sensível, e não grava nenhum mês', () => {
  const { vault } = vaultFalso();
  const antes = readFileSync(join(vault, '04-NEGOCIO', 'financeiro', '2030-03.md'), 'utf8');
  const ruim = { acao: 'novo', mes: '2030-03', lancamento: L({ id: 'x', descricao: 'Pix 123.456.789-09', origem: 'pluggy', fitid: 'f' }) };
  assert.throws(() => aplicar(vault, [ruim], '2030-03-10'), /trava de saneamento/);
  assert.equal(readFileSync(join(vault, '04-NEGOCIO', 'financeiro', '2030-03.md'), 'utf8'), antes);
});

test('aplicar: conciliar grava data do banco e fitid no recebido à mão, sem travar por obs escrita à mão', () => {
  const { vault } = vaultFalso();
  const r = lerRazao(vault);
  r['2030-02'].lista[0].obs = 'anotado à mão: protocolo 1234567';
  gravarMes(vault, '2030-02', r['2030-02'], r['2030-02'].lista, '2030-03-10');
  aplicar(vault, [{ acao: 'conciliar', mes: '2030-02', id: '2030-02-05-alfa', liquidadoEm: '2030-02-06', fitid: 'abc', origem: 'pluggy' }], '2030-03-10');
  const l = lerRazao(vault)['2030-02'].lista[0];
  assert.deepEqual([l.status, l.liquidadoEm, l.fitid, l.origem], ['recebido', '2030-02-06', 'abc', 'pluggy']);
});

test('avisoConsentimento: avisa a partir de 30 dias antes', () => {
  const c = [{ rotulo: 'X', autorizacaoVence: '2030-04-01T00:00:00Z' }];
  assert.equal(avisoConsentimento(c, '2030-03-01').length, 0);
  assert.equal(avisoConsentimento(c, '2030-03-02').length, 1);
});

test('credencial DPAPI: grava cifrado e só lê de volta pela mesma conta (Windows)', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'sinapse-cred-'));
  const arq = join(dir, 'pluggy.cred');
  const json = JSON.stringify({ clientId: 'id-falso', clientSecret: 'segredo-falso', itemIds: ['00000000-0000-4000-8000-000000000001'] });
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(ConvertTo-SecureString $env:J -AsPlainText -Force | ConvertFrom-SecureString) | Set-Content -LiteralPath $env:A -Encoding ASCII'],
    { env: { ...process.env, J: json, A: arq }, windowsHide: true });
  const cifrado = readFileSync(arq, 'utf8');
  assert.ok(!cifrado.includes('segredo-falso'));
  const c = lerCredencial(arq);
  assert.equal(c.clientSecret, 'segredo-falso');
  assert.deepEqual(c.itemIds, ['00000000-0000-4000-8000-000000000001']);
  assert.throws(() => lerCredencial(join(dir, 'nao-existe.cred')), /não encontrada/);
});
