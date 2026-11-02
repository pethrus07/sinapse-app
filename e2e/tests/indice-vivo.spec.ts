import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Regressao do bug: o JSON empacotado (src/data) esta em server.watch.ignored, entao o
// Vite servia do cache e QUALQUER reindex fora da sessao (CLI, edicao do .md na mao,
// outra aba) ficava invisivel no navegador. O app tem que ler o indice vivo.

// Grava na CÓPIA temporária do vault que o playwright.config monta (SINAPSE_E2E_VAULT),
// nunca no vault real.
const VAULT = process.env.SINAPSE_E2E_VAULT
if (!VAULT) throw new Error('SINAPSE_E2E_VAULT ausente: rode pelo playwright.config (npm test em e2e/)')
const ARQUIVO = join(VAULT, '00-INBOX', '_teste-e2e-evento.md')

function coletarErros(page: Page): string[] {
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push('pageerror: ' + String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push('console.error: ' + m.text())
  })
  return erros
}

test.afterEach(() => {
  if (existsSync(ARQUIVO)) rmSync(ARQUIVO)
})

test('nota criada fora do app aparece sem reiniciar o servidor', async ({ page }) => {
  const erros = coletarErros(page)
  const MARCA = 'Evento de teste ' + Date.now()

  await page.goto('/#/agenda')
  await expect(page.locator('.ag-week')).toBeVisible()
  await page.getByRole('button', { name: /Painel/ }).click()
  await expect(page.getByText(MARCA)).toHaveCount(0)

  // nota com `quando:` escrita direto no vault, como se eu tivesse usado o editor
  const daqui30 = new Date()
  daqui30.setDate(daqui30.getDate() + 30)
  const dia = daqui30.toISOString().slice(0, 10)
  writeFileSync(
    ARQUIVO,
    `---\ntipo: nota\narea: inbox\nquando: ${dia}\nfrente: pessoal\n---\n\n# ${MARCA}\n\nCriada pelo teste e2e.\n`,
    'utf8',
  )

  // o watcher reindexa (debounce 400ms) e a volta do foco revalida
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  await expect(page.getByText(MARCA).first()).toBeVisible({ timeout: 10_000 })

  expect(erros, erros.join('\n')).toEqual([])
})
