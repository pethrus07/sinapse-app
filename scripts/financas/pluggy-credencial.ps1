# Guarda a credencial da Pluggy (Meu Pluggy) cifrada com DPAPI do seu usuário do Windows.
# QUEM RODA É O PEDRO, numa janela do PowerShell (o Claude nunca vê o segredo):
#
#   powershell -ExecutionPolicy Bypass -File C:\Users\olive\Projetos\sinapse-app\scripts\financas\pluggy-credencial.ps1
#
# Pergunta o Client ID, o Client Secret (digitação escondida) e o(s) itemId(s) do Dashboard
# (Applications → sua aplicação → Demo → Connected Items). Grava em
# %LOCALAPPDATA%\sinapse-financas\pluggy.cred, que só esta conta, nesta máquina, consegue abrir.
# Nada vai para o repositório, para a tela ou para o histórico do PowerShell.
#
#   -ItemId x  já preenche o itemId (Enter na pergunta aceita). O itemId não é segredo, mas não
#              entra no repositório (é público): vai só no comando e no arquivo cifrado.
#   -Remover   apaga a credencial gravada
param([string]$ItemId = '', [switch]$Remover)
$ErrorActionPreference = 'Stop'
$base = if ($env:SINAPSE_FINANCAS) { $env:SINAPSE_FINANCAS } else { Join-Path $env:LOCALAPPDATA 'sinapse-financas' }
$arq = if ($env:SINAPSE_PLUGGY_CRED) { $env:SINAPSE_PLUGGY_CRED } else { Join-Path $base 'pluggy.cred' }

if ($Remover) {
  if (Test-Path -LiteralPath $arq) { Remove-Item -LiteralPath $arq -Force; "credencial apagada: $arq" } else { 'não havia credencial gravada' }
  return
}

function Texto([Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

Write-Host ''
Write-Host 'Credencial da Pluggy (Meu Pluggy). Pegue os três no dashboard.pluggy.ai:'
Write-Host '  Client ID ........ Applications, na linha da sua aplicação'
Write-Host '  Client Secret .... aparece uma vez só; se perdeu, gere outro na página da aplicação'
Write-Host '  itemId ........... Applications → aplicação → Demo → Connected Items → id do item MeuPluggy'
Write-Host ''
$id = Texto (Read-Host 'Client ID' -AsSecureString)
$segredo = Texto (Read-Host 'Client Secret' -AsSecureString)
if ($ItemId) {
  $resp = Read-Host "itemId [Enter = $ItemId]"
  $itens = if ($resp) { $resp } else { $ItemId }
} else {
  $itens = Read-Host 'itemId (se tiver mais de um, separe por vírgula)'
}

$lista = @($itens -split '[\s,;]+' | Where-Object { $_ })
if (-not $id -or -not $segredo -or -not $lista.Count) { throw 'faltou algum dos três; nada gravado' }
$guid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
foreach ($i in $lista) { if ($i -notmatch $guid) { throw 'um itemId não tem o formato de id da Pluggy (8-4-4-4-12); nada gravado' } }

$json = @{ clientId = $id; clientSecret = $segredo; itemIds = $lista } | ConvertTo-Json -Compress
$seguro = ConvertTo-SecureString $json -AsPlainText -Force
$id = $null; $segredo = $null; $json = $null

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $arq) | Out-Null
($seguro | ConvertFrom-SecureString) | Set-Content -LiteralPath $arq -Encoding ASCII
Write-Host ''
Write-Host "Gravado (cifrado) em $arq com $($lista.Count) item(ns)."
Write-Host 'Teste agora, sem baixar transação nenhuma:'
Write-Host '  cd C:\Users\olive\Projetos\sinapse-app; node scripts\financas\sincronizar.mjs --testar'
