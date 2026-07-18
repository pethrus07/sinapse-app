import { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import type { Note } from '../types';
import { areaLabel, colorForArea } from '../lib/colors';

interface Props {
  note: Note;
  byId: Map<string, Note>;
  onNav: (path: string) => void;
}

export function NoteView({ note, byId, onNav }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => marked.parse(note.body) as string, [note.body]);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [note.id]);

  function onClick(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('wl:')) {
      e.preventDefault();
      onNav('/note/' + encodeURIComponent(href.slice(3)));
    } else if (href.startsWith('wlx:')) {
      e.preventDefault();
    } else if (/^https?:/.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }

  const outgoing = note.links.map((id) => byId.get(id)).filter(Boolean) as Note[];
  const incoming = note.backlinks.map((id) => byId.get(id)).filter(Boolean) as Note[];

  return (
    <div className="note-scroll" ref={ref}>
      <article className="note">
        <div className="note-meta">
          <span className="chip" style={{ ['--c' as any]: colorForArea(note.area) }}>
            {areaLabel(note.area)}
          </span>
          <span className="chip ghost">{note.type}</span>
          {note.status && <span className="chip ghost">{note.status}</span>}
          {note.tags?.map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
        </div>

        <div className="note-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />

        <div className="rel">📄 {note.rel}</div>

        <div className="conn-grid">
          <section>
            <h4>🔗 Liga para ({outgoing.length})</h4>
            {outgoing.length ? (
              outgoing.map((n) => (
                <a key={n.id} className="conn" href={'#/note/' + encodeURIComponent(n.id)}>
                  {n.title}
                </a>
              ))
            ) : (
              <p className="muted small">nada ainda — use a regra dos 3 links</p>
            )}
          </section>
          <section>
            <h4>← Backlinks ({incoming.length})</h4>
            {incoming.length ? (
              incoming.map((n) => (
                <a key={n.id} className="conn" href={'#/note/' + encodeURIComponent(n.id)}>
                  {n.title}
                </a>
              ))
            ) : (
              <p className="muted small">ninguém aponta pra cá ainda</p>
            )}
          </section>
        </div>
      </article>
    </div>
  );
}
