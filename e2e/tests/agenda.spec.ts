import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

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

test('Agenda: as três abas montam sem erro de runtime (+ screenshots)', async ({ page }) => {
  const erros = coletarErros(page)
  await page.goto('/#/agenda')

  // --- semana: grade de rótulo + 7 dias, com as faixas e a linha de daily
  await expect(page.locator('.ag-week')).toBeVisible()
  await expect(page.locator('.ag-whead')).toHaveCount(7)
  for (const rot of ['Datas', 'Dia', 'Noite', 'Livre', 'Daily']) {
    await expect(page.locator('.ag-wlabel', { hasText: rot }).first()).toBeVisible()
  }
  // hoje está destacado exatamente uma vez no cabeçalho da semana atual
  await expect(page.locator('.ag-whead.hoje')).toHaveCount(1)
  // trabalho e aula entram como bloco intermediável
  await expect(page.locator('.ag-inter').first()).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/8-agenda-semana.png`, fullPage: true })

  // navegação de semana não quebra a grade
  await page.locator('.ag-nav').last().click()
  await expect(page.locator('.ag-week')).toBeVisible()
  await expect(page.locator('.ag-hoje')).toBeVisible()
  await page.locator('.ag-hoje').click()
  await expect(page.locator('.ag-whead.hoje')).toHaveCount(1)

  // --- mês: 7 cabeçalhos + 42 células
  await page.getByRole('button', { name: /Mês/ }).click()
  await expect(page.locator('.ag-month')).toBeVisible()
  await expect(page.locator('.ag-mdow')).toHaveCount(7)
  await expect(page.locator('.ag-mcell')).toHaveCount(42)
  await page.screenshot({ path: `${SHOTS}/9-agenda-mes.png`, fullPage: true })

  // --- painel: marcos, capacidade da semana e a lista com data
  await page.getByRole('button', { name: /Painel/ }).click()
  await expect(page.getByText('Próximos marcos')).toBeVisible()
  await expect(page.locator('.ag-marco').first()).toBeVisible()
  await expect(page.locator('.ag-capdia')).toHaveCount(7)
  await expect(page.getByText('Recorrências ativas')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/10-agenda-painel.png`, fullPage: true })

  expect(erros, erros.join('\n')).toEqual([])
})

test('Agenda: um marco do painel abre a nota de origem', async ({ page }) => {
  const erros = coletarErros(page)
  await page.goto('/#/agenda')
  await page.getByRole('button', { name: /Painel/ }).click()
  // marco do financeiro ("Pagar/Receber R$ …" do razão falso) não tem nota: quando a fatura falsa
  // vence antes de qualquer marco de nota, o primeiro marco não abria nada e o teste quebrava
  await page.locator('.ag-marco').filter({ hasNotText: /(Pagar|Receber) R\$/ }).first().click()
  await expect(page).toHaveURL(/#\/note\//)
  await expect(page.locator('.main')).toBeVisible()
  expect(erros, erros.join('\n')).toEqual([])
})
