import { useMemo } from 'react';
import type { Note } from '../types';

interface Props {
  notes: Note[];
  onOpen: (id: string) => void;
  onProgress: (rel: string, progresso: string) => void;
}

// `progresso` é o eixo do estudo (o `status` da nota é o ciclo de vida, outro eixo).
const STATUS: Record<string, { label: string }> = {
  dominado: { label: 'dominado' },
  revisar: { label: 'revisar' },
  estudando: { label: 'estudando' },
  'a-fazer': { label: 'a fazer' },
};
const CYCLE = ['a-fazer', 'estudando', 'revisar', 'dominado'];
const nextProg = (st: string) => CYCLE[(CYCLE.indexOf(st) + 1) % CYCLE.length];

export function RoadmapView({ notes, onOpen, onProgress }: Props) {
  const tracks = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const n of notes) {
      if ((n.area || '').toLowerCase() !== 'estudo') continue;
      if (!n.trilha) continue;
      if (!map.has(n.trilha)) map.set(n.trilha, []);
      map.get(n.trilha)!.push(n);
    }
    const arr = [...map.entries()].map(([name, items]) => {
      items.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999));
      const total = items.length;
      const done = items.filter((i) => i.progresso === 'dominado').length;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const current = items.find((i) => i.progresso !== 'dominado');
      return { name, items, total, done, pct, currentId: current?.id };
    });
    arr.sort((a, b) => (a.name === 'Método' ? -1 : b.name === 'Método' ? 1 : b.total - a.total));
    return arr;
  }, [notes]);

  const totalMil = tracks.reduce((s, t) => s + t.total, 0);
  const totalDone = tracks.reduce((s, t) => s + t.done, 0);
  const overallPct = totalMil ? Math.round((totalDone / totalMil) * 100) : 0;
  const nextTrack = tracks.find((t) => t.pct < 100 && t.currentId);
  const nextNote = nextTrack ? notes.find((n) => n.id === nextTrack.currentId) : undefined;

  return (
    <div className="pad-scroll">
      <div className="rm-hero">
        <div>
          <div className="eyebrow-mono">Roadmap de estudo</div>
          <h1 className="rm-title">Sua trilha de conhecimento</h1>
          <p className="muted">Clique no número de cada marco pra avançar: a fazer → estudando → revisar → dominado. A meta é ver tudo verde.</p>
        </div>
        <div className="rm-ring" style={{ ['--p' as any]: overallPct }}>
          <div className="rm-ring-num">{overallPct}%</div>
          <div className="rm-ring-sub">{totalDone}/{totalMil}</div>
        </div>
      </div>

      {nextNote && (
        <div className="rm-next">
          <span className="muted small">Próximo passo</span>
          <button className="conn" onClick={() => onOpen(nextNote.id)}>▶ {nextNote.title}</button>
        </div>
      )}

      {tracks.map((t) => (
        <section className="track" key={t.name}>
          <div className="track-head">
            <h3>{t.name}</h3>
            <div className="track-prog">
              <div className="track-bar">
                <div className="track-fill" style={{ width: t.pct + '%' }} />
              </div>
              <span className="track-count">{t.done}/{t.total}</span>
            </div>
          </div>
          <div className="spine">
            {t.items.map((n, i) => {
              const st = (n.progresso && STATUS[n.progresso] ? n.progresso : 'a-fazer') as string;
              const isCurrent = n.id === t.currentId;
              return (
                <div key={n.id} className={'milestone ms-' + st + (isCurrent ? ' current' : '')}>
                  <button
                    className="ms-node"
                    title="clique pra avançar o progresso"
                    onClick={() => onProgress(n.rel, nextProg(st))}
                  >
                    {st === 'dominado' ? '✓' : n.ordem ?? i + 1}
                  </button>
                  <button className="ms-body-btn" onClick={() => onOpen(n.id)}>
                    <span className="ms-title">{n.title}</span>
                    <span className="ms-status">
                      {STATUS[st]?.label || st}
                      {isCurrent ? ' · você está aqui' : ''}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {!tracks.length && (
        <p className="muted">Nenhuma trilha ainda. Adicione `trilha:`, `ordem:` e `progresso:` no frontmatter das notas de estudo.</p>
      )}
    </div>
  );
}
