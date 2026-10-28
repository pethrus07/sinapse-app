import { useMemo, useState } from 'react';
import type { Note } from '../types';

interface Props {
  notes: Note[];
  onOpen: (id: string) => void;
}

// Mesmo vocabulário de ProjectsView (régua do vault). Cada coluna do quadro é um status.
const COLUNAS: [string, string, string][] = [
  ['em-producao', 'Em produção', 'st-prod'],
  ['ativo', 'Ativo', 'st-ativo'],
  ['aguardando', 'Aguardando', 'st-wait'],
  ['pausado', 'Pausado', 'st-inc'],
  ['ideia', 'Ideia', 'st-prop'],
  ['concluido', 'Concluído', 'st-none'],
  ['arquivado', 'Arquivado', 'st-none'],
];
const COR: Record<string, string> = {
  'em-producao': 'var(--accent)',
  ativo: '#4FA3F0',
  aguardando: 'var(--violet)',
  pausado: '#7BE0A3',
  ideia: 'var(--amber)',
};
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function ultimoDia(n: Note) {
  return n.historia?.find((e) => e.tipo === 'commit')?.data || n.historia?.[0]?.data || '';
}

export function PanoramaView({ notes, onOpen }: Props) {
  const projetos = useMemo(() => notes.filter((n) => n.type === 'projeto'), [notes]);
  const [visao, setVisao] = useState<'quadro' | 'ano'>('quadro');

  return (
    <div className="pad-scroll">
      <div className="rm-hero">
        <div>
          <div className="eyebrow-mono">Panorama</div>
          <h1 className="rm-title">{projetos.length} projetos</h1>
          <p className="muted">Onde cada um está e quando cada um andou.</p>
        </div>
        <div className="ag-tabs" style={{ display: 'flex', gap: 6 }}>
          <button className={'proj-tab' + (visao === 'quadro' ? ' active' : '')} onClick={() => setVisao('quadro')}>Quadro</button>
          <button className={'proj-tab' + (visao === 'ano' ? ' active' : '')} onClick={() => setVisao('ano')}>Linha do ano</button>
        </div>
      </div>
      {visao === 'quadro' ? <Quadro projetos={projetos} onOpen={onOpen} /> : <LinhaDoAno projetos={projetos} onOpen={onOpen} />}
    </div>
  );
}

function Quadro({ projetos, onOpen }: { projetos: Note[]; onOpen: (id: string) => void }) {
  const [verEncerrados, setVerEncerrados] = useState(false);
  const colunas = COLUNAS.filter(([s]) => verEncerrados || (s !== 'concluido' && s !== 'arquivado'));
  return (
    <>
      <div className="pano-quadro">
        {colunas.map(([status, rotulo, cls]) => {
          const lista = projetos
            .filter((n) => (n.status || '') === status)
            .sort((a, b) => ultimoDia(b).localeCompare(ultimoDia(a)));
          return (
            <div key={status} className="pano-col">
              <div className="pano-col-head">
                <span className={'st-pill ' + cls}>{rotulo}</span>
                <span className="muted small">{lista.length}</span>
              </div>
              {lista.map((n) => {
                const abertas = (n.tarefas || []).filter((t) => t.estado !== 'feito').length;
                const dia = ultimoDia(n);
                return (
                  <button key={n.id} className="pano-card" onClick={() => onOpen(n.id)}>
                    <div className="pano-card-tit">{n.title}</div>
                    {n.cliente && <div className="muted small">{n.cliente}</div>}
                    <div className="pano-card-pe">
                      {dia && <span className="mini-chip ghost">{dia.slice(8, 10)}/{dia.slice(5, 7)}/{dia.slice(2, 4)}</span>}
                      {abertas > 0 && <span className="mini-chip">{abertas} tarefa{abertas === 1 ? '' : 's'}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <button className="linkbtn small" onClick={() => setVerEncerrados(!verEncerrados)}>
        {verEncerrados ? 'Esconder concluídos e arquivados' : 'Mostrar concluídos e arquivados'}
      </button>
    </>
  );
}

function LinhaDoAno({ projetos, onOpen }: { projetos: Note[]; onOpen: (id: string) => void }) {
  const anos = useMemo(() => {
    const s = new Set<string>();
    for (const n of projetos) for (const e of n.historia || []) s.add(e.data.slice(0, 4));
    return [...s].sort().reverse();
  }, [projetos]);
  const [ano, setAno] = useState(anos[0] || String(new Date().getFullYear()));

  const linhas = useMemo(() => {
    return projetos
      .map((n) => {
        const evs = (n.historia || []).filter((e) => e.data.startsWith(ano));
        const commits = evs.reduce((s, e) => s + (e.qtd || 0), 0);
        const primeiro = evs.length ? evs[evs.length - 1].data : '';
        return { n, evs, commits, primeiro };
      })
      .filter((l) => l.evs.length)
      .sort((a, b) => a.primeiro.localeCompare(b.primeiro));
  }, [projetos, ano]);

  const inicio = new Date(ano + '-01-01T00:00:00Z').getTime();
  const fim = new Date(Number(ano) + 1 + '-01-01T00:00:00Z').getTime();
  const pos = (d: string) => ((new Date(d + 'T12:00:00Z').getTime() - inicio) / (fim - inicio)) * 100;
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {anos.map((a) => (
          <button key={a} className={'mini-chip' + (a === ano ? '' : ' ghost')} style={{ cursor: 'pointer' }} onClick={() => setAno(a)}>
            {a}
          </button>
        ))}
      </div>
      <div className="ano">
        <div className="ano-linha ano-cab">
          <div className="ano-nome" />
          <div className="ano-trilho">
            {MES_CURTO.map((m, i) => (
              <span key={m} className="ano-mes" style={{ left: (i / 12) * 100 + '%' }}>{m}</span>
            ))}
          </div>
        </div>
        {linhas.map(({ n, evs, commits }) => {
          const cor = COR[n.status] || 'var(--faint)';
          const ini = pos(evs[evs.length - 1].data);
          const ult = pos(evs[0].data);
          return (
            <div key={n.id} className="ano-linha">
              <button className="ano-nome linkbtn" title={n.title} onClick={() => onOpen(n.id)}>{n.title}</button>
              <div className="ano-trilho">
                {MES_CURTO.map((m, i) => (
                  <span key={m} className="ano-grade" style={{ left: (i / 12) * 100 + '%' }} />
                ))}
                {hoje.startsWith(ano) && <span className="ano-hoje" style={{ left: pos(hoje) + '%' }} />}
                <span className="ano-faixa" style={{ left: ini + '%', width: Math.max(ult - ini, 0.3) + '%', background: cor }} />
                {evs.map((e, i) => (
                  <span
                    key={i}
                    className={'ano-ponto' + (e.tipo === 'commit' ? '' : ' marco')}
                    title={`${e.data} · ${e.tipo === 'commit' ? e.qtd + ' commit(s)' : e.titulo}`}
                    style={{
                      left: pos(e.data) + '%',
                      background: cor,
                      width: e.tipo === 'commit' ? 4 + Math.min(e.qtd || 1, 12) : 7,
                      height: e.tipo === 'commit' ? 4 + Math.min(e.qtd || 1, 12) : 7,
                    }}
                  />
                ))}
              </div>
              <span className="muted small ano-num">{commits || ''}</span>
            </div>
          );
        })}
      </div>
      <p className="muted small" style={{ marginTop: 14 }}>
        Cada ponto é um dia com commit (maior = mais commits); losango = nota datada ou criação. Faixa = do primeiro ao último movimento no ano.
      </p>
    </div>
  );
}
