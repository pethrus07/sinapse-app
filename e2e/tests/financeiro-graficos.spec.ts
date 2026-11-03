import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Métis (o módulo financeiro): Visão e Pronoia sobre o razão FALSO que o playwright.config grava
// na cópia do vault (e2e/fixtures/financeiro-falso.ts). Nada aqui lê ou grava o vault real.
const VAULT = process.env.SINAPSE_E2E_VAULT
if (!VAULT) throw new Error('SINAPSE_E2E_VAULT ausente: rode pelo playwright.config (npm test em e2e/)')
const INV = join(VAULT, '04-NEGOCIO', 'financeiro', '_teste-investimento.md')
const PAT = join(VAULT, '04-NEGOCIO', 'financeiro', 'patrimonio.md')
const SHOTS = 'shots'
mkdirSync(SHOTS, { recursive: true })

function coletarErros(page: Page): string[] {
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push('pageerror: ' + String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push('console.error: ' + m.text())
  })
  return erros
}

async function fotoInteira(page: Page, arq: string, largura: number) {
  // .pad-scroll rola por dentro: a página inteira só sai com a janela da altura do conteúdo
  const alt = await page.evaluate(() => (document.querySelector('.pad-scroll') as HTMLElement).scrollHeight)
  await page.setViewportSize({ width: largura, height: Math.min(alt + 80, 7000) })
  await page.screenshot({ path: `${SHOTS}/${arq}` })
}

test.afterEach(() => {
  for (const f of [INV, PAT]) if (existsSync(f)) rmSync(f)
})

test('Visão: avisos, fluxo, gastos, recorrente, patrimônio, clientes e vencido; o resto em "Mais opções"', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro')

  await expect(page.locator('.eyebrow-mono')).toHaveText('Métis')
  await expect(page.getByRole('tab', { name: 'Visão' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.fg-card')).toHaveCount(6)
  for (const id of ['fluxo', 'gastos', 'recorrente', 'patrimonio', 'clientes', 'vencido'])
    await expect(page.locator(`[data-grafico="${id}"]`)).toBeVisible()

  // avisos: fatura em 3 dias (valor medido), autorização a 20 dias e o "a classificar"
  await expect(page.locator('[data-aviso="fatura"]').filter({ hasText: 'R$ 321,09' })).toContainText('valor do banco')
  await expect(page.locator('[data-aviso="conexao-renovar"]')).toContainText('vence em')
  await expect(page.locator('[data-aviso="a-classificar"]')).toContainText('1 lançamento')

  // gastos: mercado fugiu da média (400 → 700); a TV é pontual e fica fraca na barra
  const gastos = page.locator('[data-grafico="gastos"]')
  await expect(gastos.locator('.fg-leitura')).toContainText('Mercado')
  const mercado = gastos.locator('.mt-cats li', { hasText: 'Mercado' })
  await expect(mercado).toContainText('R$ 300,00 acima da média')
  await expect(gastos.locator('.mt-cats li', { hasText: 'Casa' }).locator('.mt-cat-barra.pontual')).toHaveCount(1)
  // clique na categoria abre os lançamentos dela
  await mercado.locator('.mt-cat').click()
  await expect(mercado.locator('.mt-cat-itens')).toContainText('Gasto falso · mercado')
  await mercado.locator('.mt-cat').click()
  await expect(mercado.locator('.mt-cat-itens')).toHaveCount(0)

  // recorrente: a TV (pontual) fica fora do gasto recorrente
  const rec = page.locator('[data-grafico="recorrente"]')
  await expect(rec.locator('.fg-numeros')).toContainText('R$ 1.500,00')
  await expect(rec.locator('.fg-leitura')).toContainText('se sustenta até')
  await expect(rec.locator('.fg-leitura')).toContainText('cai para R$ 2.250,00')
  await expect(page.locator('[data-grafico="clientes"] .fg-titulo')).toHaveText('Fontes de renda: recebido × o que falta')
  await expect(page.locator('[data-grafico="clientes"] .fg-barras li', { hasText: 'Cliente Alfa' })).toContainText('sem fim')
  await expect(page.locator('[data-grafico="gastos"] .mt-cat-nome', { hasText: 'Mercado' })).toBeVisible()

  // clientes: recebido × o que falta, com o vencido do Alfa
  const cli = page.locator('[data-grafico="clientes"]')
  await expect(cli.locator('.fg-barras li', { hasText: 'Cliente Alfa' })).toContainText('vencido há')
  await expect(cli.locator('.fg-barras li', { hasText: 'Cliente Beta' })).toContainText('em dia')

  // patrimônio vazio até a primeira posição
  await expect(page.locator('[data-grafico="patrimonio"] .fg-leitura')).toContainText('Nenhuma posição')
  // vencido: o Alfa do mês passado
  const venc = page.locator('[data-grafico="vencido"]')
  await expect(venc.locator('.fg-barras li')).toHaveCount(1)
  await expect(venc).toContainText('R$ 2.000,00')

  // tabela fica fechada até pedir
  const fluxo = page.locator('[data-grafico="fluxo"]')
  await expect(fluxo.locator('.fg-tabela')).toBeHidden()
  await fluxo.getByText('Mais opções').click()
  await expect(fluxo.locator('.fg-tabela')).toBeVisible()
  await fluxo.getByText('Mais opções').click()
  // dica ao passar o mouse numa coluna
  await fluxo.locator('.fg-hit').nth(3).hover()
  await expect(fluxo.locator('.fg-dica')).toBeVisible()

  // trocar o mês das análises muda o foco (o de hoje fica "até agora")
  const meses = page.locator('.mt-mes')
  await meses.last().click()
  await expect(gastos.locator('.fg-leitura')).toContainText('até agora')
  await meses.nth((await meses.count()) - 2).click()

  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${SHOTS}/19-metis-visao-1440.png` })
  await fotoInteira(page, '19-metis-visao-1440-inteira.png', 1440)
  expect(erros, erros.join('\n')).toEqual([])
})

test('Pronoia: renda futura, reserva projetada, cartão parcelado e a projeção mês a mês', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro')
  await page.getByRole('tab', { name: 'Pronoia' }).click()
  await expect(page).toHaveURL(/#\/financeiro\/pronoia$/)
  await expect(page.locator('.eyebrow-mono')).toHaveText('Métis › Pronoia')
  await expect(page.locator('.fg-card')).toHaveCount(3)
  // receita estável = Alfa 2.000 + Beta 250 (Gama tem `ate`, Delta é parcela)
  await expect(page.locator('[data-grafico="receita"] .fg-leitura')).toContainText('R$ 2.250,00')
  await expect(page.locator('[data-grafico="receita"] .fg-legenda')).toContainText('Cliente Gama · até')
  const cartao = page.locator('[data-grafico="cartao"]')
  await expect(cartao.locator('.fg-legenda')).toContainText('medido')
  await expect(cartao.locator('.fg-legenda')).toContainText('extrapolado')
  const opac = await cartao.locator('svg path').evaluateAll((ps) => [...new Set(ps.map((p) => p.getAttribute('opacity')))])
  expect(opac.length).toBeGreaterThan(1)
  await expect(page.locator('[data-grafico="reserva"] .fg-leitura')).toContainText('saldo de partida não está no razão')
  await expect(page.getByRole('heading', { name: /Projeção mês a mês/ })).toBeVisible()
  await expect(page.locator('.fin-proj tbody tr').first()).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/21-metis-pronoia-1440.png` })
  await fotoInteira(page, '21-metis-pronoia-1440-inteira.png', 1440)
  // abrir direto pela rota
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro/pronoia')
  await expect(page.getByRole('tab', { name: 'Pronoia' })).toHaveAttribute('aria-selected', 'true')
  expect(erros, erros.join('\n')).toEqual([])
})

test('Visão e Pronoia no celular (390 px): sem rolagem lateral', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const [rota, n, foto] of [['/#/financeiro', 6, '20-metis-visao-390'], ['/#/financeiro/pronoia', 3, '22-metis-pronoia-390']] as const) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(rota)
    await expect(page.locator('.fg-card')).toHaveCount(n)
    const vaza = await page.evaluate(() => {
      const el = document.querySelector('.pad-scroll') as HTMLElement
      return el.scrollWidth - el.clientWidth
    })
    expect(vaza, rota).toBeLessThanOrEqual(1)
    const larg = await page.locator('.fg-card').evaluateAll((cs) =>
      cs.map((c) => {
        const s = c.querySelector('svg') as SVGSVGElement | null
        return s ? s.getBoundingClientRect().right - c.getBoundingClientRect().right : -1
      }),
    )
    for (const d of larg) expect(d).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `${SHOTS}/${foto}.png` })
    await fotoInteira(page, `${foto}-inteira.png`, 390)
  }
  expect(erros, erros.join('\n')).toEqual([])
})

test('Patrimônio: posições do banco e à mão, reserva líquida × piso e a evolução pelos retratos', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro')
  await expect(page.locator('[data-grafico="patrimonio"] .fg-leitura')).toContainText('Nenhuma posição')

  const hoje = new Date().toISOString().slice(0, 10)
  const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const anteontem = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
  const mes = hoje.slice(0, 7)
  const lanc = {
    lancamentos: [
      // duas caixinhas com o MESMO nome: não podem se fundir
      { id: 'inv-1', tipo: 'investimento', descricao: 'CDB Banco Falso · liquidez diária', classe: 'CDB', instituicao: 'Banco Falso', liquidez: 'diaria', data: hoje, valor: 2000, status: 'posicao', reserva: true, vencimento: '', origem: 'pluggy', fitid: `aaaa0001-${mes}` },
      { id: 'inv-2', tipo: 'investimento', descricao: 'CDB Banco Falso · liquidez diária', classe: 'CDB', instituicao: 'Banco Falso', liquidez: 'diaria', data: hoje, valor: 1300, status: 'posicao', reserva: true, vencimento: '', origem: 'pluggy', fitid: `aaaa0002-${mes}` },
      { id: 'inv-3', tipo: 'investimento', descricao: 'FII FALS11', classe: 'FII', instituicao: 'Corretora Falsa', liquidez: 'bolsa-d2', data: hoje, valor: 700, status: 'posicao', vencimento: '', origem: 'pluggy', fitid: `aaaa0003-${mes}` },
      { id: 'inv-4', tipo: 'investimento', descricao: 'Moeda falsa', classe: 'cripto', instituicao: 'Carteira falsa', liquidez: '', data: hoje, valor: 500, status: 'posicao', vencimento: '' },
    ],
  }
  writeFileSync(INV, `---\ntipo: financeiro\narea: negocio\nmes: ${mes}\n---\n\n# teste\n\n\`\`\`financeiro\n${JSON.stringify(lanc, null, 2)}\n\`\`\`\n`, 'utf8')
  const ret = { retratos: [
    { data: anteontem, total: 3600, diaria: 2600, porGrupo: { 'CDB liquidez diária': 2600, FII: 1000 } },
    { data: ontem, total: 4100, diaria: 3000, porGrupo: { 'CDB liquidez diária': 3000, FII: 1100 } },
  ] }
  writeFileSync(PAT, `---\ntipo: financeiro\narea: negocio\n---\n\n# patrimônio falso\n\n\`\`\`patrimonio\n${JSON.stringify(ret)}\n\`\`\`\n`, 'utf8')
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  const pat = page.locator('[data-grafico="patrimonio"]')
  await expect(pat.locator('.fg-leitura')).toContainText('R$ 4.500,00', { timeout: 10_000 })
  await expect(pat.locator('.mt-reserva')).toContainText('R$ 3.300,00')
  await expect(pat.locator('.fg-leitura')).toContainText('faltam R$ 1.700,00')
  await expect(pat.locator('.fg-legenda').first()).toContainText('Cripto')
  await expect(pat.locator('svg path')).toHaveCount(2) // total e liquidez diária, 3 pontos
  // saldo não é fluxo; e a reserva da Pronoia parte das posições marcadas reserva
  await expect(page.locator('[data-grafico="fluxo"] .fg-leitura')).not.toContainText('4.500')
  await page.locator('[data-grafico="patrimonio"]').screenshot({ path: `${SHOTS}/23-metis-patrimonio.png` })
  await page.getByRole('tab', { name: 'Pronoia' }).click()
  await expect(page.locator('[data-grafico="reserva"] .fg-leitura')).toContainText('Hoje')
  expect(erros, erros.join('\n')).toEqual([])
})
