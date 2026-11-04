import { test, expect, type Browser, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ARQ_POSICOES, gravarPosicoesFalsas } from '../fixtures/aion-falso'

// Aion (investimentos): as 8 telas em 1440 e 390 sem erro de console, sem rolagem lateral e com
// alvo de toque ≥ 44 px; o pop-up do porquê no hover e no toque; e as escritas (observação, regra,
// estudo) só na CÓPIA do vault. Mercado falso (fixtures/aion-falso.ts, SINAPSE_AION temporário) e
// a rede de mercado bloqueada e contada: o app não pode chamar BCB, brapi, CoinGecko nem CVM.
const TMP = process.env.SINAPSE_E2E_TMP
const VAULT = process.env.SINAPSE_E2E_VAULT
if (!TMP || !VAULT) throw new Error('SINAPSE_E2E_TMP ausente: rode pelo playwright.config (npm test em e2e/)')
const SHOTS = 'shots'
mkdirSync(SHOTS, { recursive: true })
const TELAS = ['carteira', 'porques', 'observacao', 'simular', 'metas', 'economia', 'estudo', 'regra']
const MERCADO = /api\.bcb\.gov\.br|olinda\.bcb\.gov\.br|bcb\.gov\.br\/api|brapi\.dev|coingecko\.com|dados\.cvm\.gov\.br/
const AION_ARQS = ['aion-observacao.md', 'aion-regra.md', 'aion-metas.md', 'aion-estudo.md'].map((f) => join(VAULT, '04-NEGOCIO', 'financeiro', f))

function vigiar(page: Page) {
  const erros: string[] = []
  const rede: string[] = []
  page.on('pageerror', (e) => erros.push('pageerror: ' + String(e)))
  page.on('console', (m) => { if (m.type() === 'error') erros.push('console.error: ' + m.text()) })
  page.route(MERCADO, (r) => { rede.push(r.request().url()); return r.abort() })
  return { erros, rede }
}

async function esperarIndice(page: Page, quer: (idx: { financeiro: { lancamentos: { id: string }[] } }) => boolean) {
  await expect.poll(async () => quer(await (await page.request.get('/api/indice')).json()), { timeout: 15_000 }).toBe(true)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  gravarPosicoesFalsas(VAULT)
  const p = await browser.newPage()
  await esperarIndice(p, (i) => i.financeiro.lancamentos.some((l) => l.id.endsWith('-inv-fii')))
  await p.close()
})

test.afterAll(async ({ browser }) => {
  // o resto da suíte (Métis) não pode ver as posições do Aion nem os arquivos que ele gravou
  rmSync(join(VAULT, ARQ_POSICOES), { force: true })
  for (const f of AION_ARQS) rmSync(f, { force: true })
  const p = await browser.newPage()
  await esperarIndice(p, (i) => !i.financeiro.lancamentos.some((l) => l.id.endsWith('-inv-fii')))
  await p.close()
})

async function alvosPequenos(page: Page) {
  return page.evaluate(() => {
    const sel = '.aion :is(button, a[href], select, input, textarea, summary, [role="button"], [role="tab"])'
    return [...document.querySelectorAll<HTMLElement>(sel)]
      // dentro de <details> fechado não está à vista (o Chromium ainda dá caixa a esses filhos)
      .filter((el) => {
        for (let a = el.parentElement; a; a = a.parentElement) {
          if (a.tagName === 'DETAILS' && !(a as HTMLDetailsElement).open && !(el.tagName === 'SUMMARY' && el.parentElement === a)) return false
        }
        return true
      })
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null && !el.closest('.ai-pq-pop') })
      .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 44 || r.width < 24 })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`)
  })
}

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  test(`as oito telas em ${w}: sem erro, sem rolagem lateral${w < 500 ? ', alvo de toque ≥ 44 px' : ''}`, async ({ browser }) => {
    const ctx = await (browser as Browser).newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', ...(w < 500 ? { hasTouch: true, isMobile: true } : {}) })
    const page = await ctx.newPage()
    const { erros, rede } = vigiar(page)
    for (const t of TELAS) {
      await page.goto(`/#/aion/${t}`)
      await expect(page.locator('.aion .mt-abas [aria-selected="true"]')).toHaveCount(1)
      await expect(page.locator('.aion .fg-card').first()).toBeVisible()
      const lateral = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(lateral, `rolagem lateral em ${t} (${w})`).toBeLessThanOrEqual(0)
      if (w < 500) expect(await alvosPequenos(page), `alvos pequenos em ${t}`).toEqual([])
      await page.screenshot({ path: `${SHOTS}/40-aion-${t}-${w}.png`, fullPage: true })
    }
    expect(erros, erros.join('\n')).toEqual([])
    expect(rede, 'o app chamou a rede de mercado').toEqual([])
    await ctx.close()
  })
}

test('Carteira: posições falsas por tipo, reserva × piso, renda passiva, rendimento × CDI e IPCA', async ({ page }) => {
  const { erros } = vigiar(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/aion')
  await expect(page.locator('.eyebrow-mono')).toHaveText('Aion')
  await expect(page.locator('[data-numero="total"]')).toContainText('R$ 6.000,00')
  await expect(page.locator('[data-numero="reserva"]')).toContainText('R$ 3.000,00')
  await expect(page.locator('[data-numero="reserva"]')).toContainText('faltam R$ 2.000,00')
  await expect(page.locator('[data-numero="fora"]')).toContainText('R$ 3.000,00')
  await expect(page.locator('[data-numero="renda-passiva"]')).toContainText('R$ 12,50')
  await expect(page.locator('[data-grafico="por-tipo"]')).toContainText('Sem regra escrita')
  await expect(page.locator('[data-grafico="rendimento"]')).toContainText('3,45%') // 100 / 2.900
  await expect(page.locator('[data-grafico="ativos"]')).toContainText('sem cotação: falta o token da brapi')
  expect(erros).toEqual([])
})

test('Porquê no hover (mouse): causa com fonte e data, link para o bloco da trilha; sem notícia dito com todas as letras', async ({ page }) => {
  const { erros } = vigiar(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/aion')
  await page.locator('[data-porque="TEST3"]').hover()
  const pop = page.locator('.ai-pq-pop')
  await expect(pop).toBeVisible()
  await expect(pop.locator('[data-tipo-porque="causa"]')).toContainText('ficou "ex"')
  await expect(pop.locator('[data-tipo-porque="fato"]').first()).toContainText('fato relevante')
  await expect(pop).toContainText('Fonte:')
  await expect(pop).toContainText('notícia em tempo real: fonte ainda não escolhida')
  await page.screenshot({ path: `${SHOTS}/41-aion-porque-hover-1440.png` })
  await page.mouse.move(2, 2)
  await expect(pop).toHaveCount(0)
  await page.locator('[data-porque="FUND11"]').hover()
  await expect(page.locator('.ai-pq-pop [data-sem-noticia]')).toContainText('Sem notícia específica')
  await expect(page.locator('.ai-pq-pop')).toContainText('precisa do token da brapi')
  // a Selic na Economia: causa (Copom) e opinião com o nome de quem disse; o link leva ao bloco 2
  await page.goto('/#/aion/economia')
  await page.locator('[data-porque="selic"]').hover()
  await expect(page.locator('.ai-pq-pop [data-tipo-porque="opiniao"]')).toContainText('Comitê de Política Monetária')
  await page.locator('.ai-pq-pop .ai-pq-bloco').first().click()
  await expect(page.getByRole('tab', { name: 'Estudo' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.ai-bloco.foco')).toHaveCount(1)
  expect(erros).toEqual([])
})

test('Porquê no toque (celular): abre com um toque, fecha no ×', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'pt-BR' })
  const page = await ctx.newPage()
  const { erros } = vigiar(page)
  await page.goto('/#/aion')
  await page.locator('[data-porque="reserva"]').tap()
  const pop = page.locator('.ai-pq-pop')
  await expect(pop).toBeVisible()
  await expect(pop.locator('[data-tipo-porque="causa"]')).toContainText('Copom')
  const caixa = await pop.boundingBox()
  expect(caixa!.x).toBeGreaterThanOrEqual(0)
  expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: `${SHOTS}/42-aion-porque-toque-390.png` })
  await pop.locator('.ai-pq-x').tap()
  await expect(pop).toHaveCount(0)
  await page.locator('[data-porque="TEST3"]').tap()
  await expect(page.locator('.ai-pq-pop')).toContainText('TEST3')
  expect(erros).toEqual([])
  await ctx.close()
})

test('Escritas só na cópia: observação, regra (a Carteira passa a mostrar o desvio) e progresso do estudo', async ({ page }) => {
  const { erros } = vigiar(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  // lista de observação
  await page.goto('/#/aion/observacao')
  const card = page.locator('[data-grafico="observacao"]')
  await card.locator('.fin-campo', { hasText: 'Código' }).locator('input').fill('obsv3')
  await card.getByRole('button', { name: 'Incluir' }).click()
  await expect(card.locator('[data-porque="OBSV3"]')).toContainText('R$ 20,00')
  await expect(card.locator('[data-porque="OBSV3"]')).toContainText('P/L')
  const obs = readFileSync(AION_ARQS[0], 'utf8')
  expect(obs).toContain('"codigo": "OBSV3"')
  // regra: sem regra a tela explica; o modelo nasce vazio; soma diferente de 100% é recusada
  await page.goto('/#/aion/regra')
  await expect(page.locator('[data-grafico="sem-regra"]')).toContainText('bloco 11')
  await page.getByRole('button', { name: 'Começar do modelo vazio' }).click()
  const ed = page.locator('[data-grafico="editor-regra"]')
  const alvo = (tipo: string) => ed.locator('fieldset', { hasText: tipo }).locator('.fin-campo', { hasText: 'Alvo' }).locator('input')
  await alvo('Fundos imobiliários').fill('50')
  await alvo('Ações').fill('30')
  await ed.getByRole('button', { name: 'Salvar a regra' }).click()
  await expect(ed.locator('.fin-erro')).toContainText('somam 80%')
  await alvo('Cripto').fill('20')
  await ed.locator('.fin-campo', { hasText: 'O que não fazer' }).locator('textarea').fill('não tirar da reserva para comprar ação')
  await ed.getByRole('button', { name: 'Salvar a regra' }).click()
  await expect(page.locator('[data-grafico="regra"]')).toContainText('não tirar da reserva')
  expect(readFileSync(AION_ARQS[1], 'utf8')).toContain('"alvo": 50')
  await page.getByRole('tab', { name: 'Carteira' }).click()
  // FII 50% (alvo 50), ação 16,7% (alvo 30: abaixo), cripto 33,3% (alvo 20: acima)
  await expect(page.locator('[data-grafico="por-tipo"]')).toContainText('2 de 3 tipos fora da faixa')
  await expect(page.locator('[data-porque="cripto"]')).toContainText('acima do alvo')
  // estudo
  await page.getByRole('tab', { name: 'Estudo' }).click()
  await page.getByLabel('Progresso do bloco 1', { exact: true }).selectOption('estudando')
  await expect(page.locator('[data-bloco="1"]')).toHaveAttribute('data-progresso', 'estudando')
  expect(readFileSync(AION_ARQS[3], 'utf8')).toContain('"1": "estudando"')
  expect(existsSync(AION_ARQS[3])).toBe(true)
  await page.screenshot({ path: `${SHOTS}/43-aion-estudo-1440.png` })
  expect(erros).toEqual([])
})

test('Simular: "e se" muda a faixa; antes × depois; premissas à vista em Mais opções', async ({ page }) => {
  const { erros } = vigiar(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/aion/simular')
  const c = page.locator('[data-grafico="e-se"]')
  await expect(c.locator('.fg-titulo')).toHaveText('Daqui a 1, 3 e 5 anos')
  const antes = await c.locator('.fg-leitura').innerText()
  await c.locator('.fin-campo', { hasText: 'Aportar a mais' }).locator('input').fill('300')
  await expect(c.locator('.fg-titulo')).toHaveText('Antes × depois do "e se"')
  await expect(c.locator('.fg-leitura')).not.toHaveText(antes)
  await expect(c.locator('.ai-horizontes tbody tr')).toHaveCount(3)
  await c.locator('.fg-mais > summary').last().click()
  await expect(c.locator('[data-premissas]')).toContainText('tabela regressiva')
  await expect(c.locator('[data-premissas]')).toContainText('mediana do Focus')
  await page.screenshot({ path: `${SHOTS}/44-aion-simular-e-se-1440.png`, fullPage: true })
  expect(erros).toEqual([])
})
