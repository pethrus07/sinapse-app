#!/usr/bin/env node
// Aion · coletor de dado de mercado. Busca nas fontes permitidas (scripts/aion/fontes.mjs) e guarda
// um cache LOCAL em %LOCALAPPDATA%\sinapse-aion\mercado.json (fora do git e do vault). O índice do
// app (scripts/build-index.mjs) lê esse cache; o navegador nunca chama a rede de mercado.
//
//   node scripts/aion/coletar.mjs              = --simular: busca e mostra o resumo, não grava nada
//   node scripts/aion/coletar.mjs --gravar     busca e grava o cache (o que falhar fica com o dado anterior)
//   node scripts/aion/coletar.mjs --so=bcb,focus,copom,cotacao,cripto,cvm   só essas fontes
//   node scripts/aion/coletar.mjs --cvm        força a CVM (por padrão, no máximo 1 vez a cada 6 dias)
//
// Que ativos: as posições de ação, FII e cripto do razão da Métis (vault, 04-NEGOCIO/financeiro) e a
// lista de observação (aion-observacao.md). Chaves: token da brapi e chave Demo da CoinGecko pelo
// aion-chave.ps1 (DPAPI); sem elas o caminho sem chave segue e a tela diz o que falta.
// Limites: brapi até 12 mil chamadas/mês (o grátis dá 15 mil) e 60 por rodada; CoinGecko 1 chamada
// por rodada; 0,4 s entre chamadas ao mesmo host (2,5 s na CoinGecko). Contador do mês em uso.json.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buscarCopom, buscarCotacoes, buscarCripto, buscarCvm, buscarFocus, buscarSgs, decisoesDaSelic, ipca12m, limitador, proximaReuniao, semSegredo, SERIES,
} from './fontes.mjs';
import { BASE_AION, lerChave } from './credencial.mjs';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VAULT = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(APP, '..', 'sinapse');
const PASTA_FIN = join(VAULT, '04-NEGOCIO', 'financeiro');
export const ARQ_MERCADO = () => join(BASE_AION(), 'mercado.json');

/** "Ação ABCD3", "FII ABCD11" → código de negociação; `codigo` gravado vence. */
export function tickerDe(l) {
  if (l.codigo) return String(l.codigo).toUpperCase();
  const m = /\b([A-Z]{4}\d{1,2}[A-Z]?)\b/.exec(String(l.descricao || ''));
  return m ? m[1] : '';
}
export const ehCripto = (l) => String(l.classe || '').toLowerCase() === 'cripto';

/** O que buscar: ativos da carteira (última posição de cada um) + a lista de observação. */
export function ativosParaColetar(lancamentos, observacao) {
  const bolsa = new Set();
  const cripto = new Set();
  for (const l of lancamentos) {
    if (l.tipo !== 'investimento') continue;
    if (ehCripto(l)) { const c = String(l.codigo || l.descricao || '').trim(); if (c) cripto.add(c.length <= 6 ? c.toUpperCase() : c); continue; }
    const t = tickerDe(l);
    if (t) bolsa.add(t);
  }
  for (const a of observacao || []) {
    const c = String(a.codigo || '').trim();
    if (!c) continue;
    if (a.tipo === 'cripto') cripto.add(c); else bolsa.add(c.toUpperCase());
  }
  return { bolsa: [...bolsa].sort(), cripto: [...cripto].sort() };
}

function lerBloco(arquivo, bloco) {
  if (!existsSync(arquivo)) return null;
  const m = readFileSync(arquivo, 'utf8').match(new RegExp('```' + bloco + '\\s*\\n([\\s\\S]*?)```'));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function lerVault() {
  const lancamentos = [];
  if (existsSync(PASTA_FIN)) {
    for (const f of readdirSync(PASTA_FIN).filter((x) => /^\d{4}-\d{2}\.md$/.test(x))) {
      const p = lerBloco(join(PASTA_FIN, f), 'financeiro');
      if (p && Array.isArray(p.lancamentos)) lancamentos.push(...p.lancamentos);
    }
  }
  const obs = lerBloco(join(PASTA_FIN, 'aion-observacao.md'), 'aion-observacao');
  return { lancamentos, observacao: Array.isArray(obs?.ativos) ? obs.ativos : [] };
}

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/**
 * Uma rodada. `pegar` = fetch (o teste passa um falso); `anterior` = cache que já existia (o que
 * falhar agora fica com o dado de antes, cada fonte com a sua data `em`).
 */
export async function coletar({ pegar = fetch, anterior = null, hoje = hojeSP(), agora = new Date().toISOString(), ativos, chaves = {}, so = null, forcarCvm = false, uso = {} } = {}) {
  const mes = hoje.slice(0, 7);
  const lim = limitador({
    uso, mes, intervaloMs: 400,
    intervaloPorHost: { 'api.coingecko.com': 2500 },
    tetoPorHost: { 'brapi.dev': { mes: 12000, rodada: 60 }, 'api.coingecko.com': { mes: 9000, rodada: 3 } },
  });
  const quer = (k) => !so || so.includes(k);
  const m = anterior ? structuredClone(anterior) : {};
  m.versao = 1;
  m.erros = [];
  const falhou = (fonte, e) => m.erros.push({ fonte, erro: semSegredo(String(e && e.message || e)).slice(0, 240), em: agora });

  if (quer('bcb')) {
    m.bcb = m.bcb || {};
    for (const k of Object.keys(SERIES)) {
      try {
        const s = await buscarSgs(pegar, lim, k);
        const ult = s.pontos[s.pontos.length - 1];
        const base = { fonte: s.fonte, nome: s.nome, url: s.url, em: agora };
        if (k === 'selicMeta') m.bcb.selicMeta = { ...base, valor: ult?.valor ?? null, data: ult?.data || '', decisoes: decisoesDaSelic(s.pontos).slice(-12) };
        else if (k === 'ipcaMensal') m.bcb.ipca = { ...base, mensal: s.pontos.slice(-24), doze: ipca12m(s.pontos), ultimo: ult || null };
        else if (k === 'cdiMensal') m.bcb.cdiMensal = { ...base, pontos: s.pontos.slice(-72) };
        else if (k === 'cdiAnual') m.bcb.cdi = { ...base, valor: ult?.valor ?? null, data: ult?.data || '' };
        else if (k === 'dolar') m.bcb.dolar = { ...base, valor: ult?.valor ?? null, data: ult?.data || '', pontos: s.pontos.slice(-30) };
      } catch (e) { falhou(`bcb:${k}`, e); }
    }
  }
  if (quer('focus')) {
    try { m.focus = { ...(await buscarFocus(pegar, lim, Number(hoje.slice(0, 4)))), em: agora }; } catch (e) { falhou('focus', e); }
  }
  if (quer('copom')) {
    try {
      const c = await buscarCopom(pegar, lim);
      m.copom = { ...c, proxima: proximaReuniao(c.decisoes, hoje), em: agora };
    } catch (e) { falhou('copom', e); }
  }
  if (quer('cotacao') && ativos.bolsa.length) {
    try {
      const r = await buscarCotacoes(pegar, lim, ativos.bolsa, chaves.brapi || '', agora);
      const antes = m.cotacoes?.porCodigo || {};
      const porCodigo = { ...antes };
      for (const c of r.cotacoes) porCodigo[c.codigo] = c;
      m.cotacoes = { fonte: r.fonte, url: r.url, porCodigo, semToken: r.semToken, comToken: !!chaves.brapi, em: agora };
      for (const e of r.erros) falhou(`cotacao:${e.codigo}`, e.erro);
    } catch (e) { falhou('cotacao', e); }
  }
  if (quer('cripto') && ativos.cripto.length) {
    try {
      const r = await buscarCripto(pegar, lim, ativos.cripto, chaves.coingecko || '', agora);
      const porCodigo = { ...(m.cripto?.porCodigo || {}) };
      for (const c of r.cotacoes) porCodigo[c.codigo] = c;
      m.cripto = { fonte: r.fonte, citar: r.citar, url: r.url, porCodigo, comChave: !!chaves.coingecko, em: agora };
    } catch (e) { falhou('cripto', e); }
  }
  const cvmVelha = !m.cvm?.em || (Date.parse(agora) - Date.parse(m.cvm.em)) > 6 * 86400000;
  if (quer('cvm') && ativos.bolsa.length && (forcarCvm || cvmVelha)) {
    try { m.cvm = { ...(await buscarCvm(pegar, lim, ativos.bolsa, hoje)), em: agora }; } catch (e) { falhou('cvm', e); }
  }
  m.geradoEm = agora;
  m.ativos = ativos;
  return { mercado: m, uso: lim.uso };
}

function resumo(m) {
  const l = [];
  const b = m.bcb || {};
  if (b.selicMeta) l.push(`Selic meta ${b.selicMeta.valor}% (${b.selicMeta.data}) · ${b.selicMeta.decisoes.length} decisões na série`);
  if (b.cdi) l.push(`CDI ${b.cdi.valor}% a.a. (${b.cdi.data})`);
  if (b.ipca) l.push(`IPCA ${b.ipca.ultimo?.valor}% em ${b.ipca.ultimo?.data?.slice(0, 7)} · 12 meses ${b.ipca.doze}%`);
  if (b.dolar) l.push(`dólar R$ ${b.dolar.valor} (${b.dolar.data})`);
  if (m.focus) l.push(`Focus de ${m.focus.data}: IPCA ${JSON.stringify(m.focus.medianas.IPCA || {})}`);
  if (m.copom) l.push(`Copom: última ${m.copom.decisoes[0]?.numero}ª (${m.copom.decisoes[0]?.data}) "${m.copom.decisoes[0]?.titulo}"; próxima ${m.copom.proxima.numero}ª ${m.copom.proxima.dias || '(data não cadastrada)'}`);
  if (m.cotacoes) l.push(`cotações: ${Object.keys(m.cotacoes.porCodigo).join(', ') || 'nenhuma'}${m.cotacoes.semToken.length ? ` · sem token da brapi: ${m.cotacoes.semToken.join(', ')}` : ''}`);
  if (m.cripto) l.push(`cripto: ${Object.keys(m.cripto.porCodigo).join(', ')} (${m.cripto.citar})`);
  if (m.cvm) l.push(`CVM: ${m.cvm.fatos.length} fatos relevantes desde 120 dias · sem empresa: ${m.cvm.semEmpresa.join(', ') || 'nenhum'}`);
  for (const e of m.erros) l.push(`ERRO ${e.fonte}: ${e.erro}`);
  return l.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const gravar = args.includes('--gravar');
  const so = (args.find((a) => a.startsWith('--so=')) || '').slice(5).split(',').filter(Boolean);
  const base = BASE_AION();
  const arq = ARQ_MERCADO();
  const anterior = existsSync(arq) ? JSON.parse(readFileSync(arq, 'utf8')) : null;
  const arqUso = join(base, 'uso.json');
  const uso = existsSync(arqUso) ? JSON.parse(readFileSync(arqUso, 'utf8')) : {};
  const avisos = [];
  const chaves = { brapi: lerChave('brapi', { avisar: (t) => avisos.push(t) }), coingecko: lerChave('coingecko', { avisar: (t) => avisos.push(t) }) };
  const { lancamentos, observacao } = lerVault();
  const ativos = ativosParaColetar(lancamentos, observacao);
  const { mercado, uso: usoNovo } = await coletar({ anterior, ativos, chaves, so: so.length ? so : null, forcarCvm: args.includes('--cvm'), uso });
  const txt = resumo(mercado);
  console.log(`Aion · ${gravar ? 'gravar' : 'simular (nada gravado)'} · ativos: ${ativos.bolsa.length} da bolsa, ${ativos.cripto.length} cripto`);
  console.log(`brapi: ${chaves.brapi ? 'com token' : 'sem token (só PETR4, MGLU3, VALE3, ITUB4)'} · CoinGecko: ${chaves.coingecko ? 'com chave Demo' : 'endpoint público'}`);
  for (const a of avisos) console.log('aviso: ' + a);
  console.log(txt);
  mkdirSync(base, { recursive: true });
  writeFileSync(arqUso, JSON.stringify(usoNovo)); // o contador conta também no simular: a chamada aconteceu
  if (gravar) {
    writeFileSync(arq, JSON.stringify(mercado, null, 1));
    mkdirSync(join(base, 'logs'), { recursive: true });
    appendFileSync(join(base, 'logs', `${new Date().toISOString().slice(0, 7)}.log`), `\n[${new Date().toISOString()}] gravado\n${txt}\n`);
    console.log(`\ngravado em ${arq}`);
  }
  process.exitCode = mercado.erros.length && !Object.keys(mercado.bcb || {}).length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('Aion: ' + semSegredo(String(e && e.message || e))); process.exitCode = 1; });
}
