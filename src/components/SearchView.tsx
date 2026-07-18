import { useMemo } from 'react';
import type { Note } from '../types';
import { areaLabel } from '../lib/colors';

interface Props {
  notes: Note[];
  query: string;
  onOpen: (id: string) => void;
}

function snippet(body: string, q: string) {
  const i = body.toLowerCase().indexOf(q);
  if (i < 0) return body.slice(0, 120).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, i - 40);
  return (
    (start > 0 ? '…' : '') +
    body.slice(start, i + q.length + 70).replace(/\s+/g, ' ').trim() +
    '…'
  );
}

export function SearchView({ notes, query, onOpen }: Props) {
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [] as { n: Note; idx: number }[];
    return notes
      .map((n) => {
        const hay = (n.title + ' ' + (n.tags || []).join(' ') + ' ' + n.body).toLowerCase();
        const idx = hay.indexOf(q);
        return idx >= 0 ? { n, idx } : null;
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.idx - b.idx)
      .slice(0, 50) as { n: Note; idx: number }[];
  }, [q, notes]);

  return (
    <div className="pad-scroll">
      <h2 className="page-title">Busca</h2>
      {!q && <p className="muted">Digite na caixa de busca ao lado para procurar nas suas notas.</p>}
      {q && (
        <p className="muted small">
          {results.length} resultado(s) para “{query}”.
        </p>
      )}
      <div className="cards">
        {results.map(({ n }) => (
          <button key={n.id} className="card" onClick={() => onOpen(n.id)}>
            <div className="card-title">{n.title}</div>
            <div className="card-sub">{areaLabel(n.area)}</div>
            <div className="card-snippet">{snippet(n.body, q)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
