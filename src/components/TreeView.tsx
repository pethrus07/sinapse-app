import { useMemo, useState } from 'react';
import type { Note } from '../types';
import { areaLabel, colorForArea } from '../lib/colors';

interface Props {
  notes: Note[];
  onOpen: (id: string) => void;
}

export function TreeView({ notes, onOpen }: Props) {
  const areas = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const n of notes) {
      const a = n.area || 'outros';
      if (!map.has(a)) map.set(a, []);
      map.get(a)!.push(n);
    }
    return [...map.entries()]
      .map(([area, items]) => ({
        area,
        items: items.sort((a, b) => (a.title > b.title ? 1 : -1)),
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [notes]);

  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(areas.map((a) => [a.area, true]))
  );

  return (
    <div className="pad-scroll">
      <div className="rm-hero">
        <div>
          <div className="eyebrow-mono">Árvore de conhecimento</div>
          <h1 className="rm-title">Tudo que você já plantou</h1>
          <p className="muted">
            {notes.length} notas ramificando em {areas.length} áreas. Clique numa folha pra abrir.
          </p>
        </div>
      </div>

      <div className="tree">
        <div className="tree-root">
          <span className="tree-root-dot">🧠</span> Sinapse
        </div>
        <div className="tree-branches">
          {areas.map((a) => (
            <div className="branch" key={a.area}>
              <button
                className="branch-head"
                onClick={() => setOpen((o) => ({ ...o, [a.area]: !o[a.area] }))}
              >
                <span className="branch-caret">{open[a.area] ? '▾' : '▸'}</span>
                <span className="branch-dot" style={{ background: colorForArea(a.area) }} />
                <span className="branch-name">{areaLabel(a.area)}</span>
                <span className="branch-count">{a.items.length}</span>
              </button>
              {open[a.area] && (
                <div className="leaves">
                  {a.items.map((n) => (
                    <button key={n.id} className="leaf" onClick={() => onOpen(n.id)}>
                      <span className="leaf-name">{n.title}</span>
                      {n.degree > 0 && <span className="leaf-deg">{n.degree}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
