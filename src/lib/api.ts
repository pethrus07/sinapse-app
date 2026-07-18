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
