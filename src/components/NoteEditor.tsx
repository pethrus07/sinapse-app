import { useState } from 'react';
import type { Note } from '../types';
import { saveNote } from '../lib/api';

const AREAS = ['estudo', 'projetos', 'negocio', 'ideias', 'pessoas', 'fontes'];

interface Props {
  mode: 'new' | 'edit';
  note?: Note;
  onIndex: (idx: any) => void;
  onDone: (id: string) => void;
  onCancel: () => void;
}

export function NoteEditor({ mode, note, onIndex, onDone, onCancel }: Props) {
  const initialTitle =
    mode === 'new'
      ? new URLSearchParams(window.location.hash.split('?')[1] || '').get('title') || ''
      : note?.title || '';

  const [area, setArea] = useState(note?.area || 'estudo');
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState((note?.tags || []).join(', '));
  const [progresso, setProgresso] = useState(note?.progresso || '');
  const [body, setBody] = useState(
    mode === 'edit' ? note?.body || '' : `# ${initialTitle || 'Nova nota'}\n\n`
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setSaving(true);
    setErr('');
    try {
      const payload: any = {
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        body,
      };
      if (mode === 'edit') {
        payload.rel = note!.rel;
        if (note!.area === 'estudo') payload.progresso = progresso;
      } else {
        payload.area = area;
        payload.tipo = 'nota';
        payload.title = title || 'Nova nota';
        if (!body.trim().startsWith('#')) payload.body = `# ${title || 'Nova nota'}\n\n${body}`;
      }
      const resp = await saveNote(payload);
      onIndex(resp);
      onDone(resp.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pad-scroll">
      <div className="editor">
        <div className="editor-head">
          <h2 className="page-title">{mode === 'new' ? 'Nova nota' : 'Editar nota'}</h2>
          <div className="editor-actions">
            <button className="btn ghost" onClick={onCancel} disabled={saving}>
              Cancelar
            </button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
        {err && <div className="editor-err">Erro: {err}</div>}
        <div className="editor-fields">
          {mode === 'new' && (
            <>
              <label>
                Área
                <select value={area} onChange={(e) => setArea(e.target.value)}>
                  {AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Título
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título da nota" />
              </label>
            </>
          )}
          <label>
            Tags (vírgula)
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="backend, estudo" />
          </label>
          {mode === 'edit' && note?.area === 'estudo' && (
            <label>
              Progresso
              <select value={progresso} onChange={(e) => setProgresso(e.target.value)}>
                <option value="">—</option>
                <option value="a-fazer">a fazer</option>
                <option value="estudando">estudando</option>
                <option value="revisar">revisar</option>
                <option value="dominado">dominado</option>
              </select>
            </label>
          )}
        </div>
        <textarea
          className="editor-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
          placeholder="# Título&#10;&#10;Escreva em markdown. Ligue outras notas com [[nome-da-nota]]."
        />
        <p className="muted small">
          Markdown + wikilinks <code>[[nome-da-nota]]</code>. Salvar escreve direto no vault e reindexa na hora.
        </p>
      </div>
    </div>
  );
}
