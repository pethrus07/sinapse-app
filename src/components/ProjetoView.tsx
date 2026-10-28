import { useMemo, useState } from 'react';
import type { Evento, Note } from '../types';
import { NoteView } from './NoteView';
import { RoadmapCanvasView } from './RoadmapCanvasView';
import { DesenhoView } from './DesenhoView';
import { QuadroTarefas } from './QuadroTarefas';

type Aba = 'nota' | 'historia' | 'tarefas' | 'desenho' | 'roadmap';

interface Props {
  note: Note;
  byId: Map<string, Note>;
  roadmap: any | null;
  onNav: (p: string) => void;
  onIndex: (i: any) => void;
}

// Página do projeto: a nota continua sendo a fonte; as outras abas são lentes sobre ela
// (história = commits das `pastas:` + notas datadas; tarefas = checkboxes do corpo).
export function ProjetoView({ note, byId, roadmap, onNav, onIndex }: Props) {
  const [aba, setAba] = useState<Aba>('nota');
  const tarefas = note.tarefas || [];
  const abertas = tarefas.filter((t) => t.estado !== 'feito').length;
  const ehProjeto = note.type === 'projeto';

  const abas: [Aba, string][] = [['nota', 'Visão geral']];
  if (ehProjeto) abas.push(['historia', 'História'], ['tarefas', abertas ? `Tarefas · ${abertas}` : 'Tarefas']);
  if (note.desenho) abas.push(['desenho', 'Desenho']);
  if (roadmap) abas.push(['roadmap', `Roadmap · ${roadmap.items?.length ?? 0}`]);

  return (
    <div className="proj-detail">
      <div className="proj-tabs">
        {abas.map(([k, rotulo]) => (
          <button key={k} className={'proj-tab' + (aba === k ? ' active' : '')} onClick={() => setAba(k)}>
            {rotulo}
          </button>
        ))}
      </div>
      <div className="proj-tabbody">
        {aba === 'nota' && <NoteView note={note} byId={byId} onNav={onNav} onIndex={onIndex} />}
        {aba === 'historia' && <Historia note={note} onNav={onNav} />}
        {aba === 'tarefas' && <Quadro note={note} onIndex={onIndex} />}
        {aba === 'desenho' && <DesenhoView nota={note.id} />}
        {aba === 'roadmap' && roadmap && (
          <RoadmapCanvasView roadmap={roadmap} onOpenSource={() => onNav('/note/' + encodeURIComponent(roadmap.id || 'commagente-roadmap'))} />
        )}
      </div>
    </div>
  );
}

/* ---------- História ---------- */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function Historia({ note, onNav }: { note: Note; onNav: (p: string) => void }) {
  const eventos = note.historia || [];
  const porMes = useMemo(() => {
    const m = new Map<string, Evento[]>();
    for (const e of eventos) {
      const k = e.data.slice(0, 7);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()];
  }, [eventos]);
  const commits = eventos.reduce((s, e) => s + (e.qtd || 0), 0);
  const dias = eventos.filter((e) => e.tipo === 'commit').length;

  if (!eventos.length)
    return (
      <div className="pad-scroll">
        <p className="muted">Ainda sem história: a nota não tem `pastas:` com git nem notas datadas que a citem.</p>
      </div>
    );

  return (
    <div className="pad-scroll">
      <div className="eyebrow-mono">História</div>
      <h1 className="rm-title">{note.title}</h1>
      <p className="muted">
        {commits} commits em {dias} dias de trabalho
        {eventos.length ? ` · de ${dataBr(eventos[eventos.length - 1].data)} a ${dataBr(eventos[0].data)}` : ''}
      </p>
      <div className="hist">
        {porMes.map(([mes, lista]) => (
          <section key={mes} className="hist-mes">
            <h3 className="hist-mes-titulo">
              {MESES[Number(mes.slice(5, 7)) - 1]} <span className="muted">{mes.slice(0, 4)}</span>
            </h3>
            {lista.map((e, i) => (
              <div key={e.data + e.tipo + i} className={'hist-ev hist-' + e.tipo}>
                <span className="hist-dia">{e.data.slice(8, 10)}</span>
                <span className="hist-ponto" />
                <div className="hist-corpo">
                  {e.tipo === 'commit' ? (
                    <>
                      <div className="hist-tit">{e.qtd} commit{e.qtd === 1 ? '' : 's'}</div>
                      {(e.textos || []).map((t, j) => (
                        <div key={j} className="hist-txt">{t}</div>
                      ))}
                    </>
                  ) : e.nota ? (
                    <button className="linkbtn hist-tit" onClick={() => onNav('/note/' + encodeURIComponent(e.nota!))}>
                      {e.titulo}
                    </button>
                  ) : (
                    <div className="hist-tit muted">{e.titulo}</div>
                  )}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function dataBr(d: string) {
  return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
}

/* ---------- Tarefas (quadro) ---------- */

function Quadro({ note, onIndex }: { note: Note; onIndex: (i: any) => void }) {
  return (
    <div className="pad-scroll">
      <div className="eyebrow-mono">Tarefas</div>
      <h1 className="rm-title">{note.title}</h1>
      {note.proximo && <p className="muted">Próximo passo da nota: {note.proximo}</p>}
      <QuadroTarefas projetos={[note]} onIndex={onIndex} />
    </div>
  );
}
