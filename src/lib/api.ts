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

export function lancarFinanceiro(lancamento: unknown) {
  return post('/api/financeiro', { acao: 'lancar', lancamento });
}

/** acao: 'liquidar' | 'reabrir' | 'remover' */
export function acaoFinanceiro(acao: string, mes: string, id: string) {
  return post('/api/financeiro', { acao, mes, id });
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
