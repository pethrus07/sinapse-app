import { test, expect, type Page } from '@playwright/test'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'

// Tela Frentes (#/frentes). Este teste ESCREVE no vault (troca de vaga), então roda
// contra uma CÓPIA temporária do vault, num Vite próprio na porta 5174, com o índice
// gerado fora de src/data (INDEX_OUT). O vault real é conferido no fim: tem que sair igual.

const APP = resolve(process.cwd(), '..') // o playwright roda de dentro de e2e/
const VAULT_REAL = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(APP, '..', 'sinapse')
const PORTA = 5174
const BASE = `http://localhost:${PORTA}`
const SHOTS = 'shots'
mkdirSync(SHOTS, { recursive: true })

let tmp = ''
let vault = ''
let servidor: ChildProcess | null = null
let statusReal = ''

const statusDoVault = () =>
  execFileSync('git', ['-C', VAULT_REAL, 'status', '--porcelain'], { encoding: 'utf8' })
const nota = (rel: string) => readFileSync(join(vault, rel), 'utf8')
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

function coletarErros(page: Page): string[] {
  const erros: string[] = []
  page.on('pageerror', (e) => erros.push('pageerror: ' + String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') erros.push('console.error: ' + m.text())
  })
  return erros
}

// Abre a tela e espera o índice VIVO (o do vault temporário), não o JSON empacotado.
async function abrir(page: Page) {
  const vivo = page.waitForResponse((r) => r.url().endsWith('/api/indice') && r.ok())
  await page.goto(BASE + '/#/frentes')
  await vivo
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

async function revalidar(page: Page) {
  await espera(1200) // watcher do vault (debounce 400 ms)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  statusReal = statusDoVault()
  tmp = mkdtempSync(join(tmpdir(), 'sinapse-frentes-'))
  vault = join(tmp, 'sinapse')
  cpSync(VAULT_REAL, vault, { recursive: true })
  servidor = spawn(process.execPath, [join(APP, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORTA), '--strictPort'], {
    cwd: APP,
    env: {
      ...process.env,
      VAULT_PATH: vault,
      INDEX_OUT: join(tmp, 'indice'),
      PROJETOS_PATH: resolve(VAULT_REAL, '..'), // as pastas de projeto reais, só para ler o git
    },
    stdio: 'ignore',
  })
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(BASE + '/api/versao')).ok) return
    } catch {
      /* subindo */
    }
    await espera(500)
  }
  throw new Error('o Vite do vault temporário não subiu na porta ' + PORTA)
})

test.afterAll(async () => {
  if (servidor && servidor.exitCode === null) {
    await new Promise((r) => {
      servidor!.once('exit', r)
      servidor!.kill()
    })
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  // a garantia que importa: nada do teste vazou para o vault de verdade
  expect(statusDoVault()).toBe(statusReal)
})

test('mostra no máximo 3 vagas e o resto por estado (+ screenshots 1366 e 2560)', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1366, height: 768 })
  await abrir(page)

  const vagas = page.getByTestId('vaga')
  const n = await vagas.count()
  expect(n).toBeGreaterThan(0)
  expect(n).toBeLessThanOrEqual(3)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${n} frentes em andamento`)
  await expect(page.locator('.fr-pergunta')).toHaveCount(0) // sem excesso, sem cor de alerta
  await expect(page.locator('.fr-card.alerta')).toHaveCount(0)

  await expect(page.getByRole('heading', { name: /Na fila/ })).toBeVisible()
  await expect(page.locator('.fr-mais')).not.toHaveAttribute('open', '') // parado fica recolhido
  await expect(page.getByText('A Parresia é a faixa fixa do dia')).toBeVisible()
  await expect(page.locator('.fr-linha', { hasText: /qa-parresia/ })).toHaveCount(0)

  // o que se vê ao abrir + a página inteira (a rolagem é do .pad-scroll, não do body)
  for (const [w, h, nome] of [[1366, 768, '13-frentes-1366'], [2560, 1080, '14-frentes-2560']] as const) {
    await page.setViewportSize({ width: w, height: h })
    await page.screenshot({ path: `${SHOTS}/${nome}.png` })
    const alto = await page.locator('.pad-scroll').evaluate((el) => el.scrollHeight)
    await page.setViewportSize({ width: w, height: Math.max(h, alto) })
    await page.screenshot({ path: `${SHOTS}/${nome}-inteira.png` })
  }

  expect(erros, erros.join('\n')).toEqual([])
})

test('a 4ª vaga pergunta qual sai, e a troca escreve no vault e reindexa', async ({ page }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 1366, height: 768 })
  await abrir(page)
  await expect(page.getByTestId('vaga')).toHaveCount(3)

  // com as 3 ocupadas, pôr uma da fila na vaga não escreve nada: pergunta qual sai
  await page.locator('.fr-linha', { hasText: 'Sinapse App' }).getByRole('button', { name: 'Pôr na vaga' }).click()
  await expect(page.getByTestId('entrando')).toContainText('Qual sai?')
  await expect(page.getByTestId('entrando')).toBeInViewport() // a pergunta vem até o olho
  await expect(page.locator('.fr-card.alerta')).toHaveCount(1) // a única cor de alerta
  expect(nota('03-PROJETOS/sinapse-app.md')).not.toMatch(/^vaga:/m)
  await page.screenshot({ path: `${SHOTS}/15-frentes-qual-sai.png`, fullPage: true })

  // escolhe quem sai: as duas escritas acontecem e a tela reindexa sem recarregar
  const card = page.getByTestId('vaga').filter({ has: page.locator('.fr-nome', { hasText: 'Desbravando UTV' }) })
  await card.getByRole('button', { name: 'Sai esta' }).click()
  await expect(page.getByTestId('entrando')).toHaveCount(0)
  await expect(page.getByTestId('vaga').locator('.fr-nome', { hasText: 'Sinapse App' })).toBeVisible()
  await expect(page.getByTestId('vaga').locator('.fr-nome', { hasText: 'Desbravando UTV' })).toHaveCount(0)
  expect(nota('03-PROJETOS/sinapse-app.md')).toMatch(/^vaga: true$/m)
  expect(nota('04-NEGOCIO/desbravando.md')).not.toMatch(/^vaga:/m)
  await expect(page.getByTestId('vaga')).toHaveCount(3)

  // tirar da vaga libera o lugar
  await page.getByTestId('vaga').filter({ hasText: 'Sinapse App' }).getByRole('button', { name: 'Tirar da vaga' }).click()
  await expect(page.getByTestId('vaga')).toHaveCount(2)
  await expect(page.getByText('Vaga livre')).toBeVisible()
  expect(nota('03-PROJETOS/sinapse-app.md')).not.toMatch(/^vaga:/m)

  expect(erros, erros.join('\n')).toEqual([])
})

test('o servidor recusa a 4ª vaga sem dizer qual sai; 4 marcadas à mão viram a pergunta', async ({ page, request }) => {
  const erros = coletarErros(page)
  // 2 vagas (do teste anterior) + 1 pela API = 3
  let r = await request.post(BASE + '/api/vaga', { data: { rel: '03-PROJETOS/sinapse-app.md', vaga: true } })
  expect(r.status()).toBe(200)
  r = await request.post(BASE + '/api/vaga', { data: { rel: '03-PROJETOS/mesa-arton.md', vaga: true } })
  expect(r.status()).toBe(409)
  expect(nota('03-PROJETOS/mesa-arton.md')).not.toMatch(/^vaga:/m)
  // caminho fora do vault não passa
  r = await request.post(BASE + '/api/vaga', { data: { rel: '../sinapse-app/README.md', vaga: false } })
  expect(r.status()).toBe(400)

  await page.setViewportSize({ width: 1366, height: 768 })
  await abrir(page)
  await expect(page.getByTestId('vaga')).toHaveCount(3)

  // alguém marca a 4ª direto no .md
  const rel = '03-PROJETOS/mesa-arton.md'
  writeFileSync(join(vault, rel), nota(rel).replace(/^(status:.*)$/m, '$1\nvaga: true'), 'utf8')
  await revalidar(page)
  await expect(page.locator('.fr-pergunta')).toContainText('Qual sai?')
  await expect(page.getByTestId('vaga')).toHaveCount(4)
  await expect(page.locator('.fr-card.alerta')).toHaveCount(1)

  expect(erros, erros.join('\n')).toEqual([])
})
