import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Aba Visão do Financeiro sobre o razão FALSO que o playwright.config grava na cópia do vault
// (e2e/fixtures/financeiro-falso.ts). Nada aqui lê ou grava o vault real.
const VAULT = process.env.SINAPSE_E2E_VAULT
if (!VAULT) throw new Error('SINAPSE_E2E_VAULT ausente: rode pelo playwright.config (npm test em e2e/)')
const INV = join(VAULT, '04-NEGOCIO', 'financeiro', '_teste-investimento.md')
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

test.afterEach(() => {
  if (existsSync(INV)) rmSync(INV)
})

test('Visão: os seis gráficos, leitura certa e o resto em "Mais opções"', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro')

  await expect(page.getByRole('tab', { name: 'Visão' })).toHaveAttribute('aria-selected', 'true')
  const cards = page.locator('.fg-card')
  await expect(cards).toHaveCount(6)
  for (const id of ['fluxo', 'receita', 'vencido', 'reserva', 'cartao', 'investimentos'])
    await expect(page.locator(`[data-grafico="${id}"]`)).toBeVisible()

  // receita estável = Alfa 2.000 + Beta 250 (Gama tem `ate`, Delta é parcela)
  await expect(page.locator('[data-grafico="receita"] .fg-leitura')).toContainText('R$ 2.250,00')
  await expect(page.locator('[data-grafico="receita"] .fg-legenda')).toContainText('Cliente Gama · até')
  // vencido: o Alfa do mês passado
  const venc = page.locator('[data-grafico="vencido"]')
  await expect(venc.locator('.fg-barras li')).toHaveCount(1)
  await expect(venc).toContainText('Cliente Alfa')
  await expect(venc).toContainText('R$ 2.000,00')
  // cartão: medido e extrapolado em tons diferentes, a legenda diz qual é qual
  const cartao = page.locator('[data-grafico="cartao"]')
  await expect(cartao.locator('.fg-legenda')).toContainText('medido')
  await expect(cartao.locator('.fg-legenda')).toContainText('extrapolado')
  const opac = await cartao.locator('svg path').evaluateAll((ps) => [...new Set(ps.map((p) => p.getAttribute('opacity')))])
  expect(opac.length).toBeGreaterThan(1)
  // reserva sem posição de investimento: avisa que o saldo de partida não está no razão
  await expect(page.locator('[data-grafico="reserva"] .fg-leitura')).toContainText('saldo de partida não está no razão')
  // investimentos: vazio, com o formato à mão
  const inv = page.locator('[data-grafico="investimentos"]')
  await expect(inv.locator('.fg-leitura')).toContainText('Nenhum investimento')

  // tabela fica fechada até pedir
  const fluxo = page.locator('[data-grafico="fluxo"]')
  await expect(fluxo.locator('.fg-tabela')).toBeHidden()
  await fluxo.getByText('Mais opções').click()
  await expect(fluxo.locator('.fg-tabela')).toBeVisible()
  await fluxo.getByText('Mais opções').click()

  // dica ao passar o mouse numa coluna
  await fluxo.locator('.fg-hit').nth(3).hover()
  await expect(fluxo.locator('.fg-dica')).toBeVisible()
  await expect(fluxo.locator('.fg-dica')).toContainText('realizado')

  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${SHOTS}/19-financeiro-visao-1440.png`, fullPage: true })
  // .pad-scroll rola por dentro: a página inteira só sai com a janela da altura do conteúdo
  const alt = await page.evaluate(() => (document.querySelector('.pad-scroll') as HTMLElement).scrollHeight)
  await page.setViewportSize({ width: 1440, height: Math.min(alt + 40, 6000) })
  await page.screenshot({ path: `${SHOTS}/19-financeiro-visao-1440-inteira.png` })
  await page.setViewportSize({ width: 1440, height: 900 })

  // a aba Lançamentos continua lá
  await page.getByRole('tab', { name: 'Lançamentos' }).click()
  await expect(page.locator('.fin-kpi')).toHaveCount(6)
  expect(erros, erros.join('\n')).toEqual([])
})

test('Visão no celular (390 px): sem rolagem lateral', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/financeiro')
  await expect(page.locator('.fg-card')).toHaveCount(6)
  const vaza = await page.evaluate(() => {
    const el = document.querySelector('.pad-scroll') as HTMLElement
    return el.scrollWidth - el.clientWidth
  })
  expect(vaza).toBeLessThanOrEqual(1)
  // nenhum svg passa da largura do cartão
  const larg = await page.locator('.fg-card').evaluateAll((cs) =>
    cs.map((c) => {
      const s = c.querySelector('svg') as SVGSVGElement | null
      return s ? s.getBoundingClientRect().right - c.getBoundingClientRect().right : -1
    }),
  )
  for (const d of larg) expect(d).toBeLessThanOrEqual(0)
  await page.screenshot({ path: `${SHOTS}/20-financeiro-visao-390.png` })
  // altura total para a revisão por imagem
  const altura = await page.evaluate(() => (document.querySelector('.pad-scroll') as HTMLElement).scrollHeight)
  await page.setViewportSize({ width: 390, height: Math.min(altura + 80, 6000) })
  await page.screenshot({ path: `${SHOTS}/20-financeiro-visao-390-inteira.png` })
  expect(erros, erros.join('\n')).toEqual([])
})

test('Investimento lançado no razão aparece e vira saldo de partida da reserva', async ({ page }) => {
  const erros = coletarErros(page)
  await page.goto('/#/financeiro')
  await expect(page.locator('[data-grafico="investimentos"] .fg-leitura')).toContainText('Nenhum investimento')

  const hoje = new Date().toISOString().slice(0, 10)
  const lanc = {
    lancamentos: [
      { id: 'inv-1', tipo: 'investimento', descricao: 'Caixinha', instituicao: 'Banco Falso', liquidez: 'diaria', data: hoje, valor: 5300, status: 'posicao', reserva: true, vencimento: '' },
      { id: 'inv-2', tipo: 'investimento', descricao: 'CDB falso', instituicao: 'Banco Falso', liquidez: 'no-vencimento', data: hoje, valor: 700, status: 'posicao', vencimento: '' },
    ],
  }
  writeFileSync(INV, `---\ntipo: financeiro\narea: negocio\nmes: ${hoje.slice(0, 7)}\n---\n\n# teste\n\n\`\`\`financeiro\n${JSON.stringify(lanc, null, 2)}\n\`\`\`\n`, 'utf8')
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  const inv = page.locator('[data-grafico="investimentos"]')
  await expect(inv.locator('.fg-leitura')).toContainText('R$ 6.000,00', { timeout: 10_000 })
  await expect(inv.locator('.fg-leitura')).toContainText('R$ 5.300,00')
  await expect(page.locator('[data-grafico="reserva"] .fg-leitura')).toContainText('Hoje')
  // saldo não é fluxo: o fluxo do mês não mudou por causa dele
  await expect(page.locator('[data-grafico="fluxo"] .fg-leitura')).not.toContainText('6.000')
  // e não aparece como coisa a pagar/receber na lista
  await page.getByRole('tab', { name: 'Lançamentos' }).click()
  await page.locator('.fin-listahead .proj-tab', { hasText: 'todos' }).click()
  const linha = page.locator('.fin-tabela tr', { hasText: 'CDB falso' })
  await expect(linha.locator('.fin-tag.st-posicao')).toHaveText('saldo')
  await expect(linha.locator('.fin-mini.ok')).toHaveCount(0)
  expect(erros, erros.join('\n')).toEqual([])
})
