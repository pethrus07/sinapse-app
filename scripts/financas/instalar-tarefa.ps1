# Instala a tarefa diária que sincroniza o banco com o razão do vault (NÃO foi instalada: o Pedro
# decide quando). Por usuário, sem admin, rodando escondida pelo rodar-escondido.vbs (mesmo padrão
# do manutencao-xps e do Hermes: nenhuma janela pisca).
#
#   powershell -ExecutionPolicy Bypass -File scripts\financas\instalar-tarefa.ps1            instala (07:30, todo dia)
#   powershell -ExecutionPolicy Bypass -File scripts\financas\instalar-tarefa.ps1 -Hora 09:00
#   powershell -ExecutionPolicy Bypass -File scripts\financas\instalar-tarefa.ps1 -Remover   tira a tarefa
#
# Antes de instalar: credencial gravada (pluggy-credencial.ps1), --testar ok e um --simular revisado.
# A tarefa roda --gravar: liquida previstos e lança transações no vault, mas NÃO faz commit. O resumo
# de cada rodada vai para %LOCALAPPDATA%\sinapse-financas\logs\AAAA-MM.log.
# O Meu Pluggy atualiza 1 vez por dia; rodar mais vezes não traz nada novo.
param([string]$Hora = '07:30', [switch]$Remover)
$ErrorActionPreference = 'Stop'
$nome = 'Sinapse-Financas'

if ($Remover) {
  if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $nome -Confirm:$false; "tarefa $nome removida" }
  else { "tarefa $nome não estava instalada" }
  return
}

$app = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$node = (Get-Command node.exe).Source
$vbs = Join-Path $PSScriptRoot 'rodar-escondido.vbs'
$cli = Join-Path $PSScriptRoot 'sincronizar.mjs'
$cred = Join-Path (Join-Path $env:LOCALAPPDATA 'sinapse-financas') 'pluggy.cred'
if (-not (Test-Path -LiteralPath $cred)) { throw "credencial não encontrada ($cred): rode antes o pluggy-credencial.ps1" }

$acao = New-ScheduledTaskAction -Execute 'wscript.exe' -WorkingDirectory $app -Argument "`"$vbs`" `"$node`" `"$cli`" --gravar"
$gatilho = New-ScheduledTaskTrigger -Daily -At $Hora
$conf = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $conf -Force `
  -Description 'Sinapse: lê Nubank e Inter pelo Open Finance (Meu Pluggy, só leitura) e grava no razão do vault. Não faz commit.' | Out-Null
"tarefa $nome instalada: todo dia às $Hora (escondida). Teste agora: Start-ScheduledTask -TaskName $nome"
