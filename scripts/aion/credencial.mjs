// Aion · chaves das fontes de cotação (token da brapi, chave Demo da CoinGecko), gravadas pelo
// aion-chave.ps1 com DPAPI do usuário do Windows, no mesmo padrão de scripts/financas/credencial.mjs:
// só esta conta, nesta máquina, decifra. O texto decifrado passa do PowerShell para cá pelo stdout e
// fica só em memória (nunca vai para arquivo, log, cache ou terminal).
// Sem chave gravada: devolve '' e o coletor segue pelo caminho sem chave.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const BASE_AION = () => process.env.SINAPSE_AION || join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Local'), 'sinapse-aion');
export const SERVICOS = { brapi: 'brapi.cred', coingecko: 'coingecko.cred' };
export const arquivoDaChave = (servico) => join(BASE_AION(), SERVICOS[servico]);

const DECIFRAR = [
  '$ErrorActionPreference = "Stop"',
  '$s = (Get-Content -Raw -LiteralPath $env:SINAPSE_AION_CRED).Trim() | ConvertTo-SecureString',
  '$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)',
  'try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }',
].join('; ');

/** A chave do serviço, ou '' se não houver. Erro de decifrar vira '' + aviso (sem repassar o texto do PowerShell). */
export function lerChave(servico, { avisar = () => {} } = {}) {
  if (!SERVICOS[servico]) throw new Error('serviço desconhecido: ' + servico);
  const arq = arquivoDaChave(servico);
  if (!existsSync(arq)) return '';
  const env = { ...process.env, SINAPSE_AION_CRED: arq };
  // chamado de dentro do PowerShell 7, o powershell.exe (5.1) herdaria o PSModulePath errado
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PSMODULEPATH') delete env[k];
  try {
    const t = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', DECIFRAR], {
      env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    }).trim();
    return /^[\w.-]{8,200}$/.test(t) ? t : (avisar(`a chave de ${servico} decifrada não tem formato de chave: grave de novo com o aion-chave.ps1`), '');
  } catch {
    avisar(`não consegui decifrar a chave de ${servico} (ela só abre na conta do Windows que a gravou): grave de novo com o aion-chave.ps1`);
    return '';
  }
}

/** Só diz se a chave existe (o índice do app usa isto; nunca lê o conteúdo). */
export const temChave = (servico) => existsSync(arquivoDaChave(servico));
