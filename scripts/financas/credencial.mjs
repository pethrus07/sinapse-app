// Lê a credencial da Pluggy gravada pelo pluggy-credencial.ps1: um JSON cifrado com DPAPI do
// usuário do Windows (ConvertFrom-SecureString sem chave). Só esta conta, nesta máquina, decifra.
// O texto decifrado passa do PowerShell para cá pelo stdout do processo filho e fica só em memória:
// nunca vai para arquivo, log ou terminal.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const BASE_LOCAL = process.env.SINAPSE_FINANCAS || join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'sinapse-financas');
export const ARQ_CRED = () => process.env.SINAPSE_PLUGGY_CRED || join(BASE_LOCAL, 'pluggy.cred');

const DECIFRAR = [
  '$ErrorActionPreference = "Stop"',
  '$s = (Get-Content -Raw -LiteralPath $env:SINAPSE_PLUGGY_CRED).Trim() | ConvertTo-SecureString',
  '$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)',
  'try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }',
].join('; ');

export function lerCredencial(arquivo = ARQ_CRED()) {
  if (!existsSync(arquivo)) {
    throw new Error(`credencial não encontrada em ${arquivo}. Rode antes: powershell -File scripts\\financas\\pluggy-credencial.ps1`);
  }
  let texto;
  try {
    texto = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', DECIFRAR], {
      env: { ...process.env, SINAPSE_PLUGGY_CRED: arquivo }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
  } catch {
    // a mensagem do PowerShell não é repassada: pode citar o conteúdo
    throw new Error('não consegui decifrar a credencial (ela só abre na mesma conta do Windows que a gravou). Rode o pluggy-credencial.ps1 de novo.');
  }
  let c;
  try { c = JSON.parse(texto); } catch { throw new Error('credencial decifrada não é JSON válido: rode o pluggy-credencial.ps1 de novo.'); }
  const itemIds = (Array.isArray(c.itemIds) ? c.itemIds : String(c.itemIds || '').split(/[\s,;]+/)).map((s) => String(s).trim()).filter(Boolean);
  if (!c.clientId || !c.clientSecret || !itemIds.length) throw new Error('credencial incompleta (clientId, clientSecret e ao menos um itemId).');
  return { clientId: String(c.clientId), clientSecret: String(c.clientSecret), itemIds };
}
