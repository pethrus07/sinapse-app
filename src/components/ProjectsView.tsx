import { useMemo } from 'react';
import type { Note } from '../types';

interface Props {
  notes: Note[];
  onOpen: (id: string) => void;
}

const STATUS_ORDER = ['producao', 'ativo', 'proposta', 'aguardando-cliente', 'incubando', ''];
const STATUS_META: Record<string, { label: string; cls: string }> = {
  producao: { label: 'em produção', cls: 'st-prod' },
  ativo: { label: 'ativo', cls: 'st-ativo' },
  proposta: { label: 'proposta', cls: 'st-prop' },
  'aguardando-cliente': { label: 'aguardando cliente', cls: 'st-wait' },
  incubando: { label: 'incubando', cls: 'st-inc' },
};

export function ProjectsView({ notes, onOpen }: Props) {
  const groups = useMemo(() => {
    const projs = notes.filter((n) => n.type === 'projeto');
    const map = new Map<string, Note[]>();
    for (const n of projs) {
      const s = n.status || '';
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(n);
    }
    return [...map.entries()]
      .sort((a, b) => {
        const ia = STATUS_ORDER.indexOf(a[0]);
        const ib = STATUS_ORDER.indexOf(b[0]);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .map(([status, items]) => ({ status, items: items.sort((a, b) => b.degree - a.degree) }));
  }, [notes]);

  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const prod = groups.find((g) => g.status === 'producao')?.items.length || 0;

  return (
    <div className="pad-scroll">
      <div className="rm-hero">
        <div>
          <div className="eyebrow-mono">Projetos</div>
          <h1 className="rm-title">{total} projetos no radar</h1>
          <p className="muted">{prod} em produção · o resto ativo, em proposta ou aguardando cliente.</p>
        </div>
      </div>

      {groups.map((g) => {
        const meta = STATUS_META[g.status] || { label: g.status || 'sem status', cls: 'st-none' };
        return (
          <section className="pgroup" key={g.status || 'none'}>
            <div className="pgroup-head">
              <span className={'st-pill ' + meta.cls}>{meta.label}</span>
              <span className="muted small">{g.items.length}</span>
            </div>
            <div className="cards">
              {g.items.map((n) => (
                <button key={n.id} className="card proj-card" onClick={() => onOpen(n.id)}>
                  <div className="card-title">{n.title}</div>
                  {n.cliente && <div className="card-sub">{n.cliente}</div>}
                  <div className="proj-meta">
                    {n.stack && <span className="mini-chip">{n.stack}</span>}
                    <span className="mini-chip ghost">{n.degree} conexões</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
