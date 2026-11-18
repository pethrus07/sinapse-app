# Instala a tarefa do Agendador de um aviso de data única (bloco ```avisos do LEMBRETES.md).
# Dispara uma vez, na hora do `quando`; se a máquina estiver desligada ou dormindo, dispara quando
# voltar. A tarefa se apaga sozinha 7 dias depois.
#   pwsh -NoProfile -ExecutionPolicy Bypass -File C:\Users\olive\Projetos\sinapse-app\scripts\lembretes\instalar-aviso.ps1 -Aviso <id>
#   ... -Remover   tira a tarefa
param([Parameter(Mandatory)][string]$Aviso, [switch]$Remover)
$ErrorActionPreference = "Stop"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$raiz = Resolve-Path (Join-Path $aqui "..\..")
$vault = if ($env:VAULT_PATH) { $env:VAULT_PATH } else { Resolve-Path (Join-Path $raiz "..\sinapse") }
$nome = "Sinapse-Aviso-$Aviso"

if ($Remover) { Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue; Write-Host "tarefa $nome removida"; exit 0 }

$md = Get-Content (Join-Path $vault "99-MOCS\LEMBRETES.md") -Raw -Encoding UTF8
if ($md -notmatch '```avisos\s*\n([\s\S]*?)```') { throw "LEMBRETES.md sem bloco avisos" }
$a = ($Matches[1] | ConvertFrom-Json).$Aviso
if (-not $a) { throw "aviso '$Aviso' não existe no LEMBRETES.md" }
$quando = [datetime]::ParseExact($a.quando, "yyyy-MM-dd HH:mm", $null)
if ($quando -le (Get-Date)) { throw "o aviso '$Aviso' é de $($a.quando), que já passou" }

$vbs = Join-Path $aqui "rodar-escondido.vbs"
$node = (Get-Command node.exe).Source
$script = Join-Path $aqui "avisar-uma-vez.mjs"
$acao = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`" `"$node`" `"$script`" $Aviso" -WorkingDirectory $raiz
$gatilho = New-ScheduledTaskTrigger -Once -At $quando
$gatilho.EndBoundary = $quando.AddDays(7).ToString("s")   # sem fim, o Agendador recusa o "apagar depois"
$conf = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -DeleteExpiredTaskAfter (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $conf -Description "Sinapse: aviso '$Aviso' em $($a.quando)" -Force | Out-Null

# nome do aviso: "Sinapse" em vez de "Windows PowerShell" (mesma chave do instalar-tarefa.ps1)
$chave = "HKCU:\Software\Classes\AppUserModelId\Sinapse.Avisos"
if (-not (Test-Path $chave)) {
  New-Item -Path $chave -Force | Out-Null
  Set-ItemProperty -Path $chave -Name DisplayName -Value "Sinapse"
  Set-ItemProperty -Path $chave -Name ShowInSettings -Value 0 -Type DWord
}

Write-Host "tarefa $nome instalada para $($quando.ToString('dd/MM/yyyy HH:mm'))" -ForegroundColor Green
