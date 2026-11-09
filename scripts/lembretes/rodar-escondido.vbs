' rodar-escondido.vbs: roda um comando SEM JANELA e devolve o código de saída dele.
' Uso (no Agendador):  wscript.exe rodar-escondido.vbs programa.exe arg1 "arg com espaço" ...
'
' Por que existe: tarefa agendada que chama python.exe/pwsh.exe direto abre um console que
' pisca; e pythonw.exe sem console abre um cmd NOVO a cada subprocesso (git, npm). Aqui o
' processo nasce com o console escondido (janela 0) e os filhos herdam esse console, então
' nada aparece. Espera terminar (True) para o Agendador registrar sucesso ou falha.
Set sh = CreateObject("WScript.Shell")
cmd = ""
For Each a In WScript.Arguments
  If InStr(a, " ") > 0 Then a = """" & a & """"
  cmd = cmd & a & " "
Next
WScript.Quit sh.Run(Trim(cmd), 0, True)
