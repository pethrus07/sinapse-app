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
  // ---- página do projeto (scripts/build-index.mjs) ----
  criado?: string;          // AAAA-MM-DD
  tarefas?: Tarefa[];       // "- [ ]" / "- [/]" / "- [x]" do corpo da nota
  historia?: Evento[];      // commits por dia + notas datadas que citam o projeto, mais novo primeiro
  desenho?: boolean;        // existe 09-DESENHOS/<id>.excalidraw
  body: string;
  links: string[];
  backlinks: string[];
  degree: number;
}

export type EstadoTarefa = 'a-fazer' | 'fazendo' | 'feito';

export interface Tarefa {
  linha: string;           // a linha exata do arquivo: é a chave para o /api/tarefa
  texto: string;
  estado: EstadoTarefa;
  secao: string;
}

export interface Evento {
  data: string;            // AAAA-MM-DD
  tipo: 'commit' | 'diario' | 'nota' | 'criado';
  qtd?: number;            // commits no dia
  textos?: string[];       // assuntos dos commits (até 4)
  titulo?: string;
  nota?: string;           // id da nota que gerou o evento
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
// 'investimento' e SALDO (posicao numa data), nao fluxo: fica fora de projecao, agenda e somas.
export type TipoLancamento = 'entrada' | 'saida' | 'reserva' | 'investimento';
// Aqui entra so o CONTRATADO. Orcamento sem aceite nao e lancamento — decisao do
// Pedro em 23/08/2026: dinheiro que talvez venha nao pode aparecer no previsto.
// 'posicao' so existe em investimento: o saldo informado naquela data.
export type StatusLancamento = 'a-receber' | 'recebido' | 'a-pagar' | 'pago' | 'posicao';
/** Quanto se confia no valor: medido no banco, extrapolado por conta, ou estimativa. */
export type ConfiancaValor = 'medido' | 'extrapolado' | 'estimado';

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
  /** Ultimo mes (AAAA-MM) de um recorrente com prazo (acordo de 6 ciclos). Sem ele, recorrente = estavel. */
  ate?: string;
  /** Confianca do valor. Sem o campo, o app le da obs ("MEDIDO", "EXTRAPOLADO", "NAO MEDIDO"). */
  confianca?: ConfiancaValor;
  /** Investimento: onde esta, liquidez ('diaria' | 'no-vencimento' | 'carencia'), data do saldo, se e reserva. */
  instituicao?: string;
  liquidez?: string;
  data?: string;
  reserva?: boolean;
  /** Veio da sincronizacao do banco: origem ('pluggy' | 'extrato') + fitid (hash, nunca o id cru). */
  origem?: string;
  fitid?: string;
  conta?: string;          // rotulo da conta ("Nubank · conta"), nunca numero
  /** Compra no cartao: o dinheiro sai quando a FATURA e paga, entao fica fora do fluxo e das somas. */
  viaCartao?: boolean;
  fatura?: string;         // AAAA-MM da fatura em que a compra cai
  /** Gasto que nao se repete (emprestimo, compra grande): fica fora do "gasto recorrente". */
  pontual?: boolean;
  /** Natureza do gasto, sobrescrevendo o mapa da categoria (NATUREZA_POR_CATEGORIA em financeiroAnalise.ts). */
  natureza?: 'fixo' | 'variavel' | 'pontual';
  /** Investimento: CDB, FII, Acao, cripto... (o grupo do patrimonio sai daqui). */
  classe?: string;
  /** Previsto pago em varios Pix: os fitids de todos; e o valor combinado quando o real foi outro. */
  fitids?: string[];
  valorPrevisto?: number;
  /** Investimento, para o Aion (gravados pela sincronização quando a API manda; cripto à mão pode ter `codigo` e `quantidade`). */
  codigo?: string;
  quantidade?: number;
  aportado?: number;
  desde?: string;
  indexador?: string;
  mes: string;             // preenchido pelo indexador
  rel: string;
}

export interface Financeiro {
  lancamentos: Lancamento[];
  meses: { mes: string; rel: string; id: string; total: number }[];
  /** Conexoes do Open Finance (estado.json do sincronizador, fora do git). Sem ids. */
  conexoes?: Conexao[];
  ultimaSync?: string;
  /** Ultima rodada da sincronizacao que deu erro (mensagem saneada, sem dado do banco). */
  ultimaFalha?: { em: string; mensagem: string } | null;
  /** Retratos do patrimonio, um por dia de sincronizacao (04-NEGOCIO/financeiro/patrimonio.md). */
  retratos?: { data: string; total: number; diaria: number; porGrupo: Record<string, number> }[];
  /** Orçamento (04-NEGOCIO/financeiro/orcamento.md, bloco ```financeiro-orcamento). null = o Pedro não definiu. */
  orcamento?: Orcamento | null;
}

export interface Orcamento {
  /** Teto mensal por categoria (id gravado no razão, ex.: "alimentacao"). */
  tetos: Record<string, number>;
  /** Meta da reserva; sem ela vale o piso de R$ 5.000. */
  metaReserva?: number;
  rel?: string;
}

export interface Conexao {
  rotulo: string;
  status: string;
  execucao?: string;
  ultimaAtualizacao?: string;
  autorizacaoVence?: string;
  erro?: string;
}

/* ---------- Aion (investimentos) ----------
   Vem de scripts/aion/indice.mjs: o cache local do coletor (mercado, só dado público) e os blocos
   JSON de 04-NEGOCIO/financeiro/aion-*.md (observação, regra, metas, estudo). As posições vêm do
   razão da Métis (Financeiro.lancamentos, tipo investimento). Formato em docs/aion-formato.md. */
export interface Fonte { fonte: string; url: string; em?: string }
export interface PontoSerie { data: string; valor: number }
export interface Cotacao {
  codigo: string; nome?: string; preco: number | null; variacaoDia: number | null; fechamentoAnterior?: number | null; em: string;
  min52?: number | null; max52?: number | null; pl?: number | null; lpa?: number | null;
  historico?: { data: string; fechamento: number }[];
  proventos?: { tipo: string; valor: number; pagamento: string; aprovado: string; dataCom: string; dataEx: string }[];
  id?: string;
}
export interface Mercado {
  versao: number;
  geradoEm: string;
  bcb?: {
    selicMeta?: Fonte & { nome: string; valor: number | null; data: string; decisoes: { desde: string; de: number; para: number }[]; mensal?: PontoSerie[] };
    cdi?: Fonte & { nome: string; valor: number | null; data: string };
    cdiMensal?: Fonte & { nome: string; pontos: PontoSerie[] };
    ipca?: Fonte & { nome: string; mensal: PontoSerie[]; doze: number | null; ultimo: PontoSerie | null };
    dolar?: Fonte & { nome: string; valor: number | null; data: string; pontos: PontoSerie[] };
  };
  focus?: Fonte & {
    data: string; medianas: Record<string, Record<string, number>>; selicPorReuniao: { reuniao: string; mediana: number | null }[];
    /** a evolução das medianas semana a semana (IPCA e Selic, ano corrente e o próximo) */
    historico?: { desde: string; anos: string[]; porIndicador: Record<string, Record<string, { data: string; mediana: number }[]>>; em?: string };
  };
  copom?: Fonte & { decisoes: { numero: number; data: string; titulo: string; trecho?: string }[]; proxima: { numero: number; dias: string; decisao: string; fonteData: string } };
  cotacoes?: Fonte & { porCodigo: Record<string, Cotacao>; semToken: string[]; comToken: boolean };
  cripto?: Fonte & { porCodigo: Record<string, Cotacao>; citar: string; comChave: boolean };
  cvm?: Fonte & {
    nota: string; fatos: { codigo: string; data: string; assunto: string; url: string }[]; empresas: Record<string, { cnpj: string; nome: string }>; semEmpresa: string[];
    /** dia em que a companhia divulgou o resultado (press-release no IPE) */
    resultados?: { codigo: string; data: string; assunto: string; url: string }[];
    /** o que a companhia faz (FCA): setor e atividade */
    perfis?: Record<string, { setor: string; atividade: string }>;
    /** FII pelo informe mensal da CVM: segmento, valor patrimonial da cota, dividend yield do mês (%) */
    fiis?: Record<string, { nome: string; segmento: string; mandato: string; gestao: string; mes: string; vpCota: number | null; dyMes: number | null }>;
  };
  ativos?: { bolsa: string[]; cripto: string[] };
  erros: { fonte: string; erro: string; em: string }[];
}
export type TipoAtivo = 'acao' | 'fii' | 'etf' | 'bdr' | 'cripto';
export interface AtivoObservado { codigo: string; tipo: TipoAtivo; nota: string; desde: string }
export type TipoCarteira = 'reserva' | 'renda-fixa' | 'fii' | 'acao' | 'cripto' | 'outros';
export interface RegraAion {
  reservaMinima: number | null;
  alocacao: Partial<Record<Exclude<TipoCarteira, 'reserva'>, { alvo: number; tolerancia: number }>>;
  aportes: string[];
  naoFazer: string[];
  revisarEm: string;
  escritaEm: string;
  rel?: string;
}
export interface MetasAion { reserva: number | null; carteira: number | null; meta3: { nome: string; valor: number | null }; rel?: string }
export interface BlocoTrilha { n: number; titulo: string; aprender: string; material: string }
export interface Aion {
  mercado: Mercado | null;
  observacao: { ativos: AtivoObservado[]; rel?: string } | null;
  regra: RegraAion | null;
  metas: MetasAion | null;
  estudo: { blocos: Record<string, string>; atualizado?: string; rel?: string } | null;
  trilha: { nota: string; rel: string; blocos: BlocoTrilha[] };
  chaves: { brapi: boolean; coingecko: boolean };
  erros: { arquivo: string; erro: string }[];
}
