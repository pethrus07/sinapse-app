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
  await expect(page.locator('.card').first()).toBeVisible()
  await page.locator('.card').first().click()
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
