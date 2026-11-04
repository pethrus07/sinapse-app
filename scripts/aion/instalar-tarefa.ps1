# Instala a tarefa que coleta o dado de mercado do Aion (Selic, CDI, IPCA, dólar, Focus, Copom,
# cotações e cripto; fatos relevantes da CVM no máximo 1 vez por semana). NÃO É INSTALADA PELO
# CLAUDE: quem decide e roda é o Pedro. Por usuário, sem admin, escondida pelo rodar-escondido.vbs
# da Métis (nenhuma janela pisca).
#
#   powershell -ExecutionPolicy Bypass -File scripts\aion\instalar-tarefa.ps1                 instala (09:30 e 18:30, dias úteis)
#   powershell -ExecutionPolicy Bypass -File scripts\aion\instalar-tarefa.ps1 -Horas 10:00    um horário só
#   powershell -ExecutionPolicy Bypass -File scripts\aion\instalar-tarefa.ps1 -Remover        tira a tarefa
#
# Antes: rodar uma vez `node scripts\aion\coletar.mjs --simular` e conferir o resumo. A tarefa roda
# `--gravar`: grava só o cache local (%LOCALAPPDATA%\sinapse-aion\mercado.json); não mexe no vault
# nem no git. Consumo da brapi com token: ~7 ativos × 2 rodadas × 22 dias ≈ 310 chamadas/mês (o
# grátis dá 15 mil). Log de cada rodada em %LOCALAPPDATA%\sinapse-aion\logs\AAAA-MM.log.
param([string[]]$Horas = @('09:30', '18:30'), [switch]$Remover)
$ErrorActionPreference = 'Stop'
$nome = 'Aion-Coletar'

if ($Remover) {
  if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $nome -Confirm:$false; "tarefa $nome removida" }
  else { "tarefa $nome não estava instalada" }
  return
}

$app = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$node = (Get-Command node.exe).Source
$vbs = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'financas') 'rodar-escondido.vbs'
$cli = Join-Path $PSScriptRoot 'coletar.mjs'

$acao = New-ScheduledTaskAction -Execute 'wscript.exe' -WorkingDirectory $app -Argument "`"$vbs`" `"$node`" `"$cli`" --gravar"
$gatilhos = @($Horas | ForEach-Object { New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $_ })
$conf = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilhos -Settings $conf -Force `
  -Description 'Aion (investimentos do Sinapse): coleta dado de mercado de fontes permitidas e grava só o cache local.' | Out-Null
"tarefa $nome instalada: dias úteis às $($Horas -join ' e ') (escondida). Teste agora: Start-ScheduledTask -TaskName $nome"
