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

/** Um screenshot por cartão (a página rola dentro de .pad-scroll: o fullPage não pega o que está abaixo). Para a revisão por imagem. */
async function fotosDosCartoes(page: Page, prefixo: string) {
  const cartoes = page.locator('.aion .fg-card')
  const n = await cartoes.count()
  for (let i = 0; i < n; i++) {
    const c = cartoes.nth(i)
    const id = (await c.getAttribute('data-grafico')) || String(i)
    await c.scrollIntoViewIfNeeded()
    await c.screenshot({ path: `${SHOTS}/${prefixo}-${id}.png` })
  }
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
      expect(await page.locator('[data-termo-sem-verbete]').count(), `termo marcado sem verbete em ${t}`).toBe(0)
      await page.screenshot({ path: `${SHOTS}/40-aion-${t}-${w}.png`, fullPage: true })
    }
    // o ativo no tempo (rota própria): gráfico de preço com os marcadores de evento
    await page.goto('/#/aion/ativo/TEST3')
    await expect(page.locator('[data-grafico="ativo-preco"] svg').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `rolagem lateral no ativo (${w})`).toBeLessThanOrEqual(0)
    if (w < 500) expect(await alvosPequenos(page), 'alvos pequenos no ativo').toEqual([])
    await page.screenshot({ path: `${SHOTS}/45-aion-ativo-${w}.png`, fullPage: true })
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

test('Conceito × porquê no mouse: termo abre "O que é" (com o bloco); número abre "Por quê" (com a fonte); ativo abre os dois', async ({ page }) => {
  const { erros, rede } = vigiar(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/aion')
  // termo: sublinhado pontilhado, pop-up "O que é"
  const termo = page.locator('[data-numero="reserva"] [data-termo="reserva"]')
  expect(await termo.evaluate((el) => getComputedStyle(el).textDecorationStyle)).toBe('dotted')
  await termo.hover()
  const pop = page.locator('.ai-pq-pop')
  await expect(pop).toHaveAttribute('data-pop', 'termo')
  await expect(pop.locator('.ai-pq-cab-tit')).toHaveText('O que é · Reserva')
  await expect(pop.locator('[data-oque="reserva"]')).toContainText('emergência')
  await expect(pop.locator('.ai-pq-bloco')).toContainText('bloco 4')
  await expect(pop.locator('[data-tipo-porque]')).toHaveCount(0) // conceito não traz porquê
  await page.screenshot({ path: `${SHOTS}/46-aion-oque-hover-1440.png` })
  await page.mouse.move(2, 2)
  await expect(pop).toHaveCount(0)
  // número: marcador pequeno, pop-up "Por quê", sempre com a fonte do número
  const numero = page.locator('[data-numero="reserva"] [data-porque="reserva"]')
  expect(await numero.evaluate((el) => getComputedStyle(el, '::after').content)).not.toBe('none')
  await numero.hover()
  await expect(pop).toHaveAttribute('data-pop', 'porque')
  await expect(pop.locator('.ai-pq-cab-tit')).toHaveText('Por quê · Reserva')
  await expect(pop.locator('[data-tipo-porque="causa"]')).toContainText('Copom')
  await expect(pop.locator('[data-fonte-numero]')).toContainText('razão da Métis')
  await page.mouse.move(2, 2)
  await expect(pop).toHaveCount(0)
  // o nome do tipo na barra é termo; o valor é número (o desvio da regra)
  await page.locator('[data-tipo="fii"] [data-termo="fii"]').hover()
  await expect(pop).toHaveAttribute('data-pop', 'termo')
  await page.mouse.move(2, 2)
  await expect(pop).toHaveCount(0)
  // ativo inteiro: "O que é" em cima, "Por quê" embaixo
  await page.locator('[data-ativo="TEST3"]').hover()
  await expect(pop).toHaveAttribute('data-pop', 'ativo')
  await expect(pop.locator('.ai-pq-cab-tit')).toHaveText('O que é e por quê · TEST3')
  await expect(pop.locator('[data-oque="TEST3"]')).toContainText('Setor de Teste')
  await expect(pop.locator('[data-oque="TEST3"]')).toContainText('Fabrica peças de teste')
  await expect(pop.locator('[data-parte="porque"] [data-tipo-porque="causa"]')).toContainText('ficou "ex"')
  await expect(pop.locator('[data-parte="porque"] [data-fonte-numero]')).toContainText('brapi')
  const ordem = await pop.evaluate((el) => { const a = el.querySelector('[data-oque]')!, b = el.querySelector('[data-parte="porque"]')!; return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) })
  expect(ordem, '"O que é" vem antes do "Por quê"').toBe(true)
  await page.screenshot({ path: `${SHOTS}/47-aion-ativo-pop-1440.png` })
  await page.mouse.move(2, 2)
  await expect(pop).toHaveCount(0)
  // FII: o que é pelo informe mensal da CVM
  await page.locator('[data-ativo="FUND11"]').hover()
  await expect(page.locator('.ai-pq-pop [data-oque="FUND11"]')).toContainText('segmento "Logística"')
  await page.mouse.move(2, 2)
  await expect(pop).toHaveCount(0)
  // todo "Por quê" da Carteira e da Economia tem a fonte do número
  for (const rota of ['/#/aion', '/#/aion/economia']) {
    await page.goto(rota)
    const alvos = page.locator('.aion .ai-alvo-porque')
    const n = await alvos.count()
    expect(n).toBeGreaterThan(3)
    for (let i = 0; i < n; i++) {
      await alvos.nth(i).scrollIntoViewIfNeeded()
      await alvos.nth(i).hover()
      await expect(page.locator('.ai-pq-pop [data-fonte-numero]'), `fonte no porquê ${i} de ${rota}`).toBeVisible()
      await page.mouse.move(2, 2)
  await expect(pop).toHaveCount(0)
      await expect(page.locator('.ai-pq-pop')).toHaveCount(0)
    }
  }
  expect(erros, erros.join('\n')).toEqual([])
  expect(rede).toEqual([])
})

test('Conceito × porquê no toque: termo e número abrem com um toque; o pop-up cabe na tela', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'pt-BR' })
  const page = await ctx.newPage()
  const { erros, rede } = vigiar(page)
  await page.goto('/#/aion/economia')
  await page.locator('[data-numero="selic"] [data-termo="selic"]').tap()
  const pop = page.locator('.ai-pq-pop')
  await expect(pop).toHaveAttribute('data-pop', 'termo')
  await expect(pop).toContainText('taxa básica de juros')
  const c = await pop.boundingBox()
  expect(c!.x).toBeGreaterThanOrEqual(0)
  expect(c!.x + c!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: `${SHOTS}/48-aion-oque-toque-390.png` })
  await pop.locator('.ai-pq-x').tap()
  await expect(pop).toHaveCount(0)
  await page.locator('[data-numero="selic"] [data-porque="selic"]').tap()
  await expect(pop).toHaveAttribute('data-pop', 'porque')
  await expect(pop.locator('[data-fonte-numero]')).toContainText('SGS 432')
  await pop.locator('.ai-pq-x').tap()
  // no toque, o ativo abre o pop-up (não navega); o botão do pop-up leva ao gráfico
  await page.goto('/#/aion')
  await page.locator('[data-ativo="TEST3"]').tap()
  await expect(pop).toHaveAttribute('data-pop', 'ativo')
  await pop.getByRole('button', { name: 'Ver TEST3 no tempo →' }).tap()
  await expect(page).toHaveURL(/#\/aion\/ativo\/TEST3$/)
  const marcas = page.locator('[data-grafico="ativo-preco"] .ai-marca-ev')
  await expect(marcas.first()).toBeVisible()
  await marcas.last().tap()
  await expect(pop).toHaveAttribute('data-pop', 'porque')
  await expect(pop.locator('[data-fonte-numero]')).toBeVisible()
  expect(erros, erros.join('\n')).toEqual([])
  expect(rede).toEqual([])
  await ctx.close()
})

test('Ativo no tempo: clique (mouse) na Carteira abre o preço com resultado, fato relevante, data com/ex e Copom marcados', async ({ page }) => {
  const { erros, rede } = vigiar(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/aion')
  await page.locator('[data-ativo="TEST3"]').click()
  await expect(page).toHaveURL(/#\/aion\/ativo\/TEST3$/)
  const c = page.locator('[data-grafico="ativo-preco"]')
  await expect(c.locator('.fg-leitura')).toContainText('eventos marcados')
  expect(await c.locator('.ai-marca-ev').count()).toBeGreaterThanOrEqual(4)
  await expect(c.locator('.ai-leg-formas')).toContainText('resultado')
  await expect(c.locator('.ai-leg-formas')).toContainText('Copom')
  const pop = page.locator('.ai-pq-pop')
  await c.locator('[data-porque^="ev-res-TEST3"]').hover()
  await expect(pop).toContainText('resultado divulgado')
  await expect(pop.locator('[data-tipo-porque="fato"]')).toBeVisible()
  await expect(pop).toContainText('Fonte:')
  await page.screenshot({ path: `${SHOTS}/49-aion-ativo-evento-1440.png` })
  await page.mouse.move(2, 2)
  await expect(pop).toHaveCount(0)
  await c.locator('[data-porque^="ev-copom-"]').hover()
  await expect(pop).toContainText('contexto, não prova de causa')
  await page.mouse.move(2, 2)
  await expect(pop).toHaveCount(0)
  // a mira e a dica no hover do gráfico
  await c.locator('.ai-linhas').scrollIntoViewIfNeeded()
  const box = (await c.locator('.ai-linhas').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 4 })
  await expect(c.locator('.fg-dica')).toContainText('fechamento')
  await expect(page.locator('[data-grafico="ativo-oque"]')).toContainText('EMPRESA TESTE S.A.')
  await page.getByRole('button', { name: '← Voltar' }).click()
  await expect(page.getByRole('tab', { name: 'Carteira' })).toHaveAttribute('aria-selected', 'true')
  // FII sem cotação: o gráfico diz o que falta
  await page.goto('/#/aion/ativo/FUND11')
  await expect(page.locator('[data-grafico="ativo-preco"] .fg-leitura')).toContainText('Falta o token da brapi')
  expect(erros, erros.join('\n')).toEqual([])
  expect(rede).toEqual([])
})

test('Gráficos com 1 mês de dado dizem que é 1 mês; Economia em small multiples; Focus semana a semana; sparkline na Observação', async ({ page }) => {
  const { erros, rede } = vigiar(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/aion')
  for (const g of ['patrimonio', 'rendimento']) await expect(page.locator(`[data-grafico="${g}"] [data-pouco-dado]`), g).toContainText('1 mês de dado; o gráfico cresce com o tempo')
  await expect(page.locator('[data-grafico="patrimonio"] .fg-hit')).toHaveCount(1)
  await page.goto('/#/aion/economia')
  const eco = page.locator('[data-grafico="juros-inflacao"]')
  await expect(eco.locator('.ai-multiplo')).toHaveCount(3) // um gráfico por indicador: nunca dois eixos
  for (const s of await eco.locator('.ai-multiplo').all()) expect(await s.locator('svg .fg-eixo').count()).toBe(1)
  // small multiples na mesma escala: o maior rótulo do eixo é o mesmo nos três
  const topos = await eco.locator('.ai-multiplo').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.fg-eixo text')].map((t) => t.textContent).pop()))
  expect(new Set(topos).size).toBe(1)
  const f = page.locator('[data-grafico="focus-semanas"]')
  await expect(f.locator('.ai-multiplo')).toHaveCount(2)
  await expect(f.locator('.fg-legenda').first()).toContainText(String(new Date().getFullYear() + 1))
  await expect(f.locator('.fg-leitura')).toContainText('IPCA de')
  await f.locator('.ai-linhas').first().scrollIntoViewIfNeeded()
  const b = (await f.locator('.ai-linhas').first().boundingBox())!
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.5, { steps: 4 })
  await expect(f.locator('.fg-dica').first()).toContainText('semana de')
  await page.screenshot({ path: `${SHOTS}/50-aion-economia-graficos-1440.png`, fullPage: true })
  await fotosDosCartoes(page, '50-cartao-economia-1440')
  await page.goto('/#/aion')
  await fotosDosCartoes(page, '50-cartao-carteira-1mes-1440')
  await page.goto('/#/aion/ativo/TEST3')
  await fotosDosCartoes(page, '50-cartao-ativo-1440')
  // Observação: a linha de preço e a régua de 52 semanas (OBSV3 foi incluído no teste das escritas)
  await page.goto('/#/aion/observacao')
  await expect(page.locator('[data-ativo="OBSV3"] .ai-spark')).toBeVisible()
  await expect(page.locator('[data-ativo="OBSV3"] .ai-52')).toBeVisible()
  await fotosDosCartoes(page, '50-cartao-observacao-1440')
  expect(erros, erros.join('\n')).toEqual([])
  expect(rede).toEqual([])
})

test('Razão falso estendido para 12 meses: os gráficos crescem, sem aviso de pouco dado, e as metas ganham o caminho', async ({ page }) => {
  const { erros, rede } = vigiar(page)
  gravarPosicoesFalsas(VAULT, new Date(), 12)
  await esperarIndice(page, (i) => i.financeiro.lancamentos.some((l) => l.id.endsWith('-aporte-e2e')))
  for (const [w, h] of [[1440, 900], [390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/#/aion')
    await expect(page.locator('[data-grafico="patrimonio"] .fg-hit')).toHaveCount(12)
    await expect(page.locator('[data-grafico="patrimonio"] [data-pouco-dado]')).toHaveCount(0)
    await expect(page.locator('[data-grafico="rendimento"] [data-pouco-dado]')).toHaveCount(0)
    await expect(page.locator('[data-grafico="rendimento"] [data-serie="carteira"] path')).toHaveCount(1)
    await expect(page.locator('[data-grafico="rendimento"] [data-serie="cdi"] path')).toHaveCount(1)
    await expect(page.locator('[data-grafico="rendimento"] .fg-legenda')).toContainText('base 100')
    expect(await page.locator('[data-grafico="aportes"] .fg-hit').count()).toBeGreaterThanOrEqual(12)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `${SHOTS}/51-aion-carteira-12-meses-${w}.png`, fullPage: true })
    await fotosDosCartoes(page, `51-cartao-12m-${w}`)
    await page.goto('/#/aion/metas')
    await expect(page.locator('[data-grafico="meta-reserva"] [data-serie="real"] path')).toHaveCount(1)
    await expect(page.locator('[data-grafico="meta-reserva"] [data-serie="proj"] path')).toHaveCount(1)
    await expect(page.locator('[data-grafico="meta-reserva"] .fg-legenda')).toContainText('faixa')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `${SHOTS}/52-aion-metas-12-meses-${w}.png`, fullPage: true })
    await fotosDosCartoes(page, `52-cartao-metas-12m-${w}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/aion')
  await page.locator('[data-grafico="patrimonio"] .fg-hit').nth(5).hover()
  await expect(page.locator('[data-grafico="patrimonio"] .fg-dica')).toContainText('total')
  expect(erros, erros.join('\n')).toEqual([])
  expect(rede).toEqual([])
})
