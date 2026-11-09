# Instala a tarefa do Agendador que mostra o lembrete do Sinapse na tela, sem janela (igual ao Hermes).
# Lê a janela e o intervalo do próprio LEMBRETES.md, então mudar lá e rodar de novo reinstala certo.
# Também registra o nome "Sinapse" no aviso (AppUserModelId, por usuário, sem admin).
#   pwsh -NoProfile -ExecutionPolicy Bypass -File C:\Users\olive\Projetos\sinapse-app\scripts\lembretes\instalar-tarefa.ps1 -Lembrete agua
#   ... -Remover   tira a tarefa
param([string]$Lembrete = "agua", [switch]$Remover)
$ErrorActionPreference = "Stop"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$raiz = Resolve-Path (Join-Path $aqui "..\..")
$vault = if ($env:VAULT_PATH) { $env:VAULT_PATH } else { Resolve-Path (Join-Path $raiz "..\sinapse") }
$nome = "Sinapse-Lembrete-$Lembrete"

if ($Remover) { Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue; Write-Host "tarefa $nome removida"; exit 0 }

$md = Get-Content (Join-Path $vault "99-MOCS\LEMBRETES.md") -Raw
if ($md -notmatch '```lembretes\s*\n([\s\S]*?)```') { throw "LEMBRETES.md sem bloco lembretes" }
$todos = $Matches[1] | ConvertFrom-Json
$l = $todos.$Lembrete
if (-not $l) { throw "lembrete '$Lembrete' não existe no LEMBRETES.md" }

$ini = [datetime]::ParseExact($l.inicio, "HH:mm", $null)
$fim = [datetime]::ParseExact($l.fim, "HH:mm", $null)
$intervalo = New-TimeSpan -Minutes ([int]$l.intervalo_min)
$duracao = ($fim - $ini) + (New-TimeSpan -Minutes 1)   # +1 min para o disparo do `fim` também sair

$vbs = Join-Path $aqui "rodar-escondido.vbs"
$node = (Get-Command node.exe).Source
$script = Join-Path $aqui "avisar.mjs"
$acao = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`" `"$node`" `"$script`" $Lembrete" -WorkingDirectory $raiz
$gatilho = if ($l.dias -eq "uteis") {
  New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $ini
} else { New-ScheduledTaskTrigger -Daily -At $ini }
$gatilho.Repetition = (New-ScheduledTaskTrigger -Once -At $ini -RepetitionInterval $intervalo -RepetitionDuration $duracao).Repetition
$conf = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $conf -Description "Sinapse: lembrete '$Lembrete' ($($l.inicio) a $($l.fim), a cada $($l.intervalo_min) min)" -Force | Out-Null

# nome e ícone do aviso: "Sinapse" em vez de "Windows PowerShell"
$chave = "HKCU:\Software\Classes\AppUserModelId\Sinapse.Avisos"
New-Item -Path $chave -Force | Out-Null
Set-ItemProperty -Path $chave -Name DisplayName -Value "Sinapse"
Set-ItemProperty -Path $chave -Name ShowInSettings -Value 0 -Type DWord

Write-Host "tarefa $nome instalada: $($l.dias), $($l.inicio) a $($l.fim), a cada $($l.intervalo_min) min" -ForegroundColor Green
Write-Host "teste agora:  node `"$script`" $Lembrete --simular"
