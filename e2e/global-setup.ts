import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Guarda o `git status` do vault REAL antes da suíte: o teardown confere que nada vazou.
export default function globalSetup() {
  const real = process.env.SINAPSE_E2E_VAULT_REAL!
  const status = execFileSync('git', ['-C', real, 'status', '--porcelain'], { encoding: 'utf8' })
  writeFileSync(join(process.env.SINAPSE_E2E_TMP!, 'status-real.txt'), status, 'utf8')
}
