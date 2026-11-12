import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const SHOTS = 'shots'
mkdirSync(SHOTS, { recursive: true })

// coleta erros de runtime (pageerror + console.error) — sinal forte de QA
function coletarErros(page: Page): string[] {
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push('pageerror: ' + String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push('console.error: ' + m.text())
  })
  return erros
}

test('carrega e navega todas as views sem erro de runtime (+ screenshots)', async ({ page }) => {
  const erros = coletarErros(page)
  await page.goto('/')

  // marca + as áreas novas de hoje na sidebar
  await expect(page.locator('.brand-name')).toHaveText('Sinapse')
  await expect(page.locator('a[href="#/area/crescimento"]')).toBeVisible()
  await expect(page.locator('a[href="#/area/estudo"]')).toBeVisible()
  await expect(page.locator('a[href="#/area/projetos"]')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/1-roadmap.png`, fullPage: true })

  await page.locator('a[href="#/projetos"]').click()
  await expect(page.locator('.main')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/2-projetos.png`, fullPage: true })

  await page.locator('a[href="#/arvore"]').click()
  await expect(page.locator('.main')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/3-arvore.png`, fullPage: true })

  await page.locator('a[href="#/grafo"]').click()
  await page.waitForTimeout(1800) // d3 assenta
  await page.screenshot({ path: `${SHOTS}/4-grafo.png`, fullPage: true })

  // Skill Tree (nova view — ramos por domínio)
  await page.locator('a[href="#/skills"]').click()
  // titulo da view, nao o item do nav (getByText casaria com os dois)
  await expect(page.getByRole('heading', { name: 'Skill Tree' })).toBeVisible()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOTS}/7-skills.png`, fullPage: true })

  expect(erros, erros.join('\n')).toEqual([])
})

test('abre a área Crescimento e uma nota (wikilinks) sem erro', async ({ page }) => {
  const erros = coletarErros(page)
  await page.goto('/#/area/crescimento')
  await expect(page.locator('.area-card').first()).toBeVisible()
  await page.locator('.area-card').first().click()
  await expect(page).toHaveURL(/#\/note\//)
  await expect(page.locator('.main')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/5-nota.png`, fullPage: true })
  expect(erros, erros.join('\n')).toEqual([])
})

test('busca funciona', async ({ page }) => {
  const erros = coletarErros(page)
  await page.goto('/')
  await page.locator('.search input').fill('fala')
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOTS}/6-busca.png`, fullPage: true })
  expect(erros, erros.join('\n')).toEqual([])
})

test('legenda do grafo, área aberta na árvore e ficha da Skill Tree', async ({ page }) => {
  const erros = coletarErros(page)
  // grafo: legenda com uma linha por área; clique destaca e marca a área
  await page.goto('/#/grafo')
  await expect(page.locator('.graph-legenda')).toBeVisible()
  const linhas = page.locator('.gl-area')
  expect(await linhas.count()).toBeGreaterThan(3)
  await linhas.first().click()
  await expect(linhas.first()).toHaveClass(/on/)
  await expect(linhas.nth(1)).toHaveClass(/off/)
  await page.screenshot({ path: `${SHOTS}/8-grafo-legenda.png` })

  // árvore: abre fechada (só áreas); clique numa área mostra os grupos por estado
  await page.goto('/#/arvore')
  await expect(page.locator('.tw-area').first()).toBeVisible()
  expect(await page.locator('.tw-leaf').count()).toBe(0)
  await page.locator('.tw-area', { hasText: 'Projetos' }).click()
  await expect(page.locator('.tw-grupo').first()).toBeVisible()
  expect(await page.locator('.tw-leaf').count()).toBeGreaterThan(0)
  await page.screenshot({ path: `${SHOTS}/9-arvore-aberta.png` })

  // skill tree: clique num domínio abre a ficha com as habilidades; o X fecha
  await page.goto('/#/skills')
  await page.locator('.sk-dom').first().click()
  await expect(page.locator('.sk-ficha')).toBeVisible()
  expect(await page.locator('.sk-item').count()).toBeGreaterThan(0)
  await page.screenshot({ path: `${SHOTS}/10-skills-ficha.png` })
  await page.getByRole('button', { name: 'Fechar' }).click()
  await expect(page.locator('.sk-ficha')).toHaveCount(0)

  expect(erros, erros.join('\n')).toEqual([])
})

test('grafo no tempo, fluxo da Métis e mapa de clientes', async ({ page }) => {
  const erros = coletarErros(page)
  // grafo no tempo: voltar a barra mostra menos notas que hoje; "hoje" volta tudo
  await page.goto('/#/grafo')
  const barra = page.locator('.graph-tempo input[type=range]')
  await expect(barra).toBeVisible()
  const total = Number((await page.locator('.gt-data b').innerText()).trim())
  await barra.fill('10')
  const antes = Number((await page.locator('.gt-data b').innerText()).trim())
  expect(antes).toBeLessThan(total)
  await page.locator('.gt-hoje').click()
  await expect(page.locator('.gt-data')).toContainText('hoje')
  await page.screenshot({ path: `${SHOTS}/11-grafo-tempo.png` })

  // fluxo: a aba existe e desenha o diagrama (ou diz que o mês está vazio)
  await page.goto('/#/financeiro/fluxo')
  await expect(page.locator('[data-grafico="fluxo"]')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/12-metis-fluxo.png` })

  // clientes: lê a nota de clientes do vault e desenha canais e clientes
  await page.goto('/#/clientes')
  await expect(page.getByRole('heading', { name: 'De onde vem o trabalho' })).toBeVisible()
  expect(await page.locator('.cl-canal').count()).toBeGreaterThan(0)
  expect(await page.locator('.cl-cli').count()).toBeGreaterThan(0)
  await page.screenshot({ path: `${SHOTS}/13-clientes.png`, fullPage: true })

  expect(erros, erros.join('\n')).toEqual([])
})
