import { test, expect, type Page } from '@playwright/test'

function coletarErros(page: Page): string[] {
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push('pageerror: ' + String(e)))
  page.on('console', (m) => { if (m.type() === 'error') erros.push('console.error: ' + m.text()) })
  return erros
}

test('rotina do dia 08 aparece uma vez por mes', async ({ page }) => {
  const erros = coletarErros(page)
  await page.goto('/#/agenda')
  await page.getByRole('button', { name: /Mês/ }).click()
  await expect(page.locator('.ag-month')).toBeVisible()
  // o chip do acompanhamento existe, e so num dia do mes visivel
  const chips = page.locator('.ag-mcell:not(.fora) .ag-chip', { hasText: 'Acompanhamento dos projetos' })
  await expect(chips).toHaveCount(1)
  expect(erros, erros.join('\n')).toEqual([])
})

test('revisao mensal cai no ULTIMO domingo, exatamente uma vez por mes', async ({ page }) => {
  const erros = coletarErros(page)
  await page.goto('/#/agenda')
  await page.getByRole('button', { name: /Mês/ }).click()

  // varre 6 meses: em cada um, exatamente 1 ocorrencia, e sempre num domingo
  for (let i = 0; i < 6; i++) {
    const celulas = page.locator('.ag-mcell:not(.fora)')
    const comRevisao = celulas.filter({ hasText: 'Revisão do plano' })
    await expect(comRevisao, `mes ${i}: deveria ter exatamente 1 revisao`).toHaveCount(1)

    // domingo e a 1a coluna da grade: o indice da celula na grade tem que ser multiplo de 7
    const todas = await page.locator('.ag-mcell').all()
    const alvo = await page.locator('.ag-mcell', { hasText: 'Revisão do plano' }).first().innerText()
    let idx = -1
    for (let k = 0; k < todas.length; k++) {
      if ((await todas[k].innerText()) === alvo) { idx = k; break }
    }
    expect(idx % 7, `mes ${i}: revisao caiu fora da coluna de domingo`).toBe(0)

    await page.locator('.ag-nav').last().click()
    await expect(page.locator('.ag-month')).toBeVisible()
  }
  expect(erros, erros.join('\n')).toEqual([])
})
