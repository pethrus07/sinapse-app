// "O que prometi": compromissos do Pedro tirados das atas do Atas (../atas/atas-salvas).
//
// Fonte: cada reunião em `atas-salvas/<id>/` tem `sessao.json` (titulo, tipo, projeto, inicio)
// e `ata.json` (schema atas/ata@1: encaminhamentos [{id, acao, dono, prazo, prazo_dito, t,
// citacao, verificado}], participantes [{rotulo, nome, confirmado}]). Só LEITURA: o app nunca
// escreve no Atas, e nada daqui vai para o vault. O índice sai em src/data/compromissos.json
// (gitignored) e só chega ao navegador pelo /api/indice — não entra no bundle do build.
//
// O que entra:
//   - tipo da reunião `cliente` ou `carreira`. Fora: `parresia` (a operação da Parresia não
//     entra no Sinapse), `pessoal`, `pendente` (tipo ainda não escolhido) e qualquer tipo novo.
//   - encaminhamento cujo dono é o Pedro: "Você", ou o nome do participante rotulado "Você"
//     — e só se esse rótulo estiver confirmado (regra do Atas: "Você" a confirmar não é o Pedro).
//   - citação achada na transcrição (`verificado` diferente de false).
//   - prazo nos últimos 30 dias ou no futuro; sem prazo, reunião dos últimos 30 dias.
//   - não marcado como feito (estado local, ver abaixo).
//
// Reunião → frente (o primeiro nível que casar ganha; empate: id da nota em ordem alfabética):
//   1. `atas_projeto:` no frontmatter da nota (string ou lista) = `projeto` da sessão
//   2. id da nota (nome do arquivo)                              = `projeto`
//   3. título da nota (slug)                                     = `projeto`
//   4. nome da última pasta de cada `pastas:`                    = `projeto`
// Tudo comparado em slug. Sessão sem `projeto`, ou que não casa com nenhuma frente: "sem frente".
// Frente da Parresia (tag `parresia` / cliente Parresia) também não recebe compromisso.
//
// "Feito" é estado LOCAL do app, fora do vault e fora do git:
//   ~/.sinapse/compromissos-feitos.json   (ou SINAPSE_ESTADO=<pasta>)
//   { "feitos": { "<sessao>#<E1>": "AAAA-MM-DD" } }
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const JANELA_DIAS = 30;
const TIPOS_QUE_ENTRAM = new Set(['cliente', 'carreira']);

export function caminhoAtas() {
  return process.env.ATAS_PATH ? resolve(process.env.ATAS_PATH) : resolve(APP_ROOT, '..', 'atas');
}

export function arquivoFeitos() {
  const dir = process.env.SINAPSE_ESTADO ? resolve(process.env.SINAPSE_ESTADO) : join(homedir(), '.sinapse');
  return join(dir, 'compromissos-feitos.json');
}

export function lerFeitos() {
  try {
    const j = JSON.parse(readFileSync(arquivoFeitos(), 'utf8'));
    return j && typeof j.feitos === 'object' && j.feitos ? j.feitos : {};
  } catch {
    return {};
  }
}

export function marcarFeito(id, feito) {
  const feitos = lerFeitos();
  if (feito) feitos[id] = hojeLocal();
  else delete feitos[id];
  const arq = arquivoFeitos();
  mkdirSync(dirname(arq), { recursive: true });
  const tmp = arq + '.tmp';
  writeFileSync(tmp, JSON.stringify({ feitos }, null, 2), 'utf8');
  renameSync(tmp, arq);
  return feitos;
}

function slug(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Data local (a máquina está em -03:00): o "hoje" do Pedro, não o do UTC.
export function hojeLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function somarDias(ymd, dias) {
  const [a, m, d] = ymd.split('-').map(Number);
  const dt = new Date(a, m - 1, d + dias);
  return hojeLocal(dt);
}

const YMD = /^\d{4}-\d{2}-\d{2}/;
const ymdDe = (v) => (typeof v === 'string' && YMD.test(v) ? v.slice(0, 10) : '');

function lerJson(arq) {
  try {
    return JSON.parse(readFileSync(arq, 'utf8'));
  } catch {
    return null;
  }
}

function ehParresiaNota(n) {
  return (n.tags || []).some((t) => String(t).toLowerCase() === 'parresia') || /parresia/i.test(n.cliente || '');
}

/** Monta o resolvedor projeto → id da frente. `frentes` = notas que aparecem na tela Frentes. */
export function mapaDeFrentes(frentes) {
  const niveis = [new Map(), new Map(), new Map(), new Map()];
  const ordenadas = [...frentes].sort((a, b) => a.id.localeCompare(b.id));
  const por = (nivel, chave, id) => {
    const k = slug(chave);
    if (k && !niveis[nivel].has(k)) niveis[nivel].set(k, id);
  };
  for (const n of ordenadas) {
    for (const p of n.atasProjeto || []) por(0, p, n.id);
    por(1, n.id, n.id);
    por(2, n.title, n.id);
    for (const p of n.pastas || []) por(3, String(p).split(/[\\/]/).filter(Boolean).pop(), n.id);
  }
  return (projeto) => {
    const k = slug(projeto);
    if (!k) return null;
    for (const m of niveis) if (m.has(k)) return m.get(k);
    return null;
  };
}

/**
 * Lê as atas e devolve { itens, semFrente, fonte, contagem }.
 * `frentes` = notas de projeto vivas (com `atividade`), já com `atasProjeto`.
 */
export function lerCompromissos(frentes, { atas = caminhoAtas(), hoje = hojeLocal(), feitos = lerFeitos() } = {}) {
  const raiz = join(atas, 'atas-salvas');
  const contagem = { reunioes: 0, foraPorTipo: 0, semAta: 0, feitos: 0, antigos: 0 };
  const vazio = { itens: [], fonte: atas, existe: false, contagem };
  if (!existsSync(raiz)) return vazio;

  const validas = frentes.filter((n) => !ehParresiaNota(n));
  const parresia = new Set(frentes.filter(ehParresiaNota).map((n) => n.id));
  const resolver = mapaDeFrentes(validas);
  const resolverTodas = mapaDeFrentes(frentes);
  const limite = somarDias(hoje, -JANELA_DIAS);
  const itens = [];

  for (const nome of readdirSync(raiz).sort()) {
    const pasta = join(raiz, nome);
    const sessao = lerJson(join(pasta, 'sessao.json'));
    if (!sessao) continue; // legado-classificacao.json e afins
    contagem.reunioes += 1;
    const tipo = String(sessao.tipo || '').toLowerCase();
    if (!TIPOS_QUE_ENTRAM.has(tipo)) {
      contagem.foraPorTipo += 1;
      continue;
    }
    const ata = lerJson(join(pasta, 'ata.json'));
    if (!ata || !Array.isArray(ata.encaminhamentos)) {
      contagem.semAta += 1;
      continue;
    }

    // Quem é o Pedro nesta ata: "Você" e o nome dado ao rótulo "Você", se confirmado.
    const voce = (ata.participantes || []).find((p) => String(p.rotulo || '').toLowerCase() === 'você');
    if (voce && voce.confirmado === false) continue;
    const pedro = new Set(['você']);
    if (voce && voce.nome) pedro.add(String(voce.nome).trim().toLowerCase());

    const dataReuniao = ymdDe(sessao.inicio) || ymdDe(sessao.criado) || ymdDe(ata.data) || ymdDe(nome);
    const projeto = String(sessao.projeto || ata.projeto || '').trim();
    let frente = resolver(projeto);
    if (!frente && parresia.has(resolverTodas(projeto))) continue; // frente da Parresia: fora
    const temHtml = existsSync(join(pasta, 'ata.html'));

    for (const e of ata.encaminhamentos) {
      const dono = String(e.dono || '').trim().toLowerCase();
      if (!dono || !pedro.has(dono)) continue;
      if (e.verificado === false) continue;
      const id = `${nome}#${e.id || ''}`;
      if (feitos[id]) {
        contagem.feitos += 1;
        continue;
      }
      const prazo = ymdDe(e.prazo) || null;
      const recente = prazo ? prazo >= limite : dataReuniao >= limite;
      if (!recente) {
        contagem.antigos += 1;
        continue;
      }
      itens.push({
        id,
        frente: frente || null,
        acao: String(e.acao || '').trim(),
        prazo,
        prazoDito: e.prazo_dito || null,
        citacao: String(e.citacao || '').trim(),
        t: e.t || null,
        reuniao: { id: nome, titulo: String(sessao.titulo || nome), data: dataReuniao, projeto, temHtml },
      });
    }
  }

  // prazo mais cedo primeiro (vencidos no topo); sem prazo no fim, reunião mais nova primeiro
  itens.sort(
    (a, b) =>
      (a.prazo || '9999').localeCompare(b.prazo || '9999') ||
      b.reuniao.data.localeCompare(a.reuniao.data) ||
      a.id.localeCompare(b.id),
  );
  return { itens, fonte: atas, existe: true, contagem };
}
