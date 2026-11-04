import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` // dia local, como o app

// Métis v2 (o módulo financeiro): as sete páginas sobre o razão FALSO que o playwright.config grava
// na cópia do vault (e2e/fixtures/financeiro-falso.ts). Nada aqui lê ou grava o vault real.
// Números do razão falso no mês passado (o foco padrão): fixo 540 (moradia 500 + assinatura 40),
// variável 1.102,50 (mercado 700, transporte 210, alimentação 150, a classificar 42,50), pontual 1.500.
const VAULT = process.env.SINAPSE_E2E_VAULT
if (!VAULT) throw new Error('SINAPSE_E2E_VAULT ausente: rode pelo playwright.config (npm test em e2e/)')
const INV = join(VAULT, '04-NEGOCIO', 'financeiro', '_teste-investimento.md')
const PAT = join(VAULT, '04-NEGOCIO', 'financeiro', 'patrimonio.md')
const ORC = join(VAULT, '04-NEGOCIO', 'financeiro', 'orcamento.md')
const SHOTS = 'shots'
mkdirSync(SHOTS, { recursive: true })

const PAGINAS = [
  ['visao', '/#/financeiro'], ['gastos', '/#/financeiro/gastos'], ['entradas', '/#/financeiro/entradas'],
  ['patrimonio', '/#/financeiro/patrimonio'], ['pronoia', '/#/financeiro/pronoia'], ['plano', '/#/financeiro/plano'],
  ['lancamentos', '/#/financeiro/lancamentos'],
] as const

function coletarErros(page: Page): string[] {
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push('pageerror: ' + String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push('console.error: ' + m.text())
  })
  return erros
}

async function fotoInteira(page: Page, arq: string, largura: number) {
  // .pad-scroll rola por dentro: a página inteira só sai com a janela da altura do conteúdo
  await page.mouse.move(0, 0)
  const alt = await page.evaluate(() => (document.querySelector('.pad-scroll') as HTMLElement).scrollHeight)
  await page.setViewportSize({ width: largura, height: Math.min(alt + 80, 7000) })
  await page.screenshot({ path: `${SHOTS}/${arq}` })
}

test.afterEach(() => {
  for (const f of [INV, PAT, ORC]) if (existsSync(f)) rmSync(f)
})

test('as sete páginas abrem pela rota, sem erro de console (1440 e 390)', async ({ page }) => {
  const erros = coletarErros(page)
  for (const [larg, alt] of [[1440, 900], [390, 844]] as const) {
    for (const [aba, rota] of PAGINAS) {
      await page.setViewportSize({ width: larg, height: alt })
      await page.goto(rota)
      await expect(page.locator('.mt-abas [role="tab"][aria-selected="true"]')).toHaveCount(1)
      await expect(page.locator('.pad-scroll h1')).toBeVisible()
      await page.waitForTimeout(150)
      await page.screenshot({ path: `${SHOTS}/30-metis-${aba}-${larg}.png` })
      await fotoInteira(page, `30-metis-${aba}-${larg}-inteira.png`, larg)
    }
  }
  expect(erros, erros.join('\n')).toEqual([])
})

test('Visão: quatro números, natureza contra o mês anterior e um aviso só à vista', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro')
  await expect(page.locator('.eyebrow-mono')).toHaveText('Métis')
  await expect(page.getByRole('tab', { name: 'Visão' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.mt-numeros .mt-num')).toHaveCount(4)
  await expect(page.locator('[data-numero="saiu"]')).toContainText('R$ 3.142,50')
  await expect(page.locator('[data-numero="entrou"]')).toContainText('R$ 1.050,00')
  await expect(page.locator('[data-numero="sobrou"]')).toContainText('foram para a reserva')
  await expect(page.locator('[data-numero="reserva"]')).toContainText('abaixo do piso')

  // um aviso à vista (a fatura que vence em 3 dias); os outros em "Mais N avisos"
  const avisos = page.locator('.mt-avisos').first()
  await expect(avisos.locator(':scope > .fg-aviso')).toHaveCount(1)
  await expect(avisos.locator(':scope > [data-aviso="fatura"]')).toContainText('valor do banco')
  await expect(page.locator('[data-aviso="a-classificar"]')).toBeHidden()
  await page.getByText(/Mais \d avisos/).click()
  await expect(page.locator('[data-aviso="conexao-renovar"]')).toContainText('vence em')
  await expect(page.locator('[data-aviso="a-classificar"]')).toContainText('1 lançamento')

  const nat = page.locator('[data-grafico="natureza"]')
  await expect(nat.locator('.fg-leitura')).toContainText('o fixo foi R$ 540,00')
  await expect(nat.locator('.fg-leitura')).toContainText('R$ 1.102,50')
  await expect(nat.locator('.fg-legenda')).toContainText('mês anterior')
  await expect(nat.locator('[data-natureza="pontual"]')).toContainText('R$ 1.500,00')
  // dica ao passar o mouse
  await nat.locator('[data-natureza="variavel"]').hover()
  await expect(nat.locator('.fg-dica')).toContainText('diferença')
  // a estimativa honesta mora em "Mais opções": 2 meses completos, fraca
  await nat.getByText('Mais opções').click()
  await expect(nat.locator('[data-estimativa="mediana"]')).toContainText('2 meses completos')
  await expect(nat.locator('[data-estimativa="mediana"]')).toContainText('fraca')

  // seletor de mês no topo: avançar mostra o mês em andamento
  await page.getByRole('button', { name: 'Próximo mês' }).click()
  await expect(page.locator('.mt-seletor-tag')).toHaveText('em andamento')
  await page.getByRole('button', { name: 'Mês anterior' }).click()
  expect(erros, erros.join('\n')).toEqual([])
})

test('Gastos: categorias por natureza, mês a mês, o que mudou, a lista; trocar a natureza de um gasto', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro/gastos')
  await expect(page.locator('.eyebrow-mono')).toHaveText('Métis › Gastos')
  const cat = page.locator('[data-grafico="categorias"]')
  await expect(cat.locator('.fg-leitura')).toContainText('A maior foi Casa')
  await expect(cat.locator('.mt-barras li').first()).toContainText('Casa')
  await expect(cat.locator('.fg-legenda')).toContainText('Pontual')
  await expect(cat.locator('.mt-semteto')).toContainText('Sem teto definido')
  await cat.locator('.mt-barras li', { hasText: 'Mercado' }).locator('.mt-barra').hover()
  await expect(cat.locator('.fg-dica')).toContainText('média de 3 meses')

  await expect(page.locator('[data-grafico="natureza-tempo"] svg path').first()).toBeVisible()
  await expect(page.locator('[data-grafico="natureza-tempo"] .fg-leitura')).toContainText('O fixo fica perto de R$ 540,00')
  const dif = page.locator('[data-grafico="diferenca"]')
  await expect(dif.locator('.mt-dif li').first()).toContainText('Casa')
  await expect(dif.locator('.mt-dif li').first()).toContainText('+R$ 1.500,00')

  // lista agrupada: abrir Transporte e marcar o gasto como fixo (só na cópia do vault)
  const lista = page.locator('[data-grafico="lista"]')
  await expect(lista.locator('[data-grupo="fixo"] .mt-grupo-tit')).toContainText('R$ 540,00')
  await lista.locator('[data-grupo="variavel"] summary', { hasText: 'Transporte' }).click()
  await lista.locator('select[aria-label^="Natureza de Gasto falso · transporte"]').selectOption('fixo')
  await expect(lista.locator('[data-grupo="fixo"] .mt-grupo-tit')).toContainText('R$ 750,00')
  await lista.locator('[data-grupo="fixo"] summary', { hasText: 'Transporte' }).click()
  await lista.locator('select[aria-label^="Natureza de Gasto falso · transporte"]').selectOption('')
  await expect(lista.locator('[data-grupo="fixo"] .mt-grupo-tit')).toContainText('R$ 540,00')

  // "Definir tetos" leva ao Plano com o formulário aberto
  await cat.getByRole('button', { name: 'Definir tetos' }).click()
  await expect(page.getByRole('tab', { name: 'Plano' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.mt-editor')).toBeVisible()
  expect(erros, erros.join('\n')).toEqual([])
})

test('Entradas: por cliente (entrou × falta) e a linha do tempo dos contratos', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro/entradas')
  const pc = page.locator('[data-grafico="por-cliente"]')
  await expect(pc.locator('.fg-leitura')).toContainText('vencido e ainda aberto')
  await expect(pc.locator('.mt-barras li', { hasText: 'Cliente Alfa' })).toContainText('de R$ 2.000,00')
  await expect(pc.locator('.fg-legenda')).toContainText('falta')
  const ct = page.locator('[data-grafico="contratos"]')
  await expect(ct.locator('.mt-tempo-linhas li', { hasText: 'Cliente Gama' })).toContainText('até')
  await expect(ct.locator('.mt-tempo-linhas li', { hasText: 'Cliente Alfa' })).toContainText('segue')
  await expect(ct.locator('.fg-leitura')).toContainText('caem para R$ 2.250,00')
  await ct.locator('.mt-tempo-linhas li').first().hover()
  await expect(ct.locator('.fg-dica')).toBeVisible()
  expect(erros, erros.join('\n')).toEqual([])
})

test('Pronoia: sobra estimada, receita por cliente, reserva, cartão e a projeção em "Mais opções"', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro/pronoia')
  await expect(page.locator('.eyebrow-mono')).toHaveText('Métis › Pronoia')
  for (const id of ['sobra', 'receita', 'reserva', 'cartao', 'projecao']) await expect(page.locator(`[data-grafico="${id}"]`)).toBeVisible()
  // gasto que se repete = fixo 540 + mediana do variável (600; 1.102,50) = 1.391,25
  await expect(page.locator('[data-grafico="sobra"] .fg-leitura')).toContainText('R$ 1.391,25')
  await expect(page.locator('[data-grafico="receita"] .fg-leitura')).toContainText('R$ 2.250,00')
  await expect(page.locator('[data-grafico="receita"] .fg-legenda')).toContainText('Cliente Gama · até')
  const cartao = page.locator('[data-grafico="cartao"]')
  await expect(cartao.locator('.fg-legenda')).toContainText('medido')
  await expect(page.locator('[data-grafico="reserva"] .fg-leitura')).toContainText('saldo de partida não está no razão')
  const proj = page.locator('[data-grafico="projecao"]')
  await expect(proj.locator('.fin-proj')).toBeHidden()
  await proj.getByText('Mais opções').click()
  await expect(proj.locator('.fin-proj tbody tr').first()).toBeVisible()
  await expect(proj.locator('.fin-proj td.num.guarda').first()).toBeVisible()
  await page.locator('[data-grafico="sobra"] .fg-hit').first().hover()
  await expect(page.locator('[data-grafico="sobra"] .fg-dica')).toBeVisible()
  expect(erros, erros.join('\n')).toEqual([])
})

test('Patrimônio enxuto: reserva × piso, total investido e "Investimentos em breve"', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro/patrimonio')
  await expect(page.locator('[data-grafico="reserva-piso"] .fg-leitura')).toContainText('Nenhuma posição')
  await expect(page.locator('[data-grafico="investimentos"]')).toContainText('em breve')

  const d = new Date()
  const hoje = ymdLocal(d)
  const mes = hoje.slice(0, 7)
  const lanc = {
    lancamentos: [
      // duas caixinhas com o MESMO nome: não podem se fundir; as duas são reserva
      { id: 'inv-1', tipo: 'investimento', descricao: 'CDB Banco Falso · liquidez diária', classe: 'CDB', instituicao: 'Banco Falso', liquidez: 'diaria', data: hoje, valor: 2000, status: 'posicao', reserva: true, vencimento: '', origem: 'pluggy', fitid: `aaaa0001-${mes}` },
      { id: 'inv-2', tipo: 'investimento', descricao: 'CDB Banco Falso · liquidez diária', classe: 'CDB', instituicao: 'Banco Falso', liquidez: 'diaria', data: hoje, valor: 1300, status: 'posicao', reserva: true, vencimento: '', origem: 'pluggy', fitid: `aaaa0002-${mes}` },
      { id: 'inv-3', tipo: 'investimento', descricao: 'FII FALS11', classe: 'FII', instituicao: 'Corretora Falsa', liquidez: 'bolsa-d2', data: hoje, valor: 700, status: 'posicao', vencimento: '', origem: 'pluggy', fitid: `aaaa0003-${mes}` },
      { id: 'inv-4', tipo: 'investimento', descricao: 'Moeda falsa', classe: 'cripto', instituicao: 'Carteira falsa', liquidez: '', data: hoje, valor: 500, status: 'posicao', vencimento: '' },
    ],
  }
  writeFileSync(INV, `---\ntipo: financeiro\narea: negocio\nmes: ${mes}\n---\n\n# teste\n\n\`\`\`financeiro\n${JSON.stringify(lanc, null, 2)}\n\`\`\`\n`, 'utf8')
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  const res = page.locator('[data-grafico="reserva-piso"]')
  await expect(res.locator('.fg-leitura')).toContainText('R$ 3.300,00', { timeout: 10_000 })
  await expect(res.locator('.fg-leitura')).toContainText('faltam R$ 1.700,00')
  await expect(res.locator('[data-numero="investido"]')).toContainText('R$ 4.500,00')
  await expect(res.locator('[role="meter"]')).toHaveAttribute('aria-valuenow', '3300')
  await page.locator('.pad-scroll').screenshot({ path: `${SHOTS}/31-metis-patrimonio-com-posicao.png` })
  // a Pronoia parte das posições marcadas reserva
  await page.getByRole('tab', { name: 'Pronoia' }).click()
  await expect(page.locator('[data-grafico="reserva"] .fg-leitura')).toContainText('Hoje')
  expect(erros, erros.join('\n')).toEqual([])
})

test('Plano: sem teto até definir; definir grava orcamento.md (só na cópia) e muda a estimativa', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/financeiro/plano')
  const orc = page.locator('[data-grafico="orcamento"]')
  await expect(orc.locator('.fg-leitura')).toHaveText('Sem teto definido.')
  await expect(page.locator('[data-grafico="meta-reserva"] .fg-leitura')).toContainText('Faltam')
  await orc.getByRole('button', { name: 'Definir tetos' }).click()
  // os campos nascem vazios: o teto é decisão do Pedro (a referência é só texto)
  await expect(orc.locator('#teto-mercado')).toHaveValue('')
  await expect(orc.locator('.mt-editor-lista li', { hasText: 'Mercado' })).toContainText('referência')
  await orc.locator('#teto-mercado').fill('500')
  await orc.locator('#teto-alimentacao').fill('200,00')
  await orc.getByRole('button', { name: 'Salvar tetos' }).click()
  await expect(orc.locator('.fg-leitura')).toContainText('de R$ 700,00')
  await expect(orc.locator('.mt-barras li', { hasText: 'Mercado' })).toContainText('R$ 200,00 acima')
  const texto = readFileSync(ORC, 'utf8')
  expect(texto).toContain('```financeiro-orcamento')
  expect(JSON.parse(texto.match(/```financeiro-orcamento\s*\n([\s\S]*?)```/)![1])).toEqual({ tetos: { mercado: 500, alimentacao: 200 } })
  await page.locator('.pad-scroll').screenshot({ path: `${SHOTS}/32-metis-plano-com-teto.png` })

  // com menos de 3 meses completos, a Pronoia passa a usar o teto das variáveis: 540 + 700
  await page.getByRole('tab', { name: 'Pronoia' }).click()
  await expect(page.locator('[data-grafico="sobra"] .fg-leitura')).toContainText('R$ 1.240,00')
  // e Gastos mostra o teto (traço) e quem passou
  await page.getByRole('tab', { name: 'Gastos' }).click()
  await expect(page.locator('[data-grafico="categorias"] .mt-marcador').first()).toBeVisible()
  await expect(page.locator('[data-grafico="categorias"] .fg-leitura')).toContainText('acima do teto')
  expect(erros, erros.join('\n')).toEqual([])
})

test('orçamento pelo dev server: só JSON de origem local, categoria e valor validados', async ({ request }) => {
  const r1 = await request.post('/api/financeiro', { headers: { 'content-type': 'text/plain' }, data: JSON.stringify({ acao: 'orcamento', tetos: { mercado: 1 } }) })
  expect(r1.status()).toBe(403)
  const r2 = await request.post('/api/financeiro', { data: { acao: 'orcamento', tetos: { '../../x': 10 } } })
  expect(r2.status()).toBe(400)
  const r3 = await request.post('/api/financeiro', { data: { acao: 'orcamento', tetos: { mercado: 'abc' } } })
  expect(r3.status()).toBe(400)
  expect(existsSync(ORC)).toBe(false)
})

test('celular (390 px): nenhuma página da Métis rola de lado e todo alvo de toque tem 44 px', async ({ page }) => {
  const erros = coletarErros(page)
  for (const [, rota] of PAGINAS) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(rota)
    await expect(page.locator('.pad-scroll h1')).toBeVisible()
    await page.waitForTimeout(150)
    const vaza = await page.evaluate(() => { const el = document.querySelector('.pad-scroll') as HTMLElement; return el.scrollWidth - el.clientWidth })
    expect(vaza, rota).toBeLessThanOrEqual(1)
    const larg = await page.locator('.fg-card').evaluateAll((cs) => cs.map((c) => {
      const s = c.querySelector('svg') as SVGSVGElement | null
      return s ? s.getBoundingClientRect().right - c.getBoundingClientRect().right : -1
    }))
    for (const d of larg) expect(d, rota).toBeLessThanOrEqual(0)
    const pequenos = await page.locator('.pad-scroll').evaluate((raiz) =>
      [...raiz.querySelectorAll('button, a[href], summary, select, input, [role="tab"]')]
        .filter((e) => (e as HTMLElement).offsetParent !== null && !e.closest('.mt-rolagem, .fin-tabela-wrap'))
        .map((e) => ({ t: (e.textContent || (e as HTMLInputElement).value || e.tagName).trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) }))
        .filter((x) => x.h < 44),
    )
    expect(pequenos, rota + ' ' + JSON.stringify(pequenos)).toEqual([])
  }
  expect(erros, erros.join('\n')).toEqual([])
})
