# Primeira ligação das finanças com o Meu Pluggy, num comando só.
#
#   powershell -ExecutionPolicy Bypass -File C:\Users\olive\Projetos\sinapse-app\scripts\financas\primeira-vez.ps1 -ItemId <id>
#
# Faz, em ordem, e para no primeiro erro:
#   1. pede o Client ID e o Client Secret (digitação escondida) e guarda cifrado (DPAPI);
#   2. testa a conexão: lista as contas com os 4 últimos dígitos, sem baixar transação;
#   3. cria o arquivo de regras local a partir do exemplo, se ainda não existir;
#   4. roda a sincronização em SIMULAÇÃO: mostra o que casaria com o razão, sem gravar nada.
# Gravar no razão é outro passo, de propósito (npm run financas:gravar), depois de conferir.
param([string]$ItemId = '')

$ErrorActionPreference = 'Stop'
$app = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$base = Join-Path $env:LOCALAPPDATA 'sinapse-financas'

function Passo($n, $t) { Write-Host ''; Write-Host "== $n. $t" -ForegroundColor Cyan }

Passo 1 'Credencial do Meu Pluggy'
& (Join-Path $PSScriptRoot 'pluggy-credencial.ps1') -ItemId $ItemId
if (-not (Test-Path (Join-Path $base 'pluggy.cred'))) { throw 'A credencial não foi gravada.' }

Push-Location $app
try {
  Passo 2 'Testar a conexão (sem transações)'
  npm run --silent financas:testar
  if ($LASTEXITCODE -ne 0) { throw 'O teste de conexão falhou: confira o Client ID, o Client Secret e o itemId.' }

  Passo 3 'Regras locais'
  $regras = Join-Path $base 'regras\regras.json'
  if (Test-Path $regras) {
    Write-Host "   já existe: $regras"
  } else {
    New-Item -ItemType Directory -Force (Split-Path $regras) | Out-Null
    Copy-Item (Join-Path $PSScriptRoot 'regras.exemplo.json') $regras
    Write-Host "   criado a partir do exemplo: $regras"
  }

  Passo 4 'Sincronizar em simulação (não grava nada)'
  npm run --silent financas:simular
  if ($LASTEXITCODE -ne 0) { throw 'A simulação falhou.' }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Pronto. Nada foi gravado no razão. Mande o resultado da simulação para conferir.' -ForegroundColor Green
