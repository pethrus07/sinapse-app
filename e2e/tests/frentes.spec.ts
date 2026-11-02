import { test, expect, type Page } from '@playwright/test'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'

// Tela Frentes (#/frentes). Este teste ESCREVE no vault (troca de vaga), então roda
// contra uma CÓPIA temporária do vault, num Vite próprio na porta 5174, com o índice
// gerado fora de src/data (INDEX_OUT). O vault real é conferido no fim: tem que sair igual.
// "O que prometi" lê uma pasta de atas FALSA (ATAS_PATH, montada aqui com datas relativas a
// hoje) e grava o "feito" num estado temporário (SINAPSE_ESTADO): nem o Atas real nem o
// ~/.sinapse de verdade são lidos ou tocados.

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
let atas = ''
let estado = ''
let fotoInicial = ''

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

// ---- fixture do Atas: 5 reuniões falsas, datas relativas a hoje ----
const ymd = (dias: number) => {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const ddmm = (dias: number) => `${ymd(dias).slice(8, 10)}/${ymd(dias).slice(5, 7)}`
const R_CLIENTE = '2099-01-01_1000_reuniao-falsa-atas'
const R_SEM = '2099-01-02_1000_reuniao-falsa-sem-projeto'
const R_PARRESIA = '2099-01-03_1000_reuniao-falsa-parresia'
const R_PESSOAL = '2099-01-04_1000_reuniao-falsa-pessoal'
const R_RETIFICA = '2099-01-05_1000_reuniao-falsa-retifica'
const REUNIOES = [R_CLIENTE, R_SEM, R_PARRESIA, R_PESSOAL, R_RETIFICA]

function enc(id: string, acao: string, dono: string | null, prazo: string | null, extra: object = {}) {
  return {
    id, acao, dono, prazo, prazo_dito: prazo ? 'até sexta' : null, t: '01:17',
    citacao: 'citação de ' + acao, verificado: true, problemas: [], ...extra,
  }
}

function reuniao(id: string, tipo: string, projeto: string, data: string, encs: object[], html = false) {
  const dir = join(atas, 'atas-salvas', id)
  mkdirSync(dir, { recursive: true })
  const inicio = data + 'T10:00:00-03:00'
  const titulo = 'Reunião falsa ' + id.slice(16)
  writeFileSync(join(dir, 'sessao.json'), JSON.stringify({ schema: 'atas/sessao@1', id, titulo, tipo, projeto, participantes: ['Fulano'], inicio, criado: inicio }))
  writeFileSync(join(dir, 'ata.json'), JSON.stringify({
    schema: 'atas/ata@1', id, titulo, tipo, projeto: null, data: inicio,
    participantes: [{ rotulo: 'Você', nome: 'Pedro', confirmado: true }, { rotulo: 'Participante', nome: 'Fulano', confirmado: true }],
    decisoes: [], encaminhamentos: encs, status: 'estruturada',
  }))
  if (html) writeFileSync(join(dir, 'ata.html'), '<!doctype html><title>ata falsa</title><h1>ATA-FALSA-HTML</h1>')
}

function montarAtas() {
  atas = join(tmp, 'atas')
  reuniao(R_CLIENTE, 'cliente', 'atas', ymd(-2), [
    enc('E1', 'PROMESSA-FUTURA mandar o orçamento revisado', 'Pedro', ymd(3)),
    enc('E2', 'PROMESSA-VENCIDA ajustar a tela de login', 'Você', ymd(-4)),
    enc('E3', 'PROMESSA-SEM-PRAZO revisar o texto da home', 'Pedro', null),
    enc('E4', 'PROMESSA-DO-CLIENTE enviar as fotos', 'Fulano', ymd(1)),
    enc('E5', 'PROMESSA-NAO-VERIFICADA algo que ninguém disse', 'Pedro', ymd(1), { verificado: false }),
  ], true)
  reuniao(R_SEM, 'cliente', '', ymd(-1), [
    enc('E1', 'PROMESSA-SEM-FRENTE ligar para o fornecedor', 'Pedro', ymd(5)),
    enc('E2', 'PROMESSA-ANTIGA coisa de dois meses atrás', 'Pedro', ymd(-60)),
  ])
  // mesmo projeto da frente Atas, mas tipo parresia / pessoal: não pode aparecer
  reuniao(R_PARRESIA, 'parresia', 'atas', ymd(-1), [enc('E1', 'PROMESSA-PARRESIA nunca aparece', 'Pedro', ymd(2))], true)
  reuniao(R_PESSOAL, 'pessoal', 'atas', ymd(-1), [enc('E1', 'PROMESSA-PESSOAL nunca aparece', 'Pedro', ymd(2))])
  // "retifica" casa com a frente Renatinho Motores pelo nome da pasta (pastas: retifica-os, retifica)
  reuniao(R_RETIFICA, 'cliente', 'retifica-os', ymd(-3), [enc('E1', 'PROMESSA-RETIFICA subir a versão nova', 'Pedro', ymd(0))])
}

// As duas frentes que o teste usa ficam fixas NA CÓPIA, para o teste não depender do dado real do
// vault: em 01/11/2026 a nota atas virou "Ágora (ex-Atas)" e o card /^Atas$/ sumiu; a Retífica perdeu
// a pasta `retifica` na mesma revisão.
function fixarFrontmatter(rel: string, campos: Record<string, string>) {
  const arq = join(vault, rel)
  const [, fm, corpo] = readFileSync(arq, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)!
  const linhas = fm.split(/\r?\n/).filter((l) => !Object.keys(campos).some((k) => l.startsWith(k + ':')))
  for (const [k, v] of Object.entries(campos)) linhas.push(`${k}: ${v}`)
  writeFileSync(arq, `---\n${linhas.join('\n')}\n---\n${corpo}`, 'utf8')
}
function fixarNotas() {
  fixarFrontmatter('03-PROJETOS/atas.md', { title: 'Atas', vaga: 'true', pastas: '[atas]' })
  fixarFrontmatter('03-PROJETOS/renatinho-motores.md', { title: 'Renatinho Motores', status: 'em-producao', pastas: '[retifica-os]' })
}

// o app só lê o Atas: o conteúdo das reuniões falsas tem que sair igual
const fotoDoAtas = () =>
  REUNIOES.map((r) => ['ata.json', 'sessao.json'].map((a) => readFileSync(join(atas, 'atas-salvas', r, a), 'utf8')).join('')).join('|')

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  statusReal = statusDoVault()
  tmp = mkdtempSync(join(tmpdir(), 'sinapse-frentes-'))
  vault = join(tmp, 'sinapse')
  cpSync(VAULT_REAL, vault, { recursive: true })
  fixarNotas()
  montarAtas()
  fotoInicial = fotoDoAtas()
  estado = join(tmp, 'estado')
  servidor = spawn(process.execPath, [join(APP, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORTA), '--strictPort'], {
    cwd: APP,
    env: {
      ...process.env,
      VAULT_PATH: vault,
      INDEX_OUT: join(tmp, 'indice'),
      PROJETOS_PATH: resolve(VAULT_REAL, '..'), // as pastas de projeto reais, só para ler o git
      ATAS_PATH: atas, // a fixture, nunca o atas-salvas real
      SINAPSE_ESTADO: estado, // o "feito" vai para cá, não para ~/.sinapse
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
  const atasIntacto = atas ? fotoDoAtas() === fotoInicial : true
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  expect(atasIntacto, 'o app mexeu no Atas').toBe(true)
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

test('o que prometi: só o do Pedro, por frente, 2 à vista, citação e feito local (+ screenshots)', async ({ page, request }) => {
  const erros = coletarErros(page)
  await page.setViewportSize({ width: 2560, height: 1080 })
  await abrir(page)

  // fora: Parresia, pessoal, dono que não é o Pedro, citação não achada, prazo antigo
  for (const fora of ['PROMESSA-PARRESIA', 'PROMESSA-PESSOAL', 'PROMESSA-DO-CLIENTE', 'PROMESSA-NAO-VERIFICADA', 'PROMESSA-ANTIGA'])
    await expect(page.getByText(fora)).toHaveCount(0)

  // vaga Atas: 3 promessas, 2 à vista (a vencida primeiro) e "Mais 1"
  const atasCard = page.getByTestId('vaga').filter({ has: page.locator('.fr-nome', { hasText: /^Atas$/ }) })
  const itens = atasCard.getByTestId('promessa')
  await expect(itens).toHaveCount(2)
  await expect(itens.nth(0)).toContainText('PROMESSA-VENCIDA')
  await expect(itens.nth(0)).toContainText('venceu há 4 dias')
  await expect(itens.nth(1)).toContainText(`PROMESSA-FUTURA mandar o orçamento revisado · até ${ddmm(3)}`)
  // vencido = o mesmo realce sem cor do "parada há N dias"; a única cor de alerta segue sendo a 4ª vaga
  const corVencido = await itens.nth(0).locator('.vencido').evaluate((el) => getComputedStyle(el).color)
  const corParada = await page.evaluate(() => {
    const s = document.createElement('span')
    s.className = 'fr-parada'
    document.body.appendChild(s)
    const c = getComputedStyle(s).color
    s.remove()
    return c
  })
  expect(corVencido).toBe(corParada)
  await expect(page.locator('.fr-card.alerta')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/16-promessas-2560.png` })
  await atasCard.getByRole('button', { name: 'Mais 1' }).click()
  await expect(itens).toHaveCount(3)
  await expect(itens.nth(2)).toContainText('PROMESSA-SEM-PRAZO')

  // linha de lista (Sob demanda), casada pelo nome da pasta
  await expect(page.locator('.fr-linha', { hasText: 'Renatinho Motores' }).getByTestId('promessa'))
    .toContainText('PROMESSA-RETIFICA subir a versão nova · até hoje')

  // clique abre a citação literal e a reunião de origem; a ata local abre pelo servidor
  await itens.nth(1).locator('.fr-prom-linha').click()
  const det = atasCard.getByTestId('promessa-detalhe')
  await expect(det).toContainText('“citação de PROMESSA-FUTURA mandar o orçamento revisado”')
  await expect(det).toContainText(`Reunião falsa reuniao-falsa-atas · ${ddmm(-2)} · 01:17`)
  const href = await det.getByRole('link', { name: 'Abrir a ata' }).getAttribute('href')
  const html = await request.get(BASE + href)
  expect(html.status()).toBe(200)
  expect(await html.text()).toContain('ATA-FALSA-HTML')
  // reunião fora do índice (a da Parresia) e caminho torto não abrem
  expect((await request.get(BASE + '/api/ata/' + R_PARRESIA)).status()).toBe(404)
  expect((await request.get(BASE + '/api/ata/..%2F..%2Fsinapse')).status()).toBe(404)
  await page.screenshot({ path: `${SHOTS}/17-promessa-aberta-2560.png` })

  // sem frente: uma linha discreta em "Mais"
  const mais = page.locator('.fr-mais')
  await expect(mais.locator('summary')).toContainText('1 promessa sem frente')
  await expect(page.getByTestId('sem-frente')).toBeHidden()
  await mais.locator('summary').click()
  await expect(page.getByTestId('sem-frente').getByTestId('promessa')).toHaveCount(1)
  await expect(page.getByTestId('sem-frente'))
    .toContainText(`PROMESSA-SEM-FRENTE ligar para o fornecedor · até ${ddmm(5)} · reunião de ${ddmm(-1)}`)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.screenshot({ path: `${SHOTS}/18-promessas-1366.png` })
  const alto = await page.locator('.pad-scroll').evaluate((el) => el.scrollHeight)
  await page.setViewportSize({ width: 1366, height: Math.max(768, alto) })
  await page.screenshot({ path: `${SHOTS}/18-promessas-1366-inteira.png` })
  await page.setViewportSize({ width: 1366, height: 768 })
  await mais.locator('summary').click() // fecha de novo: o teste seguinte espera "Mais" recolhido

  // Feito: grava no estado local (nem vault, nem Atas) e some da tela; Desfazer traz de volta
  await det.getByRole('button', { name: 'Feito' }).click()
  await expect(page.getByTestId('feito-agora')).toBeVisible()
  await expect(page.getByTestId('promessa').filter({ hasText: 'PROMESSA-FUTURA' })).toHaveCount(0)
  const arqFeitos = join(estado, 'compromissos-feitos.json')
  expect(Object.keys(JSON.parse(readFileSync(arqFeitos, 'utf8')).feitos)).toEqual([R_CLIENTE + '#E1'])
  expect(fotoDoAtas()).toBe(fotoInicial)
  await page.getByTestId('feito-agora').getByRole('button', { name: 'Desfazer' }).click()
  await expect(page.getByTestId('promessa').filter({ hasText: 'PROMESSA-FUTURA' })).toHaveCount(1)
  expect(JSON.parse(readFileSync(arqFeitos, 'utf8')).feitos).toEqual({})
  // id que não está no índice é recusado
  const r = await request.post(BASE + '/api/compromisso', { data: { id: R_PARRESIA + '#E1', feito: true } })
  expect(r.status()).toBe(404)

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
