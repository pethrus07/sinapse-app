// Razão FALSO para o e2e. O playwright.config troca a pasta 04-NEGOCIO/financeiro da cópia
// temporária do vault por estes arquivos: nenhum valor real do Pedro aparece em teste nem em
// screenshot. Datas relativas a hoje (data fixa no passado quebrou o financeiro quando o
// calendário andou). Clientes "Alfa", "Beta"... são inventados.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
  return porMes
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
