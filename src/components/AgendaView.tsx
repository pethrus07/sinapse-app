import { Fragment, useMemo, useState } from 'react';
import type { Agenda, Note, Ocorrencia } from '../types';
import {
  DIA_CURTO, DIA_LONGO, MES_LONGO, FAIXAS,
  corDaFrente, labelDaFrente, ymd, parseYmd, hojeYmd, addDays, ROTULO_SEMANA,
  inicioDaSemana, expandir, proximos, diasEntre, rotuloRelativo, dataCurta,
} from '../lib/agenda';

interface Props {
  agenda: Agenda;
  notes: Note[];
  onOpen: (id: string) => void;
  onCriarDaily: (dia: string) => void;
}

type Aba = 'semana' | 'mes' | 'painel';

/** Um compromisso, do tamanho de um chip. Abre a nota, ou o link se não houver nota. */
function Chip({ oc, onOpen, compacto }: { oc: Ocorrencia; onOpen: (id: string) => void; compacto?: boolean }) {
  const cor = corDaFrente(oc.frente);
  const detalhe = [oc.hora, oc.onde].filter(Boolean).join(' · ');
  const cont = (
    <>
      <span className="ag-chip-dot" style={{ background: cor }} />
      <span className="ag-chip-txt">
        {oc.multi && !oc.inicio ? '↳ ' : ''}{oc.titulo}
        {oc.intermediavel && <span className="ag-inter" title="dá pra encaixar outra coisa aqui">intermediável</span>}
      </span>
      {detalhe && !compacto && <span className="ag-chip-sub">{detalhe}</span>}
    </>
  );
  const cls = 'ag-chip ag-k-' + oc.kind + (compacto ? ' compacto' : '');
  if (oc.nota) return <button className={cls} style={{ borderLeftColor: cor }} onClick={() => onOpen(oc.nota!)}>{cont}</button>;
  if (oc.link) return <a className={cls} style={{ borderLeftColor: cor }} href={oc.link} target="_blank" rel="noreferrer">{cont}</a>;
  return <div className={cls} style={{ borderLeftColor: cor }}>{cont}</div>;
}

export function AgendaView({ agenda, notes, onOpen, onCriarDaily }: Props) {
  const [aba, setAba] = useState<Aba>('semana');
  const [deslocSemana, setDeslocSemana] = useState(0);
  const [deslocMes, setDeslocMes] = useState(0);

  const hoje = hojeYmd();
  const dailyPorDia = useMemo(() => new Map(agenda.dailys.map((d) => [d.dia, d])), [agenda.dailys]);
  const temNota = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);
  const abrir = (id?: string) => { if (id && temNota.has(id)) onOpen(id); };

  /* ---------------- SEMANA ---------------- */
  const semana = useMemo(() => {
    const ini = addDays(inicioDaSemana(new Date()), deslocSemana * 7);
    const dias = Array.from({ length: 7 }, (_, i) => ymd(addDays(ini, i)));
    const mapa = expandir(agenda, dias[0], dias[6]);
    return { dias, mapa };
  }, [agenda, deslocSemana]);

  /* ---------------- MÊS ---------------- */
  const mes = useMemo(() => {
    const base = new Date();
    const ref = new Date(base.getFullYear(), base.getMonth() + deslocMes, 1);
    const primeiro = ymd(ref);
    const ultimoDia = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    const grade: string[] = [];
    const inicioGrade = inicioDaSemana(ref);
    for (let i = 0; i < 42; i++) grade.push(ymd(addDays(inicioGrade, i)));
    const mapa = expandir(agenda, grade[0], grade[41]);
    return { ref, primeiro, ultimo: ymd(ultimoDia), grade, mapa, mesAtual: ref.getMonth() };
  }, [agenda, deslocMes]);

  /* ---------------- PAINEL ---------------- */
  const painel = useMemo(() => {
    const lista = proximos(agenda, hoje, 120);
    const porFrente = new Map<string, { dia: string; oc: Ocorrencia }[]>();
    for (const it of lista) {
      const f = (it.oc.frente || '').toLowerCase() || 'sem-frente';
      if (!porFrente.has(f)) porFrente.set(f, []);
      porFrente.get(f)!.push(it);
    }
    const ocupacao = new Map<number, Ocorrencia[]>();
    for (const b of agenda.blocos)
      for (const d of b.dias || []) {
        if (!ocupacao.has(d)) ocupacao.set(d, []);
        ocupacao.get(d)!.push({ ...b, kind: 'bloco' } as Ocorrencia);
      }
    return { lista, porFrente, ocupacao, marcos: lista.slice(0, 3) };
  }, [agenda, hoje]);

  const semTitulo = `${dataCurta(semana.dias[0])} – ${dataCurta(semana.dias[6])}`;

  return (
    <div className="pad-scroll">
      <div className="ag-hero">
        <div>
          <div className="eyebrow-mono">Agenda</div>
          <h1 className="rm-title">O calendário da rotina</h1>
          <p className="muted">
            Vem de <button className="linkbtn" onClick={() => abrir(agenda.fonte)}>AGENDA.md</button>{' '}
            no vault: {agenda.blocos.length} blocos fixos, {agenda.semanal.length} semanais,{' '}
            {agenda.mensal.length} mensais e {agenda.datas.length} datas.
          </p>
        </div>
        <div className="ag-tabs">
          {(['semana', 'mes', 'painel'] as Aba[]).map((a) => (
            <button key={a} className={'proj-tab' + (aba === a ? ' active' : '')} onClick={() => setAba(a)}>
              {a === 'semana' ? '📆 Semana' : a === 'mes' ? '🗓️ Mês' : '📊 Painel'}
            </button>
          ))}
        </div>
      </div>

      {/* ============ SEMANA ============ */}
      {aba === 'semana' && (
        <>
          <div className="ag-navbar">
            <button className="ag-nav" onClick={() => setDeslocSemana((d) => d - 1)}>‹</button>
            <span className="ag-navtitle">
              {semTitulo}
              {deslocSemana === 0 && <em> · semana atual</em>}
            </span>
            <button className="ag-nav" onClick={() => setDeslocSemana((d) => d + 1)}>›</button>
            {deslocSemana !== 0 && <button className="ag-hoje" onClick={() => setDeslocSemana(0)}>hoje</button>}
          </div>

          <div className="ag-week">
            <div className="ag-wcorner" />
            {semana.dias.map((dia) => {
              const d = parseYmd(dia);
              const ehHoje = dia === hoje;
              const fds = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div key={dia} className={'ag-whead' + (ehHoje ? ' hoje' : '') + (fds ? ' fds' : '')}>
                  <span className="ag-wdow">{DIA_CURTO[d.getDay()]}</span>
                  <span className="ag-wnum">{d.getDate()}</span>
                </div>
              );
            })}

            <div className="ag-wlabel">
              Datas<span>evento, prazo</span>
            </div>
            {semana.dias.map((dia) => {
              const ocs = (semana.mapa.get(dia) || []).filter((o) => !o.faixa);
              return (
                <div key={'ev' + dia} className={'ag-wcell' + (dia === hoje ? ' hoje' : '')}>
                  {ocs.map((oc, i) => <Chip key={i} oc={oc} onOpen={abrir} />)}
                </div>
              );
            })}

            {FAIXAS.map((f) => (
              <Fragment key={f.id}>
                <div className="ag-wlabel">
                  {f.label}<span>{f.hint}</span>
                </div>
                {semana.dias.map((dia) => {
                  const ocs = (semana.mapa.get(dia) || []).filter((o) => o.faixa === f.id);
                  const vago = !ocs.length;
                  return (
                    <div key={f.id + dia} className={'ag-wcell' + (dia === hoje ? ' hoje' : '') + (vago ? ' vago' : '')}>
                      {ocs.map((oc, i) => <Chip key={i} oc={oc} onOpen={abrir} />)}
                      {vago && <span className="ag-vago">{f.id === 'livre' ? '—' : 'livre'}</span>}
                    </div>
                  );
                })}
              </Fragment>
            ))}

            <div className="ag-wlabel">
              Daily<span>01-DIARIO</span>
            </div>
            {semana.dias.map((dia) => {
              const dl = dailyPorDia.get(dia);
              const futuro = dia > hoje;
              return (
                <div key={'dl' + dia} className={'ag-wcell' + (dia === hoje ? ' hoje' : '')}>
                  {dl ? (
                    <button className="ag-daily tem" onClick={() => onOpen(dl.id)}>✎ daily</button>
                  ) : futuro ? (
                    <span className="ag-vago">—</span>
                  ) : (
                    <button className="ag-daily" onClick={() => onCriarDaily(dia)}>＋ daily</button>
                  )}
                </div>
              );
            })}
          </div>

          <p className="muted small ag-rodape">
            <b>intermediável</b> = trabalho e aula ocupam a faixa, mas dá pra encaixar outra coisa dentro.
            É onde cabe estudar, adiantar AS e mexer em projeto — o tempo desta rotina é interstício, não bloco vazio.
          </p>
        </>
      )}

      {/* ============ MÊS ============ */}
      {aba === 'mes' && (
        <>
          <div className="ag-navbar">
            <button className="ag-nav" onClick={() => setDeslocMes((d) => d - 1)}>‹</button>
            <span className="ag-navtitle">
              {MES_LONGO[mes.ref.getMonth()]} de {mes.ref.getFullYear()}
            </span>
            <button className="ag-nav" onClick={() => setDeslocMes((d) => d + 1)}>›</button>
            {deslocMes !== 0 && <button className="ag-hoje" onClick={() => setDeslocMes(0)}>hoje</button>}
          </div>

          <div className="ag-month">
            {DIA_CURTO.map((d) => <div key={d} className="ag-mdow">{d}</div>)}
            {mes.grade.map((dia) => {
              const d = parseYmd(dia);
              const foraDoMes = d.getMonth() !== mes.mesAtual;
              const ocs = (semanaOuMes(mes.mapa, dia)).filter((o) => o.kind !== 'bloco');
              const temDaily = dailyPorDia.has(dia);
              return (
                <div
                  key={dia}
                  className={'ag-mcell' + (dia === hoje ? ' hoje' : '') + (foraDoMes ? ' fora' : '')}
                >
                  <div className="ag-mtop">
                    <span className="ag-mnum">{d.getDate()}</span>
                    {temDaily && <span className="ag-mdaily" title="tem daily" />}
                  </div>
                  {ocs.slice(0, 3).map((oc, i) => <Chip key={i} oc={oc} onOpen={abrir} compacto />)}
                  {ocs.length > 3 && <span className="ag-mmais">+{ocs.length - 3}</span>}
                </div>
              );
            })}
          </div>
          <p className="muted small ag-rodape">
            O mês esconde os blocos fixos (trabalho e aula, todo dia útil) — sem isso a grade viraria uma parede.
            Bolinha no canto = dia com daily escrita.
          </p>
        </>
      )}

      {/* ============ PAINEL ============ */}
      {aba === 'painel' && (
        <div className="ag-painel">
          <section className="ag-bloco">
            <h3>Próximos marcos</h3>
            <div className="ag-marcos">
              {painel.marcos.map(({ dia, oc }, i) => (
                <button
                  key={i}
                  className="ag-marco"
                  style={{ borderTopColor: corDaFrente(oc.frente) }}
                  onClick={() => abrir(oc.nota)}
                >
                  <span className="ag-marco-dias">{diasEntre(hoje, dia) === 0 ? 'hoje' : `${diasEntre(hoje, dia)}d`}</span>
                  <span className="ag-marco-tit">{oc.titulo}</span>
                  <span className="ag-marco-sub">
                    {DIA_LONGO[parseYmd(dia).getDay()]}, {dataCurta(dia)} · {labelDaFrente(oc.frente)}
                  </span>
                </button>
              ))}
              {!painel.marcos.length && <p className="muted">Nada com data marcada à frente.</p>}
            </div>
          </section>

          <section className="ag-bloco">
            <h3>Capacidade da semana</h3>
            <p className="muted small">
              O que já está ocupado toda semana. <b>Intermediável</b> não é tempo livre — é tempo dividido.
            </p>
            <div className="ag-cap">
              {DIA_CURTO.map((rot, dow) => {
                const ocs = painel.ocupacao.get(dow) || [];
                return (
                  <div key={dow} className={'ag-capdia' + (ocs.length ? '' : ' vazio')}>
                    <span className="ag-capdow">{rot}</span>
                    {ocs.length ? (
                      ocs.map((o, i) => (
                        <span key={i} className="ag-capbar" style={{ background: corDaFrente(o.frente) }}>
                          {o.faixa}
                        </span>
                      ))
                    ) : (
                      <span className="ag-capbar vazio">livre</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="ag-bloco">
            <h3>Tudo o que tem data · próximos 120 dias</h3>
            <p className="muted small">
              Recorrência mensal aparece só nas <b>2 próximas vezes</b> — senão o ciclo de cobrança
              afogaria os prazos de data única.
            </p>
            {[...painel.porFrente.entries()].map(([frente, itens]) => (
              <div key={frente} className="ag-frente">
                <div className="ag-frente-head">
                  <span className="ag-chip-dot" style={{ background: corDaFrente(frente) }} />
                  <b>{labelDaFrente(frente)}</b>
                  <span className="muted small">{itens.length}</span>
                </div>
                <table className="ag-tabela">
                  <tbody>
                    {itens.map(({ dia, oc }, i) => (
                      <tr key={i} className={dia === hoje ? 'hoje' : ''}>
                        <td className="ag-td-data">
                          {dataCurta(dia)}
                          <span className="muted"> {DIA_CURTO[parseYmd(dia).getDay()]}</span>
                        </td>
                        <td className="ag-td-rel">{rotuloRelativo(hoje, dia)}</td>
                        <td className="ag-td-tit">
                          {oc.nota && temNota.has(oc.nota) ? (
                            <button className="linkbtn" onClick={() => abrir(oc.nota)}>{oc.titulo}</button>
                          ) : (
                            oc.titulo
                          )}
                          {oc.onde && <span className="muted small"> · {oc.onde}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {!painel.lista.length && <p className="muted">Nada nos próximos 120 dias.</p>}
          </section>

          <section className="ag-bloco">
            <h3>Recorrências ativas</h3>
            <table className="ag-tabela">
              <tbody>
                {agenda.semanal.map((s, i) => (
                  <tr key={'s' + i}>
                    <td className="ag-td-data">
                      {Array.isArray(s.dias) && s.dias.length
                        ? s.dias.map((d) => DIA_CURTO[d]).join(' ')
                        : 'toda ' + DIA_LONGO[s.dia ?? 0]}
                    </td>
                    <td className="ag-td-tit">
                      {s.titulo}
                      {!s.hora && !s.link && <span className="ag-falta">falta horário e link</span>}
                    </td>
                  </tr>
                ))}
                {agenda.mensal.map((m, i) => (
                  <tr key={'m' + i}>
                    <td className="ag-td-data">
                      {m.semanaDoMes
                        ? `${ROTULO_SEMANA[m.semanaDoMes] || m.semanaDoMes} ${DIA_LONGO[m.dia ?? 0]}`
                        : `dia ${m.diaDoMes}`}
                    </td>
                    <td className="ag-td-tit">
                      {m.nota && temNota.has(m.nota) ? (
                        <button className="linkbtn" onClick={() => abrir(m.nota)}>{m.titulo}</button>
                      ) : (
                        m.titulo
                      )}
                    </td>
                  </tr>
                ))}
                {agenda.blocos.map((b, i) => (
                  <tr key={'b' + i}>
                    <td className="ag-td-data">{(b.dias || []).map((d) => DIA_CURTO[d]).join(' ')}</td>
                    <td className="ag-td-tit">
                      {b.titulo} <span className="muted small">· faixa {b.faixa}</span>
                      {!b.hora && <span className="ag-falta">falta horário</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}

// helper local: o mapa do mês pode não ter a chave do dia
function semanaOuMes(mapa: Map<string, Ocorrencia[]>, dia: string): Ocorrencia[] {
  return mapa.get(dia) || [];
}
