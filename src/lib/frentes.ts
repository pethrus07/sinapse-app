import type { Note } from '../types';

/* Frentes: no máximo 3 em andamento (as "vagas"); o resto espera em estados que não
   ocupam vaga. Tudo derivado do frontmatter do vault — nada de lista paralela.

   em andamento  `vaga: true`              (máx. 3; a 4ª pergunta "qual sai?")
   esperando     `status: aguardando`      (+ `esperando: quem`, `cutucar: AAAA-MM-DD`)
   sob demanda   `status: em-producao`     (no ar; pedido do cliente entra aqui)
   na fila       `status: ativo` sem vaga
   parado        `status: pausado`         (+ `motivo:`; gatilho de volta no RETOMAR)

   A Parresia é a faixa fixa do dia: não ocupa vaga nem entra nas listas. */

export const MAX_VAGAS = 3;
export const DIAS_ALERTA = 7; // vaga sem commit há 7+ dias

export type Estado = 'vaga' | 'esperando' | 'demanda' | 'fila' | 'parado';

export interface Frente {
  note: Note;
  nome: string;
  estado: Estado;
  dias: number | null; // desde o último movimento
}

export function ehParresia(n: Note): boolean {
  return (n.tags || []).some((t) => String(t).toLowerCase() === 'parresia') || /parresia/i.test(n.cliente || '');
}

/** "🎙️ Atas — o registro oficial…" -> "Atas"; "Ware IoT (ex-Celiware IHM) — …" -> "Ware IoT". */
export function nomeCurto(titulo: string): string {
  const semIcone = titulo.replace(/^[^\p{L}\p{N}]+/u, '');
  return semIcone.split(/\s[—–-]\s|\s\(|:\s/)[0].trim() || titulo;
}

function diasDesde(seg: number | null | undefined, agora: number): number | null {
  if (!seg) return null;
  return Math.max(0, Math.floor((agora - seg * 1000) / 86_400_000));
}

function estadoDe(n: Note): Estado | null {
  if (n.vaga) return 'vaga';
  switch (n.status) {
    case 'aguardando': return 'esperando';
    case 'em-producao': return 'demanda';
    case 'ativo': return 'fila';
    case 'pausado': return 'parado';
    default: return null;
  }
}

export function separarFrentes(notes: Note[], agora = Date.now()) {
  const grupos: Record<Estado, Frente[]> = { vaga: [], esperando: [], demanda: [], fila: [], parado: [] };
  const parresia: Note[] = [];
  for (const n of notes) {
    if (n.type !== 'projeto' || !n.atividade) continue;
    const estado = estadoDe(n);
    if (!estado) continue;
    if (ehParresia(n)) {
      parresia.push(n);
      continue;
    }
    grupos[estado].push({ note: n, nome: nomeCurto(n.title), estado, dias: diasDesde(n.atividade.ultimo, agora) });
  }
  // mais recente primeiro; sem movimento conhecido vai para o fim
  const porMovimento = (a: Frente, b: Frente) => (a.dias ?? 1e9) - (b.dias ?? 1e9) || a.nome.localeCompare(b.nome);
  for (const k of Object.keys(grupos) as Estado[]) grupos[k].sort(porMovimento);
  return { ...grupos, parresia };
}

/* ---------- horas pelo método de sessões ----------
   Commits a até 120 min um do outro formam uma sessão; cada sessão vale
   (último − primeiro) + 40 min, o trabalho antes do primeiro commit. É PISO:
   reunião, conversa e o que não vira commit ficam de fora. Commit que aparece
   em duas frentes (mesmo repo declarado nas duas) conta uma vez só. */
const GAP = 120 * 60;
const ANTES = 40 * 60;

export function horasPorSessao(commits: Iterable<number>, desde: number): number {
  const ts = [...new Set(commits)].filter((t) => t >= desde).sort((a, b) => a - b);
  if (!ts.length) return 0;
  let total = 0;
  let ini = ts[0];
  let fim = ts[0];
  for (const t of ts.slice(1)) {
    if (t - fim <= GAP) {
      fim = t;
    } else {
      total += fim - ini + ANTES;
      ini = fim = t;
    }
  }
  total += fim - ini + ANTES;
  return total / 3600;
}

export function inicioDaSemana(agora = Date.now()): number {
  return Math.floor(agora / 1000) - 7 * 86400; // últimos 7 dias, não a semana do calendário
}

export function horasDe(frentes: Frente[], desde: number): number {
  return horasPorSessao(frentes.flatMap((f) => f.note.atividade?.commits || []), desde);
}

export function fmtHoras(h: number): string {
  if (h <= 0) return '0 h';
  if (h < 1) return Math.round(h * 60) + ' min';
  return (Math.round(h * 2) / 2).toLocaleString('pt-BR') + ' h';
}

export function fmtDias(d: number | null): string {
  if (d == null) return 'sem registro';
  if (d === 0) return 'hoje';
  if (d === 1) return 'ontem';
  return `há ${d} dias`;
}

/** Para quem espera: "desde hoje", "desde ontem", "há 5 dias". */
export function fmtEspera(d: number | null): string {
  if (d == null) return '';
  if (d === 0) return 'desde hoje';
  if (d === 1) return 'desde ontem';
  return `há ${d} dias`;
}

export function fmtData(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}` : ymd;
}
