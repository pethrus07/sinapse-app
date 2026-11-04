// Aion · o que o índice do app leva para o módulo de investimentos (chamado por build-index.mjs).
//  - mercado: o cache local do coletor (%LOCALAPPDATA%\sinapse-aion\mercado.json, ou SINAPSE_AION).
//    Só dado público de mercado; sem o arquivo, null (a tela explica como coletar).
//  - observacao, regra, metas, estudo: blocos JSON dos arquivos do vault em 04-NEGOCIO/financeiro/
//    (aion-observacao.md, aion-regra.md, aion-metas.md, aion-estudo.md). JSON quebrado = null + erro
//    (a tela avisa; nada é regravado em cima).
//  - trilha: os 11 blocos da nota trilha-investimentos-e-economia (tabela "Os 11 blocos").
//  - chaves: só SE existe a chave da brapi / CoinGecko (o conteúdo nunca é lido aqui).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_AION, temChave } from './credencial.mjs';

export const PASTA_AION = '04-NEGOCIO/financeiro';
export const ARQUIVOS_AION = {
  observacao: { arquivo: 'aion-observacao.md', bloco: 'aion-observacao' },
  regra: { arquivo: 'aion-regra.md', bloco: 'aion-regra' },
  metas: { arquivo: 'aion-metas.md', bloco: 'aion-metas' },
  estudo: { arquivo: 'aion-estudo.md', bloco: 'aion-estudo' },
};
export const NOTA_TRILHA = 'trilha-investimentos-e-economia';

function lerBloco(VAULT, { arquivo, bloco }) {
  const rel = `${PASTA_AION}/${arquivo}`;
  const full = join(VAULT, rel);
  if (!existsSync(full)) return { rel, dado: null, erro: '' };
  const m = readFileSync(full, 'utf8').match(new RegExp('```' + bloco + '\\s*\\n([\\s\\S]*?)```'));
  if (!m) return { rel, dado: null, erro: `sem bloco ${bloco}` };
  try { return { rel, dado: JSON.parse(m[1]), erro: '' }; } catch { return { rel, dado: null, erro: `JSON inválido no bloco ${bloco}` }; }
}

const semMd = (t) => String(t || '').replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1').replace(/\*\*?|`/g, '').trim();

/** Os blocos da tabela "| # | bloco | o que aprender | material principal |" da nota da trilha. */
export function blocosDaTrilha(corpo) {
  const out = [];
  for (const l of String(corpo || '').split(/\r?\n/)) {
    const c = l.split('|').map((x) => x.trim());
    if (c.length < 6 || !/^\d{1,2}$/.test(c[1])) continue;
    out.push({ n: Number(c[1]), titulo: semMd(c[2]), aprender: semMd(c[3]), material: semMd(c[4]) });
  }
  return out.sort((a, b) => a.n - b.n);
}

export function lerMercado() {
  const arq = join(BASE_AION(), 'mercado.json');
  if (!existsSync(arq)) return null;
  try { return JSON.parse(readFileSync(arq, 'utf8')); } catch { return null; }
}

export function lerAion(VAULT, notas) {
  const arquivos = {};
  const erros = [];
  for (const [k, def] of Object.entries(ARQUIVOS_AION)) {
    const r = lerBloco(VAULT, def);
    arquivos[k] = r.dado ? { ...r.dado, rel: r.rel } : null;
    if (r.erro) erros.push({ arquivo: r.rel, erro: r.erro });
  }
  const nota = (notas || []).find((n) => n.id === NOTA_TRILHA);
  // o corpo da nota no índice já tem os wikilinks trocados por [alias](wl:id); semMd tira os dois
  const corpo = nota ? String(nota.body || '').replace(/\[([^\]]+)\]\(wlx?:[^)]+\)/g, '$1') : '';
  return {
    mercado: lerMercado(),
    observacao: arquivos.observacao,
    regra: arquivos.regra,
    metas: arquivos.metas,
    estudo: arquivos.estudo,
    trilha: { nota: nota ? nota.id : '', rel: nota ? nota.rel : '', blocos: blocosDaTrilha(corpo) },
    chaves: { brapi: temChave('brapi'), coingecko: temChave('coingecko') },
    erros,
  };
}
