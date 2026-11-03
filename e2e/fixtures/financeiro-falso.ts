// Razão FALSO para o e2e. O playwright.config troca a pasta 04-NEGOCIO/financeiro da cópia
// temporária do vault por estes arquivos: nenhum valor real do Pedro aparece em teste nem em
// screenshot. Datas relativas a hoje (data fixa no passado quebrou o financeiro quando o
// calendário andou). Clientes "Alfa", "Beta"... são inventados.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const somarMes = (mes: string, k: number) => {
  const [a, m] = mes.split('-').map(Number)
  const t = a * 12 + (m - 1) + k
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

export function razaoFalso(hoje = new Date()): Record<string, object[]> {
  const mesHoje = hoje.toISOString().slice(0, 7)
  const meses = [-2, -1, 0, 1, 2, 3, 4, 5].map((k) => somarMes(mesHoje, k))
  const porMes: Record<string, object[]> = {}
  meses.forEach((mes, i) => {
    const passado = mes < mesHoje
    const ent = (id: string, dia: string, valor: number, extra: object = {}) => ({
      id: `${mes}-${id}`, tipo: 'entrada', descricao: `Cliente ${id} · mensalidade`, valor,
      vencimento: `${mes}-${dia}`, status: passado ? 'recebido' : 'a-receber',
      ...(passado ? { liquidadoEm: `${mes}-${dia}` } : {}), recorrente: true, ...extra,
    })
    const l: object[] = [
      ent('Alfa', '05', 2000, { cliente: 'Cliente Alfa', categoria: 'salario' }),
      ent('Beta', '20', 250, { cliente: 'Cliente Beta', categoria: 'mensalidade' }),
      {
        id: `${mes}-cartao`, tipo: 'saida', descricao: 'Cartao de credito · fatura', valor: i < 4 ? 410.5 : 180,
        vencimento: `${mes}-05`, status: passado ? 'pago' : 'a-pagar', ...(passado ? { liquidadoEm: `${mes}-05` } : {}),
        categoria: 'cartao', recorrente: true,
        obs: i < 2 ? 'NAO MEDIDO. estimativa' : i < 5 ? 'MEDIDO no banco.' : 'EXTRAPOLADO, nao medido.',
      },
      { id: `${mes}-moradia`, tipo: 'saida', descricao: 'Moradia', valor: 500, vencimento: '', status: passado ? 'pago' : 'a-pagar', ...(passado ? { liquidadoEm: `${mes}-10` } : {}), categoria: 'moradia', recorrente: true },
      { id: `${mes}-reserva`, tipo: 'reserva', descricao: 'Reserva de mudança', valor: 1000, vencimento: '', status: passado ? 'pago' : 'a-pagar', ...(passado ? { liquidadoEm: `${mes}-06` } : {}), categoria: 'reserva', recorrente: true },
    ]
    // acordo com prazo: termina 3 meses à frente
    if (i <= 5) l.push(ent('Gama', '26', 500, { cliente: 'Cliente Gama', categoria: 'mensalidade', ate: meses[5] }))
    // parcela: termina no mês que vem
    if (i <= 3) l.push({ ...ent('Delta', '12', 300, { cliente: 'Cliente Delta', categoria: 'parcela', recorrente: false }), descricao: `Cliente Delta · parcela ${i + 1}/4` })
    porMes[mes] = l
  })
  // um recebível vencido: o Alfa do mês passado segue aberto
  const passado = porMes[meses[1]] as Record<string, unknown>[]
  const alfa = passado.find((x) => String(x.id).endsWith('Alfa'))!
  alfa.status = 'a-receber'
  delete alfa.liquidadoEm

  // gastos "do banco" (origem) nos dois meses fechados: o banco começa no dia 01 do primeiro,
  // então ele conta na média. Mercado sobe de 400 para 700 (fugiu da média); a TV é pontual.
  const g = (mes: string, dia: string, categoria: string, valor: number, extra: object = {}) => ({
    id: `${mes}-gasto-${categoria}-${dia}`, tipo: 'saida', descricao: `Gasto falso · ${categoria}`, valor,
    vencimento: `${mes}-${dia}`, status: 'pago', liquidadoEm: `${mes}-${dia}`, categoria, origem: 'teste', conta: 'Banco Falso · conta', ...extra,
  })
  porMes[meses[0]].push(g(meses[0], '01', 'mercado', 400), g(meses[0], '08', 'transporte', 200))
  porMes[meses[1]].push(
    g(meses[1], '03', 'mercado', 700), g(meses[1], '09', 'transporte', 210),
    g(meses[1], '15', 'casa', 1500, { descricao: 'TV falsa', pontual: true }),
    // o que a sincronização não reconheceu: o bruto falso (playwright.config) tem a transação
    g(meses[1], '20', 'a classificar', 42.5, { id: `${meses[1]}-pix-falso`, descricao: 'Compra no débito', origem: 'pluggy', fitid: FITID_A_CLASSIFICAR }),
  )
  // fatura do cartão que vence daqui a 3 dias, com valor medido no banco
  const em3 = new Date(hoje.getTime() + 3 * 86400000).toISOString().slice(0, 10)
  porMes[em3.slice(0, 7)].push({
    id: `${em3}-fatura-proxima`, tipo: 'saida', descricao: 'Cartão de crédito · fatura', valor: 321.09, vencimento: em3,
    status: 'a-pagar', categoria: 'cartao', confianca: 'medido', obs: 'MEDIDO no banco.',
  })
  return porMes
}

/** A transação crua falsa por trás do lançamento "a classificar" (id inventado). */
export const TX_A_CLASSIFICAR = { id: 'tx-falsa-e2e-1', type: 'DEBIT', amount: -42.5, date: '2030-01-01', description: 'Compra no débito|LOJA FALSA E2E', merchant: { name: 'Loja Falsa E2E' } }
export const FITID_A_CLASSIFICAR = createHash('sha256').update(`pluggy:${TX_A_CLASSIFICAR.id}`).digest('hex').slice(0, 16)

/** O bruto falso, onde o "lembrar para os próximos" procura a transação. */
export function gravarBrutoFalso(pastaFinancas: string, hoje = new Date()) {
  const dia = join(pastaFinancas, 'bruto', 'pluggy', hoje.toISOString().slice(0, 10))
  mkdirSync(dia, { recursive: true })
  writeFileSync(join(dia, 'falso-transacoes.json'), JSON.stringify([TX_A_CLASSIFICAR]), 'utf8')
}

export function gravarFinanceiroFalso(vault: string, hoje = new Date()) {
  const pasta = join(vault, '04-NEGOCIO', 'financeiro')
  rmSync(pasta, { recursive: true, force: true })
  mkdirSync(pasta, { recursive: true })
  for (const [mes, lancamentos] of Object.entries(razaoFalso(hoje))) {
    const md = `---\ntipo: financeiro\narea: negocio\nmes: ${mes}\n---\n\n# Financeiro falso · ${mes}\n\n\`\`\`financeiro\n${JSON.stringify({ lancamentos }, null, 2)}\n\`\`\`\n`
    writeFileSync(join(pasta, `${mes}.md`), md, 'utf8')
  }
}
