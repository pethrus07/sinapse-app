import { useEffect, useMemo, useState } from 'react';
import type { Financeiro, Lancamento, Note, TipoLancamento } from '../types';
import { dataCurta, hojeYmd, rotuloRelativo } from '../lib/agenda';
import {
  aReceberPorCliente, brl, CATEGORIAS, agruparPorMes, clientesConhecidos, rotuloCategoria,
  estaAberto, resumir, rotuloStatus,
} from '../lib/financeiro';
import { focoPadrao } from '../lib/financeiroModelo';
import { MetisEntradas, MetisGastos, MetisPatrimonio, MetisPlano, MetisPronoia, MetisVisao, SeletorMes } from './MetisPaginas';
import { FilaClassificar } from './FinanceiroAnalises';

// Métis: o módulo financeiro do Sinapse (por dentro segue "financeiro": rota, pasta e formato).
// Abas no topo, cada uma com rota própria (#/financeiro/<aba>): Visão, Gastos, Entradas,
// Patrimônio, Pronoia, Plano e Lançamentos. O mês em foco é um só para as abas que olham um mês.

interface Props {
  financeiro: Financeiro;
  notes: Note[];
  onOpen: (id: string) => void;
  onLancar: (l: Record<string, unknown>) => Promise<void>;
  onAcao: (acao: 'liquidar' | 'reabrir' | 'remover', mes: string, id: string) => Promise<void>;
  onClassificar: (mes: string, id: string, categoria: string, lembrar: boolean) => Promise<{ lembrou: boolean; motivo?: string } | null>;
  onPontual: (mes: string, id: string, valor: boolean) => Promise<void>;
  onNatureza: (mes: string, id: string, valor: string) => Promise<void>;
  onOrcamento: (tetos: Record<string, string>, meta: string) => Promise<void>;
}

type Filtro = 'abertos' | 'todos';
type Aba = 'visao' | 'gastos' | 'entradas' | 'patrimonio' | 'pronoia' | 'plano' | 'lancamentos';
const ABAS: { aba: Aba; rotulo: string; titulo: string; mes: boolean }[] = [
  { aba: 'visao', rotulo: 'Visão', titulo: 'O mês num relance', mes: true },
  { aba: 'gastos', rotulo: 'Gastos', titulo: 'Para onde foi o dinheiro', mes: true },
  { aba: 'entradas', rotulo: 'Entradas', titulo: 'O que entra e até quando', mes: true },
  { aba: 'patrimonio', rotulo: 'Patrimônio', titulo: 'A reserva e o investido', mes: false },
  { aba: 'pronoia', rotulo: 'Pronoia', titulo: 'O que vem pela frente', mes: false },
  { aba: 'plano', rotulo: 'Plano', titulo: 'Tetos e meta da reserva', mes: true },
  { aba: 'lancamentos', rotulo: 'Lançamentos', titulo: 'Entra, sai e o que falta receber', mes: false },
];
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

export function FinanceiroView({ financeiro, notes, onOpen, onLancar, onAcao, onClassificar, onPontual, onNatureza, onOrcamento }: Props) {
  const hoje = hojeYmd();
  const [form, setForm] = useState({ ...VAZIO });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('abertos');
  // #/financeiro abre na Visão; #/financeiro/<aba> abre direto na aba
  const abaDoHash = (): Aba => {
    const k = location.hash.replace(/^#\/financeiro\/?/, '').split(/[/?]/)[0];
    return (ABAS.find((a) => a.aba === k)?.aba) || 'visao';
  };
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
  const [foco, setFoco] = useState(() => focoPadrao(financeiro.lancamentos, hoje.slice(0, 7)));
  const [editarTetos, setEditarTetos] = useState(false);
  const info = ABAS.find((a) => a.aba === aba)!;
  // no celular as abas rolam de lado: a ativa precisa estar à vista
  useEffect(() => {
    const el = document.querySelector('.mt-abas [aria-selected="true"]') as HTMLElement | null;
    const pai = el?.parentElement;
    if (el && pai && (el.offsetLeft < pai.scrollLeft || el.offsetLeft + el.offsetWidth > pai.scrollLeft + pai.clientWidth))
      pai.scrollLeft = el.offsetLeft - 16;
  }, [aba]);

  const temNota = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);
  const resumo = useMemo(() => resumir(financeiro.lancamentos, hoje), [financeiro.lancamentos, hoje]);
  const clientes = useMemo(() => clientesConhecidos(financeiro.lancamentos), [financeiro.lancamentos]);
  const porCliente = useMemo(() => aReceberPorCliente(financeiro.lancamentos), [financeiro.lancamentos]);
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

  const props = { financeiro, hoje, foco };
  return (
    <div className="pad-scroll metis">
      <div className="mt-topo">
        <div className="eyebrow-mono">Métis{aba !== 'visao' ? ` › ${info.rotulo}` : ''}</div>
        <h1 className="rm-title">{info.titulo}</h1>
        <nav className="mt-abas" role="tablist" aria-label="Páginas da Métis">
          {ABAS.map((a) => (
            <button key={a.aba} role="tab" aria-selected={aba === a.aba} className={'proj-tab' + (aba === a.aba ? ' active' : '')}
              onClick={() => { setEditarTetos(false); setAba(a.aba); }} title={a.aba === 'pronoia' ? 'Pronoia: o que vem pela frente' : undefined}>{a.rotulo}</button>
          ))}
        </nav>
        {info.mes && <SeletorMes {...props} onFoco={setFoco} />}
      </div>

      {aba === 'visao' && <MetisVisao {...props} onClassificar={() => setAba('lancamentos')} />}
      {aba === 'gastos' && <MetisGastos {...props} onNatureza={(l, v) => onNatureza(l.mes, l.id, v)} onPlano={() => { setEditarTetos(true); setAba('plano'); }} />}
      {aba === 'entradas' && <MetisEntradas {...props} />}
      {aba === 'patrimonio' && <MetisPatrimonio {...props} />}
      {aba === 'pronoia' && <MetisPronoia {...props} />}
      {aba === 'plano' && <MetisPlano key={String(editarTetos)} {...props} onOrcamento={onOrcamento} editarAoAbrir={editarTetos} />}

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
          <b>{brl(resumo.semData)} sem data de vencimento</b>: {brl(resumo.semDataReceber)} a receber
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
              placeholder="opcional: o porquê, a condição, o combinado"
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
                          {l.categoria && <span className="fin-tag fraca">{rotuloCategoria(l.categoria)}</span>}
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
