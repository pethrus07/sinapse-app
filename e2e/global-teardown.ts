import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// A garantia que importa: o vault real sai igual ao que entrou. Depois apaga a cópia.
export default function globalTeardown() {
  const tmp = process.env.SINAPSE_E2E_TMP!
  const real = process.env.SINAPSE_E2E_VAULT_REAL!
  const antes = readFileSync(join(tmp, 'status-real.txt'), 'utf8')
  const depois = execFileSync('git', ['-C', real, 'status', '--porcelain'], { encoding: 'utf8' })
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  if (antes !== depois) {
    throw new Error(`o e2e mexeu no vault real (${real}).\nantes:\n${antes}\ndepois:\n${depois}`)
  }
}
