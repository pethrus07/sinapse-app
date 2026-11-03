import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Os endpoints de escrita do dev server (scripts/vault-api.mjs) só gravam DENTRO do vault da cópia
// e só para o próprio app. Tudo aqui roda na cópia temporária (SINAPSE_E2E_VAULT).
const VAULT = process.env.SINAPSE_E2E_VAULT!
const mesHoje = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

test('escrita fora do vault é recusada (note, progress e o mês do financeiro)', async ({ request }) => {
  const fora = resolve(VAULT, '..', 'fora-do-vault.md')
  const r1 = await request.post('/api/note', { data: { rel: '../fora-do-vault.md', body: 'x' } })
  expect(r1.status()).toBe(400)
  expect(existsSync(fora)).toBe(false)
  const r2 = await request.post('/api/progress', { data: { rel: '../../x.md', progresso: 'feito' } })
  expect(r2.status()).toBe(400)
  for (const mes of ['../../A', '..\\..\\A', '2030-13', 'x']) {
    const r = await request.post('/api/financeiro', { data: { acao: 'remover', mes, id: 'qualquer' } })
    expect(r.status(), mes).toBe(400)
  }
  expect(existsSync(join(VAULT, 'A.md'))).toBe(false)
})

test('POST que não é do app (text/plain ou outra origem) não escreve', async ({ request }) => {
  const corpo = JSON.stringify({ acao: 'lancar', lancamento: { descricao: 'Ataque falso', valor: 1 } })
  const r1 = await request.post('/api/financeiro', { headers: { 'content-type': 'text/plain' }, data: corpo })
  expect(r1.status()).toBe(403)
  const r2 = await request.post('/api/financeiro', { headers: { 'content-type': 'application/json', origin: 'https://site-qualquer.example' }, data: corpo })
  expect(r2.status()).toBe(403)
  const arq = join(VAULT, '04-NEGOCIO', 'financeiro', `${mesHoje()}.md`)
  expect(readFileSync(arq, 'utf8')).not.toContain('Ataque falso')
})

test('lançamento com CPF, conta ou chave Pix na descrição é recusado; "1.234,56" vira 1234.56', async ({ request }) => {
  for (const descricao of ['Pix 123.456.789-09', 'Ag 0001 conta 12345-6', 'chave 3f2b8c1e-9a4d-4e7b-b1c2-0d9e8f7a6b5c']) {
    const r = await request.post('/api/financeiro', { data: { acao: 'lancar', lancamento: { descricao, valor: 10 } } })
    expect(r.status(), descricao).toBe(400)
  }
  const ok = await request.post('/api/financeiro', { data: { acao: 'lancar', lancamento: { descricao: 'Teste valor BR', valor: '1.234,56', vencimento: `${mesHoje()}-15`, tipo: 'saida' } } })
  expect(ok.status()).toBe(200)
  const { id, mes } = await ok.json()
  const texto = readFileSync(join(VAULT, '04-NEGOCIO', 'financeiro', `${mes}.md`), 'utf8')
  expect(texto).toContain('"valor": 1234.56')
  await request.post('/api/financeiro', { data: { acao: 'remover', mes, id } })
})

test('mês com JSON quebrado não é regravado por cima (antes o próximo lançamento apagava o resto)', async ({ request }) => {
  const mes = '2031-07'
  const arq = join(VAULT, '04-NEGOCIO', 'financeiro', `${mes}.md`)
  const quebrado = '---\ntipo: financeiro\nmes: 2031-07\n---\n\n```financeiro\n{ "lancamentos": [ { "id": "a", } ] }\n```\n'
  writeFileSync(arq, quebrado, 'utf8')
  const r = await request.post('/api/financeiro', { data: { acao: 'lancar', lancamento: { descricao: 'Novo', valor: 5, vencimento: `${mes}-02` } } })
  expect(r.status()).toBe(409)
  expect(readFileSync(arq, 'utf8')).toBe(quebrado)
  rmSync(arq)
})

test('primeiro paint já sai do índice da cópia (com o /api/indice bloqueado, a tela mostra o razão falso)', async ({ page }) => {
  await page.route('**/api/indice', (r) => r.abort())
  await page.goto('/#/financeiro/lancamentos')
  await expect(page.locator('.fin-tabela').getByText('Cliente Alfa').first()).toBeVisible()
})
