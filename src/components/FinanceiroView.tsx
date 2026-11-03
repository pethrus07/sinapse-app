import { useEffect, useMemo, useState } from 'react';
import type { Financeiro, Lancamento, Note, TipoLancamento } from '../types';
import { dataCurta, hojeYmd, rotuloRelativo } from '../lib/agenda';
import {
  aReceberPorCliente, brl, CATEGORIAS, agruparPorMes, clientesConhecidos,
  contarSaidas, estaAberto, foraDaProjecao, projetar, resumir, rotuloStatus,
} from '../lib/financeiro';
import { MetisPronoia, MetisVisao } from './MetisPaginas';
import { FilaClassificar } from './FinanceiroAnalises';

// Métis: o módulo financeiro do Sinapse (por dentro segue "financeiro": rota, pasta e formato).
// Abas: Visão (o mês e o que já aconteceu), Pronoia (o que vem pela frente) e Lançamentos.

interface Props {
  financeiro: Financeiro;
  notes: Note[];
  onOpen: (id: string) => void;
  onLancar: (l: Record<string, unknown>) => Promise<void>;
  onAcao: (acao: 'liquidar' | 'reabrir' | 'remover', mes: string, id: string) => Promise<void>;
  onClassificar: (mes: string, id: string, categoria: string, lembrar: boolean) => Promise<{ lembrou: boolean; motivo?: string } | null>;
  onPontual: (mes: string, id: string, valor: boolean) => Promise<void>;
}

type Filtro = 'abertos' | 'todos';
type Aba = 'visao' | 'pronoia' | 'lancamentos';
const CLASSES = ['cripto', 'CDB', 'FII', 'Ação', 'outro'];

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (mes: string) => {
  const [a, m] = mes.split('-');
  return `${MES_CURTO[Number(m) - 1] || m}/${a}`;
};

const VAZIO = {
  tipo: 'entrada' as TipoLancamento,
  descricao: '',
  valor: '',
  vencimento: '',
  cliente: '',
  categoria: '',
  recorrente: false,
  pontual: false,
  obs: '',
  // saldo lançado à mão (tipo investimento): cripto, corretora fora do Open Finance
  instituicao: '',
  classe: 'cripto',
  data: '',
};

export function FinanceiroView({ financeiro, notes, onOpen, onLancar, onAcao, onClassificar, onPontual }: Props) {
  const hoje = hojeYmd();
  const [form, setForm] = useState({ ...VAZIO });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('abertos');
  // #/financeiro abre na Visão; #/financeiro/pronoia na projeção; #/financeiro/lancamentos na lista
  const abaDoHash = (): Aba => (location.hash.includes('lancamentos') ? 'lancamentos' : location.hash.includes('pronoia') ? 'pronoia' : 'visao');
  const [aba, setAbaEstado] = useState<Aba>(abaDoHash);
  // link direto (#/financeiro/pronoia) com a Métis já aberta: segue o endereço
  useEffect(() => {
    const ouvir = () => { if (location.hash.startsWith('#/financeiro')) setAbaEstado(abaDoHash()); };
    window.addEventListener('hashchange', ouvir);
    return () => window.removeEventListener('hashchange', ouvir);
  }, []);
  const setAba = (a: Aba) => {
    setAbaEstado(a);
    history.replaceState(null, '', a === 'visao' ? '#/financeiro' : `#/financeiro/${a}`);
  };

  const temNota = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);
  const resumo = useMemo(() => resumir(financeiro.lancamentos, hoje), [financeiro.lancamentos, hoje]);
  const clientes = useMemo(() => clientesConhecidos(financeiro.lancamentos), [financeiro.lancamentos]);
  const porCliente = useMemo(() => aReceberPorCliente(financeiro.lancamentos), [financeiro.lancamentos]);
  const projecao = useMemo(() => projetar(financeiro.lancamentos, hoje.slice(0, 7)), [financeiro.lancamentos, hoje]);
  const contagem = useMemo(() => contarSaidas(financeiro.lancamentos), [financeiro.lancamentos]);
  const fora = useMemo(() => foraDaProjecao(financeiro.lancamentos), [financeiro.lancamentos]);
  // categorias para a fila "a classificar": as que já existem no razão primeiro
  const categoriasUsadas = useMemo(() => {
    const cont = new Map<string, number>();
    for (const l of financeiro.lancamentos) {
      const c = (l.categoria || '').trim();
      if (c && c !== 'a classificar' && l.tipo === 'saida') cont.set(c, (cont.get(c) || 0) + 1);
    }
    return [...cont.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 14);
  }, [financeiro.lancamentos]);

  const visiveis = useMemo(() => {
    const arr = filtro === 'abertos' ? financeiro.lancamentos.filter(estaAberto) : financeiro.lancamentos;
    return agruparPorMes(arr);
  }, [financeiro.lancamentos, filtro]);

  const set = (k: keyof typeof VAZIO, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const saldo = form.tipo === 'investimento';

  async function lancar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    const valor = Number(String(form.valor).replace(/\./g, '').replace(',', '.'));
    if (!form.descricao.trim()) return setErro('Escreve o que é.');
    if (!Number.isFinite(valor) || valor <= 0) return setErro(saldo ? 'Saldo tem que ser um número maior que zero.' : 'Valor tem que ser um número maior que zero.');
    setSalvando(true);
    try {
      await onLancar({ ...form, valor, pontual: form.tipo === 'saida' && form.pontual });
      setForm({ ...VAZIO, tipo: form.tipo }); // mantém o tipo: lançar vários seguidos é o caso comum
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const eh = (l: Lancamento) => (l.tipo === 'saida' ? 'saida' : l.tipo === 'reserva' ? 'reserva' : l.tipo === 'investimento' ? 'saldo' : 'entrada');
  const seta = (k: string) => (k === 'saida' ? '↑' : k === 'reserva' ? '→' : k === 'saldo' ? '=' : '↓');
  const tab = (a: Aba, rotulo: string, title?: string) => (
    <button role="tab" aria-selected={aba === a} className={'proj-tab' + (aba === a ? ' active' : '')} onClick={() => setAba(a)} title={title}>{rotulo}</button>
  );

  return (
    <div className="pad-scroll">
      <div className="ag-hero">
        <div>
          <div className="eyebrow-mono">Métis{aba === 'pronoia' ? ' › Pronoia' : ''}</div>
          <h1 className="rm-title">{aba === 'pronoia' ? 'O que vem pela frente' : 'Entra, sai e o que falta receber'}</h1>
          <p className="muted">
            {aba === 'pronoia'
              ? 'Pronoia (previdência): a renda que segue, a reserva que se forma e as faturas que já estão assumidas.'
              : <>Um arquivo por mês em <code>04-NEGOCIO/financeiro/</code>. Vencimento aberto aparece sozinho no calendário — a data vive num lugar só.</>}
          </p>
        </div>
        <div className="ag-tabs" role="tablist">
          {tab('visao', 'Visão')}
          {tab('pronoia', 'Pronoia', 'Pronoia: o que vem pela frente')}
          {tab('lancamentos', 'Lançamentos')}
        </div>
      </div>

      {aba === 'visao' && <MetisVisao financeiro={financeiro} hoje={hoje} onClassificar={() => setAba('lancamentos')} />}

      {aba === 'pronoia' && (<>
        <MetisPronoia financeiro={financeiro} hoje={hoje} />

        <section className="fin-bloco mt-proj">
          <h3>Projeção mês a mês</h3>
          {contagem.saidas <= 1 ? (
            <p className="fin-nota alerta">
              <b>Esta projeção é otimista por construção.</b> Existem{' '}
              <b>{contagem.entradas} entradas</b> e <b>{contagem.saidas} saída(s)</b> lançadas — ou seja,
              o lado do gasto praticamente não existe aqui. Cartão, contas, transporte e assinaturas
              não estão no sistema, então o acumulado abaixo é <b>teto</b>, não previsão. Não decidir
              adiantamento de cartão com este número.
            </p>
          ) : (
            <p className="muted small">
              Só o que está <b>aberto</b> — o liquidado saiu do futuro. Item <b>sem dia</b> (marcado
              <span className="fin-semdia">s/dia</span>) conta no mês do arquivo onde vive: cartão sem
              dia ainda é cartão daquele mês. <b>Guarda</b> não é gasto, é destinação — sai do
              disponível e vira reserva.
            </p>
          )}
          {fora.itens > 0 && (
            <p className="muted small">
              <b>Fora da projeção:</b> {fora.itens} item(ns) sem cronograma —{' '}
              {brl(fora.receber)} a receber e {brl(fora.pagar)} a pagar. Não pertencem a mês nenhum
              (dívida sem prazo, valor ou data ainda a combinar), então não distorcem o fluxo.
            </p>
          )}
          <div className="mt-rolagem">
            <table className="fin-tabela fin-proj">
              <thead>
                <tr>
                  <th>mês</th>
                  <th className="num">entra</th>
                  <th className="num">sai</th>
                  <th className="num">guarda</th>
                  <th className="num">sobra</th>
                  <th className="num">reserva acum.</th>
                </tr>
              </thead>
              <tbody>
                {projecao.map((l) => (
                  <tr key={l.mes} className={l.mes === hoje.slice(0, 7) ? 'hoje' : ''}>
                    <td className="ag-td-data">
                      {rotuloMes(l.mes)}
                      <span className="muted"> {l.itens}</span>
                      {l.semDia > 0 && <span className="fin-semdia" title="itens sem dia definido, projetados no mês do arquivo">{l.semDia} s/dia</span>}
                    </td>
                    <td className="num entrada">{l.entra ? brl(l.entra) : '—'}</td>
                    <td className="num saida">{l.sai ? brl(l.sai) : '—'}</td>
                    <td className="num guarda">{l.guarda ? brl(l.guarda) : '—'}</td>
                    <td className={'num ' + (l.sobra >= 0 ? 'entrada' : 'saida')}>{brl(l.sobra)}</td>
                    <td className="num forte">{brl(l.reservaAcum)}</td>
                  </tr>
                ))}
                {!projecao.length && (
                  <tr><td colSpan={6} className="muted">Nada aberto com data à frente.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </>)}

      {aba === 'lancamentos' && (<>

      <FilaClassificar ls={financeiro.lancamentos} categorias={categoriasUsadas.length ? categoriasUsadas : CATEGORIAS} onClassificar={onClassificar} />

      {/* ---------- resumo ---------- */}
      <div className="fin-kpis">
        <div className="fin-kpi entrada">
          <span className="fin-kpi-rot">A receber</span>
          <b>{brl(resumo.aReceber)}</b>
          <span className="fin-kpi-sub">{resumo.qtdReceber} lançamento(s)</span>
        </div>
        <div className="fin-kpi saida">
          <span className="fin-kpi-rot">A pagar</span>
          <b>{brl(resumo.aPagar)}</b>
          <span className="fin-kpi-sub">{resumo.qtdPagar} lançamento(s)</span>
        </div>
        <div className={'fin-kpi' + (resumo.qtdAtrasado ? ' alerta' : '')}>
          <span className="fin-kpi-rot">Vencido e aberto</span>
          <b>{brl(resumo.atrasado)}</b>
          <span className="fin-kpi-sub">{resumo.qtdAtrasado} lançamento(s)</span>
        </div>
        <div className={'fin-kpi' + (resumo.qtdSemData ? ' aviso' : '')}>
          <span className="fin-kpi-rot">Sem data definida</span>
          <b>{brl(resumo.semData)}</b>
          <span className="fin-kpi-sub">{resumo.qtdSemData} lançamento(s)</span>
        </div>
        <div className="fin-kpi reserva">
          <span className="fin-kpi-rot">Reserva</span>
          <b>{brl(resumo.guardado)}</b>
          <span className="fin-kpi-sub">+ {brl(resumo.guardar)} programado</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-rot">Sobra prevista</span>
          <b>{brl(resumo.saldoPrevisto)}</b>
          <span className="fin-kpi-sub">a receber − a pagar − a guardar</span>
        </div>
      </div>

      {porCliente.length > 0 && (
        <div className="fin-quebra">
          <span className="fin-quebra-rot">A receber por origem</span>
          {porCliente.map(([nome, v]) => (
            <span key={nome} className="fin-quebra-item">
              <b>{nome}</b> {brl(v.total)} <em>{v.qtd}</em>
            </span>
          ))}
        </div>
      )}

      {resumo.qtdSemData > 0 && (
        <p className="fin-nota">
          <b>{brl(resumo.semData)} sem data de vencimento</b> — {brl(resumo.semDataReceber)} a receber
          e {brl(resumo.semDataPagar)} a pagar. Não é atraso, é indefinição: some da agenda enquanto
          não tiver data, porque calendário não mostra o que não tem dia.
        </p>
      )}

      {/* ---------- lançar ---------- */}
      <section className="fin-bloco">
        <h3>Lançar</h3>
        <form className="fin-form" onSubmit={lancar}>
          <div className="fin-tipo">
            <button type="button" className={'fin-tbtn entrada' + (form.tipo === 'entrada' ? ' on' : '')} onClick={() => set('tipo', 'entrada')}>↓ Entra</button>
            <button type="button" className={'fin-tbtn saida' + (form.tipo === 'saida' ? ' on' : '')} onClick={() => set('tipo', 'saida')}>↑ Sai</button>
            <button type="button" className={'fin-tbtn reserva' + (form.tipo === 'reserva' ? ' on' : '')} onClick={() => set('tipo', 'reserva')}
              title="destinação: sai do disponível sem ser gasto">→ Guarda</button>
            <button type="button" className={'fin-tbtn saldo' + (saldo ? ' on' : '')} onClick={() => set('tipo', 'investimento')}
              title="saldo de um investimento que não vem pelo banco (cripto): entra no patrimônio">= Saldo</button>
          </div>

          <label className="fin-campo grande">
            <span>O que é</span>
            <input
              value={form.descricao}
              onChange={(e) => set('descricao', e.target.value)}
              placeholder={saldo ? 'ex.: Bitcoin' : 'ex.: mensalidade de setembro'}
              autoComplete="off"
            />
          </label>

          <label className="fin-campo">
            <span>{saldo ? 'Saldo (R$)' : 'Valor (R$)'}</span>
            <input
              value={form.valor}
              onChange={(e) => set('valor', e.target.value)}
              placeholder="250,00"
              inputMode="decimal"
              autoComplete="off"
            />
          </label>

          {saldo ? (<>
            <label className="fin-campo">
              <span>Data do saldo</span>
              <input type="date" value={form.data} onChange={(e) => set('data', e.target.value)} />
            </label>
            <label className="fin-campo">
              <span>Onde está</span>
              <input value={form.instituicao} onChange={(e) => set('instituicao', e.target.value)} placeholder="corretora, carteira" autoComplete="off" />
            </label>
            <label className="fin-campo">
              <span>Classe</span>
              <select value={form.classe} onChange={(e) => set('classe', e.target.value)}>
                {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </>) : (<>
            <label className="fin-campo">
              <span>Vencimento</span>
              <input type="date" value={form.vencimento} onChange={(e) => set('vencimento', e.target.value)} />
            </label>

            <label className="fin-campo">
              <span>Cliente</span>
              <input
                value={form.cliente}
                onChange={(e) => set('cliente', e.target.value)}
                list="fin-clientes"
                placeholder="opcional"
                autoComplete="off"
              />
              <datalist id="fin-clientes">
                {clientes.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>

            <label className="fin-campo">
              <span>Categoria</span>
              <input
                value={form.categoria}
                onChange={(e) => set('categoria', e.target.value)}
                list="fin-categorias"
                placeholder="opcional"
                autoComplete="off"
              />
              <datalist id="fin-categorias">
                {CATEGORIAS.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
          </>)}

          <label className="fin-campo grande">
            <span>Observação</span>
            <input
              value={form.obs}
              onChange={(e) => set('obs', e.target.value)}
              placeholder="opcional — o porquê, a condição, o combinado"
              autoComplete="off"
            />
          </label>

          {!saldo && (
            <label className="fin-check">
              <input type="checkbox" checked={form.recorrente} onChange={(e) => set('recorrente', e.target.checked)} />
              <span>repete todo mês</span>
            </label>
          )}
          {form.tipo === 'saida' && (
            <label className="fin-check">
              <input type="checkbox" checked={form.pontual} onChange={(e) => set('pontual', e.target.checked)} />
              <span>não se repete (pontual)</span>
            </label>
          )}

          <div className="fin-acoes">
            <button className="fin-salvar" disabled={salvando}>{salvando ? 'salvando…' : 'Lançar'}</button>
            <button type="button" className="linkbtn" onClick={() => { setForm({ ...VAZIO }); setErro(''); }}>
              limpar
            </button>
          </div>
          {erro && <p className="fin-erro">{erro}</p>}
          <p className="muted small fin-dica">
            {saldo
              ? 'O saldo entra no patrimônio na data informada (sem data: hoje). Para atualizar, lance o novo saldo com o mesmo nome e o mesmo "onde está": vale o mais recente.'
              : <>Sem vencimento o lançamento cai no mês corrente e fica marcado como <b>sem data</b>. O arquivo do mês é criado sozinho se não existir.</>}
          </p>
        </form>
      </section>

      {/* ---------- lista ---------- */}
      <section className="fin-bloco">
        <div className="fin-listahead">
          <h3>Lançamentos</h3>
          <div className="ag-tabs">
            <button className={'proj-tab' + (filtro === 'abertos' ? ' active' : '')} onClick={() => setFiltro('abertos')}>
              abertos
            </button>
            <button className={'proj-tab' + (filtro === 'todos' ? ' active' : '')} onClick={() => setFiltro('todos')}>
              todos
            </button>
          </div>
        </div>

        {!visiveis.length && <p className="muted">Nada aqui ainda. Lança acima.</p>}

        {visiveis.map(([mes, itens]) => (
          <div key={mes} className="fin-mes">
            <div className="fin-mes-head">
              <b>{rotuloMes(mes)}</b>
              <span className="muted small">
                {itens.length} · entra {brl(itens.filter((l) => eh(l) === 'entrada').reduce((s, l) => s + Number(l.valor || 0), 0))}
                {' · '}sai {brl(itens.filter((l) => eh(l) === 'saida').reduce((s, l) => s + Number(l.valor || 0), 0))}
              </span>
            </div>
            <table className="fin-tabela">
              <tbody>
                {itens.map((l) => {
                  const atrasado = estaAberto(l) && !!l.vencimento && l.vencimento < hoje;
                  return (
                    <tr key={l.mes + l.id} className={atrasado ? 'atrasado' : ''}>
                      <td className="fin-td-tipo">
                        <span className={'fin-seta ' + eh(l)}>{seta(eh(l))}</span>
                      </td>
                      <td className="fin-td-venc">
                        {l.vencimento ? (
                          <>
                            {dataCurta(l.vencimento)}
                            <span className="muted"> {rotuloRelativo(hoje, l.vencimento)}</span>
                          </>
                        ) : (
                          <span className="fin-semdata">sem data</span>
                        )}
                      </td>
                      <td className="fin-td-desc">
                        <span className="fin-desc">{l.descricao}</span>
                        <span className="fin-meta">
                          {l.cliente && <span className="fin-tag">{l.cliente}</span>}
                          {l.categoria && <span className="fin-tag fraca">{l.categoria}</span>}
                          {l.recorrente && <span className="fin-tag fraca">mensal</span>}
                          {l.pontual && <span className="fin-tag fraca">pontual</span>}
                          <span className={'fin-tag st-' + l.status}>{rotuloStatus(l)}</span>
                          {l.nota && temNota.has(l.nota) && (
                            <button className="linkbtn" onClick={() => onOpen(l.nota!)}>abrir nota</button>
                          )}
                        </span>
                        {l.obs && <span className="fin-obs">{l.obs}</span>}
                      </td>
                      <td className={'fin-td-valor ' + eh(l)}>
                        {eh(l) === 'entrada' ? '+' : eh(l) === 'reserva' ? '→' : eh(l) === 'saldo' ? '=' : '−'}{brl(Number(l.valor || 0))}
                      </td>
                      <td className="fin-td-acoes">
                        {l.tipo === 'investimento' ? null : estaAberto(l) ? (
                          <button
                            className="fin-mini ok"
                            title={eh(l) === 'saida' ? 'marcar como pago' : 'marcar como recebido'}
                            onClick={() => onAcao('liquidar', l.mes, l.id)}
                          >
                            ✓
                          </button>
                        ) : (
                          <button className="fin-mini" title="reabrir" onClick={() => onAcao('reabrir', l.mes, l.id)}>
                            ↺
                          </button>
                        )}
                        {l.tipo === 'saida' && (
                          <button className={'fin-mini pontual' + (l.pontual ? ' on' : '')} aria-pressed={!!l.pontual}
                            title={l.pontual ? 'deixar de ser pontual' : 'marcar como pontual (não se repete)'}
                            onClick={() => onPontual(l.mes, l.id, !l.pontual)}>
                            1×
                          </button>
                        )}
                        <button
                          className="fin-mini del"
                          title="remover"
                          onClick={() => {
                            if (confirm(`Remover "${l.descricao}"?`)) onAcao('remover', l.mes, l.id);
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        {financeiro.meses.length > 0 && (
          <p className="muted small fin-dica">
            Arquivos:{' '}
            {financeiro.meses.map((m, i) => (
              <span key={m.rel}>
                {i > 0 && ' · '}
                <button className="linkbtn" onClick={() => onOpen(m.id)}>{m.mes}</button>
              </span>
            ))}
          </p>
        )}
      </section>
      </>)}
    </div>
  );
}
