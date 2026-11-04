// Aion · escrita segura no vault (chamada pelo POST /api/aion do dev server, scripts/vault-api.mjs).
// Mesmo padrão do orçamento da Métis: só application/json de origem local (conferido antes, no
// vault-api), caminho FIXO por ação (nada de caminho vem do navegador), validação de cada campo, e
// só o bloco JSON é trocado se o arquivo existe (frontmatter, texto e CRLF ficam como estão).
// Texto livre com cara de documento, conta, cartão ou chave Pix é recusado (o vault é git).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pareceSensivel } from '../financas/nucleo.mjs';
import { ARQUIVOS_AION, PASTA_AION } from './indice.mjs';

export const TIPOS_ATIVO = ['acao', 'fii', 'etf', 'bdr', 'cripto'];
export const TIPOS_CARTEIRA = ['renda-fixa', 'fii', 'acao', 'cripto', 'outros'];
export const PROGRESSO = ['a-fazer', 'estudando', 'revisar', 'dominado']; // vocabulário do vault (saude-vault.py)

const erro = (msg, code = 400) => Object.assign(new Error(msg), { code });
const texto = (v, max, campo) => {
  const t = String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (t.length > max) throw erro(`${campo}: no máximo ${max} letras`);
  if (t && pareceSensivel(t)) throw erro(`${campo} parece ter documento, conta, cartão, e-mail ou telefone: tire antes de gravar`);
  return t;
};
/** "1.234,56", "1234,56", número → reais; '' / null → null. */
const valor = (v, campo) => {
  if (v === '' || v == null) return null;
  let t = typeof v === 'number' ? String(v) : String(v).trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (typeof v !== 'number') {
    if (!/^[\d.,]+$/.test(t)) throw erro(`${campo}: valor inválido`);
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw erro(`${campo}: valor inválido`);
  return Math.round(n * 100) / 100;
};
const pct = (v, campo, max = 100) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max) throw erro(`${campo}: precisa ser um número de 0 a ${max}`);
  return Math.round(n * 10) / 10;
};
const lista = (v, campo, maxItens = 20, maxTexto = 300) => {
  if (v == null) return [];
  if (!Array.isArray(v)) throw erro(`${campo}: precisa ser uma lista`);
  if (v.length > maxItens) throw erro(`${campo}: no máximo ${maxItens} itens`);
  return v.map((x, i) => texto(x, maxTexto, `${campo} ${i + 1}`)).filter(Boolean);
};

/** Lista de observação: { ativos: [{ codigo, tipo, nota, desde }] }. */
export function validarObservacao(p, hoje) {
  if (!Array.isArray(p.ativos)) throw erro('ativos ausentes');
  if (p.ativos.length > 60) throw erro('no máximo 60 ativos na lista');
  const vistos = new Set();
  const ativos = p.ativos.map((a, i) => {
    const codigo = String(a?.codigo || '').trim();
    if (!/^[A-Za-z0-9-]{2,40}$/.test(codigo)) throw erro(`ativo ${i + 1}: código inválido (ex.: ITSA4, ABCD11, bitcoin)`);
    const tipo = String(a?.tipo || '');
    if (!TIPOS_ATIVO.includes(tipo)) throw erro(`ativo ${codigo}: tipo inválido (${TIPOS_ATIVO.join(', ')})`);
    const k = (tipo === 'cripto' ? codigo.toLowerCase() : codigo.toUpperCase());
    if (vistos.has(k)) throw erro(`ativo repetido: ${codigo}`);
    vistos.add(k);
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(a?.desde || '') ? a.desde : hoje;
    return { codigo: tipo === 'cripto' ? codigo : codigo.toUpperCase(), tipo, nota: texto(a?.nota, 200, `nota de ${codigo}`), desde };
  });
  return { ativos };
}

/** Minha regra: { reservaMinima, alocacao: { tipo: { alvo, tolerancia } }, aportes, naoFazer, revisarEm }. */
export function validarRegra(p, hoje) {
  const alocacao = {};
  const a = p.alocacao && typeof p.alocacao === 'object' && !Array.isArray(p.alocacao) ? p.alocacao : {};
  for (const [k, v] of Object.entries(a)) {
    if (!TIPOS_CARTEIRA.includes(k)) throw erro(`tipo da alocação desconhecido: ${k}`);
    if (v == null || v.alvo === '' || v.alvo == null) continue;
    alocacao[k] = { alvo: pct(v.alvo, `alvo de ${k}`), tolerancia: v.tolerancia === '' || v.tolerancia == null ? 5 : pct(v.tolerancia, `tolerância de ${k}`, 50) };
  }
  const soma = Object.values(alocacao).reduce((s, x) => s + x.alvo, 0);
  if (Object.keys(alocacao).length && Math.abs(soma - 100) > 0.5) throw erro(`os alvos somam ${soma.toLocaleString('pt-BR')}%: precisam somar 100% da carteira fora da reserva`);
  const revisarEm = p.revisarEm ? String(p.revisarEm) : '';
  if (revisarEm && !/^\d{4}-(0[1-9]|1[0-2])$/.test(revisarEm)) throw erro('revisar em: use AAAA-MM');
  return {
    reservaMinima: valor(p.reservaMinima, 'reserva mínima'),
    alocacao,
    aportes: lista(p.aportes, 'regra de aporte'),
    naoFazer: lista(p.naoFazer, 'o que não fazer'),
    revisarEm,
    escritaEm: hoje,
  };
}

/** Metas: { reserva, carteira, meta3: { nome, valor } } (valor null = o Pedro ainda não definiu). */
export function validarMetas(p) {
  const m3 = p.meta3 && typeof p.meta3 === 'object' ? p.meta3 : {};
  return {
    reserva: valor(p.reserva, 'meta da reserva'),
    carteira: valor(p.carteira, 'meta da carteira'),
    meta3: { nome: texto(m3.nome, 80, 'nome da meta 3') || 'sair de casa ou veículo', valor: valor(m3.valor, 'valor da meta 3') },
  };
}

function corpoNovo(def, titulo, explica, json, hoje) {
  return `---\ntipo: aion\narea: negocio\ntags:\n  - aion\n  - investimentos\ncriado: '${hoje}'\n---\n\n# ${titulo}\n\n> ${explica}\n\n\`\`\`${def.bloco}\n${json}\n\`\`\`\n\n## Conexões\n- Módulo: [[aion]]\n`;
}

/** Troca só o bloco (ou cria o arquivo). Devolve o caminho relativo gravado. */
export function gravarBloco(VAULT, def, dado, hoje, titulo, explica) {
  const rel = `${PASTA_AION}/${def.arquivo}`;
  const full = join(VAULT, rel);
  const json = JSON.stringify(dado, null, 2);
  const re = new RegExp('```' + def.bloco + '\\s*\\n[\\s\\S]*?```');
  let saida;
  if (existsSync(full)) {
    const atual = readFileSync(full, 'utf8');
    const m = atual.match(new RegExp('```' + def.bloco + '\\s*\\n([\\s\\S]*?)```'));
    if (m) { try { JSON.parse(m[1]); } catch { throw erro(`o bloco ${def.bloco} de ${rel} tem JSON inválido: corrija o arquivo antes (nada foi gravado)`, 409); } }
    const eol = atual.includes('\r\n') ? '\r\n' : '\n';
    const bloco = ('```' + def.bloco + '\n' + json + '\n```').replace(/\n/g, eol);
    saida = m ? atual.replace(re, () => bloco) : atual.replace(/\s*$/, eol + eol + bloco + eol);
  } else {
    saida = corpoNovo(def, titulo, explica, json, hoje);
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, saida, 'utf8');
  return rel;
}

function lerAtual(VAULT, def) {
  const full = join(VAULT, PASTA_AION, def.arquivo);
  if (!existsSync(full)) return null;
  const m = readFileSync(full, 'utf8').match(new RegExp('```' + def.bloco + '\\s*\\n([\\s\\S]*?)```'));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { throw erro(`o bloco ${def.bloco} tem JSON inválido: corrija o arquivo antes (nada foi gravado)`, 409); }
}

export function gravarAion(VAULT, p, hoje) {
  const acao = String(p?.acao || '');
  if (acao === 'observacao') {
    const rel = gravarBloco(VAULT, ARQUIVOS_AION.observacao, validarObservacao(p, hoje), hoje, 'Aion · lista de observação',
      'Ativos que o Pedro acompanha sem ter (ação, FII, cripto). Gravado pelo app (Aion › Lista de observação); o coletor busca a cotação destes também.');
    return { acao, rel };
  }
  if (acao === 'regra') {
    const rel = gravarBloco(VAULT, ARQUIVOS_AION.regra, validarRegra(p, hoje), hoje, 'Aion · minha regra (política de investimento)',
      'Escrita pelo Pedro (bloco 11 da trilha). O Aion compara a carteira com a alocação-alvo e mostra o desvio; quem decide é o Pedro.');
    return { acao, rel };
  }
  if (acao === 'metas') {
    const rel = gravarBloco(VAULT, ARQUIVOS_AION.metas, validarMetas(p), hoje, 'Aion · metas',
      'Valores das metas, definidos pelo Pedro. A data de chegada sai do ritmo real de aporte medido no razão.');
    return { acao, rel };
  }
  if (acao === 'estudo') {
    const n = Number(p.bloco);
    if (!Number.isInteger(n) || n < 1 || n > 30) throw erro('bloco inválido');
    if (!PROGRESSO.includes(p.progresso)) throw erro(`progresso inválido (${PROGRESSO.join(', ')})`);
    const atual = lerAtual(VAULT, ARQUIVOS_AION.estudo) || {};
    const blocos = { ...(atual.blocos || {}), [String(n)]: p.progresso };
    const rel = gravarBloco(VAULT, ARQUIVOS_AION.estudo, { blocos, atualizado: hoje }, hoje, 'Aion · progresso da trilha',
      'Progresso por bloco da trilha de investimentos e economia, no vocabulário do vault (a-fazer, estudando, revisar, dominado). Gravado pelo app (Aion › Estudo).');
    return { acao, rel };
  }
  throw erro('ação desconhecida: ' + acao);
}
