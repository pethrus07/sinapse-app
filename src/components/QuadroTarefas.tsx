import { useMemo, useState } from 'react';
import type { EstadoTarefa, Note, Tarefa } from '../types';
import { mudarTarefa, novaTarefa } from '../lib/api';

const COLUNAS: [EstadoTarefa, string][] = [
  ['a-fazer', 'A fazer'],
  ['fazendo', 'Fazendo'],
  ['feito', 'Feito'],
];

interface Item {
  nota: Note;
  tarefa: Tarefa;
}

interface Props {
  /** projetos cujas tarefas entram no quadro (um só = quadro do projeto) */
  projetos: Note[];
  onIndex: (i: any) => void;
  onOpen?: (id: string) => void;
}

// Quadro a fazer / fazendo / feito sobre os "- [ ]" das notas. Com mais de um projeto, cada
// cartão diz de qual projeto é e a tarefa nova pergunta para qual projeto vai.
export function QuadroTarefas({ projetos, onIndex, onOpen }: Props) {
  const varios = projetos.length > 1;
  const itens = useMemo<Item[]>(
    () => projetos.flatMap((nota) => (nota.tarefas || []).map((tarefa) => ({ nota, tarefa }))),
    [projetos],
  );
  const [texto, setTexto] = useState('');
  const [destino, setDestino] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [arrastando, setArrastando] = useState<Item | null>(null);
  const alvo = varios ? projetos.find((n) => n.id === destino) : projetos[0];

  async function mover(i: Item, estado: EstadoTarefa) {
    if (i.tarefa.estado === estado) return;
    setOcupado(true);
    try {
      onIndex(await mudarTarefa(i.nota.rel, i.tarefa.linha, estado));
    } catch (e) {
      alert('Não deu pra mover: ' + (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function acrescentar() {
    if (!texto.trim() || !alvo) return;
    setOcupado(true);
    try {
      onIndex(await novaTarefa(alvo.rel, texto));
      setTexto('');
    } catch (e) {
      alert('Não deu pra criar: ' + (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="quadro-nova">
        <input
          placeholder="Nova tarefa…"
          value={texto}
          disabled={ocupado}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && acrescentar()}
        />
        {varios && (
          <select value={destino} onChange={(e) => setDestino(e.target.value)} disabled={ocupado}>
            <option value="">para qual projeto?</option>
            {[...projetos].sort((a, b) => a.title.localeCompare(b.title)).map((n) => (
              <option key={n.id} value={n.id}>{n.title}</option>
            ))}
          </select>
        )}
        <button className="btn" disabled={ocupado || !texto.trim() || !alvo} onClick={acrescentar}>Adicionar</button>
      </div>
      <div className="quadro">
        {COLUNAS.map(([estado, rotulo]) => {
          const lista = itens.filter((i) => i.tarefa.estado === estado);
          return (
            <div
              key={estado}
              className="quadro-col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => arrastando && mover(arrastando, estado)}
            >
              <div className="quadro-col-head">
                <span>{rotulo}</span>
                <span className="muted small">{lista.length}</span>
              </div>
              {lista.map((i) => (
                <div
                  key={i.nota.id + '|' + i.tarefa.linha}
                  className={'quadro-card' + (estado === 'feito' ? ' feito' : '')}
                  draggable={!ocupado}
                  onDragStart={() => setArrastando(i)}
                  onDragEnd={() => setArrastando(null)}
                >
                  {varios && (
                    <button className="quadro-proj linkbtn" onClick={() => onOpen?.(i.nota.id)}>{i.nota.title}</button>
                  )}
                  <div>{i.tarefa.texto}</div>
                  <div className="quadro-card-pe">
                    {!varios && i.tarefa.secao ? <span className="muted small">{i.tarefa.secao}</span> : <span />}
                    <span className="quadro-setas">
                      {COLUNAS.filter(([e]) => e !== estado).map(([e, r]) => (
                        <button key={e} className="linkbtn small" disabled={ocupado} onClick={() => mover(i, e)}>
                          {r.toLowerCase()}
                        </button>
                      ))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {!itens.length && (
        <p className="muted small">
          {varios ? 'Nenhuma tarefa neste filtro.' : 'A nota ainda não tem tarefas.'} As que entrarem aqui vão para a seção "Tarefas" do .md do projeto.
        </p>
      )}
    </>
  );
}
