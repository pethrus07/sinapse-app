// Núcleo da sincronização do banco com o razão do vault. NÃO conhece a fonte: recebe
// transações já normalizadas (Pluggy hoje; um leitor de OFX/CSV amanhã entrega o mesmo formato)
// e decide, para cada uma: já importada, ignorar, casar com um previsto (liquidar) ou lançar nova.
//
// Transação normalizada (o que um leitor entrega):
//   { idFonte, fonte, data: 'AAAA-MM-DD', valor: > 0, direcao: 'entrada'|'saida',
//     texto: string (SÓ EM MEMÓRIA: descrição crua + contraparte + estabelecimento, para as regras),
//     documentos: string[] (só dígitos, SÓ EM MEMÓRIA), meio: 'pix'|'ted'|'boleto'|'cartao'|'outro',
//     conta: 'Nubank · conta' (rótulo, nunca número), viaCartao: bool, fatura: 'AAAA-MM'|'',
//     categoriaFonte: string (taxonomia do banco/agregador), pendente: bool }
//
// Regra de ouro: nada que sai daqui para o vault ou para o terminal carrega texto cru do banco.
// A descrição gravada é montada de pedaços conhecidos (meio + regra) e passa por `sanear`.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PASTA_RAZAO = join('04-NEGOCIO', 'financeiro');
const BLOCO = /```financeiro\s*\n([\s\S]*?)```/;
const n = (v) => Number(v) || 0;

/* ------------------------------------------------------------------ saneamento */

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Hash curto e estável: guarda a identidade da transação sem guardar o id cru. */
export function hashId(fonte, id) {
  return createHash('sha256').update(`${fonte}:${id}`).digest('hex').slice(0, 16);
}

const PADROES_SENSIVEIS = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,                  // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,          // CNPJ
  /[*•xX]{2,}\s?\d{2,}/g,                               // cartão mascarado (**** 1234)
  /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g,           // cartão inteiro
  /\b(ag|agencia|agência|conta|cc|c\/c)\.?\s*:?\s*\d[\d.-]*/gi, // agência / conta
  /\b\d{5,}\b/g,                                        // qualquer número longo (conta, documento, protocolo)
  /[\w.+-]+@[\w-]+\.[\w.]+/g,                            // e-mail (chave Pix)
  /\+?55\s?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g,              // telefone (chave Pix)
];

/** Tira documento, conta, cartão, e-mail e telefone. Não tira nome: nome nunca entra aqui. */
export function sanear(texto) {
  let s = String(texto || '');
  for (const p of PADROES_SENSIVEIS) s = s.replace(p, '');
  return s.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/[·\-–—:,\s]+$/g, '').trim();
}

/** true se o texto ainda tem cara de dado sensível (usado nos testes e como trava antes de gravar). */
export function pareceSensivel(texto) {
  return PADROES_SENSIVEIS.some((p) => { p.lastIndex = 0; const r = p.test(String(texto || '')); p.lastIndex = 0; return r; });
}

/* ------------------------------------------------------------------ regras */

/**
 * regras.json (fora do git, %LOCALAPPDATA%\sinapse-financas\regras\regras.json). Formato em
 * scripts/financas/regras.exemplo.json. A primeira regra que casa decide.
 */
export function normalizarRegras(r = {}) {
  return {
    regras: Array.isArray(r.regras) ? r.regras : [],
    contas: Array.isArray(r.contas) ? r.contas : [],
    investimentos: Array.isArray(r.investimentos) ? r.investimentos : [],
    ignorarCategorias: (r.ignorarCategorias || []).map(norm),
    toleranciaDias: Number.isFinite(r.toleranciaDias) ? r.toleranciaDias : 5,
  };
}

export function regraDe(t, regras) {
  const texto = norm(t.texto);
  for (const r of regras.regras) {
    const q = r.quando || {};
    if (q.direcao && q.direcao !== t.direcao) continue;
    if (q.meio && q.meio !== t.meio) continue;
    if (q.viaCartao !== undefined && !!q.viaCartao !== !!t.viaCartao) continue;
    if (q.valor !== undefined && Math.abs(n(q.valor) - t.valor) > 0.005) continue;
    if (q.texto && !texto.includes(norm(q.texto))) continue;
    if (q.documento && !(t.documentos || []).includes(String(q.documento).replace(/\D/g, ''))) continue;
    if (q.categoriaFonte && norm(q.categoriaFonte) !== norm(t.categoriaFonte)) continue;
    if (!q.texto && !q.documento && !q.categoriaFonte && q.valor === undefined) continue; // regra vazia não casa tudo
    return r;
  }
  return null;
}

/* ------------------------------------------------------------------ razão */

const mesDe = (d) => String(d || '').slice(0, 7);
const ehAberto = (l) => l.status === 'a-receber' || l.status === 'a-pagar';

/** Lê todos os AAAA-MM.md: { mes: { arquivo, texto, lista } }. */
export function lerRazao(vault) {
  const pasta = join(vault, PASTA_RAZAO);
  const meses = {};
  if (!existsSync(pasta)) return meses;
  for (const f of readdirSync(pasta)) {
    if (!/^\d{4}-\d{2}\.md$/.test(f)) continue;
    const arquivo = join(pasta, f);
    const texto = readFileSync(arquivo, 'utf8');
    const m = texto.match(BLOCO);
    let lista = [];
    if (m) lista = JSON.parse(m[1]).lancamentos || []; // JSON quebrado: deixa estourar, nunca grava por cima
    meses[f.slice(0, 7)] = { arquivo, texto, lista };
  }
  return meses;
}

const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Grava SÓ o bloco ```financeiro do mês, preservando o resto do arquivo (e o CRLF, se houver). */
export function gravarMes(vault, mes, estado, lista, hoje) {
  const json = JSON.stringify({ lancamentos: lista }, null, 2);
  if (estado && estado.texto) {
    const crlf = estado.texto.includes('\r\n');
    const bloco = '```financeiro\n' + json + '\n```';
    const novo = BLOCO.test(estado.texto)
      ? estado.texto.replace(BLOCO, () => (crlf ? bloco.replace(/\n/g, '\r\n') : bloco))
      : estado.texto.trimEnd() + (crlf ? '\r\n\r\n' : '\n\n') + (crlf ? bloco.replace(/\n/g, '\r\n') : bloco) + (crlf ? '\r\n' : '\n');
    writeFileSync(estado.arquivo, novo, 'utf8');
    return estado.arquivo;
  }
  const [ano, m2] = mes.split('-');
  const arquivo = join(vault, PASTA_RAZAO, `${mes}.md`);
  mkdirSync(join(vault, PASTA_RAZAO), { recursive: true });
  const texto = `---\ntipo: financeiro\narea: negocio\ntags:\n  - financeiro\n  - caixa\n  - ${mes}\nmes: ${mes}\ncriado: '${hoje}'\n---\n\n# 💰 Financeiro · ${NOMES_MES[Number(m2) - 1]} de ${ano}\n\n> Um arquivo por mês. O bloco abaixo é a fonte; o app lê, soma e joga os vencimentos abertos no [[AGENDA|calendário]].\n\n\`\`\`financeiro\n${json}\n\`\`\`\n\n## Conexões\n- Calendário: [[AGENDA]] · foco: [[AGORA]]\n- Negócio: [[MOC-negocio]]\n`;
  writeFileSync(arquivo, texto, 'utf8');
  return arquivo;
}

/* ------------------------------------------------------------------ descrição saneada */

const MEIO = {
  entrada: { pix: 'Pix recebido', ted: 'Transferência recebida', boleto: 'Boleto recebido', cartao: 'Estorno no cartão', outro: 'Entrada' },
  saida: { pix: 'Pix enviado', ted: 'Transferência enviada', boleto: 'Boleto pago', cartao: 'Compra no cartão', outro: 'Saída' },
};

export function descricaoSaneada(t, regra) {
  if (regra && regra.descricao) return sanear(regra.descricao);
  const base = MEIO[t.direcao][t.viaCartao ? 'cartao' : t.meio] || MEIO[t.direcao].outro;
  const quem = regra && regra.cliente ? regra.cliente : '';
  return sanear(quem ? `${base} · ${quem}` : base);
}

/* ------------------------------------------------------------------ plano */

const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/**
 * Previsto candidato: aberto, mesma direção, mesmo valor (centavo), vencimento a até ±N dias
 * (sem dia: mesmo mês do arquivo), cliente da regra quando houver, e o pedaço de id da regra.
 */
function candidatos(t, regra, razao, tol) {
  const out = [];
  for (const [mes, st] of Object.entries(razao)) {
    for (const l of st.lista) {
      if (!ehAberto(l) || l.tipo === 'investimento') continue;
      if (t.direcao === 'entrada' ? l.tipo !== 'entrada' : l.tipo === 'entrada') continue;
      if (Math.abs(n(l.valor) - t.valor) > 0.005) continue;
      if (l.vencimento) { if (Math.abs(diasEntre(l.vencimento.slice(0, 10), t.data)) > tol) continue; }
      else if (mes !== mesDe(t.data)) continue;
      if (regra && regra.cliente && (l.cliente || '') !== regra.cliente) continue;
      if (regra && regra.previsto && !String(l.id).includes(regra.previsto)) continue;
      out.push({ mes, l, dist: l.vencimento ? Math.abs(diasEntre(l.vencimento.slice(0, 10), t.data)) : 99 });
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

function idNovo(t, desc) {
  const slug = norm(desc).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${t.data}-${slug || 'transacao'}-${t.fitid.slice(0, 6)}`;
}

/**
 * Decide o que fazer com cada transação. Puro: não grava nada. Devolve as ações e o relatório.
 * `razao` é o de lerRazao (é mutado só numa cópia interna, para duas transações iguais não
 * liquidarem o mesmo previsto).
 */
export function planejar(transacoes, razaoOriginal, regrasBrutas = {}) {
  const regras = normalizarRegras(regrasBrutas);
  const razao = Object.fromEntries(Object.entries(razaoOriginal).map(([m, st]) => [m, { ...st, lista: st.lista.map((l) => ({ ...l })) }]));
  const conhecidos = new Set();
  for (const st of Object.values(razao)) for (const l of st.lista) if (l.fitid) conhecidos.add(l.fitid);

  const acoes = [];
  const rel = { casados: [], novos: [], aClassificar: [], ignorados: { jaImportado: 0, regra: 0, categoria: 0, pendente: 0 }, ambiguos: [] };

  for (const bruta of transacoes) {
    const t = { ...bruta, fitid: bruta.fitid || hashId(bruta.fonte, bruta.idFonte) };
    if (conhecidos.has(t.fitid)) { rel.ignorados.jaImportado++; continue; }
    if (t.pendente) { rel.ignorados.pendente++; continue; }
    if (regras.ignorarCategorias.includes(norm(t.categoriaFonte))) { rel.ignorados.categoria++; continue; }
    const regra = regraDe(t, regras);
    if (regra && regra.ignorar) { rel.ignorados.regra++; continue; }
    conhecidos.add(t.fitid);

    // compra no cartão não liquida previsto: quem liquida é o pagamento da fatura na conta
    const cands = t.viaCartao ? [] : candidatos(t, regra, razao, regras.toleranciaDias);
    const empate = cands.length > 1 && cands[0].dist === cands[1].dist && !(regra && (regra.previsto || regra.cliente));
    if (empate) {
      rel.ambiguos.push({ data: t.data, valor: t.valor, direcao: t.direcao, opcoes: cands.slice(0, 4).map((c) => c.l.id) });
      conhecidos.delete(t.fitid); // não grava: volta na próxima rodada, depois de uma regra decidir
      continue;
    }
    if (cands.length) {
      const { mes, l } = cands[0];
      l.status = l.tipo === 'entrada' ? 'recebido' : 'pago';
      l.liquidadoEm = t.data;
      l.fitid = t.fitid;
      l.origem = t.fonte;
      acoes.push({ acao: 'liquidar', mes, id: l.id, liquidadoEm: t.data, fitid: t.fitid, origem: t.fonte });
      rel.casados.push({ data: t.data, valor: t.valor, id: l.id, descricao: l.descricao });
      continue;
    }
    const descricao = descricaoSaneada(t, regra);
    const categoria = (regra && regra.categoria) || 'a classificar';
    const novo = {
      id: idNovo(t, descricao),
      tipo: t.direcao === 'entrada' ? 'entrada' : 'saida',
      descricao,
      valor: Math.round(t.valor * 100) / 100,
      vencimento: t.data,
      status: t.direcao === 'entrada' ? 'recebido' : 'pago',
      liquidadoEm: t.data,
      cliente: (regra && regra.cliente) || '',
      categoria,
      nota: (regra && regra.nota) || '',
      recorrente: false,
      obs: '',
      origem: t.fonte,
      fitid: t.fitid,
      conta: sanear(t.conta || ''),
      ...(t.viaCartao ? { viaCartao: true, ...(t.fatura ? { fatura: t.fatura } : {}) } : {}),
    };
    const mes = mesDe(t.data);
    if (!razao[mes]) razao[mes] = { arquivo: '', texto: '', lista: [] };
    razao[mes].lista.push(novo);
    acoes.push({ acao: 'novo', mes, lancamento: novo });
    const linha = { data: t.data, valor: t.valor, direcao: t.direcao, descricao, conta: novo.conta, categoriaFonte: sanear(t.categoriaFonte || '') };
    if (categoria === 'a classificar') rel.aClassificar.push(linha); else rel.novos.push(linha);
  }
  return { acoes, relatorio: rel, razao };
}

/* ------------------------------------------------------------------ faturas e investimentos */

/**
 * Fatura do cartão vinda do banco: atualiza o previsto aberto do mês do vencimento para o valor
 * medido (confianca: medido) ou abre o previsto se não houver. Fatura já paga não mexe: quem a
 * liquida é o pagamento na conta.
 */
export function planejarFaturas(faturas, razao, hoje) {
  const acoes = [];
  const rel = { atualizadas: [], abertas: [] };
  for (const f of faturas) {
    if (!f.vencimento || f.vencimento < hoje.slice(0, 8) + '01') continue;
    const mes = mesDe(f.vencimento);
    const st = razao[mes];
    const prev = st && st.lista.find((l) => l.tipo === 'saida' && /cart[aã]o/i.test(l.categoria || '') && ehAberto(l));
    const fatFitid = hashId(f.fonte, f.idFonte);
    if (prev) {
      if (Math.abs(n(prev.valor) - f.valor) < 0.005 && prev.confianca === 'medido') continue;
      const antes = n(prev.valor);
      prev.valor = Math.round(f.valor * 100) / 100;
      prev.confianca = 'medido';
      prev.faturaFitid = fatFitid;
      acoes.push({ acao: 'atualizar', mes, id: prev.id, campos: { valor: prev.valor, confianca: 'medido', faturaFitid: fatFitid } });
      rel.atualizadas.push({ mes, antes, depois: prev.valor });
    } else {
      if (Object.values(razao).some((s) => s.lista.some((l) => l.faturaFitid === fatFitid))) continue;
      const novo = {
        id: `${mes}-cartao-de-credito-fatura-${fatFitid.slice(0, 6)}`, tipo: 'saida', descricao: `Cartão de crédito · fatura${f.conta ? ' · ' + sanear(f.conta) : ''}`,
        valor: Math.round(f.valor * 100) / 100, vencimento: f.vencimento, status: 'a-pagar', cliente: '', categoria: 'cartao',
        nota: 'cartao-de-credito', recorrente: false, obs: 'Valor da fatura lido do banco.', confianca: 'medido', origem: f.fonte, faturaFitid: fatFitid,
      };
      if (!razao[mes]) razao[mes] = { arquivo: '', texto: '', lista: [] };
      razao[mes].lista.push(novo);
      acoes.push({ acao: 'novo', mes, lancamento: novo });
      rel.abertas.push({ mes, valor: novo.valor });
    }
  }
  return { acoes, relatorio: rel };
}

/**
 * Posição de investimento: uma por aplicação por mês (a última sincronização do mês vence).
 * `inv` normalizado: { idFonte, fonte, nome, instituicao, tipoFonte, saldo, vencimentoTitulo, data }.
 */
export function planejarInvestimentos(invs, razao, regrasBrutas = {}) {
  const regras = normalizarRegras(regrasBrutas);
  const acoes = [];
  const rel = { posicoes: [] };
  for (const i of invs) {
    const mes = mesDe(i.data);
    const fitid = hashId(i.fonte, i.idFonte) + '-' + mes;
    const regra = regras.investimentos.find((r) => r.padrao && norm(`${i.nome} ${i.instituicao} ${i.tipoFonte}`).includes(norm(r.padrao))) || {};
    const lanc = {
      id: `${mes}-investimento-${fitid.slice(0, 8)}`,
      tipo: 'investimento',
      descricao: sanear(regra.descricao || i.nome || 'Investimento'),
      instituicao: sanear(regra.instituicao || i.instituicao || ''),
      liquidez: regra.liquidez || (i.vencimentoTitulo ? 'no-vencimento' : ''),
      data: i.data,
      valor: Math.round(n(i.saldo) * 100) / 100,
      status: 'posicao',
      reserva: !!regra.reserva,
      vencimento: '',
      origem: i.fonte,
      fitid,
      obs: i.vencimentoTitulo ? `Título vence em ${i.vencimentoTitulo}.` : '',
    };
    if (!razao[mes]) razao[mes] = { arquivo: '', texto: '', lista: [] };
    const k = razao[mes].lista.findIndex((l) => l.fitid === fitid);
    if (k >= 0) {
      const velho = razao[mes].lista[k];
      if (velho.data >= lanc.data && n(velho.valor) === lanc.valor) continue;
      razao[mes].lista[k] = { ...velho, ...lanc, id: velho.id };
      acoes.push({ acao: 'posicao', mes, lancamento: razao[mes].lista[k] });
    } else {
      razao[mes].lista.push(lanc);
      acoes.push({ acao: 'posicao', mes, lancamento: lanc });
    }
    rel.posicoes.push({ mes, descricao: lanc.descricao, instituicao: lanc.instituicao, valor: lanc.valor, liquidez: lanc.liquidez || 'a confirmar' });
  }
  return { acoes, relatorio: rel };
}

/* ------------------------------------------------------------------ aplicar */

/**
 * Grava as ações no vault: relê cada mês do disco (não confia no plano velho), aplica e trava se
 * algo gravável ainda parecer dado sensível. Só os meses tocados são reescritos.
 */
export function aplicar(vault, acoes, hoje) {
  const atual = lerRazao(vault);
  const tocados = new Map();
  const lista = (mes) => {
    if (!tocados.has(mes)) tocados.set(mes, (atual[mes]?.lista || []).map((l) => ({ ...l })));
    return tocados.get(mes);
  };
  for (const a of acoes) {
    const ls = lista(a.mes);
    if (a.acao === 'liquidar') {
      const l = ls.find((x) => x.id === a.id);
      if (!l || !ehAberto(l)) continue; // alguém liquidou no meio: não pisa
      l.status = l.tipo === 'entrada' ? 'recebido' : 'pago';
      l.liquidadoEm = a.liquidadoEm; l.fitid = a.fitid; l.origem = a.origem;
    } else if (a.acao === 'atualizar') {
      const l = ls.find((x) => x.id === a.id);
      if (l) Object.assign(l, a.campos);
    } else if (a.acao === 'novo') {
      if (ls.some((x) => x.id === a.lancamento.id || (a.lancamento.fitid && x.fitid === a.lancamento.fitid))) continue;
      ls.push(a.lancamento);
    } else if (a.acao === 'posicao') {
      const k = ls.findIndex((x) => x.fitid === a.lancamento.fitid);
      if (k >= 0) ls[k] = a.lancamento; else ls.push(a.lancamento);
    }
  }
  // trava ANTES de gravar qualquer mês: ou grava tudo saneado, ou nada
  for (const [mes, ls] of tocados) {
    for (const l of ls) {
      if (!l.origem) continue;
      for (const campo of ['descricao', 'conta', 'instituicao', 'obs']) {
        if (l[campo] && pareceSensivel(l[campo]))
          throw new Error(`trava de saneamento: ${mes} ${l.id} campo ${campo}. Nada foi gravado.`);
      }
    }
  }
  for (const [mes, ls] of tocados) gravarMes(vault, mes, atual[mes], ls, hoje);
  return [...tocados.keys()].sort();
}
