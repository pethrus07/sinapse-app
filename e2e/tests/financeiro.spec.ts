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

test('Financeiro: resumo, lista e o aviso de "sem data"', async ({ page }) => {
  const erros = coletarErros(page)
  await page.goto('/#/financeiro/lancamentos')

  await expect(page.getByRole('heading', { name: /Entra, sai e o que falta receber/ })).toBeVisible()
  await expect(page.locator('.fin-kpi')).toHaveCount(6) // + reserva
  // o seed tem a Retifica sem vencimento definido -> o aviso tem que aparecer
  await expect(page.locator('.fin-nota:not(.alerta)')).toBeVisible()
  await expect(page.locator('.fin-semdata').first()).toBeVisible()
  await expect(page.locator('.fin-tabela tr').first()).toBeVisible()

  // projecao mes a mes + o aviso de que ela e otimista enquanto nao houver saidas
  await expect(page.getByRole('heading', { name: /Projeção mês a mês/ })).toBeVisible()
  await expect(page.locator('.fin-proj tbody tr').first()).toBeVisible()
  // reserva e destinacao: aparece na projecao como coluna propria e NAO no calendario
  await expect(page.locator('.fin-proj td.num.guarda').first()).toBeVisible()
  await page.locator('a[href="#/agenda"]').click()
  await page.getByRole('button', { name: /Painel/ }).click()
  await expect(page.getByText(/Reserva de mudan/)).toHaveCount(0)
  await page.locator('a[href="#/financeiro"]').click()
  await page.getByRole('tab', { name: 'Lançamentos' }).click()
  await expect(page.locator('.fin-proj')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/11-financeiro.png`, fullPage: true })

  expect(erros, erros.join('\n')).toEqual([])
})

test('Financeiro: lança pela interface, aparece no calendário, liquida e remove', async ({ page }) => {
  const erros = coletarErros(page)
  page.on('dialog', (d) => d.accept()) // o remover pede confirmação

  // descricao unica por rodada: residuo de uma rodada morta nunca colide com esta,
  // e o toHaveCount(1) volta a ser uma afirmacao honesta
  const MARCA = 'TESTE e2e ' + Date.now()
  const DESC = MARCA + ' · lançamento com acentuação'
  await page.goto('/#/financeiro/lancamentos')

  // esperar a tabela renderizar antes de contar, senao a contagem sai 0 (corrida com o React)
  await expect(page.locator('.fin-tabela tr').first()).toBeVisible()

  // auto-limpeza: se uma rodada anterior morreu no meio, o residuo dela nao pode
  // contaminar as contagens desta
  await page.locator('.fin-listahead .proj-tab', { hasText: 'todos' }).click()
  for (let i = 0; i < 10; i++) {
    const sujo = page.locator('.fin-tabela tr', { hasText: 'TESTE e2e' })
    if (!(await sujo.count())) break
    await sujo.first().locator('.fin-mini.del').click()
    await expect(sujo).toHaveCount(0, { timeout: 5000 }).catch(() => {})
  }
  await page.locator('.fin-listahead .proj-tab', { hasText: 'abertos' }).click()
  const antes = await page.locator('.fin-tabela tr').count()

  // --- lança uma ENTRADA com vencimento
  await page.locator('.fin-tbtn.entrada').click()
  await page.locator('.fin-campo', { hasText: 'O que é' }).locator('input').fill(DESC)
  await page.locator('.fin-campo', { hasText: 'Valor' }).locator('input').fill('123,45')
  // vencimento daqui a 15 dias: o Painel da agenda só mostra o que vem pela frente (data fixa no
  // passado fazia o teste quebrar sozinho quando o calendário andava)
  const venc = new Date()
  venc.setDate(venc.getDate() + 15)
  await page.locator('input[type="date"]').fill(venc.toISOString().slice(0, 10))
  await page.locator('.fin-campo', { hasText: 'Cliente' }).locator('input').fill('Cliente ' + MARCA)
  await page.locator('.fin-salvar').click()

  const linha = page.locator('.fin-tabela tr', { hasText: MARCA })
  await expect(linha).toHaveCount(1)
  // acentuação sobreviveu ao ir e voltar do vault
  await expect(linha).toContainText('acentuação')
  await expect(linha).toContainText('R$ 123,45')
  await expect(linha.locator('.fin-tag.st-a-receber')).toBeVisible()
  await expect(page.locator('.fin-tabela tr')).toHaveCount(antes + 1)

  // --- vencimento aberto tem que ter chegado no calendário (fonte única de data)
  await page.locator('a[href="#/agenda"]').click()
  await page.getByRole('button', { name: /Painel/ }).click()
  await expect(page.getByText('Receber R$ 123,45 · Cliente ' + MARCA).first()).toBeVisible()

  // --- liquida: sai do calendário e muda de status
  await page.locator('a[href="#/financeiro"]').click()
  await page.getByRole('tab', { name: 'Lançamentos' }).click()
  await page.locator('.fin-listahead .proj-tab', { hasText: 'todos' }).click()
  await page.locator('.fin-tabela tr', { hasText: MARCA }).locator('.fin-mini.ok').click()
  await expect(page.locator('.fin-tabela tr', { hasText: MARCA }).locator('.fin-tag.st-recebido')).toBeVisible()

  await page.locator('a[href="#/agenda"]').click()
  await page.getByRole('button', { name: /Painel/ }).click()
  await expect(page.getByText('Receber R$ 123,45 · Cliente ' + MARCA)).toHaveCount(0)

  // --- remove e volta ao estado original (o teste limpa o que sujou)
  await page.locator('a[href="#/financeiro"]').click()
  await page.getByRole('tab', { name: 'Lançamentos' }).click()
  await page.locator('.fin-listahead .proj-tab', { hasText: 'todos' }).click()
  await page.locator('.fin-tabela tr', { hasText: MARCA }).locator('.fin-mini.del').click()
  await expect(page.locator('.fin-tabela tr', { hasText: MARCA })).toHaveCount(0)

  expect(erros, erros.join('\n')).toEqual([])
})

test('Financeiro: recusa lançamento sem descrição ou com valor inválido', async ({ page }) => {
  const erros = coletarErros(page)
  await page.goto('/#/financeiro/lancamentos')

  await page.locator('.fin-salvar').click()
  await expect(page.locator('.fin-erro')).toContainText('Escreve o que é')

  await page.locator('.fin-campo', { hasText: 'O que é' }).locator('input').fill('sem valor')
  await page.locator('.fin-campo', { hasText: 'Valor' }).locator('input').fill('abc')
  await page.locator('.fin-salvar').click()
  await expect(page.locator('.fin-erro')).toContainText('número maior que zero')

  expect(erros, erros.join('\n')).toEqual([])
})
