// Aviso de data única do Sinapse (18/11/2026): o "alarme" de um compromisso, no mesmo toast do
// avisar.mjs. O que avisar mora no vault: ../sinapse/99-MOCS/LEMBRETES.md, bloco ```avisos (JSON):
//   { "id": { "quando": "AAAA-MM-DD HH:MM", "titulo": "...", "texto": "..." } }
//
//   node scripts/lembretes/avisar-uma-vez.mjs <id>            mostra o aviso agora (fica até clicar)
//   node scripts/lembretes/avisar-uma-vez.mjs <id> --simular  imprime o que mostraria, sem toast
//   node scripts/lembretes/avisar-uma-vez.mjs --listar        os avisos do vault
//
// Chamado pelo Agendador (instalar-aviso.ps1), uma vez, na hora do `quando`. O texto fica no vault e
// a tarefa só carrega o id, então acento não passa pela linha de comando.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toast } from "./avisar.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VAULT = process.env.VAULT_PATH || path.resolve(RAIZ, "..", "sinapse");
const ARQUIVO = path.join(VAULT, "99-MOCS", "LEMBRETES.md");

export function lerAvisos(texto) {
  const m = texto.match(/```avisos\s*\n([\s\S]*?)```/);
  if (!m) throw new Error("LEMBRETES.md sem bloco ```avisos");
  return JSON.parse(m[1]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const avisos = lerAvisos(fs.readFileSync(ARQUIVO, "utf8"));
  if (args.includes("--listar")) {
    for (const [id, a] of Object.entries(avisos)) console.log(`${id}: ${a.quando} · ${a.titulo} · ${a.texto}`);
    process.exit(0);
  }
  const id = args.find((a) => !a.startsWith("--"));
  const a = id && avisos[id];
  if (!a) { console.error(`aviso não encontrado: ${id || "(nenhum)"}; use --listar`); process.exit(2); }
  if (args.includes("--simular")) { console.log(`[${a.titulo}] ${a.texto} (${a.quando})`); process.exit(0); }
  process.exit(toast(a.titulo, a.texto, true) ? 0 : 1);
}
