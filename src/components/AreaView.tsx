import { useMemo, useState } from 'react';
import type { Note } from '../types';
import { areaLabel, colorForArea } from '../lib/colors';
import { STATUS_META, STATUS_ORDER } from './ProjectsView';

interface Props {
  area: string;
  notes: Note[];
  onOpen: (id: string) => void;
}

// primeira frase de verdade do corpo (sem título, citação, lista, tabela ou marcação), para o cartão
function trecho(body: string): string {
  for (const bruta of body.split('\n')) {
    const l = bruta.trim();
    if (!l || /^(#|>|\||-|\*|```|!\[|---)/.test(l)) continue;
    const limpa = l
      .replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_, a, __, b) => b || a)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`]/g, '')
      .trim();
    if (limpa.length >= 30) return limpa.length > 160 ? limpa.slice(0, 158).replace(/\s+\S*$/, '') + '…' : limpa;
  }
  return '';
}
const dataCurta = (d?: string) => {
  if (!d) return '';
  const [a, m, dia] = d.split('-');
  return dia && m ? `${dia}/${m}/${a.slice(2)}` : d;
};

// Página de uma área: notas separadas por estado (o que está andando primeiro), cada cartão com um
// trecho da nota, o estado e as conexões. Os filtros no topo deixam ver um estado só.
export function AreaView({ area, notes, onOpen }: Props) {
  const [filtro, setFiltro] = useState<string | null>(null);
  const cor = colorForArea(area);

  const grupos = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of notes) {
      const s = STATUS_META[n.status || ''] ? n.status : '';
      if (!m.has(s)) m.set(s, []);
      m.get(s)!.push(n);
    }
    return [...m.entries()]
      .sort((a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0]))
      .map(([s, l]) => ({ status: s, notas: l.sort((x, y) => y.degree - x.degree || (x.title > y.title ? 1 : -1)) }));
  }, [notes]);
  const andando = notes.filter((n) => ['ativo', 'em-producao', 'aguardando'].includes(n.status || '')).length;
  const nome = (s: string) => STATUS_META[s]?.label || 'sem status';

  return (
    <div className="pad-scroll">
      <div className="area-page">
        <header className="area-topo" style={{ borderColor: cor }}>
          <div className="eyebrow-mono" style={{ color: cor }}>Área</div>
          <h1 className="rm-title">{areaLabel(area)}</h1>
          <p className="muted small">
            {notes.length} {notes.length === 1 ? 'nota' : 'notas'}
            {andando ? ` · ${andando} em andamento` : ''}
          </p>
        </header>

        {grupos.length > 1 && (
          <div className="area-filtros">
            <button className={'area-filtro' + (filtro === null ? ' on' : '')} onClick={() => setFiltro(null)}>
              Todas <b>{notes.length}</b>
            </button>
            {grupos.map((g) => (
              <button key={g.status} className={'area-filtro' + (filtro === g.status ? ' on' : '')} onClick={() => setFiltro(filtro === g.status ? null : g.status)}>
                {nome(g.status)} <b>{g.notas.length}</b>
              </button>
            ))}
          </div>
        )}

        {grupos
          .filter((g) => filtro === null || g.status === filtro)
          .map((g) => (
            <section key={g.status} className="area-sec">
              {grupos.length > 1 && (
                <h2 className="area-sec-titulo">
                  {nome(g.status)} <span>{g.notas.length}</span>
                </h2>
              )}
              <div className="area-cards">
                {g.notas.map((n) => {
                  const t = trecho(n.body || '');
                  const meta = STATUS_META[n.status || ''];
                  return (
                    <button key={n.id} className={'area-card' + (n.status === 'concluido' || n.status === 'arquivado' ? ' feita' : '')} onClick={() => onOpen(n.id)}>
                      <i className="area-card-cor" style={{ background: cor }} />
                      <div className="area-card-titulo">{n.title}</div>
                      {t && <div className="area-card-trecho">{t}</div>}
                      <div className="area-card-pe">
                        {meta && <span className={'st-pill ' + meta.cls}>{meta.label}</span>}
                        <span className="area-card-info">
                          {n.degree} {n.degree === 1 ? 'conexão' : 'conexões'}
                          {n.criado ? ` · ${dataCurta(n.criado)}` : ''}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
      </div>
    </div>
  );
}
