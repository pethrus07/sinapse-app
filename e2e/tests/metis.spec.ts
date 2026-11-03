import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Métis: fila "a classificar" (com "lembrar para os próximos" gravando a regra no regras.json da
// pasta TEMPORÁRIA, nunca no %LOCALAPPDATA% real nem no repo), saldo lançado à mão (cripto) e a
// marca de pontual. Tudo sobre o razão falso da cópia do vault.
const TMP = process.env.SINAPSE_E2E_TMP
if (!TMP) throw new Error('SINAPSE_E2E_TMP ausente: rode pelo playwright.config (npm test em e2e/)')
const REGRAS = join(TMP, 'financas', 'regras', 'regras.json')
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

test('Fila "a classificar": um toque na categoria, e "lembrar" grava a regra só no arquivo local', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro')
  // o aviso da Visão leva para a fila
  await page.locator('[data-aviso="a-classificar"]').getByRole('button', { name: 'Classificar' }).click()
  await expect(page.getByRole('tab', { name: 'Lançamentos' })).toHaveAttribute('aria-selected', 'true')
  const fila = page.locator('.mt-fila')
  await expect(fila.locator('h3')).toContainText('A classificar')
  await expect(fila.locator('.mt-fila-lista li')).toHaveCount(1)
  await fila.locator('.mt-fila-item').click()
  await expect(fila.locator('.mt-chip', { hasText: 'mercado' })).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/24-metis-fila-1440.png` })
  await fila.locator('.mt-chip', { hasText: 'mercado' }).click()

  await expect(page.locator('.mt-fila')).toHaveCount(0) // fila vazia some
  const regras = JSON.parse(readFileSync(REGRAS, 'utf8'))
  expect(regras.regras[0].quando).toEqual({ texto: 'loja falsa e2e', direcao: 'saida' })
  expect(regras.regras[0].categoria).toBe('mercado')
  // o lançamento foi reclassificado no razão (da cópia) e o aviso sumiu
  await page.getByRole('tab', { name: 'Visão' }).click()
  await expect(page.locator('[data-aviso="a-classificar"]')).toHaveCount(0)
  expect(existsSync(REGRAS)).toBe(true)
  expect(erros, erros.join('\n')).toEqual([])
})

test('Saldo à mão (cripto) entra no patrimônio; marcar um gasto como pontual tira do recorrente', async ({ page }) => {
  const erros = coletarErros(page)
  page.on('dialog', (d) => d.accept())
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro/lancamentos')
  const MARCA = 'Moeda e2e ' + Date.now()
  await page.locator('.fin-tbtn.saldo').click()
  await page.locator('.fin-campo', { hasText: 'O que é' }).locator('input').fill(MARCA)
  await page.locator('.fin-campo', { hasText: 'Saldo (R$)' }).locator('input').fill('250,00')
  await page.locator('.fin-campo', { hasText: 'Onde está' }).locator('input').fill('Carteira falsa')
  await expect(page.locator('.fin-campo', { hasText: 'Classe' }).locator('select')).toHaveValue('cripto')
  await page.locator('.fin-salvar').click()
  await page.locator('.fin-listahead .proj-tab', { hasText: 'todos' }).click()
  const linha = page.locator('.fin-tabela tr', { hasText: MARCA })
  await expect(linha.locator('.fin-tag.st-posicao')).toHaveText('saldo')

  await page.getByRole('tab', { name: 'Visão' }).click()
  const pat = page.locator('[data-grafico="patrimonio"]')
  await expect(pat.locator('.fg-leitura')).toContainText('R$ 250,00')
  await expect(pat.locator('.fg-legenda').first()).toContainText('Cripto')

  // pontual: o gasto de transporte do mês passado vira pontual e sai do recorrente
  const rec = page.locator('[data-grafico="recorrente"] .fg-numeros')
  const antes = await rec.innerText()
  await page.getByRole('tab', { name: 'Lançamentos' }).click()
  await page.locator('.fin-listahead .proj-tab', { hasText: 'todos' }).click()
  const transp = page.locator('.fin-tabela tr', { hasText: 'Gasto falso · transporte' }).filter({ hasText: '210,00' })
  await transp.locator('.fin-mini.pontual').click()
  await expect(transp.locator('.fin-tag', { hasText: 'pontual' })).toBeVisible()
  await page.getByRole('tab', { name: 'Visão' }).click()
  await expect(rec).not.toHaveText(antes)
  await expect(rec).toContainText('R$ 1.710,00') // TV 1.500 + transporte 210
  // desfaz e limpa
  await page.getByRole('tab', { name: 'Lançamentos' }).click()
  await page.locator('.fin-listahead .proj-tab', { hasText: 'todos' }).click()
  await transp.locator('.fin-mini.pontual').click()
  await expect(transp.locator('.fin-tag', { hasText: 'pontual' })).toHaveCount(0)
  await page.locator('.fin-tabela tr', { hasText: MARCA }).locator('.fin-mini.del').click()
  await expect(page.locator('.fin-tabela tr', { hasText: MARCA })).toHaveCount(0)
  expect(erros, erros.join('\n')).toEqual([])
})
