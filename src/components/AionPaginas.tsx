// As telas do Aion (investimentos). Regra do Pedro: pouca coisa à vista, muito respiro, o resto em
// "Mais opções"; borda só quando comunica estado. O Aion NÃO recomenda: mostra dado, fonte e data.
// Todo número, barra e ativo com porquê tem o pop-up (AionPorque.tsx). Lógica em src/lib/aion*.ts.
import { useMemo, useState } from 'react';
import type { Aion, AtivoObservado, Cotacao, Financeiro, MetasAion, RegraAion, TipoAtivo, TipoCarteira } from '../types';
import { brl } from '../lib/financeiro';
import {
  BLOCO_DO_TIPO, carteiraPorTipo, metasNoRitmo, PISO_RESERVA, posicoesAion, rendaPassiva, rendaPassivaPorMes, rendimentoDaCarteira, ritmoDeAporte, ROTULO_TIPO, TIPOS,
  type PosicaoAion,
} from '../lib/aion';
import { HORIZONTES, olharParaTras, premissasDoMercado, simular, type EntradaSimulacao, type Premissas } from '../lib/aionSimular';
import { FONTES_PORQUE, ROTULO_PORQUE, type Porque } from '../lib/aionPorques';
import { somarMes } from '../lib/financeiroGraficos';
import { ComPorque, ItemPorque, usePorques } from './AionPorque';
import { BarrasTipo, Comparacao, FaixaCenarios } from './AionGraficos';
import { Cartao, curto, Legenda, longo, num } from './FinanceiroGraficos';
import { Medidor, Numero } from './MetisGraficos';

const br = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const pct = (v: number | null | undefined, casas = 2) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
const sinalPct = (v: number | null | undefined) => (v == null ? '' : `${v > 0 ? '▲ +' : v < 0 ? '▼ −' : ''}${pct(Math.abs(v))}`);
const valorBR = (t: string) => { const s = String(t || '').trim().replace(/\./g, '').replace(',', '.'); const x = Number(s); return s && Number.isFinite(x) ? x : NaN; };

export interface PaginaAion { aion: Aion; financeiro: Financeiro; hoje: string }

/** Como pegar a chave da brapi (o Pedro digita; nunca vai para o repo). */
export function ComoPegarToken() {
  return (
    <details className="fg-mais ai-como">
      <summary>Cotação de ações e FIIs precisa da chave da brapi: como pegar</summary>
      <div className="fg-mais-corpo">
        <ol className="ai-passos">
          <li>Crie a conta grátis em <a href="https://brapi.dev/dashboard" target="_blank" rel="noreferrer noopener">brapi.dev/dashboard</a> e copie o token (plano grátis: 15 mil requisições por mês).</li>
          <li>Numa janela do PowerShell, grave cifrado (só a sua conta do Windows abre): <code className="ai-cmd">powershell -ExecutionPolicy Bypass -File scripts\aion\aion-chave.ps1 -Servico brapi</code></li>
          <li>Colete: <code className="ai-cmd">npm run aion:gravar</code> (ou a tarefa agendada, se instalar).</li>
        </ol>
        <p className="fg-explica">Sem o token, a brapi só responde PETR4, MGLU3, VALE3 e ITUB4. Cripto vem da CoinGecko sem chave (a chave Demo é opcional: <code>-Servico coingecko</code>).</p>
      </div>
    </details>
  );
}

function FonteData({ fonte, data }: { fonte?: string; data?: string }) {
  if (!fonte) return null;
  return <span className="ai-fonte">{fonte}{data ? ` · ${br(data)}` : ''}</span>;
}

/* ------------------------------------------------------------ Carteira */

function cotacaoDe(aion: Aion, p: { ticker: string; tipo: TipoCarteira }): Cotacao | null {
  const m = aion.mercado;
  return (p.tipo === 'cripto' ? m?.cripto?.porCodigo?.[p.ticker] : m?.cotacoes?.porCodigo?.[p.ticker]) || null;
}

function ListaAtivos({ aion, posicoes }: { aion: Aion; posicoes: PosicaoAion[] }) {
  return (
    <ul className="ai-ativos" aria-label="Ativos da carteira (passe o mouse ou toque para ver o porquê)">
      {posicoes.map((p) => {
        const c = cotacaoDe(aion, p);
        const semToken = aion.mercado?.cotacoes?.semToken?.includes(p.ticker);
        return (
          <ComPorque key={p.chave} como="li" alvo={p.ticker || p.tipo} rotulo={p.ticker || p.descricao} className="ai-ativo">
            <span className="ai-ativo-nome"><b>{p.ticker || p.descricao}</b><span className="muted">{ROTULO_TIPO[p.tipo]}</span></span>
            <span className="ai-ativo-val">{brl(p.valor)}</span>
            <span className={'ai-ativo-var' + (c?.variacaoDia == null ? ' muted' : '')}>
              {c?.variacaoDia != null ? <>{sinalPct(c.variacaoDia)} <span className="muted">{p.tipo === 'cripto' ? '24 h' : 'no dia'}</span></> : semToken ? 'sem cotação: falta o token da brapi' : 'sem cotação'}
            </span>
          </ComPorque>
        );
      })}
    </ul>
  );
}

export function AionCarteira({ aion, financeiro, hoje, onTela }: PaginaAion & { onTela: (t: string) => void }) {
  const ls = financeiro.lancamentos;
  const hojeMes = hoje.slice(0, 7);
  const pos = useMemo(() => posicoesAion(ls), [ls]);
  const piso = aion.metas?.reserva || financeiro.orcamento?.metaReserva || PISO_RESERVA;
  const cart = useMemo(() => carteiraPorTipo(pos, aion.regra, aion.regra?.reservaMinima || piso), [pos, aion.regra, piso]);
  const rp = useMemo(() => rendaPassiva(ls, hojeMes), [ls, hojeMes]);
  const rpAnt = useMemo(() => rendaPassiva(ls, somarMes(hojeMes, -1)), [ls, hojeMes]);
  const ritmo = useMemo(() => ritmoDeAporte(ls, hojeMes), [ls, hojeMes]);
  const retratos = financeiro.retratos || [];
  const aportesEntreRetratos = useMemo(() => {
    const rs = [...retratos].sort((a, b) => a.data.localeCompare(b.data));
    if (rs.length < 2) return 0;
    return ritmo.meses.filter((m) => m.mes > rs[0].data.slice(0, 7) && m.mes <= rs[rs.length - 1].data.slice(0, 7)).reduce((s, m) => s + m.valor, 0);
  }, [retratos, ritmo]);
  const rend = useMemo(() => rendimentoDaCarteira(pos, aion.mercado, retratos, hoje, aportesEntreRetratos), [pos, aion.mercado, retratos, hoje, aportesEntreRetratos]);
  if (!pos.length) return (
    <div className="fg"><Cartao id="carteira-vazia" className="largo" titulo="Carteira" leitura="Nenhuma posição de investimento no razão ainda. A sincronização da Métis traz as do banco; cripto entra à mão em Métis › Lançamentos (= Saldo, classe cripto).">{null}</Cartao></div>
  );
  const fora = cart.linhas.filter((l) => l.tipo !== 'reserva');
  const res = cart.linhas.find((l) => l.tipo === 'reserva');
  const foraDaFaixa = fora.filter((l) => l.situacao === 'acima' || l.situacao === 'abaixo');
  const dataPos = pos.map((p) => p.data).sort().pop() || '';
  const ativos = pos.filter((p) => ['fii', 'acao', 'cripto'].includes(p.tipo));
  const semToken = ativos.filter((p) => aion.mercado?.cotacoes?.semToken?.includes(p.ticker));
  return (
    <>
      <div className="mt-numeros">
        <ComPorque alvo="carteira" rotulo="Total investido" className="ai-num-alvo" extra={<p className="ai-pq-txt">Soma das posições do razão da Métis (Meu Pluggy, a última sincronização: {br(dataPos)}) e do que entrou à mão.</p>}>
          <Numero id="total" rotulo="Total investido" valor={brl(cart.total)} sub={`${pos.length} aplicações · posição de ${br(dataPos)}`} />
        </ComPorque>
        <ComPorque alvo="reserva" rotulo="Reserva" className="ai-num-alvo">
          <div className="mt-num" data-numero="reserva">
            <span className="mt-num-rot">Reserva</span>
            <b className="mt-num-val">{cart.reserva < cart.reservaMinima && <span className="mt-icone" aria-hidden>⚠ </span>}{brl(cart.reserva)}</b>
            <Medidor valor={cart.reserva} alvo={cart.reservaMinima} rotulo="Reserva em relação ao piso" />
            <span className="mt-num-sub">{cart.reserva < cart.reservaMinima ? `faltam ${brl(cart.reservaMinima - cart.reserva)} para o piso de ${brl(cart.reservaMinima)}` : `acima do piso de ${brl(cart.reservaMinima)}`}</span>
          </div>
        </ComPorque>
        <ComPorque alvo="carteira-fora" rotulo="Fora da reserva" className="ai-num-alvo" extra={<p className="ai-pq-txt">Tudo que não é reserva: renda fixa com prazo, FII, ação e cripto. É onde o risco é aceito.</p>}>
          <Numero id="fora" rotulo="Fora da reserva" valor={brl(cart.fora)} sub="onde o risco é aceito" />
        </ComPorque>
        <ComPorque alvo="renda-passiva" rotulo="Renda passiva" className="ai-num-alvo" extra={<p className="ai-pq-txt">Dividendos, JCP e rendimentos de FII e aplicação que entraram no mês (o que o razão tem). {rp.itens.length ? rp.itens.map((l) => `${l.descricao}: ${brl(Number(l.valor))}`).join(' · ') : ''}</p>}>
          <Numero id="renda-passiva" rotulo={`Renda passiva de ${curto(hojeMes)}`} valor={brl(rp.total)} sub={rp.total > 0 ? 'entrou no mês' : rpAnt.total > 0 ? `${curto(somarMes(hojeMes, -1))}: ${brl(rpAnt.total)}` : 'nada entrou ainda'} />
        </ComPorque>
      </div>
      <div className="fg">
        <Cartao id="por-tipo" className="largo" titulo="Fora da reserva, por tipo"
          leitura={!cart.temRegra
            ? <>Sem regra escrita: o Aion mostra a divisão, mas não tem com o que comparar. <button className="linkbtn" onClick={() => onTela('regra')}>Minha regra</button></>
            : foraDaFaixa.length ? <><span aria-hidden>⚠ </span>{foraDaFaixa.length} de {fora.length} {fora.length === 1 ? 'tipo' : 'tipos'} fora da faixa da sua regra: {foraDaFaixa.map((l) => ROTULO_TIPO[l.tipo].toLowerCase()).join(', ')}. Quem decide se mexe é você.</> : <>Tudo dentro da faixa da sua regra.</>}
          mais={<>
            <p className="fg-explica">% da carteira fora da reserva ({brl(cart.fora)}). {cart.temRegra ? 'O trilho claro é a faixa da regra (alvo ± tolerância) e o traço é o alvo.' : ''} Reserva = posição de liquidez diária ou marcada como reserva ({res ? brl(res.valor) : 'R$ 0'}).</p>
            <div className="mt-rolagem">
              <table className="fg-tabela">
                <thead><tr><th>tipo</th><th>o quê</th><th>onde</th><th className="num">valor</th><th className="num">aplicado</th><th>indexador</th><th>data</th></tr></thead>
                <tbody>{pos.map((p) => <tr key={p.chave}><td>{ROTULO_TIPO[p.tipo]}</td><td className="mt-quebra">{p.descricao}{p.manual ? ' · à mão' : ''}</td><td>{p.instituicao}</td><td className="num">{num(p.valor)}</td><td className="num">{p.aportado ? num(p.aportado) : '—'}</td><td>{p.indexador || '—'}</td><td>{br(p.data)}</td></tr>)}</tbody>
              </table>
            </div>
          </>}>
          {cart.temRegra && <Legenda itens={[{ cor: 'var(--s1)', rotulo: 'hoje' }, { cor: 'var(--ai-faixa)', rotulo: 'faixa da regra' }, { cor: 'var(--ink)', rotulo: 'alvo', linha: true }]} />}
          <BarrasTipo linhas={fora} />
        </Cartao>

        <Cartao id="rendimento" titulo="Rendimento × CDI e IPCA"
          leitura={rend.base === 'nenhuma' ? <>Ainda sem base para medir. {rend.explica}</>
            : <>Desde {br(rend.desde)} a parte com base rendeu <b>{pct(rend.pct)}</b> ({brl(rend.ganho)}). No mesmo período o CDI foi {pct(rend.cdi?.pct)} e o IPCA {pct(rend.ipca?.pct)}.</>}
          mais={<>
            <p className="fg-explica">{rend.explica} {rend.base !== 'nenhuma' && rend.cobertura < 1 ? `Cobre ${Math.round(rend.cobertura * 100)}% da carteira; o resto não tem valor aplicado no razão.` : ''}</p>
            <p className="fg-explica">A partir desta versão a sincronização da Métis grava o valor aplicado, a data e o indexador de cada aplicação (quando o banco manda): a comparação passa a valer na primeira sincronização depois que o Aion entrar no app.</p>
          </>}>
          {rend.base !== 'nenhuma' && <Comparacao itens={[
            { chave: 'carteira', alvo: 'carteira', rotulo: 'Sua carteira', pct: rend.pct, destaque: true },
            { chave: 'cdi', alvo: 'cdi', rotulo: 'CDI', pct: rend.cdi?.pct ?? null, sub: rend.cdi ? `${rend.cdi.meses} meses` : 'sem série' },
            { chave: 'ipca', alvo: 'ipca', rotulo: 'IPCA', pct: rend.ipca?.pct ?? null, sub: rend.ipca ? `${rend.ipca.meses} meses` : 'sem série' },
          ]} />}
        </Cartao>

        <Cartao id="ativos" titulo="Seus ativos hoje"
          leitura={ativos.length ? <>Passe o mouse (ou toque) num ativo para ver o porquê.{semToken.length ? ` ${semToken.length} de ${ativos.length} sem cotação.` : ''}</> : 'Nenhum FII, ação ou cripto na carteira.'}
          mais={semToken.length ? <ComoPegarToken /> : undefined}>
          <ListaAtivos aion={aion} posicoes={ativos} />
        </Cartao>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ Porquês (a lista completa) */

export function AionPorques({ aion, financeiro }: PaginaAion) {
  const { todos, onEstudar, tituloBloco } = usePorques();
  const meus = useMemo(() => new Set(posicoesAion(financeiro.lancamentos).map((p) => p.ticker).filter(Boolean)), [financeiro.lancamentos]);
  const obs = useMemo(() => new Set((aion.observacao?.ativos || []).map((a) => a.codigo.toUpperCase())), [aion.observacao]);
  const [filtro, setFiltro] = useState<'todos' | 'juros' | 'meus' | 'observacao'>('todos');
  const passa = (p: Porque) => filtro === 'todos' || (filtro === 'juros' ? p.alvos.some((a) => ['selic', 'cdi', 'ipca', 'focus', 'dolar'].includes(a)) : filtro === 'meus' ? p.alvos.some((a) => meus.has(a)) : p.alvos.some((a) => obs.has(a)));
  const lista = todos.filter(passa);
  const FILTROS = [['todos', 'Todos'], ['juros', 'Juros e inflação'], ['meus', 'Seus ativos'], ['observacao', 'Observação']] as const;
  return (
    <div className="fg">
      <Cartao id="porques" className="largo" titulo="Os porquês ligados hoje"
        leitura={todos.length ? <>{todos.length} explicações com fonte e data. Cada uma diz se é causa conhecida, fato, opinião de alguém, estimativa ou hipótese; o que não tem explicação aparece como "sem notícia".</> : 'Nenhum porquê ainda: o cache de mercado está vazio (rode a coleta).'}
        mais={<>
          <p className="fg-explica">Fontes de porquê (a camada que o Aion consulta; uma fonte nova entra aqui sem mudar as telas):</p>
          <ul className="ai-fontes">{FONTES_PORQUE.map((f) => <li key={f.id} data-fonte={f.id}><b>{f.nome}</b> <span className={'ai-tag ' + (f.ligada ? 'fato' : 'sem-noticia')}>{f.ligada ? (f.tempoReal ? 'tempo real' : 'histórico') : 'não ligada'}</span><span className="fg-explica">{f.explica}</span></li>)}</ul>
        </>}>
        <div className="mt-meses ai-filtros" role="group" aria-label="Filtrar porquês">
          {FILTROS.map(([k, r]) => <button key={k} className={'mt-mes' + (filtro === k ? ' on' : '')} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{r}</button>)}
        </div>
        {lista.length ? <div className="ai-lista-pq">{lista.map((p) => <ItemPorque key={p.id} p={p} onEstudar={onEstudar} tituloBloco={tituloBloco} />)}</div>
          : <p className="fg-explica">Nada neste filtro.{filtro === 'observacao' && !obs.size ? ' A lista de observação está vazia.' : ''}</p>}
      </Cartao>
    </div>
  );
}

/* ------------------------------------------------------------ Lista de observação */

const TIPOS_OBS: { tipo: TipoAtivo; rotulo: string }[] = [{ tipo: 'acao', rotulo: 'Ação' }, { tipo: 'fii', rotulo: 'FII' }, { tipo: 'etf', rotulo: 'ETF' }, { tipo: 'bdr', rotulo: 'BDR' }, { tipo: 'cripto', rotulo: 'Cripto' }];

export function AionObservacao({ aion, hoje, onSalvar }: PaginaAion & { onSalvar: (ativos: AtivoObservado[]) => Promise<void> }) {
  const ativos = aion.observacao?.ativos || [];
  const [codigo, setCodigo] = useState('');
  const [tipo, setTipo] = useState<TipoAtivo>('acao');
  const [nota, setNota] = useState('');
  const [msg, setMsg] = useState('');
  const [salvando, setSalvando] = useState(false);
  const m = aion.mercado;
  const cot = (a: AtivoObservado) => (a.tipo === 'cripto' ? Object.values(m?.cripto?.porCodigo || {}).find((c) => c.id === a.codigo.toLowerCase() || c.codigo === a.codigo.toUpperCase()) : m?.cotacoes?.porCodigo?.[a.codigo.toUpperCase()]) || null;
  const salvar = async (lista: AtivoObservado[]) => {
    setSalvando(true); setMsg('');
    try { await onSalvar(lista); } catch (e) { setMsg('Não deu para salvar: ' + (e as Error).message); } finally { setSalvando(false); }
  };
  const temCripto = ativos.some((a) => a.tipo === 'cripto');
  const semToken = ativos.filter((a) => a.tipo !== 'cripto' && m?.cotacoes?.semToken?.includes(a.codigo.toUpperCase()));
  return (
    <div className="fg">
      <Cartao id="observacao" className="largo" titulo="Ativos que você acompanha sem ter"
        leitura={ativos.length ? <>{ativos.length} na lista. Passe o mouse (ou toque) para ver o porquê do movimento.</> : 'Nenhum ativo na lista ainda. Inclua um abaixo: a cotação chega na próxima coleta.'}
        mais={<>
          <p className="fg-explica">A lista mora no vault (04-NEGOCIO/financeiro/aion-observacao.md). O coletor busca a cotação destes também. Indicadores: P/L e mínima e máxima de 52 semanas quando a brapi manda; indicadores de FII só no plano pago da brapi.</p>
          {semToken.length > 0 && <ComoPegarToken />}
        </>}>
        {ativos.length > 0 && (
          <ul className="ai-ativos" aria-label="Lista de observação">
            {ativos.map((a) => {
              const c = cot(a);
              const cod = a.tipo === 'cripto' ? (c?.codigo || a.codigo.toUpperCase()) : a.codigo.toUpperCase();
              return (
                <li key={a.codigo} className="ai-obs-linha">
                  <ComPorque alvo={cod} rotulo={cod} className="ai-ativo">
                    <span className="ai-ativo-nome"><b>{cod}</b><span className="muted">{TIPOS_OBS.find((t) => t.tipo === a.tipo)?.rotulo}{a.nota ? ` · ${a.nota}` : ''}</span></span>
                    <span className="ai-ativo-val">{c?.preco != null ? brl(c.preco) : '—'}</span>
                    <span className={'ai-ativo-var' + (c?.variacaoDia == null ? ' muted' : '')}>
                      {c?.variacaoDia != null ? <>{sinalPct(c.variacaoDia)} <span className="muted">{a.tipo === 'cripto' ? '24 h' : 'no dia'}</span></> : m?.cotacoes?.semToken?.includes(cod) ? 'sem cotação: falta o token da brapi' : 'cotação na próxima coleta'}
                    </span>
                    {c && (c.pl != null || c.min52 != null) && <span className="ai-ativo-ind muted">{c.pl != null ? `P/L ${c.pl.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}` : ''}{c.min52 != null ? ` · 52 sem.: ${brl(c.min52)} a ${brl(c.max52 || 0)}` : ''}</span>}
                  </ComPorque>
                  <button className="fin-mini del" aria-label={`Tirar ${cod} da lista`} disabled={salvando} onClick={() => salvar(ativos.filter((x) => x !== a))}>✕</button>
                </li>
              );
            })}
          </ul>
        )}
        <form className="ai-form" onSubmit={(e) => {
          e.preventDefault();
          const c = codigo.trim();
          if (!c) return setMsg('Escreva o código (ex.: ITSA4, ABCD11, bitcoin).');
          salvar([...ativos, { codigo: c, tipo, nota: nota.trim(), desde: hoje }]).then(() => { setCodigo(''); setNota(''); });
        }}>
          <label className="fin-campo"><span>Código</span><input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="ITSA4, ABCD11, bitcoin" autoComplete="off" /></label>
          <label className="fin-campo"><span>Tipo</span><select value={tipo} onChange={(e) => setTipo(e.target.value as TipoAtivo)}>{TIPOS_OBS.map((t) => <option key={t.tipo} value={t.tipo}>{t.rotulo}</option>)}</select></label>
          <label className="fin-campo grande"><span>Por que observar (opcional)</span><input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="ex.: comparar com o que tenho" autoComplete="off" /></label>
          <button className="mt-botao" disabled={salvando}>{salvando ? 'salvando…' : 'Incluir'}</button>
          {msg && <p className="fin-erro" role="alert">{msg}</p>}
        </form>
        {temCripto && <p className="ai-fonte">{m?.cripto?.citar || 'Data provided by CoinGecko'}</p>}
      </Cartao>
    </div>
  );
}

/* ------------------------------------------------------------ Simular */

const TIPOS_SIM: TipoCarteira[] = ['reserva', 'renda-fixa', 'fii', 'acao', 'cripto'];

export function AionSimular({ aion, financeiro, hoje }: PaginaAion) {
  const ls = financeiro.lancamentos;
  const hojeMes = hoje.slice(0, 7);
  const pos = useMemo(() => posicoesAion(ls), [ls]);
  const ritmo = useMemo(() => ritmoDeAporte(ls, hojeMes), [ls, hojeMes]);
  const [premissas, setPremissas] = useState<Premissas>(() => premissasDoMercado(aion.mercado, Number(hoje.slice(0, 4))));
  const [mais, setMais] = useState('');
  const [compraTipo, setCompraTipo] = useState<string>('fii');
  const [compraValor, setCompraValor] = useState('');
  const [resgTipo, setResgTipo] = useState<TipoCarteira>('acao');
  const [resgValor, setResgValor] = useState('');
  const [trasValor, setTrasValor] = useState('200');
  const [trasDe, setTrasDe] = useState(() => somarMes(hojeMes, -60));
  const obs = aion.observacao?.ativos || [];
  const inicial = useMemo(() => {
    const o: Partial<Record<TipoCarteira, number>> = {};
    for (const p of pos) { const t = p.tipo === 'outros' ? 'renda-fixa' : p.tipo; o[t] = (o[t] || 0) + p.valor; }
    return o;
  }, [pos]);
  // divisão do aporte: pela regra (a reserva até o mínimo vem antes, ver Metas); sem regra, como a carteira de hoje
  const divisao = useMemo(() => {
    const a = aion.regra?.alocacao || {};
    if (Object.keys(a).length) return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v!.alvo])) as Partial<Record<TipoCarteira, number>>;
    const total = Object.values(inicial).reduce((s, v) => s + (v || 0), 0);
    return Object.fromEntries(Object.entries(inicial).map(([k, v]) => [k, total ? ((v || 0) / total) * 100 : 0])) as Partial<Record<TipoCarteira, number>>;
  }, [aion.regra, inicial]);
  const extra = Math.max(0, valorBR(mais) || 0);
  const compra = Math.max(0, valorBR(compraValor) || 0);
  const resg = Math.max(0, valorBR(resgValor) || 0);
  const temE = extra > 0 || compra > 0 || resg > 0;
  const base: EntradaSimulacao = { inicial, aporteMensal: ritmo.ritmo, divisaoAporte: divisao, eventos: [], meses: 60, anoHoje: Number(hoje.slice(0, 4)), mesHoje: Number(hoje.slice(5, 7)) };
  const obsEscolhido = compraTipo.startsWith('obs:') ? obs.find((a) => 'obs:' + a.codigo === compraTipo) : null;
  const tipoCompra: TipoCarteira = obsEscolhido ? (obsEscolhido.tipo === 'cripto' ? 'cripto' : obsEscolhido.tipo === 'fii' ? 'fii' : 'acao') : (compraTipo as TipoCarteira);
  const depoisE: EntradaSimulacao = { ...base, aporteMensal: ritmo.ritmo + extra, eventos: [...(compra ? [{ mes: 0, tipo: tipoCompra, valor: compra }] : []), ...(resg ? [{ mes: 0, tipo: resgTipo, valor: -resg }] : [])] };
  const simAntes = useMemo(() => simular(base, premissas), [JSON.stringify(base), premissas]); // eslint-disable-line react-hooks/exhaustive-deps
  const simDepois = useMemo(() => (temE ? simular(depoisE, premissas) : simAntes), [JSON.stringify(depoisE), premissas, temE, simAntes]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = simDepois;
  const h5 = s.horizontes[60];
  const tras = useMemo(() => olharParaTras(aion.mercado?.bcb?.cdiMensal?.pontos || [], aion.mercado?.bcb?.ipca?.mensal || [], Math.max(0, valorBR(trasValor) || 0), trasDe), [aion.mercado, trasValor, trasDe]);
  const setVol = (t: TipoCarteira, v: string) => { const x = valorBR(v); if (Number.isFinite(x)) setPremissas({ ...premissas, volatilidade: { ...premissas.volatilidade, [t]: x } }); };
  const setCdi = (t: TipoCarteira, v: string) => { const x = valorBR(v); if (Number.isFinite(x)) setPremissas({ ...premissas, pctCdi: { ...premissas.pctCdi, [t]: x } }); };
  if (!pos.length) return <p className="muted">Sem posição no razão para simular.</p>;
  return (
    <div className="fg">
      <Cartao id="e-se" className="largo" titulo={temE ? 'Antes × depois do "e se"' : 'Daqui a 1, 3 e 5 anos'}
        leitura={h5 ? <>Em 5 anos, em reais de hoje e já tirado o imposto: entre <b>{brl(h5.ruim.real)}</b> e <b>{brl(h5.bom.real)}</b>, com a base em {brl(h5.base.real)}{temE ? <> (sem o "e se": {brl(simAntes.horizontes[60].base.real)})</> : ''}. É conta com premissas, não promessa.</> : '—'}
        mais={<>
          <p className="fg-explica">Aporte de partida = o ritmo real medido no razão: <b>{brl(ritmo.ritmo)} por mês</b> ({ritmo.nMeses} {ritmo.nMeses === 1 ? 'mês fechado' : 'meses fechados'}{ritmo.fraca ? ', pouco dado: estimativa fraca' : ''}). Divisão do aporte: {aion.regra && Object.keys(aion.regra.alocacao).length ? 'pela Minha regra' : 'igual à carteira de hoje (sem regra escrita)'}. Compra e resgate acontecem hoje.</p>
          <Premissas p={premissas} setVol={setVol} setCdi={setCdi} setP={setPremissas} />
        </>}>
        <div className="ai-controles">
          <label className="fin-campo"><span>Aportar a mais por mês (R$)</span><input inputMode="decimal" value={mais} onChange={(e) => setMais(e.target.value)} placeholder={`hoje: ${num(ritmo.ritmo)}/mês`} autoComplete="off" /></label>
        </div>
        <details className="fg-mais ai-e-se" open={compra > 0 || resg > 0}>
          <summary>Aplicar ou resgatar uma vez</summary>
          <div className="ai-controles">
            <label className="fin-campo"><span>Aplicar uma vez em</span>
              <select value={compraTipo} onChange={(e) => setCompraTipo(e.target.value)}>
                {TIPOS_SIM.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
                {obs.map((a) => <option key={'o' + a.codigo} value={'obs:' + a.codigo}>{a.codigo.toUpperCase()} (da lista)</option>)}
              </select>
            </label>
            <label className="fin-campo"><span>Valor (R$)</span><input inputMode="decimal" value={compraValor} onChange={(e) => setCompraValor(e.target.value)} placeholder="0" autoComplete="off" /></label>
            <label className="fin-campo"><span>Resgatar de</span><select value={resgTipo} onChange={(e) => setResgTipo(e.target.value as TipoCarteira)}>{TIPOS_SIM.filter((t) => (inicial[t] || 0) > 0).map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}</select></label>
            <label className="fin-campo"><span>Valor (R$)</span><input inputMode="decimal" value={resgValor} onChange={(e) => setResgValor(e.target.value)} placeholder="0" autoComplete="off" /></label>
          </div>
          <p className="fg-explica">Ativo da lista entra pelo tipo dele (ação, FII, cripto): o Aion não tem histórico longo de cada ativo para uma faixa própria.</p>
        </details>
        <Legenda itens={[{ cor: 'var(--s1)', rotulo: temE ? 'depois: base' : 'base' }, { cor: 'var(--s1)', rotulo: 'faixa ruim–bom', leve: 0.3 }, ...(temE ? [{ cor: 'var(--mt-anterior)', rotulo: 'antes: base' }] : [])]} />
        <ComPorque alvo="simulacao" rotulo="Simulação" className="ai-bloco-alvo" extra={<p className="ai-pq-txt">A faixa vem das premissas em "Mais opções": juros do Focus, volatilidade declarada de cada tipo e o imposto pela regra geral. Mexa nelas para ver o efeito.</p>}>
          <FaixaCenarios ruim={s.cenarios.ruim} base={s.cenarios.base} bom={s.cenarios.bom} antes={temE ? simAntes.cenarios.base : null} />
        </ComPorque>
        <table className="fg-tabela ai-horizontes">
          <thead><tr><th>em</th><th className="num">ruim</th><th className="num">base</th><th className="num">bom</th>{temE && <th className="num">antes (base)</th>}<th className="num">aplicado</th></tr></thead>
          <tbody>{HORIZONTES.map((h) => { const x = s.horizontes[h]; return x ? <tr key={h}><td>{h / 12} {h === 12 ? 'ano' : 'anos'}</td><td className="num">{num(x.ruim.real)}</td><td className="num">{num(x.base.real)}</td><td className="num">{num(x.bom.real)}</td>{temE && <td className="num">{num(simAntes.horizontes[h].base.real)}</td>}<td className="num">{num(x.base.aplicado)}</td></tr> : null; })}</tbody>
        </table>
      </Cartao>
      <Cartao id="para-tras" titulo="Olhar para trás"
        leitura={tras ? <>R$ {num(valorBR(trasValor) || 0)} por mês desde {curto(tras.de)} no CDI dariam <b>{brl(tras.saldo)}</b> em {curto(tras.ate)} (antes do imposto). Aplicado: {brl(tras.aplicado)}; corrigido pelo IPCA: {brl(tras.corrigido)}; ganho real {brl(tras.ganhoReal)}.</> : 'Sem série do CDI no cache para esse período.'}
        mais={<p className="fg-explica">CDI mensal (BC, SGS 4391) e IPCA (433), aporte no começo de cada mês, sem imposto e sem custo. {tras?.mesesSemIpca ? `${tras.mesesSemIpca} mês(es) no fim ainda sem IPCA divulgado.` : ''}</p>}>
        <div className="ai-controles">
          <label className="fin-campo"><span>Por mês (R$)</span><input inputMode="decimal" value={trasValor} onChange={(e) => setTrasValor(e.target.value)} autoComplete="off" /></label>
          <label className="fin-campo"><span>Desde</span><input type="month" value={trasDe} min={aion.mercado?.bcb?.cdiMensal?.pontos?.[0]?.data.slice(0, 7)} max={hojeMes} onChange={(e) => setTrasDe(e.target.value)} /></label>
        </div>
      </Cartao>
    </div>
  );
}

function Premissas({ p, setVol, setCdi, setP }: { p: Premissas; setVol: (t: TipoCarteira, v: string) => void; setCdi: (t: TipoCarteira, v: string) => void; setP: (p: Premissas) => void }) {
  const anos = Object.keys(p.selicPorAno);
  return (
    <div className="ai-premissas" data-premissas>
      <p className="fg-explica"><b>Juros</b>: Selic {p.origem.selic}; CDI = Selic {p.spreadCdi >= 0 ? '+' : '−'} {Math.abs(p.spreadCdi).toLocaleString('pt-BR')} ponto (a diferença medida hoje). Cenário ruim e bom da renda fixa: Selic ∓ {p.deltaSelic} ponto. <b>Inflação</b>: IPCA {p.origem.ipca}.</p>
      <table className="fg-tabela"><thead><tr><th>ano</th>{anos.map((a) => <th key={a} className="num">{a}</th>)}</tr></thead>
        <tbody><tr><td>Selic (% a.a.)</td>{anos.map((a) => <td key={a} className="num">{pct(p.selicPorAno[a])}</td>)}</tr><tr><td>IPCA (% a.a.)</td>{anos.map((a) => <td key={a} className="num">{pct(p.ipcaPorAno[a])}</td>)}</tr></tbody></table>
      <p className="fg-explica"><b>Renda variável</b>: sem prêmio de risco assumido (a base é o CDI esperado); a faixa é ±1 desvio padrão da volatilidade abaixo (cerca de 2 em cada 3 resultados caem dentro, se a volatilidade for essa). Ruim e bom de todos os tipos juntos: a faixa da carteira fica mais larga que a real.</p>
      <div className="ai-controles">
        {(['acao', 'fii', 'cripto'] as TipoCarteira[]).map((t) => <label key={t} className="fin-campo"><span>Volatilidade {ROTULO_TIPO[t].toLowerCase()} (% a.a.)</span><input inputMode="decimal" defaultValue={String(p.volatilidade[t] ?? '')} onBlur={(e) => setVol(t, e.target.value)} /></label>)}
        {(['reserva', 'renda-fixa'] as TipoCarteira[]).map((t) => <label key={t} className="fin-campo"><span>{ROTULO_TIPO[t]}: % do CDI</span><input inputMode="decimal" defaultValue={String(p.pctCdi[t] ?? 100)} onBlur={(e) => setCdi(t, e.target.value)} /></label>)}
        <label className="fin-campo"><span>FII: parte do ganho isenta (0 a 1)</span><input inputMode="decimal" defaultValue={String(p.fiiParteIsenta)} onBlur={(e) => { const x = valorBR(e.target.value); if (Number.isFinite(x) && x >= 0 && x <= 1) setP({ ...p, fiiParteIsenta: x }); }} /></label>
      </div>
      <p className="fg-explica"><b>Imposto</b> (regra geral, bloco 10 da trilha; conferir todo ano): renda fixa na tabela regressiva por tempo de cada aporte (22,5% até 180 dias, 20% até 360, 17,5% até 720, 15% depois); ação 15% do ganho se a venda do mês passar de R$ {num(p.isencaoAcao)}; FII 20% do ganho na venda da cota (o rendimento mensal de FII é isento para pessoa física: use a parte isenta acima); cripto 15% do ganho se a venda do mês passar de R$ {num(p.isencaoCripto)}. Conta só o ganho daqui para a frente, como se resgatasse tudo no mês.</p>
    </div>
  );
}

/* ------------------------------------------------------------ Metas */

export function AionMetas({ aion, financeiro, hoje, onSalvar }: PaginaAion & { onSalvar: (m: Record<string, unknown>) => Promise<void> }) {
  const ls = financeiro.lancamentos;
  const hojeMes = hoje.slice(0, 7);
  const pos = useMemo(() => posicoesAion(ls), [ls]);
  const cart = useMemo(() => carteiraPorTipo(pos, null), [pos]);
  const ritmo = useMemo(() => ritmoDeAporte(ls, hojeMes), [ls, hojeMes]);
  const cdi = aion.mercado?.bcb?.cdi?.valor ?? 0;
  const metas = useMemo(() => metasNoRitmo(cart.reserva, cart.fora, ritmo.ritmo, aion.metas ? aion.metas : financeiro.orcamento?.metaReserva ? { reserva: financeiro.orcamento.metaReserva, carteira: null, meta3: { nome: '', valor: null } } : null, cdi, hojeMes), [cart, ritmo, aion.metas, financeiro.orcamento, cdi, hojeMes]);
  const [editando, setEditando] = useState(false);
  const [v, setV] = useState({ reserva: String(aion.metas?.reserva ?? ''), carteira: String(aion.metas?.carteira ?? ''), nome3: aion.metas?.meta3?.nome || '', valor3: aion.metas?.meta3?.valor != null ? String(aion.metas.meta3.valor) : '' });
  const [msg, setMsg] = useState('');
  return (
    <div className="fg">
      <Cartao id="ritmo" className="largo" titulo="Ritmo real de aporte"
        leitura={ritmo.nMeses ? <>Entrou em reserva e investimento, em média, <b>{brl(ritmo.ritmo)} por mês</b> nos últimos {ritmo.nMeses} {ritmo.nMeses === 1 ? 'mês fechado' : 'meses fechados'}.{ritmo.mesAtual > 0 ? ` Em ${curto(hojeMes)}, que ainda está andando, já entraram ${brl(ritmo.mesAtual)} (contam quando o mês fechar).` : ''}{ritmo.fraca ? <> <span aria-hidden>⚠ </span>Pouco dado: estimativa fraca, as datas abaixo mudam muito com um mês a mais.</> : ''}</> : 'Sem mês fechado no razão para medir o ritmo.'}
        mais={<>
          <p className="fg-explica">O que conta: reserva paga (Métis, "→ Guarda") e saída para aplicação (categoria investimento ou descrição com "aplicação"). Média dos meses fechados, com os meses sem aporte valendo zero. As datas supõem esse ritmo e o rendimento do CDI de hoje ({pct(cdi)} ao ano) em tudo, na ordem: reserva até o piso, depois a carteira, depois a meta 3.</p>
          <table className="fg-tabela"><thead><tr><th>mês</th><th className="num">aportado</th></tr></thead><tbody>{ritmo.meses.map((m) => <tr key={m.mes}><td>{curto(m.mes)}</td><td className="num">{num(m.valor)}</td></tr>)}</tbody></table>
        </>}>{null}</Cartao>
      {metas.map((m) => (
        <Cartao key={m.id} id={'meta-' + m.id} titulo={m.id === 'meta3' ? `Meta 3 · ${m.nome}` : m.nome}
          leitura={m.alvo === null ? <>{m.explica}</> : m.falta <= 0 ? <>Chegou: {brl(m.atual)} de {brl(m.alvo)}.</>
            : <>Faltam <b>{brl(m.falta)}</b>. {m.chegaEm ? <>No ritmo real, chega em <b>{longo(m.chegaEm)}</b>{ritmo.fraca ? ' (estimativa fraca)' : ''}.</> : ritmo.ritmo > 0 ? 'Depois de 20 anos no ritmo de hoje.' : 'Sem aporte medido: sem data.'}</>}
          mais={<p className="fg-explica">{m.explica}</p>}>
          {m.alvo !== null && (
            <ComPorque alvo={m.id === 'reserva' ? 'reserva' : 'carteira-fora'} rotulo={m.nome} className="ai-bloco-alvo">
              <div className="mt-num ai-meta-num" data-meta={m.id}>
                <b className="mt-num-val">{brl(m.atual)} <span className="muted ai-de">de {brl(m.alvo)}</span></b>
                <Medidor valor={m.atual} alvo={m.alvo} rotulo={`${m.nome}: quanto já tem`} />
              </div>
            </ComPorque>
          )}
        </Cartao>
      ))}
      <Cartao id="metas-valores" className="largo" titulo="Valores das metas"
        leitura={aion.metas ? <>Definidos por você em {aion.metas.rel ? 'aion-metas.md' : 'o arquivo de metas'}.</> : <>Valendo o padrão: reserva {brl(PISO_RESERVA)} e carteira {brl(5000)}; a meta 3 sem valor.</>}>
        {editando ? (
          <form className="ai-form" onSubmit={async (e) => {
            e.preventDefault(); setMsg('');
            try { await onSalvar({ reserva: v.reserva, carteira: v.carteira, meta3: { nome: v.nome3, valor: v.valor3 } }); setEditando(false); } catch (err) { setMsg('Não deu para salvar: ' + (err as Error).message); }
          }}>
            <label className="fin-campo"><span>Reserva (R$)</span><input inputMode="decimal" value={v.reserva} onChange={(e) => setV({ ...v, reserva: e.target.value })} placeholder="5.000,00" /></label>
            <label className="fin-campo"><span>Carteira fora da reserva (R$)</span><input inputMode="decimal" value={v.carteira} onChange={(e) => setV({ ...v, carteira: e.target.value })} placeholder="5.000,00" /></label>
            <label className="fin-campo grande"><span>Meta 3: o quê</span><input value={v.nome3} onChange={(e) => setV({ ...v, nome3: e.target.value })} placeholder="sair de casa ou veículo" /></label>
            <label className="fin-campo"><span>Meta 3 (R$)</span><input inputMode="decimal" value={v.valor3} onChange={(e) => setV({ ...v, valor3: e.target.value })} placeholder="ainda sem valor" /></label>
            <button className="mt-botao">Salvar metas</button>
            <button type="button" className="mt-botao fraco" onClick={() => setEditando(false)}>Cancelar</button>
            {msg && <p className="fin-erro" role="alert">{msg}</p>}
          </form>
        ) : <button className="mt-botao" onClick={() => setEditando(true)}>Definir valores</button>}
      </Cartao>
    </div>
  );
}

/* ------------------------------------------------------------ Economia */

export function AionEconomia({ aion, hoje }: PaginaAion) {
  const m = aion.mercado;
  const b = m?.bcb;
  const f = m?.focus;
  const ano = hoje.slice(0, 4), prox = String(Number(ano) + 1);
  const ult = m?.copom?.decisoes?.[0];
  const p = m?.copom?.proxima;
  if (!m) return <SemMercado />;
  const IND: [string, string, (v: number | undefined) => string][] = [
    ['IPCA', 'IPCA (%)', (v) => pct(v)], ['Selic', 'Selic no fim do ano (%)', (v) => pct(v)], ['PIB Total', 'PIB (%)', (v) => pct(v)], ['Câmbio', 'Dólar no fim do ano (R$)', (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))],
  ];
  return (
    <>
      <div className="mt-numeros">
        <ComPorque alvo="selic" rotulo="Selic meta" className="ai-num-alvo"><Numero id="selic" rotulo="Selic meta" valor={pct(b?.selicMeta?.valor)} sub={<FonteData fonte={b?.selicMeta?.fonte} data={b?.selicMeta?.data} />} /></ComPorque>
        <ComPorque alvo="cdi" rotulo="CDI" className="ai-num-alvo"><Numero id="cdi" rotulo="CDI ao ano" valor={pct(b?.cdi?.valor)} sub={<FonteData fonte={b?.cdi?.fonte} data={b?.cdi?.data} />} /></ComPorque>
        <ComPorque alvo="ipca" rotulo="IPCA" className="ai-num-alvo"><Numero id="ipca" rotulo="IPCA em 12 meses" valor={pct(b?.ipca?.doze)} sub={<>{b?.ipca?.ultimo ? `${curto(b.ipca.ultimo.data.slice(0, 7))}: ${pct(b.ipca.ultimo.valor)} no mês · ` : ''}<FonteData fonte={b?.ipca?.fonte} /></>} /></ComPorque>
        <ComPorque alvo="dolar" rotulo="Dólar" className="ai-num-alvo"><Numero id="dolar" rotulo="Dólar" valor={b?.dolar?.valor != null ? brl(b.dolar.valor) : '—'} sub={<FonteData fonte={b?.dolar?.fonte} data={b?.dolar?.data} />} /></ComPorque>
      </div>
      <div className="fg">
        <Cartao id="copom" titulo="Copom"
          leitura={ult ? <>Última decisão ({ult.numero}ª reunião, {br(ult.data)}): <b>{ult.titulo}</b>. {p?.numero ? <>Próxima: {p.numero}ª{p.dias ? <>, <b>{p.dias}</b></> : ' (data não cadastrada)'}{p.decisao === hoje ? ': a decisão sai hoje, no fim do dia (entra na próxima coleta)' : p.decisao && p.decisao < hoje ? ': a decisão já saiu, rode a coleta' : ''}.</> : ''}</> : 'Sem comunicado do Copom no cache.'}
          mais={<>
            {ult?.trecho && <p className="fg-explica">Nas palavras do Copom: “{ult.trecho}”</p>}
            {p?.fonteData && <p className="fg-explica">Data da próxima: {p.fonteData}. O BC não tem API do calendário; confira em <a href="https://www.bcb.gov.br/publicacoes/calendarioreunioescopom" target="_blank" rel="noreferrer noopener">bcb.gov.br</a>.</p>}
            {f?.selicPorReuniao?.length ? <table className="fg-tabela"><thead><tr><th>reunião</th><th className="num">Selic esperada (Focus)</th></tr></thead><tbody>{f.selicPorReuniao.map((r) => <tr key={r.reuniao}><td>{r.reuniao}</td><td className="num">{pct(r.mediana)}</td></tr>)}</tbody></table> : null}
            <p className="ai-fonte">{m.copom?.fonte}</p>
          </>}>
          <ComPorque alvo="copom" rotulo="Copom" className="ai-bloco-alvo"><span className="ai-dica-txt">Por que o Copom decidiu assim →</span></ComPorque>
        </Cartao>
        <Cartao id="focus" titulo={f?.data ? `Focus de ${br(f.data)}` : 'Focus'}
          leitura={f?.data ? <>Mediana do mercado: IPCA <b>{pct(f.medianas.IPCA?.[ano])}</b> em {ano} e {pct(f.medianas.IPCA?.[prox])} em {prox}; Selic <b>{pct(f.medianas.Selic?.[ano])}</b> no fim de {ano}. É estimativa de quem responde ao BC, não previsão do Aion.</> : 'Sem Focus no cache.'}
          mais={<p className="ai-fonte">{f?.fonte} · base: todos os respondentes</p>}>
          {f?.data && (
            <ComPorque alvo="focus" rotulo="Focus" className="ai-bloco-alvo">
              <table className="fg-tabela ai-focus"><thead><tr><th>indicador</th><th className="num">{ano}</th><th className="num">{prox}</th></tr></thead>
                <tbody>{IND.map(([k, r, fmt]) => <tr key={k}><td>{r}</td><td className="num">{fmt(f.medianas[k]?.[ano])}</td><td className="num">{fmt(f.medianas[k]?.[prox])}</td></tr>)}</tbody></table>
            </ComPorque>
          )}
        </Cartao>
      </div>
    </>
  );
}

export function SemMercado() {
  return (
    <div className="fg">
      <Cartao id="sem-mercado" className="largo" titulo="Sem dado de mercado ainda"
        leitura={<>O coletor ainda não rodou nesta máquina. Rode <code className="ai-cmd">npm run aion:gravar</code> na pasta do app (grava só um cache local, fora do git e do vault).</>}>
        <ComoPegarToken />
      </Cartao>
    </div>
  );
}

/* ------------------------------------------------------------ Estudo */

const PROGRESSO = [['a-fazer', 'a fazer'], ['estudando', 'estudando'], ['revisar', 'revisar'], ['dominado', 'dominado']] as const;

export function AionEstudo({ aion, blocoFoco, onProgresso, onNota }: PaginaAion & { blocoFoco: number | null; onProgresso: (n: number, p: string) => Promise<void>; onNota: () => void }) {
  const blocos = aion.trilha.blocos;
  const prog = aion.estudo?.blocos || {};
  const dominados = blocos.filter((b) => prog[String(b.n)] === 'dominado').length;
  const andando = blocos.filter((b) => ['estudando', 'revisar'].includes(prog[String(b.n)])).length;
  const [msg, setMsg] = useState('');
  if (!blocos.length) return <p className="muted">A nota da trilha (trilha-investimentos-e-economia) não foi encontrada no vault.</p>;
  return (
    <div className="fg">
      <Cartao id="trilha" className="largo" titulo="Trilha · investimentos e economia, do zero"
        leitura={<>{dominados} de {blocos.length} blocos dominados{andando ? `, ${andando} em andamento` : ''}. De cima para baixo: conceito antes da conta. O bloco 11 vira a Minha regra.</>}
        mais={<p className="fg-explica">O progresso fica em 04-NEGOCIO/financeiro/aion-estudo.md, no vocabulário do vault (a fazer, estudando, revisar, dominado). Livros e quem acompanhar estão na nota. <button className="linkbtn" onClick={onNota}>Abrir a nota da trilha</button></p>}>
        <ol className="ai-blocos">
          {blocos.map((b) => {
            const atual = prog[String(b.n)] || 'a-fazer';
            return (
              <li key={b.n} id={`bloco-${b.n}`} className={'ai-bloco' + (blocoFoco === b.n ? ' foco' : '')} data-bloco={b.n} data-progresso={atual}>
                <span className="ai-bloco-n">{b.n}</span>
                <div className="ai-bloco-corpo">
                  <b>{b.titulo}</b>
                  <span className="ai-bloco-aprender">{b.aprender}</span>
                  <details className="ai-bloco-mat"><summary>Material</summary><p>{b.material}</p></details>
                </div>
                <select aria-label={`Progresso do bloco ${b.n}`} value={atual} onChange={async (e) => { setMsg(''); try { await onProgresso(b.n, e.target.value); } catch (err) { setMsg('Não deu para salvar: ' + (err as Error).message); } }}>
                  {PROGRESSO.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                </select>
              </li>
            );
          })}
        </ol>
        {msg && <p className="fin-erro" role="alert">{msg}</p>}
      </Cartao>
    </div>
  );
}

/* ------------------------------------------------------------ Minha regra */

const TIPOS_REGRA: Exclude<TipoCarteira, 'reserva'>[] = ['renda-fixa', 'fii', 'acao', 'cripto'];

export function AionRegra({ aion, onSalvar, onEstudar }: PaginaAion & { onSalvar: (r: Record<string, unknown>) => Promise<void>; onEstudar: (n: number) => void }) {
  const r = aion.regra;
  const [editando, setEditando] = useState(false);
  if (editando) return <EditorRegra regra={r} onSalvar={async (x) => { await onSalvar(x); setEditando(false); }} onCancelar={() => setEditando(false)} />;
  if (!r) return (
    <div className="fg">
      <Cartao id="sem-regra" className="largo" titulo="Ainda sem regra escrita"
        leitura={<>A regra é a sua política de investimento: quanto em cada tipo, quando aportar, quando mexer e o que não fazer, escrita antes do fato. Ela vem no fim da trilha (bloco 11), depois de estudar o resto. Com ela escrita, a Carteira mostra o desvio; quem decide é você.</>}>
        <div className="ai-linha-botoes">
          <button className="mt-botao" onClick={() => setEditando(true)}>Começar do modelo vazio</button>
          <button className="mt-botao fraco" onClick={() => onEstudar(11)}>Ver o bloco 11</button>
        </div>
      </Cartao>
    </div>
  );
  return (
    <div className="fg">
      <Cartao id="regra" className="largo" titulo="Minha regra"
        leitura={<>Escrita em {br(r.escritaEm)}{r.revisarEm ? `, revisar em ${curto(r.revisarEm)}` : ''}. Reserva mínima: <b>{brl(r.reservaMinima || PISO_RESERVA)}</b>.</>}>
        <table className="fg-tabela ai-regra-tab">
          <thead><tr><th>tipo (fora da reserva)</th><th className="num">alvo</th><th className="num">faixa</th></tr></thead>
          <tbody>{TIPOS_REGRA.filter((t) => r.alocacao[t]).map((t) => <tr key={t}><td>{ROTULO_TIPO[t]}</td><td className="num">{pct(r.alocacao[t]!.alvo, 0)}</td><td className="num">{pct(Math.max(0, r.alocacao[t]!.alvo - r.alocacao[t]!.tolerancia), 0)} a {pct(Math.min(100, r.alocacao[t]!.alvo + r.alocacao[t]!.tolerancia), 0)}</td></tr>)}</tbody>
        </table>
        {r.aportes.length > 0 && <><h4 className="ai-sub">Quando aportar</h4><ul className="ai-regras">{r.aportes.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
        {r.naoFazer.length > 0 && <><h4 className="ai-sub">O que não fazer</h4><ul className="ai-regras">{r.naoFazer.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
        <button className="mt-botao" onClick={() => setEditando(true)}>Mudar a regra</button>
      </Cartao>
    </div>
  );
}

function EditorRegra({ regra, onSalvar, onCancelar }: { regra: RegraAion | null; onSalvar: (r: Record<string, unknown>) => Promise<void>; onCancelar: () => void }) {
  const [res, setRes] = useState(regra?.reservaMinima ? String(regra.reservaMinima) : '');
  const [aloc, setAloc] = useState<Record<string, { alvo: string; tolerancia: string }>>(() => Object.fromEntries(TIPOS_REGRA.map((t) => [t, { alvo: regra?.alocacao[t] ? String(regra.alocacao[t]!.alvo) : '', tolerancia: regra?.alocacao[t] ? String(regra.alocacao[t]!.tolerancia) : '' }])));
  const [aportes, setAportes] = useState((regra?.aportes || []).join('\n'));
  const [nao, setNao] = useState((regra?.naoFazer || []).join('\n'));
  const [rev, setRev] = useState(regra?.revisarEm || '');
  const [msg, setMsg] = useState('');
  const soma = Object.values(aloc).reduce((s, a) => s + (valorBR(a.alvo) || 0), 0);
  return (
    <div className="fg">
      <Cartao id="editor-regra" className="largo" titulo="Escrever a regra"
        leitura={<>Os campos nascem vazios: o valor é decisão sua. A alocação é em % da carteira <b>fora</b> da reserva e precisa somar 100%. Soma agora: <b>{pct(soma, 0)}</b>.</>}>
        <form className="ai-form ai-editor-regra" onSubmit={async (e) => {
          e.preventDefault(); setMsg('');
          // a mesma conta do servidor (scripts/aion/escrita.mjs), antes de mandar
          if (soma > 0 && Math.abs(soma - 100) > 0.5) return setMsg(`Os alvos somam ${soma.toLocaleString('pt-BR')}%: precisam somar 100% da carteira fora da reserva.`);
          try {
            await onSalvar({ reservaMinima: res, alocacao: Object.fromEntries(Object.entries(aloc).filter(([, a]) => a.alvo !== '').map(([k, a]) => [k, { alvo: a.alvo.replace(',', '.'), tolerancia: a.tolerancia.replace(',', '.') }])), aportes: aportes.split('\n'), naoFazer: nao.split('\n'), revisarEm: rev });
          } catch (err) { setMsg('Não deu para salvar: ' + (err as Error).message); }
        }}>
          <label className="fin-campo"><span>Reserva mínima (R$)</span><input inputMode="decimal" value={res} onChange={(e) => setRes(e.target.value)} placeholder="5.000,00" /></label>
          {TIPOS_REGRA.map((t) => (
            <fieldset key={t} className="ai-aloc">
              <legend>{ROTULO_TIPO[t]}</legend>
              <label className="fin-campo"><span>Alvo (%)</span><input inputMode="decimal" value={aloc[t].alvo} onChange={(e) => setAloc({ ...aloc, [t]: { ...aloc[t], alvo: e.target.value } })} placeholder="—" /></label>
              <label className="fin-campo"><span>Tolerância (± pontos)</span><input inputMode="decimal" value={aloc[t].tolerancia} onChange={(e) => setAloc({ ...aloc, [t]: { ...aloc[t], tolerancia: e.target.value } })} placeholder="5" /></label>
            </fieldset>
          ))}
          <label className="fin-campo grande"><span>Quando aportar (uma regra por linha)</span><textarea rows={3} value={aportes} onChange={(e) => setAportes(e.target.value)} placeholder="ex.: todo mês, depois que a renda entra" /></label>
          <label className="fin-campo grande"><span>O que não fazer (uma por linha)</span><textarea rows={3} value={nao} onChange={(e) => setNao(e.target.value)} placeholder="ex.: não mexer na reserva para comprar ação" /></label>
          <label className="fin-campo"><span>Revisar em</span><input type="month" value={rev} onChange={(e) => setRev(e.target.value)} /></label>
          <div className="ai-linha-botoes"><button className="mt-botao">Salvar a regra</button><button type="button" className="mt-botao fraco" onClick={onCancelar}>Cancelar</button></div>
          {msg && <p className="fin-erro" role="alert">{msg}</p>}
        </form>
      </Cartao>
    </div>
  );
}

export const TELAS_AION = [
  { tela: 'carteira', rotulo: 'Carteira', titulo: 'O que você tem e por quê' },
  { tela: 'porques', rotulo: 'Porquês', titulo: 'O que mexeu, com fonte' },
  { tela: 'observacao', rotulo: 'Observação', titulo: 'O que você acompanha' },
  { tela: 'simular', rotulo: 'Simular', titulo: 'E se, em 1, 3 e 5 anos' },
  { tela: 'metas', rotulo: 'Metas', titulo: 'Quando chega cada meta' },
  { tela: 'economia', rotulo: 'Economia', titulo: 'Juros, inflação e câmbio' },
  { tela: 'estudo', rotulo: 'Estudo', titulo: 'A trilha, bloco a bloco' },
  { tela: 'regra', rotulo: 'Minha regra', titulo: 'Sua política de investimento' },
] as const;
export type TelaAion = (typeof TELAS_AION)[number]['tela'];
export { BLOCO_DO_TIPO, TIPOS, ROTULO_PORQUE };
