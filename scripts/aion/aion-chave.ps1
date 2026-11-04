# Aion: guarda a chave de uma fonte de cotação cifrada com DPAPI do seu usuário do Windows.
# QUEM RODA É O PEDRO, numa janela do PowerShell (o Claude nunca vê a chave):
#
#   powershell -ExecutionPolicy Bypass -File C:\Users\olive\Projetos\sinapse-app\scripts\aion\aion-chave.ps1 -Servico brapi
#   powershell -ExecutionPolicy Bypass -File C:\Users\olive\Projetos\sinapse-app\scripts\aion\aion-chave.ps1 -Servico coingecko
#
#   brapi ...... token grátis em https://brapi.dev/dashboard (criar conta → "Seu token"). Sem ele, só
#                PETR4, MGLU3, VALE3 e ITUB4 têm cotação. Plano grátis: 15 mil requisições por mês.
#   coingecko .. chave Demo grátis em https://www.coingecko.com/en/developers/dashboard (opcional: sem
#                ela o Aion usa o endpoint público, com limite menor por minuto).
#
# Grava em %LOCALAPPDATA%\sinapse-aion\<servico>.cred, que só esta conta, nesta máquina, abre.
# Nada vai para o repositório, para a tela ou para o histórico do PowerShell.
#   -Remover   apaga a chave gravada
param([Parameter(Mandatory = $true)][ValidateSet('brapi', 'coingecko')][string]$Servico, [switch]$Remover)
$ErrorActionPreference = 'Stop'
$base = if ($env:SINAPSE_AION) { $env:SINAPSE_AION } else { Join-Path $env:LOCALAPPDATA 'sinapse-aion' }
$arq = Join-Path $base "$Servico.cred"

if ($Remover) {
  if (Test-Path -LiteralPath $arq) { Remove-Item -LiteralPath $arq -Force; "chave apagada: $arq" } else { 'não havia chave gravada' }
  return
}

function Texto([Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

$rotulo = if ($Servico -eq 'brapi') { 'Token da brapi' } else { 'Chave Demo da CoinGecko' }
$chave = (Texto (Read-Host $rotulo -AsSecureString)).Trim()
if ($chave -notmatch '^[\w.-]{8,200}$') { $chave = $null; throw 'isso não parece uma chave (letras, números, ponto, hífen; 8 a 200); nada gravado' }

$seguro = ConvertTo-SecureString $chave -AsPlainText -Force
$chave = $null
New-Item -ItemType Directory -Force -Path $base | Out-Null
($seguro | ConvertFrom-SecureString) | Set-Content -LiteralPath $arq -Encoding ASCII
Write-Host ''
Write-Host "Gravada (cifrada) em $arq."
Write-Host 'Teste agora, sem gravar nada:'
Write-Host '  cd C:\Users\olive\Projetos\sinapse-app; node scripts\aion\coletar.mjs --simular'
