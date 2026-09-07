# Abre o Sinapse como aplicativo.
#
# Sobe o dev server se ninguém estiver na porta (o servidor é necessário: os endpoints
# de ESCRITA no vault — daily, progresso, financeiro — vivem no plugin do Vite), espera
# ele responder e abre numa janela de app, sem barra de endereço.
#
# Chamado pelo atalho da área de trabalho, via abrir-sinapse.cmd.

$ErrorActionPreference = 'Stop'

$app   = Split-Path -Parent $PSScriptRoot
$porta = 5173
$rota  = '#/agenda'          # <-- tela de entrada; troque para '' (Roadmap), '#/financeiro' etc.
$url   = "http://localhost:$porta/$rota"

function Responde {
  try {
    (Invoke-WebRequest -Uri "http://localhost:$porta/" -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200
  } catch {
    $false
  }
}

if (-not (Responde)) {
  # janela minimizada, não escondida: se o npm quebrar, dá pra abrir e ler o erro
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev' `
    -WorkingDirectory $app -WindowStyle Minimized
  for ($i = 0; $i -lt 60; $i++) {          # até 30s
    if (Responde) { break }
    Start-Sleep -Milliseconds 500
  }
}

if (-not (Responde)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "O servidor do Sinapse nao subiu em 30 segundos.`n`nAbra a janela minimizada do npm na barra de tarefas pra ver o erro.",
    'Sinapse'
  ) | Out-Null
  exit 1
}

# janela de app (sem barra de endereço) quando houver Chrome ou Edge; senão, navegador padrão
$navegador = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($navegador) {
  Start-Process -FilePath $navegador -ArgumentList "--app=$url"
} else {
  Start-Process $url
}
