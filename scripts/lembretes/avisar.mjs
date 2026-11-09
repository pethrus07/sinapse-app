// Lembretes do Sinapse na tela do Windows (09/11/2026), no mesmo mecanismo do Hermes (toast nativo
// por PowerShell, sem janela). O que avisar mora no vault: ../sinapse/99-MOCS/LEMBRETES.md, bloco
// ```lembretes (JSON). Este script só lê o bloco, monta o texto e mostra.
//
//   node scripts/lembretes/avisar.mjs agua            mostra o lembrete "agua" agora
//   node scripts/lembretes/avisar.mjs agua --simular  imprime o que mostraria, sem toast
//   node scripts/lembretes/avisar.mjs --listar        os lembretes do vault
//
// Chamado pelo Agendador (instalar-tarefa.ps1), que repete no intervalo do lembrete. Se a tarefa rodar
// fora da janela (máquina acordou tarde, por exemplo), o aviso não aparece.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VAULT = process.env.VAULT_PATH || path.resolve(RAIZ, "..", "sinapse");
const ARQUIVO = path.join(VAULT, "99-MOCS", "LEMBRETES.md");

export function lerLembretes(texto) {
  const m = texto.match(/```lembretes\s*\n([\s\S]*?)```/);
  if (!m) throw new Error("LEMBRETES.md sem bloco ```lembretes");
  return JSON.parse(m[1]);
}

const minutos = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };

// Em qual aviso do bloco estamos (1..total) para uma hora do dia; null fora da janela ou em dia sem aviso.
export function posicaoNoBloco(lembrete, d = new Date()) {
  const dia = d.getDay();
  if (lembrete.dias === "uteis" && (dia === 0 || dia === 6)) return null;
  const ini = minutos(lembrete.inicio), fim = minutos(lembrete.fim), passo = Number(lembrete.intervalo_min || 60);
  const agora = d.getHours() * 60 + d.getMinutes();
  if (agora < ini - 5 || agora > fim + 25) return null; // tolerância: a tarefa pode atrasar alguns minutos
  const total = Math.floor((fim - ini) / passo) + 1;
  const feitos = Math.min(total, Math.max(1, Math.round((agora - ini) / passo) + 1));
  return { feitos, total };
}

export function montarTexto(lembrete, pos) {
  return String(lembrete.texto).replace("{feitos}", pos?.feitos ?? "").replace("{total}", pos?.total ?? "");
}

// Igual ao Hermes (src/avisos.mjs): XML do toast e PowerShell com WinRT. O AppUserModelId "Sinapse.Avisos"
// é registrado pelo instalar-tarefa.ps1 para o aviso sair com o nome Sinapse; sem ele, sai como PowerShell.
export function xmlDoToast(titulo, texto, persistente = false) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "''");
  const linhas = String(texto).split(/\r?\n/).filter(Boolean).slice(0, 2).map((l) => `<text>${esc(l)}</text>`).join("");
  const corpo = `<visual><binding template="ToastGeneric"><text>${esc(titulo)}</text>${linhas}</binding></visual>`;
  return persistente
    ? `<toast scenario="reminder">${corpo}<actions><action content="Feito" activationType="system" arguments="dismiss"/></actions></toast>`
    : `<toast>${corpo}</toast>`;
}

export function toast(titulo, texto, persistente = false) {
  const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('${xmlDoToast(titulo, texto, persistente)}')
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
if (Test-Path 'HKCU:\\Software\\Classes\\AppUserModelId\\Sinapse.Avisos') { $app = 'Sinapse.Avisos' }
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", ps], { encoding: "utf8", windowsHide: true });
  return r.status === 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const lembretes = lerLembretes(fs.readFileSync(ARQUIVO, "utf8"));
  if (args.includes("--listar")) {
    for (const [id, l] of Object.entries(lembretes)) console.log(`${id}: ${l.titulo} · ${l.dias} ${l.inicio}–${l.fim} a cada ${l.intervalo_min} min`);
    process.exit(0);
  }
  const id = args.find((a) => !a.startsWith("--"));
  const l = id && lembretes[id];
  if (!l) { console.error(`lembrete não encontrado: ${id || "(nenhum)"}; use --listar`); process.exit(2); }
  const pos = posicaoNoBloco(l);
  if (!pos) { console.log(`fora da janela de "${id}" agora; nada a mostrar`); process.exit(0); }
  const texto = montarTexto(l, pos);
  if (args.includes("--simular")) { console.log(`[${l.titulo}] ${texto}`); process.exit(0); }
  process.exit(toast(l.titulo, texto, Boolean(l.persistente)) ? 0 : 1);
}
