// Núcleo da sincronização do banco com o razão do vault. NÃO conhece a fonte: recebe
// transações já normalizadas (Pluggy hoje; um leitor de OFX/CSV amanhã entrega o mesmo formato)
// e decide, para cada uma: já importada, ignorar, casar com um previsto (liquidar) ou lançar nova.
//
// Transação normalizada (o que um leitor entrega):
//   { idFonte, fonte, data: 'AAAA-MM-DD', valor: > 0, direcao: 'entrada'|'saida',
//     texto: string (SÓ EM MEMÓRIA: descrição crua + contraparte + estabelecimento, para as regras),
//     documentos: string[] (só dígitos, SÓ EM MEMÓRIA), meio: 'pix'|'ted'|'boleto'|'cartao'|'debito'|'outro',
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
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, // chave Pix aleatória, itemId, id de conta
  /[*•xX\d]{3}\.[*•xX\d]{3}\.[*•xX\d]{3}-[*•xX\d]{2}/g,  // CPF mascarado (***.123.456-**) ou formatado
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,                  // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g,          // CNPJ
  /[*•xX]{2,}\s?\d{2,}/g,                               // cartão mascarado (**** 1234)
  /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g,           // cartão inteiro
  /\b(ag|agencia|agência|conta|cc|c\/c)\.?\s*:?\s*\d[\d.-]*/gi, // agência / conta
  /\+?55\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g,        // telefone com DDI (chave Pix)
  /\(?\b\d{2}\)?\s?9\s?\d{4}[-\s]?\d{4}\b/g,            // celular com DDD, sem DDI
  /\b\d{5,}\b/g,                                        // qualquer número longo (conta, documento, protocolo)
  /[\w.+-]+@[\w-]+\.[\w.]+/g,                            // e-mail (chave Pix)
];

/** Tira documento, conta, cartão, chave Pix (aleatória, e-mail, telefone) e números longos. */
export function sanear(texto) {
  let s = String(texto || '');
  for (const p of PADROES_SENSIVEIS) s = s.replace(p, '');
  return s.replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/[·\-–—:,\s]+$/g, '').trim();
}

/** true se o texto ainda tem cara de dado sensível (usado nos testes e como trava antes de gravar). */
export function pareceSensivel(texto) {
  return PADROES_SENSIVEIS.some((p) => { p.lastIndex = 0; const r = p.test(String(texto || '')); p.lastIndex = 0; return r; });
}

// Nome de pessoa não tem padrão: quem sabe o nome é a própria transação (pagador, recebedor e
// titular, SÓ EM MEMÓRIA, em `t.nomes`). Toda palavra desses nomes (3+ letras, fora "da", "dos"…)
// sai do texto gravável, no meio da frase ou no fim, sem acento e sem maiúscula.
const LIGA = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du']);
const palavrasDe = (nomes) => [...new Set((nomes || []).flatMap((n) => norm(n).split(/[^a-z0-9]+/)).filter((w) => w.length >= 3 && !LIGA.has(w)))];

/**
 * Tira do texto as palavras dos nomes de pessoa conhecidos (os da transação), e o "da"/"de" que
 * ficaria solto entre elas ou no fim ("para JOSÉ DA SILVA" → "para").
 */
export function tirarNomes(texto, nomes) {
  const ws = new Set(palavrasDe(nomes));
  if (!ws.size) return String(texto || '');
  const partes = String(texto || '').split(/([\p{L}\p{N}]+)/u); // ímpares = palavras
  const ehPalavra = (k) => k % 2 === 1 && partes[k] !== '';
  const fora = partes.map((p, k) => ehPalavra(k) && ws.has(norm(p)));
  const vizinha = (k, d) => { for (let x = k + d; x >= 0 && x < partes.length; x += d) { if (ehPalavra(x)) return x; if (/[^\s]/.test(partes[x])) return -1; } return -1; };
  for (let k = 1; k < partes.length; k += 2) {
    if (fora[k] || !LIGA.has(norm(partes[k]))) continue;
    const a = vizinha(k, -1), b = vizinha(k, 1);
    // solto entre nomes, depois do nome no fim, ou antes de um nome que vai até o fim ("Pix da Fulana")
    let ateOFim = b >= 0 && fora[b];
    for (let x = b; ateOFim && x >= 0; x = vizinha(x, 1)) if (!fora[x]) ateOFim = false;
    if ((a >= 0 && fora[a] && (b < 0 || fora[b])) || ateOFim) fora[k] = true;
  }
  return sanear(partes.map((p, k) => (fora[k] ? '' : p)).join('').replace(/·\s*·/g, '·'));
}

/** true se o texto ainda tem alguma palavra dos nomes conhecidos. */
export function temNome(texto, nomes) {
  const ws = palavrasDe(nomes);
  const n = ` ${norm(texto).replace(/[^a-z0-9]+/g, ' ')} `;
  return ws.some((w) => n.includes(` ${w} `));
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
    if (q.contraparte && q.contraparte !== (t.contraparte || '')) continue; // 'pf' | 'pj' | '' (sem documento)
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

/* ------------------------------------------------------------------ retrato do patrimônio */

export const ARQ_PATRIMONIO = join(PASTA_RAZAO, 'patrimonio.md');
const BLOCO_PAT = /```patrimonio\s*\n([\s\S]*?)```/;

export function lerRetratos(vault) {
  const arq = join(vault, ARQ_PATRIMONIO);
  if (!existsSync(arq)) return [];
  const m = readFileSync(arq, 'utf8').match(BLOCO_PAT);
  return m ? JSON.parse(m[1]).retratos || [] : [];
}

/**
 * Guarda o retrato do dia (total, liquidez diária e por grupo; nenhum id, nenhum nome de
 * aplicação) em 04-NEGOCIO/financeiro/patrimonio.md. Um por dia: o do mesmo dia é trocado.
 * Devolve o caminho relativo se o arquivo mudou, senão ''.
 */
export function gravarRetrato(vault, retrato, hoje) {
  const arq = join(vault, ARQ_PATRIMONIO);
  const antigo = existsSync(arq) ? readFileSync(arq, 'utf8') : '';
  const m = antigo.match(BLOCO_PAT);
  const lista = m ? JSON.parse(m[1]).retratos || [] : [];
  const nova = [...lista.filter((r) => r.data !== retrato.data), retrato].sort((a, b) => a.data.localeCompare(b.data));
  // uma linha por retrato: o arquivo cresce ~1 linha por dia e o diff do git fica legível
  const json = '{\n  "retratos": [\n' + nova.map((r) => '    ' + JSON.stringify(r)).join(',\n') + '\n  ]\n}';
  const bloco = '```patrimonio\n' + json + '\n```';
  let texto;
  if (m) {
    const crlf = antigo.includes('\r\n');
    texto = antigo.replace(BLOCO_PAT, () => (crlf ? bloco.replace(/\n/g, '\r\n') : bloco));
  } else {
    texto = `---\ntipo: financeiro\narea: negocio\ntags:\n  - financeiro\n  - patrimonio\ncriado: '${hoje}'\n---\n\n# 📈 Patrimônio · um retrato por dia\n\n> Gravado pela sincronização do banco (e pelas posições lançadas à mão): total, liquidez diária e quanto em cada grupo. O app desenha a evolução a partir daqui.\n\n${bloco}\n\n## Conexões\n- Negócio: [[MOC-negocio]]\n`;
  }
  if (texto === antigo) return '';
  mkdirSync(join(vault, PASTA_RAZAO), { recursive: true });
  writeFileSync(arq, texto, 'utf8');
  return ARQ_PATRIMONIO.split('\\').join('/');
}

/* ------------------------------------------------------------------ descrição saneada */

const MEIO = {
  entrada: { pix: 'Pix recebido', ted: 'Transferência recebida', boleto: 'Boleto recebido', cartao: 'Estorno no cartão', outro: 'Entrada' },
  saida: { pix: 'Pix enviado', ted: 'Transferência enviada', boleto: 'Boleto pago', cartao: 'Compra no cartão', debito: 'Compra no débito', outro: 'Saída' },
};

export function descricaoSaneada(t, regra) {
  if (regra && regra.descricao) return sanear(regra.descricao);
  const base = MEIO[t.direcao][t.viaCartao ? 'cartao' : t.meio] || MEIO[t.direcao].outro;
  const quem = regra && regra.cliente ? regra.cliente : '';
  return sanear(quem ? `${base} · ${quem}` : base);
}

/* ------------------------------------------------------------------ plano */

const diasEntre = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const centavo = (v) => Math.round(n(v) * 100);

/** Clientes que a regra aceita no casamento: `clientes` (lista) ou `cliente`. */
const clientesDe = (regra) => (regra ? (Array.isArray(regra.clientes) && regra.clientes.length ? regra.clientes : regra.cliente ? [regra.cliente] : []) : []);
/** A regra diz de quem é (cliente) ou qual previsto liquida: só então o razão escrito à mão pode ser conciliado. */
const regraIdentifica = (regra) => !!(regra && (clientesDe(regra).length || regra.previsto));

/**
 * Lançamentos do razão que esta transação pode ser. Sem olhar o valor (quem chama decide).
 *  - aberto (a-receber/a-pagar), mesma direção, vencimento a até ±tol dias; sem dia: mesmo mês
 *    do arquivo, ou qualquer mês quando a regra aponta o `previsto` (parcela sem data);
 *  - JÁ liquidado à mão (recebido/pago sem `fitid`), só se a regra identifica o cliente ou o
 *    previsto: a distância conta do vencimento ou do `liquidadoEm`, o que estiver mais perto.
 *    Assim um pagamento que o Pedro registrou antes do banco ligar não vira lançamento em dobro.
 * Cliente(s) e pedaço de id da regra filtram. Ordem: mais perto primeiro, depois mês e id.
 */
function candidatos(t, regra, razao, tol) {
  const out = [];
  const clientes = clientesDe(regra);
  const liquidadosValem = regraIdentifica(regra);
  for (const [mes, st] of Object.entries(razao)) {
    for (const l of st.lista) {
      if (l.tipo === 'investimento') continue;
      if (t.direcao === 'entrada' ? l.tipo !== 'entrada' : l.tipo === 'entrada') continue;
      const aberto = ehAberto(l);
      const liquidado = !aberto && (l.status === 'recebido' || l.status === 'pago') && !l.fitid;
      if (!aberto && !(liquidado && liquidadosValem)) continue;
      if (clientes.length && !clientes.includes(l.cliente || '')) continue;
      if (regra && regra.previsto && !String(l.id).includes(regra.previsto)) continue;
      const datas = [l.vencimento, liquidado ? l.liquidadoEm : ''].map((d) => String(d || '').slice(0, 10)).filter(Boolean);
      let dist;
      if (datas.length) {
        dist = Math.min(...datas.map((d) => Math.abs(diasEntre(d, t.data))));
        if (dist > tol) continue;
      } else if (mes === mesDe(t.data)) dist = 50;
      else if (regra && regra.previsto && aberto) dist = 99;
      else continue;
      out.push({ mes, l, dist, liquidado });
    }
  }
  return out.sort((a, b) => a.dist - b.dist || a.mes.localeCompare(b.mes) || String(a.l.id).localeCompare(String(b.l.id)));
}

/**
 * Um Pix que paga vários lançamentos de uma vez (ex.: parcela + etapa no mesmo envio): procura
 * combinações de 2 a 6 candidatos cuja soma bate no centavo. Devolve a melhor (menor distância
 * máxima) e se houve empate com outra combinação diferente.
 */
function combinacao(cands, valor) {
  const alvo = centavo(valor);
  const lista = cands.slice(0, 16);
  const achadas = [];
  const rec = (i, soma, escolha) => {
    if (soma === alvo && escolha.length >= 2) { achadas.push(escolha.slice()); return; }
    if (soma >= alvo || escolha.length === 6 || achadas.length > 20) return;
    for (let k = i; k < lista.length; k++) { escolha.push(lista[k]); rec(k + 1, soma + centavo(lista[k].l.valor), escolha); escolha.pop(); }
  };
  rec(0, 0, []);
  if (!achadas.length) return null;
  const pior = (c) => Math.max(...c.map((x) => x.dist));
  achadas.sort((a, b) => pior(a) - pior(b));
  return { melhor: achadas[0], empate: achadas.length > 1 && pior(achadas[1]) === pior(achadas[0]) };
}

function idNovo(t, desc) {
  const slug = norm(desc).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${t.data}-${slug || 'transacao'}-${t.fitid.slice(0, 6)}`;
}

/**
 * Estornos: entrada cuja regra tem `estorno: true` anula uma saída de mesmo valor, na mesma conta,
 * até `diasEstorno` (padrão 3) dias antes ou depois, ainda não importada. As duas saem do fluxo.
 * Estorno parcial ou sem par segue como lançamento comum (com a categoria da regra).
 */
function parearEstornos(ts, regras, conhecidos) {
  const fora = new Set();
  const saidas = ts.filter((t) => t.direcao === 'saida' && !t.pendente && !conhecidos.has(t.fitid));
  for (const t of ts) {
    if (t.direcao !== 'entrada' || t.pendente || conhecidos.has(t.fitid)) continue;
    const regra = regraDe(t, regras);
    if (!regra || !regra.estorno) continue;
    const janela = Number.isFinite(regra.diasEstorno) ? regra.diasEstorno : 3;
    const par = saidas
      .filter((s) => !fora.has(s.fitid) && (s.conta || '') === (t.conta || '') && centavo(s.valor) === centavo(t.valor) && Math.abs(diasEntre(s.data, t.data)) <= janela)
      .sort((a, b) => Math.abs(diasEntre(a.data, t.data)) - Math.abs(diasEntre(b.data, t.data)))[0];
    if (par) { fora.add(par.fitid); fora.add(t.fitid); }
  }
  return fora;
}

/**
 * Decide o que fazer com cada transação. Puro: não grava nada. Devolve as ações e o relatório.
 * `razao` é o de lerRazao (é mutado só numa cópia interna, para duas transações iguais não
 * liquidarem o mesmo previsto).
 *
 * Ordem de casamento: (1) um lançamento de mesmo valor; (2) vários do(s) cliente(s) da regra que
 * somam o valor; (3) regra com `valorLivre` e `previsto`: o previsto aberto mais perto, com o
 * valor do banco (fatura do cartão); (4) a regra diz o cliente, há lançamento dele sem banco na
 * janela, mas nada fecha: DIVERGENTE, não grava (o Pedro corrige o razão ou cria a regra).
 */
export function planejar(transacoes, razaoOriginal, regrasBrutas = {}, { hoje = '' } = {}) {
  const regras = normalizarRegras(regrasBrutas);
  const razao = Object.fromEntries(Object.entries(razaoOriginal).map(([m, st]) => [m, { ...st, lista: st.lista.map((l) => ({ ...l })) }]));
  const conhecidos = new Set();
  for (const st of Object.values(razao)) for (const l of st.lista) { if (l.fitid) conhecidos.add(l.fitid); for (const f of l.fitids || []) conhecidos.add(f); }

  const acoes = [];
  const rel = { casados: [], novos: [], aClassificar: [], ignorados: { jaImportado: 0, regra: 0, categoria: 0, pendente: 0, estorno: 0 }, ambiguos: [], divergentes: [], acumulando: [] };
  const acumulos = new Map(); // previsto pago em vários Pix: `${mes}|${id}` → { mes, l, pagamentos }

  // do mais antigo para o mais novo (a API manda o mais novo primeiro): a parcela 2 vai para o
  // primeiro pagamento, a 3 para o seguinte
  const ts = transacoes.map((b) => ({ ...b, fitid: b.fitid || hashId(b.fonte, b.idFonte) }))
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const estornados = parearEstornos(ts, regras, conhecidos);

  const liquidar = (t, c, extra = {}) => {
    const { mes, l } = c;
    const modo = c.liquidado ? 'conciliar' : 'liquidar';
    if (!c.liquidado) l.status = l.tipo === 'entrada' ? 'recebido' : 'pago';
    const antes = l.liquidadoEm || '';
    l.liquidadoEm = t.data;
    l.fitid = t.fitid;
    l.origem = t.fonte;
    Object.assign(l, extra);
    acoes.push({ acao: modo, mes, id: l.id, liquidadoEm: t.data, fitid: t.fitid, origem: t.fonte, ...extra });
    return { id: l.id, descricao: l.descricao, valor: n(l.valor), modo, antes, ...(extra.valorPrevisto !== undefined ? { valorPrevisto: extra.valorPrevisto } : {}) };
  };
  const casado = (t, itens) => rel.casados.push({
    data: t.data, valor: t.valor, id: itens.map((i) => i.id).join(' + '), descricao: itens.map((i) => i.descricao).join(' + '), itens,
  });

  for (const t of ts) {
    if (conhecidos.has(t.fitid)) { rel.ignorados.jaImportado++; continue; }
    if (t.pendente) { rel.ignorados.pendente++; continue; }
    if (estornados.has(t.fitid)) { rel.ignorados.estorno++; continue; }
    if (regras.ignorarCategorias.includes(norm(t.categoriaFonte))) { rel.ignorados.categoria++; continue; }
    const regra = regraDe(t, regras);
    if (regra && regra.ignorar) { rel.ignorados.regra++; continue; }
    conhecidos.add(t.fitid);

    // vários Pix pagam um previsto só (ex.: contribuição do mês em partes): junta no previsto
    // aberto do MESMO mês da transação; quem fecha é o bloco depois do laço
    if (regra && regra.acumula && regra.previsto && !t.viaCartao) {
      const alvo = candidatos(t, regra, razao, Infinity).find((c) => !c.liquidado && c.mes === mesDe(t.data));
      if (alvo) {
        const k = `${alvo.mes}|${alvo.l.id}`;
        if (!acumulos.has(k)) acumulos.set(k, { mes: alvo.mes, l: alvo.l, pagamentos: [] });
        acumulos.get(k).pagamentos.push(t);
        continue;
      }
    }

    // compra no cartão não liquida previsto: quem liquida é o pagamento da fatura na conta
    const tol = regra && Number.isFinite(regra.toleranciaDias) ? regra.toleranciaDias : regras.toleranciaDias;
    const todos = t.viaCartao ? [] : candidatos(t, regra, razao, tol);
    const exatos = todos.filter((c) => centavo(c.l.valor) === centavo(t.valor));
    const decide = regra && (regra.previsto || clientesDe(regra).length);

    if (exatos.length) {
      if (exatos.length > 1 && exatos[0].dist === exatos[1].dist && !decide) {
        rel.ambiguos.push({ data: t.data, valor: t.valor, direcao: t.direcao, opcoes: exatos.slice(0, 4).map((c) => c.l.id) });
        conhecidos.delete(t.fitid); // não grava: volta na próxima rodada, depois de uma regra decidir
        continue;
      }
      casado(t, [liquidar(t, exatos[0])]);
      continue;
    }
    if (clientesDe(regra).length && todos.length >= 2) {
      const comb = combinacao(todos, t.valor);
      if (comb && comb.empate) {
        rel.ambiguos.push({ data: t.data, valor: t.valor, direcao: t.direcao, opcoes: comb.melhor.map((c) => c.l.id) });
        conhecidos.delete(t.fitid);
        continue;
      }
      if (comb) { casado(t, comb.melhor.map((c) => liquidar(t, c))); continue; }
    }
    if (regra && regra.valorLivre && regra.previsto) {
      const c = todos.find((x) => !x.liquidado);
      if (c) {
        const valorPrevisto = n(c.l.valor);
        casado(t, [liquidar(t, c, { valor: Math.round(t.valor * 100) / 100, valorPrevisto })]);
        continue;
      }
    }
    if (clientesDe(regra).length && todos.length) {
      rel.divergentes.push({ data: t.data, valor: t.valor, direcao: t.direcao, cliente: clientesDe(regra)[0], razao: todos.slice(0, 6).map((c) => ({ id: c.l.id, valor: n(c.l.valor), status: c.l.status })) });
      conhecidos.delete(t.fitid);
      continue;
    }

    // nome de pessoa (pagador, recebedor, titular) sai mesmo se a regra o escreveu na descrição
    const descricao = tirarNomes(descricaoSaneada(t, regra), t.nomes) || descricaoSaneada(t, null);
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
      conta: tirarNomes(sanear(t.conta || ''), t.nomes),
      ...(t.viaCartao ? { viaCartao: true, ...(t.fatura ? { fatura: t.fatura } : {}) } : {}),
    };
    const mes = mesDe(t.data);
    if (!razao[mes]) razao[mes] = { arquivo: '', texto: '', lista: [] };
    razao[mes].lista.push(novo);
    acoes.push({ acao: 'novo', mes, lancamento: novo });
    const linha = { data: t.data, valor: t.valor, direcao: t.direcao, descricao, categoria, conta: novo.conta, categoriaFonte: sanear(t.categoriaFonte || '') };
    if (categoria === 'a classificar') rel.aClassificar.push(linha); else rel.novos.push(linha);
  }
  // fecha os acumulados: soma chegou no previsto, ou o mês já passou (fecha com o valor real e
  // guarda o previsto em valorPrevisto). Mês corrente sem fechar: não grava, volta na próxima.
  for (const { mes, l, pagamentos } of acumulos.values()) {
    const total = pagamentos.reduce((s, p) => s + centavo(p.valor), 0);
    const previsto = centavo(l.valor);
    const mesPassou = hoje && mes < mesDe(hoje);
    if (total < previsto && !mesPassou) {
      for (const p of pagamentos) conhecidos.delete(p.fitid);
      rel.acumulando.push({ id: l.id, descricao: l.descricao, previsto: previsto / 100, pago: total / 100, pagamentos: pagamentos.map((p) => ({ data: p.data, valor: p.valor })) });
      continue;
    }
    const ultimo = pagamentos[pagamentos.length - 1];
    const extra = { fitids: pagamentos.map((p) => p.fitid), ...(total !== previsto ? { valor: total / 100, valorPrevisto: previsto / 100 } : {}) };
    l.status = 'pago';
    l.liquidadoEm = ultimo.data;
    l.fitid = pagamentos[0].fitid;
    l.origem = ultimo.fonte;
    Object.assign(l, extra);
    acoes.push({ acao: 'liquidar', mes, id: l.id, liquidadoEm: ultimo.data, fitid: l.fitid, origem: l.origem, ...extra });
    rel.casados.push({ data: ultimo.data, valor: total / 100, id: l.id, descricao: l.descricao,
      itens: [{ id: l.id, descricao: l.descricao, valor: total / 100, modo: 'acumulado', antes: '', pagamentos: pagamentos.map((p) => ({ data: p.data, valor: p.valor })), ...(total !== previsto ? { valorPrevisto: previsto / 100 } : {}) }] });
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
  const faturasVistas = new Set();
  for (const f of faturas) {
    if (!f.vencimento || f.vencimento < hoje.slice(0, 8) + '01') continue;
    const mes = mesDe(f.vencimento);
    const st = razao[mes];
    const fatFitid = hashId(f.fonte, f.idFonte);
    // a própria fatura (rodada anterior) primeiro; senão um previsto de cartão ainda sem fatura
    // ligada. Com dois cartões no mesmo mês, a fatura do segundo não pode pisar no previsto que o
    // primeiro já mediu (antes os dois brigavam pelo mesmo e o valor trocava a cada rodada).
    const deCartao = (l) => l.tipo === 'saida' && /cart[aã]o/i.test(l.categoria || '') && ehAberto(l);
    const prev = st && (st.lista.find((l) => deCartao(l) && l.faturaFitid === fatFitid)
      || st.lista.find((l) => deCartao(l) && !l.faturaFitid && !faturasVistas.has(l.id)));
    if (prev) faturasVistas.add(prev.id);
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

/** Campos que o Aion (módulo de investimentos) lê da posição, quando a API manda. */
export const CAMPOS_AION = ['codigo', 'quantidade', 'aportado', 'desde', 'indexador'];

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
      descricao: sanear(regra.descricao || i.descricao || i.nome || 'Investimento'),
      instituicao: sanear(regra.instituicao || i.instituicao || ''),
      liquidez: regra.liquidez || i.liquidez || (i.vencimentoTitulo ? 'no-vencimento' : ''),
      ...(i.classe ? { classe: i.classe } : {}),
      // Aion: código, quantidade, aplicado, desde e indexador (vêm da API; só os preenchidos)
      ...Object.fromEntries(CAMPOS_AION.filter((c) => i[c] !== undefined && i[c] !== '').map((c) => [c, i[c]])),
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
      const igual = ['descricao', 'instituicao', 'liquidez', 'classe', 'reserva', 'obs', ...CAMPOS_AION].every((c) => (velho[c] ?? '') === (lanc[c] ?? ''));
      if (velho.data >= lanc.data && n(velho.valor) === lanc.valor && igual) continue; // nada mudou
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
      if (a.valor !== undefined) { l.valorPrevisto = a.valorPrevisto; l.valor = a.valor; }
      if (a.fitids) l.fitids = a.fitids;
    } else if (a.acao === 'conciliar') {
      // já estava liquidado à mão: ganha a data real do banco e o fitid (não duplica depois)
      const l = ls.find((x) => x.id === a.id);
      if (!l || l.fitid || ehAberto(l)) continue;
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
  // trava ANTES de gravar qualquer mês: ou grava tudo saneado, ou nada. Vale para o texto que o
  // sincronizador escreveu (lançamento novo, posição); liquidar/conciliar não mexe em texto, e a
  // obs escrita à mão num previsto conciliado não deve travar a rodada.
  const escritos = new Set(acoes.filter((a) => a.lancamento).map((a) => a.lancamento.id));
  for (const [mes, ls] of tocados) {
    for (const l of ls) {
      if (!l.origem || !escritos.has(l.id)) continue;
      for (const campo of ['descricao', 'conta', 'instituicao', 'obs']) {
        if (l[campo] && pareceSensivel(l[campo]))
          throw new Error(`trava de saneamento: ${mes} ${l.id} campo ${campo}. Nada foi gravado.`);
      }
    }
  }
  for (const [mes, ls] of tocados) gravarMes(vault, mes, atual[mes], ls, hoje);
  return [...tocados.keys()].sort();
}
