import { defineConfig, devices } from '@playwright/test'
import { cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { gravarFinanceiroFalso } from './fixtures/financeiro-falso'

// QA E2E do sinapse-app. A suíte inteira roda contra uma CÓPIA do vault em pasta temporária:
// os testes que escrevem (agenda, financeiro, indice-vivo) nunca tocam o vault real.
// O Vite do teste sobe na porta 5175 (não reusa o dev server do dia a dia em :5173).
// A pasta temporária é criada uma vez e passada aos workers pela variável SINAPSE_E2E_TMP;
// global-setup guarda o `git status` do vault real e global-teardown confere que não mudou.

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VAULT_REAL = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(APP, '..', 'sinapse')
const PORTA = 5175

if (!process.env.SINAPSE_E2E_TMP) {
  const tmp = mkdtempSync(join(tmpdir(), 'sinapse-e2e-'))
  process.env.SINAPSE_E2E_TMP = tmp
  process.env.SINAPSE_E2E_VAULT_REAL = VAULT_REAL
}
const TMP = process.env.SINAPSE_E2E_TMP
const VAULT = join(TMP, 'sinapse')
process.env.SINAPSE_E2E_VAULT = VAULT
if (!existsSync(VAULT)) {
  cpSync(VAULT_REAL, VAULT, { recursive: true })
  mkdirSync(join(TMP, 'estado'), { recursive: true })
  // o razão real nunca entra em teste nem em screenshot: a cópia recebe um razão falso
  gravarFinanceiroFalso(VAULT)
}

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: `http://localhost:${PORTA}`,
    locale: 'pt-BR',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  webServer: {
    command: `npm run index && npx vite --port ${PORTA} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORTA}`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      VAULT_PATH: VAULT,
      INDEX_OUT: join(TMP, 'indice'),
      PROJETOS_PATH: resolve(VAULT_REAL, '..'), // pastas de projeto reais, só para ler o git
      SINAPSE_ESTADO: join(TMP, 'estado'), // o "feito" das promessas não vai para ~/.sinapse
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
