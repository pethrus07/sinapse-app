// Aion · o GLOSSÁRIO: o "O que é" de cada termo, nome ou indicador que aparece nas telas.
//
// A regra conceito × porquê (docs/aion-formato.md):
//   termo, nome, indicador  → "O que é": o conceito em 2 a 3 linhas e o bloco da trilha (este arquivo)
//   número que mudou        → "Por quê": motivo, fonte, data e o tipo da explicação (aionPorques.ts)
//   ativo inteiro           → os dois: "O que é" em cima, "Por quê" embaixo
//
// Mora aqui (e não no vault) porque: (1) é conhecimento geral, igual para qualquer pessoa, sem nada
// do Pedro; (2) as telas e o teste leem o mesmo arquivo na hora do build, então uma tela que marcar um
// termo sem verbete quebra o `npm test` (aionGlossario.test.ts) e o tipo `IdTermo` quebra o tsc; (3) o
// estudo continua no vault: cada verbete aponta para o bloco da trilha (02-ESTUDO/trilha-investimentos-
// e-economia.md), que é onde o Pedro aprofunda.
//
// Texto: simples, de colega, sem travessão, sem jargão sem explicar. Ao incluir um termo novo numa
// tela, inclua o verbete aqui antes.
import type { TipoCarteira } from '../types';

export interface Verbete {
  termo: string;         // como aparece no título do pop-up
  texto: string;         // 2 a 3 linhas
  bloco: number;         // bloco da trilha que explica
}

export const GLOSSARIO = {
  /* ---------- tipos da carteira */
  reserva: { termo: 'Reserva', bloco: 4, texto: 'O dinheiro para emergência: fica onde dá para tirar no mesmo dia e não oscila. Ela não é investimento para render mais; é o colchão que deixa você arriscar o resto com calma.' },
  'liquidez-diaria': { termo: 'Liquidez diária', bloco: 4, texto: 'Dá para resgatar em qualquer dia útil e o dinheiro cai no mesmo dia ou no seguinte. Por isso serve para a reserva. Não quer dizer que rende pouco: muitas aplicações assim pagam perto de 100% do CDI.' },
  'renda-fixa': { termo: 'Renda fixa', bloco: 3, texto: 'Você empresta dinheiro (ao governo, a um banco, a uma empresa) e recebe juros combinados. "Fixa" é a regra do juro, não o valor: pode ser uma taxa prefixada, um percentual do CDI ou IPCA mais uma taxa.' },
  fii: { termo: 'Fundos imobiliários (FII)', bloco: 5, texto: 'Um fundo que junta dinheiro de muita gente para ter imóveis (prédios, galpões, shoppings) ou títulos ligados a imóveis. A cota é negociada na bolsa e o fundo distribui o que recebe, em geral todo mês.' },
  acao: { termo: 'Ações', bloco: 6, texto: 'Um pedaço de uma empresa. Quem tem a ação é sócio: ganha se a empresa crescer e der lucro, e pode perder se ela for mal. O preço muda todo dia, pelo que o mercado acha que a empresa vale.' },
  cripto: { termo: 'Cripto', bloco: 8, texto: 'Moeda digital que não depende de um banco central, como o Bitcoin. O preço oscila muito, de um dia para o outro. Quem guarda a chave privada é dono de fato; na corretora, quem guarda é ela.' },
  outros: { termo: 'Outros', bloco: 7, texto: 'Aplicação que o Aion ainda não sabe classificar (fundo multimercado, previdência, algo que o banco descreveu de um jeito novo). Conta no total, mas fica fora da comparação com a sua regra.' },
  'fora-da-reserva': { termo: 'Fora da reserva', bloco: 11, texto: 'Tudo o que não é a reserva: renda fixa com prazo, FII, ações e cripto. É a parte em que você aceita risco para tentar crescer mais; a sua regra divide esta parte em porcentagens.' },
  'total-investido': { termo: 'Total investido', bloco: 4, texto: 'A soma do que está aplicado hoje, reserva junto, pelo valor que o banco informou na última sincronização (e o que você lançou à mão, como cripto).' },
  piso: { termo: 'Piso da reserva', bloco: 4, texto: 'O mínimo que você decidiu ter na reserva. Enquanto ela está abaixo do piso, o aporte vai primeiro para ela; só depois para o resto.' },

  /* ---------- fluxo de dinheiro */
  'renda-passiva': { termo: 'Renda passiva', bloco: 5, texto: 'Dinheiro que entra sem você vender nada: dividendos e JCP de ações, rendimentos de FII, juros que caem na conta. É o que a carteira paga para você enquanto você continua com ela.' },
  aporte: { termo: 'Aporte', bloco: 1, texto: 'Dinheiro novo que você coloca na reserva ou num investimento. Não é rendimento: é você guardando. Separar os dois é o que deixa medir quanto a carteira rendeu de verdade.' },
  ritmo: { termo: 'Ritmo de aporte', bloco: 11, texto: 'A média do que você de fato aportou por mês, contando os meses em que não entrou nada como zero. O Aion projeta as metas por esse ritmo, e não por um valor que você gostaria de aportar.' },
  patrimonio: { termo: 'Patrimônio investido', bloco: 4, texto: 'O valor de tudo o que está aplicado no fim de cada mês, pelo retrato que a sincronização guarda. Sobe com aporte e com rendimento; cai com resgate e com queda de preço.' },

  /* ---------- juros, inflação, Banco Central */
  selic: { termo: 'Selic', bloco: 2, texto: 'A taxa básica de juros do país, decidida pelo Copom. Quando ela sobe, crédito fica caro e a renda fixa paga mais; quando cai, o contrário. É a régua de quase todos os juros.' },
  cdi: { termo: 'CDI', bloco: 3, texto: 'A taxa que os bancos cobram entre si num empréstimo de um dia. Anda colada na Selic, um pouco abaixo. "100% do CDI" quer dizer que a aplicação rende o mesmo que essa taxa.' },
  ipca: { termo: 'IPCA', bloco: 2, texto: 'A inflação oficial, medida pelo IBGE todo mês: quanto os preços de uma cesta de compras subiram. Se o seu dinheiro rendeu menos que o IPCA, ele perdeu poder de compra.' },
  copom: { termo: 'Copom', bloco: 2, texto: 'O comitê do Banco Central que se reúne a cada 45 dias e decide a Selic. Depois de cada reunião sai um comunicado explicando o porquê, e a ata uma semana depois.' },
  focus: { termo: 'Focus', bloco: 9, texto: 'Relatório que o Banco Central publica toda segunda com a mediana do que bancos e consultorias esperam para inflação, Selic, PIB e dólar. É a expectativa do mercado, não uma previsão do BC nem do Aion.' },
  mediana: { termo: 'Mediana', bloco: 9, texto: 'O valor do meio quando se põe todas as respostas em ordem. Metade das instituições espera mais, metade espera menos. Ela muda pouco por causa de uma resposta muito fora da curva.' },
  dolar: { termo: 'Dólar comercial', bloco: 9, texto: 'O preço do dólar usado entre bancos e empresas, que o Banco Central publica todo dia. Mexe com o preço de importados, com a inflação e com o que você tem em ativo cotado lá fora.' },
  pib: { termo: 'PIB', bloco: 9, texto: 'A soma de tudo o que o país produz num ano. PIB crescendo costuma vir com mais emprego e lucro das empresas; caindo, com recessão.' },
  'juro-real': { termo: 'Juro real', bloco: 1, texto: 'O que o rendimento ganha da inflação. Se a aplicação deu 12% no ano e a inflação foi 5%, o ganho real fica perto de 6,7%: é ele que aumenta o que o seu dinheiro compra.' },
  'meta-inflacao': { termo: 'Meta de inflação', bloco: 2, texto: 'O alvo de inflação que o governo define e o Banco Central persegue mexendo na Selic. Quando a inflação esperada passa da meta, o BC tende a subir os juros.' },

  /* ---------- indicadores de ativo */
  pl: { termo: 'P/L', bloco: 6, texto: 'Preço dividido pelo lucro por ação: quantos anos de lucro de hoje você paga ao comprar a ação. P/L baixo pode ser barganha ou sinal de problema; sozinho não diz qual.' },
  pvp: { termo: 'P/VP', bloco: 5, texto: 'Preço da cota dividido pelo valor patrimonial dela (o que os imóveis e títulos do fundo valem, por cota). Abaixo de 1, o mercado paga menos do que o fundo diz valer; acima, mais.' },
  'vp-cota': { termo: 'Valor patrimonial da cota', bloco: 5, texto: 'O patrimônio do fundo dividido pelo número de cotas, como o próprio fundo informa à CVM todo mês. É a referência para comparar com o preço da cota na bolsa.' },
  dy: { termo: 'DY (dividend yield)', bloco: 5, texto: 'Quanto o ativo pagou de provento em relação ao preço. DY de 1% no mês quer dizer que, para cada R$ 100 em cotas, entrou R$ 1 naquele mês. Passado não garante o próximo.' },
  '52-semanas': { termo: 'Mínima e máxima de 52 semanas', bloco: 7, texto: 'O menor e o maior preço do último ano. Mostra onde o preço de hoje está nesse intervalo; não diz se está caro ou barato.' },
  variacao: { termo: 'Variação do dia', bloco: 7, texto: 'Quanto o preço andou desde o fechamento anterior. Mexidas pequenas são o vaivém normal da bolsa e quase nunca têm notícia própria.' },
  'fundo-de-papel': { termo: 'Fundo de papel', bloco: 5, texto: 'FII que, em vez de imóveis, tem títulos de dívida ligados a imóveis (como CRI). Rende juros, quase sempre atrelados ao CDI ou ao IPCA, e sente mais a mudança de juros do que a de aluguel.' },
  'fundo-de-tijolo': { termo: 'Fundo de tijolo', bloco: 5, texto: 'FII dono de imóveis de verdade (galpão, escritório, shopping) que recebe aluguel. Vacância (imóvel vazio) e reajuste do aluguel pesam mais do que os juros.' },
  segmento: { termo: 'Segmento do FII', bloco: 5, texto: 'O tipo de imóvel ou de ativo em que o fundo diz atuar no informe à CVM: logística, shoppings, escritórios, "multicategoria" quando mistura, "outros" quando não cabe nas caixas.' },

  /* ---------- eventos */
  provento: { termo: 'Provento', bloco: 6, texto: 'Dinheiro que a empresa ou o fundo distribui a quem tem o ativo: dividendo, juros sobre capital próprio (JCP) ou rendimento de FII.' },
  'data-com': { termo: 'Data com', bloco: 6, texto: 'O último dia em que quem tem o ativo no fim do pregão ganha o direito ao provento anunciado. Comprar depois disso não dá direito.' },
  'data-ex': { termo: 'Data ex', bloco: 6, texto: 'O primeiro dia sem direito ao provento. A cotação costuma abrir descontada mais ou menos do valor do provento: é a mecânica, não uma notícia ruim.' },
  'fato-relevante': { termo: 'Fato relevante', bloco: 6, texto: 'Comunicado que a empresa é obrigada a fazer quando algo pode mexer no preço da ação: venda de um negócio, aquisição, mudança grande. Fica nos dados abertos da CVM.' },
  resultado: { termo: 'Resultado do trimestre', bloco: 6, texto: 'Quando a empresa conta quanto vendeu, gastou e lucrou nos últimos três meses. O preço costuma mexer nos dias seguintes, para cima ou para baixo, conforme o esperado.' },
  'decisao-copom': { termo: 'Decisão do Copom', bloco: 2, texto: 'O dia em que o Copom anunciou a Selic. Mexe com a renda fixa na hora e com a bolsa toda; num ativo específico, é contexto, não prova de causa.' },

  /* ---------- renda fixa, preço e risco */
  indexador: { termo: 'Indexador', bloco: 3, texto: 'A régua do rendimento de uma aplicação de renda fixa: "110% do CDI", "IPCA + 6%", "prefixado 12%". Diz como o juro é calculado, não quanto vai dar no fim.' },
  'marcacao-a-mercado': { termo: 'Marcação a mercado', bloco: 3, texto: 'Atualizar o valor de um título pelo preço que ele teria se fosse vendido hoje. Um título prefixado pode valer menos antes do vencimento se os juros subirem, mesmo pagando certinho no fim.' },
  volatilidade: { termo: 'Volatilidade', bloco: 7, texto: 'O quanto um preço costuma balançar em torno da média. Volatilidade alta não é perda certa, é caminho mais acidentado; quem precisa vender no meio do caminho sente mais.' },
  cenarios: { termo: 'Cenários ruim, base e bom', bloco: 7, texto: 'Três contas com premissas diferentes, não previsões. A faixa entre o ruim e o bom mostra o tamanho da incerteza; a base é o meio, se as premissas estiverem certas.' },
  'valor-real': { termo: 'Em reais de hoje', bloco: 1, texto: 'O valor futuro descontado da inflação esperada, para comparar com o que o dinheiro compra hoje. R$ 10 mil daqui a 5 anos compram menos que R$ 10 mil hoje.' },
  'tabela-regressiva': { termo: 'Tabela regressiva do IR', bloco: 10, texto: 'O imposto da renda fixa cai quanto mais tempo o dinheiro fica: 22,5% até 6 meses, 20% até 1 ano, 17,5% até 2 anos e 15% depois. Incide só sobre o ganho.' },
  'base-100': { termo: 'Base 100', bloco: 1, texto: 'Todas as linhas começam valendo 100 no mesmo mês, para comparar o caminho e não o tamanho. 105 quer dizer 5% a mais que no começo.' },

  /* ---------- a regra */
  regra: { termo: 'Minha regra (política de investimento)', bloco: 11, texto: 'O que você decide por escrito antes do fato: quanto em cada tipo, quando aportar, quando mexer e o que não fazer. Com ela, a decisão do dia a dia vira conferência, não palpite.' },
  'alocacao-alvo': { termo: 'Alocação-alvo', bloco: 11, texto: 'A porcentagem que você quer ter em cada tipo, fora da reserva. A tolerância diz quanto pode desviar antes de você considerar mexer (rebalancear).' },
  meta: { termo: 'Meta', bloco: 11, texto: 'Um valor com um destino: a reserva até o piso, a carteira até um tamanho, um objetivo grande. O Aion mostra quando cada uma chega no ritmo real; a ordem é a que você definiu.' },
} satisfies Record<string, Verbete>;

export type IdTermo = keyof typeof GLOSSARIO;

/** O verbete (ou null: a tela não deve marcar um termo sem verbete; o teste pega). */
export function verbete(id: string): Verbete | null {
  return (GLOSSARIO as Record<string, Verbete>)[id] || null;
}

/** O termo de cada tipo da carteira. */
export const TERMO_DO_TIPO: Record<TipoCarteira, IdTermo> = { reserva: 'reserva', 'renda-fixa': 'renda-fixa', fii: 'fii', acao: 'acao', cripto: 'cripto', outros: 'outros' };

export interface OQueEAtivo { titulo: string; linhas: string[]; fonte: { nome: string; url: string } | null; termo: IdTermo }

/**
 * "O que é" de um ativo: o que a empresa ou o fundo faz e de que tipo é, quando a fonte der (CVM:
 * setor e atividade da companhia; informe mensal do FII: segmento). Sem fonte: só o tipo.
 */
export function oQueEAtivo(codigo: string, tipo: TipoCarteira | 'etf' | 'bdr', mercado: { cvm?: { empresas?: Record<string, { nome: string }>; perfis?: Record<string, { setor: string; atividade: string }>; fiis?: Record<string, { nome: string; segmento: string; mes: string }>; url?: string }; cotacoes?: { porCodigo?: Record<string, { nome?: string }> } } | null | undefined): OQueEAtivo {
  const c = codigo.toUpperCase();
  const cvm = mercado?.cvm;
  const nomeBrapi = mercado?.cotacoes?.porCodigo?.[c]?.nome || '';
  const tipoTermo: IdTermo = tipo === 'etf' || tipo === 'bdr' ? 'acao' : TERMO_DO_TIPO[tipo];
  const doTipo = GLOSSARIO[tipoTermo];
  const perfil = cvm?.perfis?.[c];
  if (perfil) {
    const nome = cvm?.empresas?.[c]?.nome || nomeBrapi || c;
    return {
      titulo: nome, termo: tipoTermo,
      linhas: [`${tipoTermo === 'acao' ? 'Ação' : doTipo.termo} de uma companhia do setor "${perfil.setor || 'não informado'}".`, perfil.atividade ? `O que ela faz, nas palavras do cadastro na CVM: ${perfil.atividade.replace(/\.$/, '')}.` : 'O cadastro na CVM não descreve a atividade.'],
      fonte: { nome: 'CVM, formulário cadastral (dados abertos)', url: 'https://dados.cvm.gov.br/dataset/cia_aberta-doc-fca' },
    };
  }
  const fii = cvm?.fiis?.[c];
  if (fii) {
    return {
      titulo: fii.nome || nomeBrapi || c, termo: 'fii',
      linhas: [`Fundo imobiliário do segmento "${fii.segmento || 'não informado'}", como ele declara à CVM (informe de ${fii.mes.slice(5)}/${fii.mes.slice(0, 4)}).`, fii.segmento === 'Multicategoria' || fii.segmento === 'Outros' ? 'O segmento sozinho não diz se é de papel ou de tijolo: o relatório do fundo diz.' : GLOSSARIO.segmento.texto],
      fonte: { nome: 'CVM, informe mensal de FII (dados abertos)', url: 'https://dados.cvm.gov.br/dataset/fii-doc-inf_mensal' },
    };
  }
  return {
    titulo: nomeBrapi || c, termo: tipoTermo,
    linhas: [`${doTipo.termo}. ${doTipo.texto}`, 'O que este ativo faz em particular: a fonte ainda não deu (a CVM liga companhia aberta e FII; o resto fica só com o tipo).'],
    fonte: null,
  };
}
