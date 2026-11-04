// Mercado e carteira FALSOS para o e2e do Aion. Nada aqui é dado do Pedro: ativos de teste
// (TEST3, FUND11, OBSV3), valores redondos, datas relativas a hoje. O cache de mercado vai para a
// pasta temporária (SINAPSE_AION) e as posições para um arquivo próprio na CÓPIA do vault, que o
// spec cria e apaga (o resto da suíte não vê). O app nunca chama a rede de mercado: o spec ainda
// bloqueia e conta qualquer chamada a BCB, brapi, CoinGecko e CVM.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dia = (k: number, hoje = new Date()) => ymd(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + k))
const mes = (k: number, hoje = new Date()) => ymd(new Date(hoje.getFullYear(), hoje.getMonth() + k, 1))

/** Pregões falsos (dias úteis) dos últimos ~3 meses até ontem, numa curva redonda em torno de `base`; o último fecha em base + 1. */
function pregoes(hoje: Date, base: number) {
  const out: { data: string; fechamento: number }[] = []
  for (let k = -88; k <= -1; k++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + k)
    if (d.getDay() === 0 || d.getDay() === 6) continue
    out.push({ data: ymd(d), fechamento: Math.round((base + 0.6 * Math.sin(out.length / 6) + out.length * 0.012) * 100) / 100 })
  }
  out[out.length - 1].fechamento = base + 1
  return out
}

export function mercadoFalso(hoje = new Date()) {
  const agora = new Date(hoje.getTime()).toISOString()
  const ano = hoje.getFullYear()
  const fonte = (codigo: number) => ({ fonte: `Banco Central, SGS ${codigo}`, url: `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados/ultimos/1?formato=json`, em: agora })
  return {
    versao: 1, geradoEm: agora, erros: [],
    bcb: {
      selicMeta: { ...fonte(432), nome: 'Selic meta (% a.a.)', valor: 11.25, data: dia(0), decisoes: [{ desde: dia(-40), de: 11.5, para: 11.25 }],
        // 36 meses: sobe de 9 a 12 e desce até 11,25 (curva de teste, redonda)
        mensal: Array.from({ length: 36 }, (_, i) => ({ data: mes(i - 35), valor: i < 18 ? 9 + i / 6 : Math.max(11.25, 12 - (i - 18) / 16) })) },
      cdi: { ...fonte(4389), nome: 'CDI', valor: 11.15, data: dia(-1) },
      cdiMensal: { ...fonte(4391), nome: 'CDI mensal', pontos: Array.from({ length: 60 }, (_, i) => ({ data: mes(i - 60), valor: 0.9 })) },
      ipca: { ...fonte(433), nome: 'IPCA', mensal: Array.from({ length: 24 }, (_, i) => ({ data: mes(i - 25), valor: 0.4 })), doze: 4.9, ultimo: { data: mes(-2), valor: 0.4 } },
      dolar: { ...fonte(1), nome: 'Dólar', valor: 5.2, data: dia(-1), pontos: [{ data: dia(-31), valor: 5 }, { data: dia(-1), valor: 5.2 }] },
    },
    focus: {
      fonte: 'Banco Central, Relatório Focus (API Olinda)', url: 'https://www.bcb.gov.br/publicacoes/focus', em: agora, data: dia(-4),
      medianas: { IPCA: { [ano]: 4.5, [ano + 1]: 4 }, Selic: { [ano]: 11, [ano + 1]: 10 }, 'PIB Total': { [ano]: 2, [ano + 1]: 1.8 }, 'Câmbio': { [ano]: 5.3, [ano + 1]: 5.4 } },
      selicPorReuniao: [{ reuniao: `R1/${ano + 1}`, mediana: 11 }],
      historico: {
        desde: dia(-7 * 12), anos: [String(ano), String(ano + 1)], em: agora,
        porIndicador: {
          IPCA: { [ano]: Array.from({ length: 12 }, (_, i) => ({ data: dia(-7 * (12 - i)), mediana: 4 + i * 0.05 })), [ano + 1]: Array.from({ length: 12 }, (_, i) => ({ data: dia(-7 * (12 - i)), mediana: 3.8 + i * 0.02 })) },
          Selic: { [ano]: Array.from({ length: 12 }, (_, i) => ({ data: dia(-7 * (12 - i)), mediana: 11.5 - i * 0.04 })), [ano + 1]: Array.from({ length: 12 }, (_, i) => ({ data: dia(-7 * (12 - i)), mediana: 10.5 - i * 0.04 })) },
        },
      },
    },
    copom: {
      fonte: 'Banco Central, comunicados do Copom', url: 'https://www.bcb.gov.br/publicacoes/comunicadoscopom', em: agora,
      decisoes: [{ numero: 90, data: dia(-41), titulo: 'Copom reduz a taxa Selic para 11,25% a.a.', trecho: 'Texto falso do comunicado: o cenário de teste pede cautela.' }, { numero: 89, data: dia(-90), titulo: 'Copom reduz a taxa Selic para 11,50% a.a.' }],
      proxima: { numero: 91, dias: 'data de teste', decisao: dia(20), fonteData: 'calendário de teste' },
    },
    cotacoes: {
      fonte: 'brapi.dev', url: 'https://brapi.dev', em: agora, comToken: false, semToken: ['FUND11'],
      porCodigo: {
        TEST3: { codigo: 'TEST3', nome: 'Empresa Teste', preco: 10, variacaoDia: -3.2, em: agora.slice(0, 19), pl: 8.5, min52: 7, max52: 12, historico: pregoes(hoje, 9), proventos: [{ tipo: 'DIVIDENDO', valor: 0.3, pagamento: dia(20), aprovado: dia(-10), dataCom: dia(-2), dataEx: dia(-1) }] },
        OBSV3: { codigo: 'OBSV3', nome: 'Observada Teste', preco: 20, variacaoDia: 0.4, em: agora.slice(0, 19), pl: 12, min52: 15, max52: 25, historico: pregoes(hoje, 19), proventos: [] },
      },
    },
    cripto: { fonte: 'CoinGecko', citar: 'Data provided by CoinGecko', url: 'https://www.coingecko.com', em: agora, comChave: false, porCodigo: { BTC: { codigo: 'BTC', id: 'bitcoin', preco: 400000, variacaoDia: 2.5, em: agora.slice(0, 19) } } },
    cvm: {
      fonte: 'CVM, dados abertos', url: 'https://dados.cvm.gov.br', em: agora, nota: 'semanal', fatos: [{ codigo: 'TEST3', data: dia(-6), assunto: 'Venda de ativo de teste', url: 'https://dados.cvm.gov.br' }],
      resultados: [{ codigo: 'TEST3', data: dia(-20), assunto: 'Resultado de teste do trimestre', url: 'https://dados.cvm.gov.br' }],
      perfis: { TEST3: { setor: 'Setor de Teste', atividade: 'Fabrica peças de teste para o e2e.' } },
      fiis: { FUND11: { nome: 'FUNDO TESTE FII', segmento: 'Logística', mandato: '', gestao: 'Ativa', mes: mes(-2).slice(0, 7), vpCota: 100, dyMes: 0.9 } },
      empresas: { TEST3: { cnpj: '00.000.000/0000-00', nome: 'EMPRESA TESTE S.A.' } }, semEmpresa: ['FUND11'],
    },
    ativos: { bolsa: ['FUND11', 'TEST3'], cripto: ['BTC'] },
  }
}

export function gravarMercadoFalso(pastaAion: string, hoje = new Date()) {
  mkdirSync(pastaAion, { recursive: true })
  writeFileSync(join(pastaAion, 'mercado.json'), JSON.stringify(mercadoFalso(hoje)), 'utf8')
}

export const ARQ_POSICOES = '04-NEGOCIO/financeiro/aion-posicoes-e2e.md'

/**
 * Posições falsas (uma da reserva, um FII sem cotação, uma ação com data ex, cripto à mão) e um
 * rendimento. `meses` > 1 estende o razão falso para trás: um retrato por mês (valores crescendo),
 * um aporte de R$ 150 e um rendimento por mês, para os gráficos com muitos pontos. O mês de hoje
 * fica igual nos dois casos (os números da Carteira não mudam).
 */
export function gravarPosicoesFalsas(vault: string, hoje = new Date(), meses = 1) {
  const m = ymd(hoje).slice(0, 7)
  const d = dia(0, hoje)
  const antes = []
  for (let k = meses - 1; k >= 1; k--) {
    const mk = mes(-k, hoje).slice(0, 7), dk = `${mk}-05`
    antes.push(
      { id: `${mk}-inv-reserva`, tipo: 'investimento', descricao: 'CDB Banco Falso · liquidez diária', instituicao: 'Banco Falso', classe: 'CDB', liquidez: 'diaria', data: dk, valor: 3000 - 150 * k, status: 'posicao', reserva: false, vencimento: '', origem: 'teste', fitid: 'aaaa1111-' + mk },
      { id: `${mk}-inv-fii`, tipo: 'investimento', descricao: 'FII FUND11', instituicao: 'Corretora Falsa', classe: 'FII', liquidez: 'bolsa-d2', data: dk, valor: 1500 - 45 * k, status: 'posicao', reserva: false, vencimento: '', origem: 'teste', fitid: 'bbbb2222-' + mk, codigo: 'FUND11' },
      { id: `${mk}-inv-acao`, tipo: 'investimento', descricao: 'Ação TEST3', instituicao: 'Corretora Falsa', classe: 'Ação', liquidez: 'bolsa-d2', data: dk, valor: 500 - 12 * k, status: 'posicao', reserva: false, vencimento: '', origem: 'teste', fitid: 'cccc3333-' + mk, codigo: 'TEST3' },
      { id: `${mk}-aporte-e2e`, tipo: 'reserva', descricao: 'Aporte falso', valor: 150, vencimento: `${mk}-10`, status: 'pago', liquidadoEm: `${mk}-10`, categoria: 'reserva' },
      { id: `${mk}-rend-e2e`, tipo: 'entrada', descricao: 'Rendimentos FUND11', categoria: 'rendimentos', valor: 10 + k % 3, vencimento: `${mk}-15`, status: 'recebido', liquidadoEm: `${mk}-15` },
    )
  }
  const lanc = [
    ...antes,
    { id: `${m}-inv-reserva`, tipo: 'investimento', descricao: 'CDB Banco Falso · liquidez diária', instituicao: 'Banco Falso', classe: 'CDB', liquidez: 'diaria', data: d, valor: 3000, status: 'posicao', reserva: false, vencimento: '', origem: 'teste', fitid: 'aaaa1111-' + m, aportado: 2900, desde: dia(-180, hoje), indexador: '100% CDI' },
    { id: `${m}-inv-fii`, tipo: 'investimento', descricao: 'FII FUND11', instituicao: 'Corretora Falsa', classe: 'FII', liquidez: 'bolsa-d2', data: d, valor: 1500, status: 'posicao', reserva: false, vencimento: '', origem: 'teste', fitid: 'bbbb2222-' + m, codigo: 'FUND11', quantidade: 15 },
    { id: `${m}-inv-acao`, tipo: 'investimento', descricao: 'Ação TEST3', instituicao: 'Corretora Falsa', classe: 'Ação', liquidez: 'bolsa-d2', data: d, valor: 500, status: 'posicao', reserva: false, vencimento: '', origem: 'teste', fitid: 'cccc3333-' + m, codigo: 'TEST3', quantidade: 50 },
    { id: `${m}-inv-btc`, tipo: 'investimento', descricao: 'Bitcoin', instituicao: 'Carteira falsa', classe: 'cripto', codigo: 'BTC', data: d, valor: 1000, status: 'posicao', reserva: false, vencimento: '' },
    { id: `${m}-rend-fii`, tipo: 'entrada', descricao: 'Rendimentos FUND11', categoria: 'rendimentos', valor: 12.5, vencimento: d, status: 'recebido', liquidadoEm: d },
  ]
  const md = `---\ntipo: financeiro\narea: negocio\nmes: ${m}\n---\n\n# Posições falsas do e2e do Aion\n\n\`\`\`financeiro\n${JSON.stringify({ lancamentos: lanc }, null, 2)}\n\`\`\`\n`
  writeFileSync(join(vault, ARQ_POSICOES), md, 'utf8')
}
