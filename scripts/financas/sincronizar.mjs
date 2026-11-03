#!/usr/bin/env node
// Sincroniza Nubank e Inter com o razão do vault pelo Open Finance (Meu Pluggy), SÓ LEITURA.
//
//   node scripts/financas/sincronizar.mjs --testar     autentica e lista as contas (final 4 dígitos), sem transação
//   node scripts/financas/sincronizar.mjs              = --simular: mostra o que faria, não grava nada
//   node scripts/financas/sincronizar.mjs --gravar     liquida previstos, lança o resto, grava bruto e estado
//   node scripts/financas/sincronizar.mjs --gravar --commitar   e ainda faz commit + push no vault SÓ dos
//                                                      arquivos do razão que gravou (nada gravado: nada commitado)
//
// Opções: --desde AAAA-MM-DD (padrão: 40 dias atrás) · --ate AAAA-MM-DD · --vault CAMINHO
//         --regras ARQ (padrão %LOCALAPPDATA%\sinapse-financas\regras\regras.json)
//         --fixture PASTA  responde de JSONs falsos no formato da API (testes; nunca toca a rede)
//         --hoje AAAA-MM-DD (testes)
// Fora do git, em %LOCALAPPDATA%\sinapse-financas\ (ou SINAPSE_FINANCAS):
//   pluggy.cred (DPAPI) · regras\regras.json · bruto\pluggy\AAAA-MM-DD\*.json · estado.json · logs\
// O terminal só mostra dado saneado: descrição montada, valor, data, rótulo da conta.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_LOCAL, lerCredencial } from './credencial.mjs';
import { PASTA_RAZAO, aplicar, gravarRetrato, hashId, lerRazao, planejar, planejarFaturas, planejarInvestimentos, sanear } from './nucleo.mjs';
import { posicoesAtuais, retratoDe } from '../../src/lib/financeiroAnalise.ts';
import { bancoDe, criarCliente, fetchDeFixture, final4, hojeSP, normalizarFatura, normalizarInvestimento, normalizarTransacao } from './pluggy.mjs';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function args(argv) {
  const o = { modo: 'simular' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--gravar') o.modo = 'gravar';
    else if (a === '--simular') o.modo = 'simular';
    else if (a === '--testar') o.modo = 'testar';
    else if (a === '--commitar') o.commitar = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.includes('=') ? a.slice(2).split('=') : [a.slice(2), argv[++i]];
      o[k] = v;
    }
  }
  return o;
}

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (d) => (d ? d.split('-').reverse().join('/') : '');
/**
 * Commit + push no vault só dos arquivos do razão que esta rodada gravou. Outras sessões deixam
 * arquivos abertos no vault: o `git commit -- <arquivos>` leva só esses, mesmo que haja outra coisa
 * no índice. Sem --no-verify: se o pre-commit barrar, registra e não tenta de novo. Nunca lança erro.
 */
export function commitarRazao(vault, meses, hoje, { git = 'git', extras = [] } = {}) {
  const arquivos = [...meses.map((m) => join(PASTA_RAZAO, `${m}.md`).split('\\').join('/')), ...extras];
  const ultimas = (e, k) => sanear(String(e.stderr || e.message || '').trim().split(/\r?\n/).slice(-k).join(' | '));
  if (!arquivos.length) return { commit: false, motivo: 'nada gravado' };
  const g = (...a) => execFileSync(git, ['-C', vault, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 120000 });
  // vault no meio de rebase, merge, cherry-pick ou revert: um commit agora entraria NA operação de
  // outra sessão. Não commita; o razão fica gravado e a rodada de amanhã (ou o Pedro) commita.
  try {
    const gitDir = g('rev-parse', '--absolute-git-dir').trim();
    const emCurso = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].find((x) => existsSync(join(gitDir, x)));
    if (emCurso) return { commit: false, motivo: `vault com operação do git em curso (${emCurso}): nada commitado` };
    if (g('diff', '--name-only', '--diff-filter=U').trim()) return { commit: false, motivo: 'vault com conflito aberto: nada commitado' };
  } catch (e) {
    return { commit: false, motivo: `não consegui ler o estado do git do vault: ${ultimas(e, 2)}` };
  }
  try {
    g('add', '--', ...arquivos);
    try { g('diff', '--cached', '--quiet', '--', ...arquivos); return { commit: false, motivo: 'gravou sem mudar o conteúdo' }; } catch { /* há diferença */ }
    g('commit', '-m', `Razão: sincronização do banco de ${dataBR(hoje).slice(0, 5)}`, '--', ...arquivos);
  } catch (e) {
    // o pre-commit barrou: tira do índice o que esta rodada pôs lá (o arquivo segue gravado)
    try { g('reset', '-q', '--', ...arquivos); } catch { /* sem HEAD ainda: nada a desfazer */ }
    return { commit: false, motivo: `commit recusado (pre-commit ou git): ${ultimas(e, 3)}` };
  }
  try { g('push'); return { commit: true, push: true }; } catch (e) {
    return { commit: true, push: false, motivo: `push falhou (fica para a próxima rodada): ${ultimas(e, 2)}` };
  }
}

const somarDias = (d, k) => new Date(Date.parse(d + 'T12:00:00Z') + k * 86400000).toISOString().slice(0, 10);

/** Aviso de renovação: 30 dias antes do fim da autorização (vale 1 ano). */
export function avisoConsentimento(conexoes, hoje) {
  return conexoes
    .filter((c) => c.autorizacaoVence)
    .map((c) => ({ ...c, avisarEm: somarDias(c.autorizacaoVence.slice(0, 10), -30) }))
    .filter((c) => c.avisarEm <= hoje);
}

/** Rodada que deu erro: fica no estado.json (o app avisa na Visão) e no log. Mensagem saneada. */
function registrarFalha(base, hoje, e) {
  try {
    mkdirSync(join(base, 'logs'), { recursive: true });
    const arq = join(base, 'estado.json');
    const estado = existsSync(arq) ? JSON.parse(readFileSync(arq, 'utf8')) : {};
    const mensagem = sanear(String((e && e.message) || e)).slice(0, 300);
    estado.ultimaFalha = { em: new Date().toISOString(), mensagem };
    writeFileSync(arq, JSON.stringify(estado, null, 2), 'utf8');
    appendFileSync(join(base, 'logs', `${hoje.slice(0, 7)}.log`), `${estado.ultimaFalha.em} falhou: ${mensagem}\n`, 'utf8');
  } catch { /* registrar a falha nunca pode esconder a falha original */ }
}

export async function rodar(argv, opcoes = {}) {
  const o = args(argv);
  try {
    return await rodarSemRegistro(argv, opcoes);
  } catch (e) {
    if (o.modo === 'gravar') {
      const env = opcoes.env || process.env;
      registrarFalha(env.SINAPSE_FINANCAS || BASE_LOCAL, o.hoje || hojeSP(), e);
    }
    throw e;
  }
}

async function rodarSemRegistro(argv, { log = console.log, env = process.env } = {}) {
  const o = args(argv);
  const hoje = o.hoje || hojeSP();
  const base = env.SINAPSE_FINANCAS || BASE_LOCAL;
  const vault = resolve(o.vault || env.VAULT_PATH || join(APP, '..', 'sinapse'));
  const desde = o.desde || somarDias(hoje, -40);
  const ate = o.ate || hoje;

  let cred, fetchImpl;
  if (o.fixture) {
    const dir = resolve(o.fixture);
    const ler = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null);
    cred = { clientId: 'falso', clientSecret: 'falso', itemIds: ler('itens.json') || [] };
    fetchImpl = fetchDeFixture(ler);
  } else {
    cred = lerCredencial();
    fetchImpl = globalThis.fetch;
  }
  const api = criarCliente(cred, { fetch: fetchImpl });
  const arqRegras = o.regras || join(base, 'regras', 'regras.json');
  const regras = existsSync(arqRegras) ? JSON.parse(readFileSync(arqRegras, 'utf8')) : {};
  if (!existsSync(arqRegras)) log(`(sem regras em ${arqRegras}: tudo que não casar vira "a classificar")`);

  await api.autenticar();
  log(`Pluggy: autenticado. ${cred.itemIds.length} conexão(ões).`);

  const bruto = {};
  const transacoes = [], faturas = [], invs = [], conexoes = [];
  for (const itemId of cred.itemIds) {
    const h = hashId('item', itemId).slice(0, 8);
    const item = await api.item(itemId);
    bruto[`${h}-item`] = item;
    const conexao = {
      rotulo: item.connector?.name || 'conexão', status: item.status || '', execucao: item.executionStatus || '',
      ultimaAtualizacao: item.lastUpdatedAt || '', autorizacaoVence: item.consentExpiresAt || '', erro: item.error?.code || '',
    };
    conexoes.push(conexao);
    log(`\n• ${conexao.rotulo} · ${conexao.status || '?'}${conexao.erro ? ' · ' + conexao.erro : ''} · atualizado ${dataBR((conexao.ultimaAtualizacao || '').slice(0, 10)) || '?'} · autorização até ${dataBR((conexao.autorizacaoVence || '').slice(0, 10)) || 'não informado'}`);
    const contas = await api.contas(itemId);
    bruto[`${h}-contas`] = contas;
    for (const c of contas) {
      const rot = bancoDe(c, regras).rotulo;
      log(`  ${rot} · final ${final4(c)} · ${c.type}/${c.subtype || '?'}`);
      if (o.modo === 'testar') continue;
      const hc = hashId('conta', c.id).slice(0, 8);
      const txs = await api.transacoes(c.id, desde, ate);
      bruto[`${h}-${hc}-transacoes`] = txs;
      for (const t of txs) transacoes.push(normalizarTransacao(t, c, regras));
      if (c.type === 'CREDIT') {
        const bs = await api.faturas(c.id);
        bruto[`${h}-${hc}-faturas`] = bs;
        for (const b of bs) faturas.push(normalizarFatura(b, c, regras));
      }
    }
    if (o.modo === 'testar') continue;
    try {
      const is = await api.investimentos(itemId);
      bruto[`${h}-investimentos`] = is;
      const banco = (contas.map((c) => bancoDe(c, regras).rotulo.split(' · ')[0]).find((b) => b !== 'Banco')) || '';
      for (const i of is) { const n = normalizarInvestimento(i, hoje, { banco }); if (n.ativo) invs.push(n); }
    } catch (e) { log(`  (investimentos indisponíveis: ${e.message})`); }
  }
  for (const c of avisoConsentimento(conexoes, hoje)) log(`\n⚠ RENOVAR a autorização de ${c.rotulo} até ${dataBR(c.autorizacaoVence.slice(0, 10))} (meu.pluggy.ai). Depois dela as leituras voltam vazias.`);
  if (o.modo === 'testar') { log('\n--testar: nenhuma transação foi lida.'); return { modo: 'testar', conexoes }; }

  // ordem: faturas primeiro (o previsto do cartão passa a ter o valor medido e o pagamento casa),
  // depois as transações, depois as posições de investimento
  const razao = lerRazao(vault);
  const copia = Object.fromEntries(Object.entries(razao).map(([m, st]) => [m, { ...st, lista: st.lista.map((l) => ({ ...l })) }]));
  const pf = planejarFaturas(faturas, copia, hoje);
  const pt = planejar(transacoes, copia, regras, { hoje });
  const pi = planejarInvestimentos(invs, pt.razao, regras);
  const acoes = [...pf.acoes, ...pt.acoes, ...pi.acoes];
  const r = pt.relatorio;

  const linha = (x) => `    ${dataBR(x.data)}  ${(x.direcao === 'entrada' ? '+' : '−') + brl(x.valor).padStart(13)}  ${x.descricao}${x.conta ? ' · ' + x.conta : ''}${x.categoriaFonte ? '  [' + x.categoriaFonte + ']' : ''}`;
  log(`\nPeríodo ${dataBR(desde)} a ${dataBR(ate)}: ${transacoes.length} transações lidas.`);
  log(`  casados (previsto liquidado): ${r.casados.length}`);
  for (const c of r.casados) {
    const varios = c.itens && c.itens.length > 1;
    log(`    ${dataBR(c.data)}  ${brl(c.valor).padStart(14)}  ${varios ? 'soma de ' + c.itens.length + ':' : (c.itens?.[0]?.descricao || c.descricao)}`);
    for (const i of c.itens || []) {
      const extra = [i.modo === 'conciliar' ? `já lançado à mão${i.antes && i.antes !== c.data ? ', data ' + dataBR(i.antes) + ' → ' + dataBR(c.data) : ''}` : '',
        i.valorPrevisto !== undefined ? `previsto ${brl(i.valorPrevisto)} → valor do banco` : ''].filter(Boolean).join('; ');
      if (i.pagamentos) log(`        em ${i.pagamentos.length} Pix: ${i.pagamentos.map((p) => dataBR(p.data) + ' ' + brl(p.valor)).join(' + ')}`);
      if (varios || extra) log(`        ${varios ? brl(i.valor).padStart(12) + '  ' + i.descricao : ''}${extra ? (varios ? '  ' : '') + '(' + extra + ')' : ''}`);
    }
  }
  log(`  novos com regra: ${r.novos.length}`);
  for (const x of r.novos) log(linha(x));
  log(`  a classificar: ${r.aClassificar.length}`);
  for (const x of r.aClassificar) log(linha(x));
  log(`  ignorados: ${r.ignorados.jaImportado} já importados · ${r.ignorados.regra} por regra · ${r.ignorados.categoria} por categoria · ${r.ignorados.pendente} pendentes no banco · ${r.ignorados.estorno || 0} compra+estorno`);
  if (r.acumulando?.length) {
    log(`  acumulando (previsto pago em partes, ainda não fechou; não gravados): ${r.acumulando.length}`);
    for (const a of r.acumulando) log(`    ${a.descricao}: ${brl(a.pago)} de ${brl(a.previsto)} (${a.pagamentos.map((p) => dataBR(p.data) + ' ' + brl(p.valor)).join(' + ')})`);
  }
  if (r.divergentes?.length) {
    log(`  divergentes (cliente reconhecido, mas o valor não fecha com o razão; não gravados): ${r.divergentes.length}`);
    for (const d of r.divergentes) log(`    ${dataBR(d.data)}  ${brl(d.valor).padStart(14)}  ${d.cliente} · no razão: ${d.razao.map((x) => x.id + ' ' + brl(x.valor) + ' ' + x.status).join(' | ')}`);
  }
  if (r.ambiguos.length) {
    log(`  ambíguos (não gravados; uma regra com "previsto" ou "cliente" resolve): ${r.ambiguos.length}`);
    for (const a of r.ambiguos) log(`    ${dataBR(a.data)}  ${brl(a.valor).padStart(14)}  pode ser: ${a.opcoes.join(' | ')}`);
  }
  log(`  faturas: ${pf.relatorio.atualizadas.length} previsto(s) com valor medido · ${pf.relatorio.abertas.length} aberta(s)`);
  for (const f of pf.relatorio.atualizadas) log(`    ${f.mes}  ${brl(f.antes)} → ${brl(f.depois)}`);
  log(`  investimentos: ${pi.relatorio.posicoes.length} posição(ões)`);
  for (const p of pi.relatorio.posicoes) log(`    ${p.instituicao || '?'} · ${p.descricao} · ${p.liquidez}  ${brl(p.valor)}`);

  if (o.modo !== 'gravar') {
    log(`\n--simular: nada gravado (${acoes.length} ação(ões) prontas). Para aplicar: --gravar`);
    return { modo: 'simular', acoes, relatorio: r, faturas: pf.relatorio, investimentos: pi.relatorio, conexoes };
  }

  const meses = aplicar(vault, acoes, hoje);
  const pastaBruto = join(base, 'bruto', 'pluggy', hoje);
  mkdirSync(pastaBruto, { recursive: true });
  for (const [k, v] of Object.entries(bruto)) writeFileSync(join(pastaBruto, `${k}.json`), JSON.stringify(v, null, 2), 'utf8');
  mkdirSync(base, { recursive: true });
  const arqEstado = join(base, 'estado.json');
  let ultimaFalha = null;
  try { ultimaFalha = JSON.parse(readFileSync(arqEstado, 'utf8')).ultimaFalha || null; } catch { /* primeira vez */ }
  writeFileSync(arqEstado, JSON.stringify({ ultimaSync: new Date().toISOString(), conexoes, ...(ultimaFalha ? { ultimaFalha } : {}) }, null, 2), 'utf8');
  // retrato do patrimônio do dia (banco + o que foi lançado à mão), um por dia
  const posicoes = posicoesAtuais(Object.values(lerRazao(vault)).flatMap((st) => st.lista));
  const patrimonioMudou = posicoes.length ? gravarRetrato(vault, retratoDe(posicoes, hoje), hoje) : '';
  mkdirSync(join(base, 'logs'), { recursive: true });
  appendFileSync(join(base, 'logs', `${hoje.slice(0, 7)}.log`),
    `${new Date().toISOString()} gravar: ${r.casados.length} casados, ${r.novos.length} novos, ${r.aClassificar.length} a classificar, ${r.ambiguos.length} ambíguos, ${r.divergentes.length} divergentes, meses ${meses.join(' ')}\n`, 'utf8');
  log(`\nGravado em ${meses.length ? meses.join(', ') : 'nenhum mês'}${patrimonioMudou ? ' + retrato do patrimônio' : ''} (${vault}). Bruto em ${pastaBruto}.`);
  let commit;
  if (o.commitar) {
    commit = commitarRazao(vault, meses, hoje, { extras: patrimonioMudou ? [patrimonioMudou] : [] });
    const txt = commit.commit ? `commit feito${commit.push ? ' e enviado' : ''}${commit.motivo ? ' (' + commit.motivo + ')' : ''}` : `sem commit: ${commit.motivo}`;
    log(`Vault: ${txt}.`);
    appendFileSync(join(base, 'logs', `${hoje.slice(0, 7)}.log`), `${new Date().toISOString()} commitar: ${txt}\n`, 'utf8');
  } else log('Revise no app (Financeiro → Lançamentos, categoria "a classificar") e faça o commit do vault.');
  return { modo: 'gravar', acoes, meses, relatorio: r, conexoes, commit, patrimonio: patrimonioMudou };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rodar(process.argv.slice(2)).catch((e) => {
    console.error('erro: ' + e.message);
    process.exit(1);
  });
}
