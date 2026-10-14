import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Compromisso, Note } from '../types';
import { marcarCompromisso, trocarVaga } from '../lib/api';
import {
  DIAS_ALERTA,
  MAX_VAGAS,
  fmtData,
  fmtDias,
  fmtEspera,
  fmtHoras,
  fmtPrazo,
  horasDe,
  inicioDaSemana,
  separarFrentes,
  type Frente,
} from '../lib/frentes';

interface Props {
  notes: Note[];
  compromissos: Compromisso[];
  onOpen: (id: string) => void;
  onIndex: (idx: any) => void;
}

// à vista por frente; o resto fica em "Mais N"
const PROMESSAS_A_VISTA = 2;

// Regra de UI do Pedro: essencial à vista, o resto em "Mais"; um sinal por informação;
// cartão sem borda (separação por tom); a única cor de alerta é a 4ª vaga.
export function FrentesView({ notes, compromissos, onOpen, onIndex }: Props) {
  const g = useMemo(() => separarFrentes(notes), [notes]);
  const [entrando, setEntrando] = useState<Frente | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [feitoAgora, setFeitoAgora] = useState<Compromisso | null>(null);
  const topo = useRef<HTMLElement>(null);

  // compromissos por frente; os sem frente vão para "Mais"
  const { porFrente, semFrente } = useMemo(() => {
    const ids = new Set([...g.vaga, ...g.esperando, ...g.demanda, ...g.fila, ...g.parado].map((f) => f.note.id));
    const porFrente = new Map<string, Compromisso[]>();
    const semFrente: Compromisso[] = [];
    for (const c of compromissos) {
      if (c.frente && ids.has(c.frente)) {
        const l = porFrente.get(c.frente) || [];
        l.push(c);
        porFrente.set(c.frente, l);
      } else {
        semFrente.push(c);
      }
    }
    return { porFrente, semFrente };
  }, [compromissos, g]);

  const desde = inicioDaSemana();
  const todas = [...g.vaga, ...g.esperando, ...g.demanda, ...g.fila, ...g.parado];
  const hVagas = horasDe(g.vaga, desde);
  const hResto = Math.max(0, horasDe(todas, desde) - hVagas);

  const vagas = g.vaga;
  const excesso = vagas.length > MAX_VAGAS;
  const escolhendo = excesso || !!entrando;
  const livres = Math.max(0, MAX_VAGAS - vagas.length - (entrando ? 1 : 0));

  async function salvar(rel: string, vaga: boolean, sai?: string) {
    setOcupado(true);
    setErro('');
    try {
      onIndex(await trocarVaga(rel, vaga, sai));
      setEntrando(null);
    } catch (e) {
      setErro('Não deu para salvar: ' + (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function feito(c: Compromisso, valor: boolean) {
    setOcupado(true);
    setErro('');
    try {
      onIndex(await marcarCompromisso(c.id, valor));
      setFeitoAgora(valor ? c : null);
    } catch (e) {
      setErro('Não deu para salvar: ' + (e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function porNaVaga(f: Frente) {
    if (vagas.length < MAX_VAGAS) return salvar(f.note.rel, true);
    setEntrando(f);
    // a pergunta aparece lá em cima, nas vagas: levar o olho até ela (depois do render)
    requestAnimationFrame(() => topo.current?.scrollIntoView({ block: 'start' }));
  }

  function acaoDaVaga(f: Frente) {
    if (entrando) return salvar(entrando.note.rel, true, f.note.rel);
    return salvar(f.note.rel, false);
  }

  const promessas = (f: Frente) => (
    <Promessas itens={porFrente.get(f.note.id) || []} ocupado={ocupado} onFeito={(c) => feito(c, true)} />
  );

  const titulo =
    vagas.length === 0
      ? 'Nenhuma frente em andamento'
      : vagas.length === 1
        ? '1 frente em andamento'
        : `${vagas.length} frentes em andamento`;

  const leitura =
    hVagas + hResto === 0
      ? 'Nenhum commit nos últimos 7 dias.'
      : `Nos últimos 7 dias, ${fmtHoras(hVagas)} nas vagas e ${fmtHoras(hResto)} no resto.`;

  const maisPartes = [
    g.parado.length ? `${g.parado.length} ${g.parado.length === 1 ? 'parada' : 'paradas'}` : '',
    semFrente.length ? `${semFrente.length} ${semFrente.length === 1 ? 'promessa' : 'promessas'} sem frente` : '',
  ].filter(Boolean);

  return (
    <div className="pad-scroll">
      <div className="fr">
        <header className="fr-head" ref={topo}>
          <div className="eyebrow-mono">Frentes</div>
          <h1 className="rm-title">{titulo}</h1>
          <p className="fr-leitura" title="Piso medido pelos commits, em sessões: reunião e conversa não entram.">
            {leitura}
          </p>
          {erro && <p className="fr-erro">{erro}</p>}
          {feitoAgora && (
            <p className="fr-erro" data-testid="feito-agora">
              Marcado como feito.{' '}
              <button className="fr-link" disabled={ocupado} onClick={() => feito(feitoAgora, false)}>
                Desfazer
              </button>
            </p>
          )}
        </header>

        <section className="fr-vagas" aria-label="Em andamento">
          {excesso && !entrando && (
            <p className="fr-pergunta">São {vagas.length} em andamento. Qual sai?</p>
          )}
          <div className="fr-grid">
            {vagas.map((f, i) => (
              <article key={f.note.id} className={'fr-card' + (i >= MAX_VAGAS ? ' alerta' : '')} data-testid="vaga">
                <button className="fr-nome" onClick={() => onOpen(f.note.id)} title={f.note.title}>
                  {f.nome}
                </button>
                <p className="fr-meta">
                  {f.dias != null && f.dias >= DIAS_ALERTA ? (
                    <span className="fr-parada">parada há {f.dias} dias</span>
                  ) : (
                    <span>mexeu {fmtDias(f.dias)}</span>
                  )}
                  {f.note.atividade?.fonte === 'pastas' && (
                    <span> · {fmtHoras(horasDe([f], desde))} na semana</span>
                  )}
                </p>
                {f.note.proximo && <p className="fr-prox">Próximo: {f.note.proximo}</p>}
                {promessas(f)}
                <button className="fr-acao" disabled={ocupado} onClick={() => acaoDaVaga(f)}>
                  {escolhendo ? 'Sai esta' : 'Tirar da vaga'}
                </button>
              </article>
            ))}

            {entrando && (
              <article className="fr-card alerta" data-testid="entrando">
                <span className="fr-nome">{entrando.nome}</span>
                <p className="fr-pergunta-card">Quer entrar. Qual sai?</p>
                <button className="fr-acao" disabled={ocupado} onClick={() => setEntrando(null)}>
                  Deixa como está
                </button>
              </article>
            )}

            {Array.from({ length: livres }, (_, i) => (
              <div key={'livre' + i} className="fr-card livre">
                Vaga livre
              </div>
            ))}
          </div>
        </section>

        <Lista titulo="Esperando alguém" itens={g.esperando} onOpen={onOpen} onVaga={porNaVaga} ocupado={ocupado}
          extra={promessas}
          meta={(f) => (
            <>
              {[f.note.esperando, fmtEspera(f.dias)].filter(Boolean).join(' · ')}
              {f.note.cutucar && <Cutucar ymd={f.note.cutucar} />}
            </>
          )}
        />
        <Lista titulo="Sob demanda" itens={g.demanda} onOpen={onOpen} onVaga={porNaVaga} ocupado={ocupado}
          extra={promessas} meta={(f) => <>mexeu {fmtDias(f.dias)}</>} />
        <Lista titulo="Na fila" itens={g.fila} onOpen={onOpen} onVaga={porNaVaga} ocupado={ocupado}
          extra={promessas} meta={(f) => <>mexeu {fmtDias(f.dias)}</>} />

        {maisPartes.length > 0 && (
          <details className="fr-mais">
            <summary>Mais · {maisPartes.join(' · ')}</summary>
            {g.parado.length > 0 && (
              <>
                <p className="fr-retomar">
                  Por que pararam e o que faz voltar:{' '}
                  <button className="fr-link" onClick={() => onOpen('RETOMAR')}>RETOMAR</button>
                </p>
                <Lista itens={g.parado} onOpen={onOpen} onVaga={porNaVaga} ocupado={ocupado}
                  extra={promessas} meta={(f) => <>{f.note.motivo || `mexeu ${fmtDias(f.dias)}`}</>} />
              </>
            )}
            {semFrente.length > 0 && (
              <section className="fr-sem-frente" aria-label="Promessas sem frente" data-testid="sem-frente">
                <h2 className="fr-titulo">
                  Promessas sem frente <span className="fr-conta">{semFrente.length}</span>
                </h2>
                <p className="fr-retomar">A reunião não diz o projeto, ou o projeto não bate com nenhuma frente.</p>
                <Promessas itens={semFrente} todas comReuniao ocupado={ocupado} onFeito={(c) => feito(c, true)} />
              </section>
            )}
          </details>
        )}

        {g.parresia.length > 0 && (
          <p className="fr-parresia">A Parresia é a faixa fixa do dia e não ocupa vaga.</p>
        )}
      </div>
    </div>
  );
}

/* "Prometi: <texto> · até 15/10" — no máximo 2 à vista; clique abre a citação literal e a
   reunião de origem, com "Feito". Vencido usa o mesmo realce sem cor do "parada há N dias". */
function Promessas({ itens, todas, comReuniao, ocupado, onFeito }: {
  itens: Compromisso[];
  todas?: boolean;
  comReuniao?: boolean;
  ocupado: boolean;
  onFeito: (c: Compromisso) => void;
}) {
  const [verTodas, setVerTodas] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  if (!itens.length) return null;
  const visiveis = todas || verTodas ? itens : itens.slice(0, PROMESSAS_A_VISTA);
  const resto = itens.length - visiveis.length;

  return (
    <div className="fr-prom" data-testid="promessas">
      <ul>
        {visiveis.map((c) => {
          const prazo = fmtPrazo(c.prazo);
          const open = aberta === c.id;
          return (
            <li key={c.id} className={'fr-prom-item' + (open ? ' aberta' : '')} data-testid="promessa">
              <button className="fr-prom-linha" aria-expanded={open} onClick={() => setAberta(open ? null : c.id)}>
                <span className="fr-prom-rotulo">Prometi:</span> <span className="fr-prom-acao">{c.acao}</span>
                {prazo && (
                  <span className={'fr-prom-prazo' + (prazo.vencido ? ' vencido' : '')}> · {prazo.texto}</span>
                )}
                {comReuniao && <span className="fr-prom-prazo"> · reunião de {fmtData(c.reuniao.data)}</span>}
              </button>
              {open && (
                <div className="fr-prom-detalhe" data-testid="promessa-detalhe">
                  {c.citacao && <blockquote className="fr-prom-citacao">“{c.citacao}”</blockquote>}
                  <p className="fr-prom-origem">
                    {c.reuniao.titulo} · {fmtData(c.reuniao.data)}
                    {c.t && <> · {c.t}</>}
                    {c.prazoDito && <> · prazo dito: “{c.prazoDito}”</>}
                  </p>
                  <p className="fr-prom-acoes">
                    {c.reuniao.temHtml && (
                      <a className="fr-link" href={`/api/ata/${encodeURIComponent(c.reuniao.id)}`} target="_blank" rel="noreferrer">
                        Abrir a ata
                      </a>
                    )}
                    <button className="fr-acao" disabled={ocupado} onClick={() => onFeito(c)}>
                      Feito
                    </button>
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {resto > 0 && (
        <button className="fr-prom-mais" onClick={() => setVerTodas(true)}>
          Mais {resto}
        </button>
      )}
    </div>
  );
}

function Cutucar({ ymd }: { ymd: string }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const vencido = ymd <= hoje;
  return (
    <span className={vencido ? 'fr-cutucar-ja' : ''}>
      {' · '}
      {vencido ? (ymd === hoje ? 'cutucar hoje' : `cutucar desde ${fmtData(ymd)}`) : `cutucar ${fmtData(ymd)}`}
    </span>
  );
}

function Lista({ titulo, itens, meta, extra, onOpen, onVaga, ocupado }: {
  titulo?: string;
  itens: Frente[];
  meta: (f: Frente) => ReactNode;
  extra?: (f: Frente) => ReactNode;
  onOpen: (id: string) => void;
  onVaga: (f: Frente) => void;
  ocupado: boolean;
}) {
  if (!itens.length) return null;
  return (
    <section className="fr-lista" aria-label={titulo}>
      {titulo && (
        <h2 className="fr-titulo">
          {titulo} <span className="fr-conta">{itens.length}</span>
        </h2>
      )}
      <ul>
        {itens.map((f) => (
          <li key={f.note.id} className="fr-linha">
            <button className="fr-linha-nome" onClick={() => onOpen(f.note.id)} title={f.note.title}>
              {f.nome}
            </button>
            <span className="fr-linha-meta">{meta(f)}</span>
            <button className="fr-acao" disabled={ocupado} onClick={() => onVaga(f)}>
              Pôr na vaga
            </button>
            {extra && <div className="fr-linha-extra">{extra(f)}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
