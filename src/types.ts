export interface Note {
  id: string;
  rel: string;
  title: string;
  area: string;
  type: string;
  tags: string[];
  status: string;
  progresso?: string;
  trilha?: string;
  ordem?: number | null;
  cliente?: string;
  stack?: string;
  // ---- frentes (só em nota de projeto viva; ver scripts/build-index.mjs) ----
  vaga?: boolean;
  pastas?: string[];
  cutucar?: string;      // AAAA-MM-DD
  esperando?: string;    // quem
  proximo?: string;
  motivo?: string;       // de `status: pausado`
  atasProjeto?: string[]; // `atas_projeto:` — projeto do Atas que cai nesta frente
  atividade?: Atividade;
  body: string;
  links: string[];
  backlinks: string[];
  degree: number;
}

/* ---------- "O que prometi" ----------
   Encaminhamentos do Pedro nas atas do Atas (scripts/compromissos.mjs). Só chegam pelo
   /api/indice (o app não importa src/data/compromissos.json no bundle). */
export interface Compromisso {
  id: string;              // "<id da reunião>#E3"
  frente: string | null;   // id da nota da frente; null = sem frente
  acao: string;
  prazo: string | null;    // AAAA-MM-DD
  prazoDito: string | null;
  citacao: string;
  t: string | null;        // momento da fala na reunião ("01:17")
  reuniao: { id: string; titulo: string; data: string; projeto: string; temHtml: boolean };
}

export interface Compromissos {
  itens: Compromisso[];
  existe: boolean;
  fonte: string;
  contagem: Record<string, number>;
}

/** Movimento de uma frente, em segundos Unix. */
export interface Atividade {
  ultimo: number | null;   // último commit
  commits: number[];       // commits dos últimos 30 dias (para as horas por sessão)
  fonte: 'pastas' | 'nota'; // repos de `pastas:` ou, sem pasta, a própria nota no vault
}

export interface GraphNode {
  id: string;
  title: string;
  area: string;
  type: string;
  degree: number;
  ghost?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  ghost?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Stats {
  notes: number;
  links: number;
  ghosts: number;
  with3: number;
  byArea: Record<string, number>;
  generatedFrom: string;
}

/* ---------- Agenda ----------
   Vem de `99-MOCS/AGENDA.md` (bloco ```agenda), de notas com `quando:` no
   frontmatter e das dailys em `01-DIARIO/`. Gerado em src/data/agenda.json. */

interface ItemBase {
  titulo: string;
  frente?: string;
  faixa?: string;
  hora?: string;
  onde?: string;
  link?: string;
  nota?: string;
}

/** Ocupa a semana toda semana (trabalho, aula). */
export interface Bloco extends ItemBase {
  dias: number[];        // 0 = domingo … 6 = sábado
  intermediavel?: boolean;
}

/** Um dia fixo da semana — ou vários (`dias`), caso da daily de seg a sex. */
export interface Semanal extends ItemBase {
  dia?: number;
  dias?: number[];
}

/**
 * Recorrência mensal. Duas formas:
 *  - `diaDoMes: 8`            -> todo dia 8 (dia 31 em mês de 30 cai no último dia)
 *  - `semanaDoMes` + `dia`    -> ex.: ultima + 0 = último domingo do mês
 */
export interface Mensal extends ItemBase {
  diaDoMes?: number;
  semanaDoMes?: 'primeira' | 'segunda' | 'terceira' | 'quarta' | 'ultima';
  dia?: number;              // 0 = domingo … 6 = sábado
}

/** Data única ou intervalo. */
export interface DataMarcada extends ItemBase {
  de: string;
  ate?: string;
  deNota?: boolean;      // veio do frontmatter de uma nota, não do bloco agenda
}

export interface DailyRef {
  dia: string;
  id: string;
  rel: string;
}

export interface Agenda {
  blocos: Bloco[];
  semanal: Semanal[];
  mensal: Mensal[];
  datas: DataMarcada[];
  dailys: DailyRef[];
  fonte: string;
}

/** Uma recorrência já resolvida num dia concreto. */
export interface Ocorrencia extends ItemBase {
  kind: 'bloco' | 'semanal' | 'mensal' | 'data';
  intermediavel?: boolean;
  multi?: boolean;       // faz parte de um intervalo
  inicio?: boolean;
  ultimo?: boolean;
}

/* ---------- Financeiro ----------
   Um arquivo por mes em 04-NEGOCIO/financeiro/AAAA-MM.md, com bloco ```financeiro.
   Vencimento aberto alimenta a Agenda automaticamente. */

// 'reserva' e DESTINACAO, nao despesa: sai do disponivel sem ser gasto.
// Fica fora do calendario de proposito — guardar e decisao, nao compromisso com data.
export type TipoLancamento = 'entrada' | 'saida' | 'reserva';
// Aqui entra so o CONTRATADO. Orcamento sem aceite nao e lancamento — decisao do
// Pedro em 23/08/2026: dinheiro que talvez venha nao pode aparecer no previsto.
export type StatusLancamento = 'a-receber' | 'recebido' | 'a-pagar' | 'pago';

export interface Lancamento {
  id: string;
  tipo: TipoLancamento;
  descricao: string;
  valor: number;
  vencimento: string;      // '' = sem data definida; a projecao usa o mes do arquivo
  status: StatusLancamento;
  liquidadoEm?: string;
  cliente?: string;
  categoria?: string;
  nota?: string;
  recorrente?: boolean;
  /**
   * true = existe, mas NAO tem cronograma nenhum (divida sem prazo, valor a combinar).
   * Continua contando no "a pagar"/"a receber", mas fica FORA da projecao mensal:
   * sem isso ele viraria uma saida gigante no mes do arquivo e torceria o fluxo.
   * Diferente de vencimento vazio, que e "neste mes, dia a definir".
   */
  semPrazo?: boolean;
  obs?: string;
  mes: string;             // preenchido pelo indexador
  rel: string;
}

export interface Financeiro {
  lancamentos: Lancamento[];
  meses: { mes: string; rel: string; id: string; total: number }[];
}
