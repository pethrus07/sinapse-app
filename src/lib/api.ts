async function post(url: string, body: unknown) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText || 'erro ao salvar');
  return j;
}

export function saveNote(payload: any) {
  return post('/api/note', payload);
}

export function setProgress(rel: string, progresso: string) {
  return post('/api/progress', { rel, progresso });
}

export function criarDaily(dia: string, body: string) {
  return post('/api/note', {
    rel: `01-DIARIO/${dia}.md`,
    tipo: 'daily',
    area: 'diario',
    tags: ['daily'],
    criado: dia,
    body,
  });
}

/** Põe (vaga=true) ou tira uma frente da vaga. Com as 3 ocupadas, `sai` diz quem dá lugar. */
export function trocarVaga(rel: string, vaga: boolean, sai?: string) {
  return post('/api/vaga', sai ? { rel, vaga, sai } : { rel, vaga });
}

/** Marca (ou desmarca) um compromisso das atas como feito. Estado local do app, fora do vault. */
export function marcarCompromisso(id: string, feito: boolean) {
  return post('/api/compromisso', { id, feito });
}

export function lancarFinanceiro(lancamento: unknown) {
  return post('/api/financeiro', { acao: 'lancar', lancamento });
}

/** acao: 'liquidar' | 'reabrir' | 'remover' */
export function acaoFinanceiro(acao: string, mes: string, id: string) {
  return post('/api/financeiro', { acao, mes, id });
}

/** Muda o estado de uma tarefa da nota de projeto (a linha é a chave). */
export function mudarTarefa(rel: string, linha: string, estado: string) {
  return post('/api/tarefa', { rel, linha, estado });
}

/** Acrescenta "- [ ] texto" na seção "## Tarefas" da nota. */
export function novaTarefa(rel: string, nova: string) {
  return post('/api/tarefa', { rel, nova });
}

export function lerDesenho(nota: string) {
  return get('/api/desenho?nota=' + encodeURIComponent(nota));
}

/** Gravar pelo app torna o desenho "do Pedro": o gerador não o sobrescreve mais. */
export function salvarDesenho(nota: string, cena: { elements: readonly unknown[]; appState?: unknown; files?: unknown }) {
  return post('/api/desenho?nota=' + encodeURIComponent(nota), cena);
}

async function get(url: string) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || r.statusText || 'erro ao ler');
  return j;
}

/** Indice vivo do vault. O JSON empacotado serve pro primeiro paint; a verdade vem daqui. */
export function buscarIndice() {
  return get('/api/indice');
}

export function buscarVersao(): Promise<{ versao: number }> {
  return get('/api/versao') as Promise<{ versao: number }>;
}
