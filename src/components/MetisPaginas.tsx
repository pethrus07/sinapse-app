// As páginas da Métis (o módulo financeiro do Sinapse; por dentro segue "financeiro").
// Cada página: poucas coisas à vista, o resto em "Mais opções" (regra do Pedro: pouca informação,
// muito respiro; borda só quando comunica estado). Lógica em src/lib/financeiroModelo.ts e
// financeiroAnalise.ts; gráficos em MetisGraficos.tsx e FinanceiroGraficos.tsx.
//  · Visão: o mês num relance (4 números, natureza × mês anterior, 1 aviso).
//  · Gastos: por categoria (com teto), natureza por mês, o que mudou, a lista agrupada.
//  · Entradas: por cliente (recebido × o que falta) e a linha do tempo dos contratos.
//  · Patrimônio: só a reserva contra o piso e o total investido (investimentos ganham módulo próprio).
//  · Pronoia: sobra estimada, receita por cliente, reserva projetada, cartão, projeção.
//  · Plano: orçamento (teto × gasto) e a meta da reserva.
import { useMemo, useState } from 'react';
import type { Financeiro, Lancamento } from '../types';
import { brl, contarSaidas, foraDaProjecao, projetar, rotuloCategoria } from '../lib/financeiro';
import { aReceberVencido, avisosConexao, cartaoFuturo, receitaPorCliente, reservaAcumulada, somarMes } from '../lib/financeiroGraficos';
import {
  avisosFinanceiro, clientesRealizado, gastoQueSeRepete, gastosPorCategoria, mediana, mesesCompletos, NATUREZAS, patrimonio,
  rendaRecorrente, ROTULO_NATUREZA, type EstimativaGasto,
} from '../lib/financeiroAnalise';
import {
  categoriasDoMes, categoriasParaTeto, comparacaoCategorias, contratosDeRenda, entradasPorCliente, gastosAgrupados, mesesDoSeletor,
  naturezaPorMes, orcamentoDoMes, ordenarAvisos, PISO_RESERVA, planoReserva, visaoDoMes,
} from '../lib/financeiroModelo';
import { Cartao5, Cartao, curto, Legenda, longo, num, Receita, Reserva } from './FinanceiroGraficos';
import { BarrasH, COR_NAT, Diferencas, EditorTetos, LinhaDoTempo, ListaAgrupada, Medidor, NaturezaComparada, NaturezaNoTempo, Numero, SobraNoTempo, type LinhaBarra } from './MetisGraficos';

const br = (d: string) => d.slice(0, 10).split('-').reverse().join('/');
const MAX_LINHAS = 8;
/** "sobram R$ X" ou, no negativo, "⚠ faltam R$ X" (o sinal vira palavra). */
const sobraTxt = (v: number) => (v < 0 ? <><span aria-hidden>⚠ </span>faltam <b>{brl(-v)}</b></> : <>sobram <b>{brl(v)}</b></>);
const sinal = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + brl(Math.abs(v));

export interface PaginaProps {
  financeiro: Financeiro;
  hoje: string;
  foco: string;
}

/* ------------------------------------------------------------ seletor de mês (topo) */

export function SeletorMes({ financeiro, hoje, foco, onFoco }: PaginaProps & { onFoco: (m: string) => void }) {
  const hojeMes = hoje.slice(0, 7);
  const { meses, parciais } = useMemo(() => mesesDoSeletor(financeiro.lancamentos, hojeMes), [financeiro.lancamentos, hojeMes]);
  const i = meses.indexOf(foco);
  const tag = foco === hojeMes ? 'em andamento' : parciais.includes(foco) ? 'incompleto: o banco começou no meio' : '';
  return (
    <div className="mt-seletor" role="group" aria-label="Mês">
      <button className="mt-seta" aria-label="Mês anterior" disabled={i <= 0} onClick={() => onFoco(meses[i - 1])}>‹</button>
      <span className="mt-seletor-mes" aria-live="polite">{longo(foco)}</span>
      <button className="mt-seta" aria-label="Próximo mês" disabled={i < 0 || i >= meses.length - 1} onClick={() => onFoco(meses[i + 1])}>›</button>
      {tag && <span className="mt-seletor-tag">{tag}</span>}
    </div>
  );
}

/* ------------------------------------------------------------ avisos: 1 à vista */

function Avisos({ financeiro, hoje, onClassificar }: { financeiro: Financeiro; hoje: string; onClassificar: () => void }) {
  const lista = useMemo(() => {
    const conexao = avisosConexao(financeiro.conexoes || [], hoje).map((a) => ({
      chave: 'conexao-' + a.motivo,
      corpo: a.motivo === 'renovar' ? <>A autorização do Open Finance ({a.rotulo}) vence em <b>{br(a.data)}</b>. Renove em meu.pluggy.ai antes disso.</>
        : a.motivo === 'vencida' ? <>A autorização do Open Finance ({a.rotulo}) venceu em <b>{br(a.data)}</b>. A sincronização parou até renovar em meu.pluggy.ai.</>
        : <>A conexão do Open Finance ({a.rotulo}) está com erro. Abra meu.pluggy.ai e confira.</>,
    }));
    const outros = avisosFinanceiro(financeiro.lancamentos, hoje, { ultimaSync: financeiro.ultimaSync, ultimaFalha: financeiro.ultimaFalha }).map((a) => ({
      chave: a.tipo,
      corpo: a.tipo === 'fatura' ? <>A fatura do cartão de <b>{brl(a.valor)}</b>{a.medido ? ' (valor do banco)' : ' (estimada)'} vence {a.dias === 0 ? <b>hoje</b> : <>em <b>{a.dias} {a.dias === 1 ? 'dia' : 'dias'}</b> ({br(a.vencimento)})</>}.</>
        : a.tipo === 'sync-falhou' ? <>A sincronização com o banco falhou em {br(a.em)}{a.mensagem ? <>: {a.mensagem}</> : ''}. O razão está como na última vez que deu certo.</>
        : a.tipo === 'sync-parada' ? <>A sincronização com o banco não roda desde <b>{br(a.desde)}</b> ({a.dias} dias).</>
        : <><b>{a.qtd}</b> {a.qtd === 1 ? 'lançamento' : 'lançamentos'} do banco sem categoria ({brl(a.valor)}). <button className="linkbtn" onClick={onClassificar}>Classificar</button></>,
    }));
    return ordenarAvisos([...outros, ...conexao]);
  }, [financeiro, hoje, onClassificar]);
  if (!lista.length) return null;
  const [primeiro, ...resto] = lista;
  const p = (a: (typeof lista)[number]) => <p key={a.chave} className="fg-aviso" role="alert" data-aviso={a.chave}><span aria-hidden>⚠ </span>{a.corpo}</p>;
  return (
    <div className="mt-avisos">
      {p(primeiro)}
      {resto.length > 0 && (
        <details className="fg-mais mt-mais-avisos">
          <summary>Mais {resto.length} {resto.length === 1 ? 'aviso' : 'avisos'}</summary>
          <div className="mt-avisos">{resto.map(p)}</div>
        </details>
      )}
    </div>
  );
}

function textoEstimativa(e: EstimativaGasto) {
  const n = e.meses.length;
  if (e.base === 'nenhum') return 'sem mês completo com o banco ligado ainda: não dá para estimar';
  if (e.base === 'teto') return `variável pelo teto do orçamento (só ${n} ${n === 1 ? 'mês completo' : 'meses completos'}, pouco para mediana)`;
  return `variável pela mediana de ${n} ${n === 1 ? 'mês completo' : 'meses completos'}${e.fraca ? ': estimativa fraca, defina tetos no Plano para uma referência sua' : ''}`;
}

/* ------------------------------------------------------------ Visão */

export function MetisVisao({ financeiro, hoje, foco, onClassificar }: PaginaProps & { onClassificar: () => void }) {
  const ls = financeiro.lancamentos;
  const hojeMes = hoje.slice(0, 7);
  const ant = somarMes(foco, -1);
  const v = useMemo(() => visaoDoMes(ls, foco), [ls, foco]);
  const va = useMemo(() => visaoDoMes(ls, ant), [ls, ant]);
  const pat = useMemo(() => patrimonio(ls, (financeiro.retratos || []) as never, hoje), [ls, financeiro.retratos, hoje]);
  const est = useMemo(() => gastoQueSeRepete(ls, hojeMes, financeiro.orcamento?.tetos), [ls, hojeMes, financeiro.orcamento]);
  if (!ls.length) return <p className="muted">Nada no razão ainda.</p>;
  const meta = financeiro.orcamento?.metaReserva || PISO_RESERVA;
  const nat = v.natureza;
  return (
    <>
      <Avisos financeiro={financeiro} hoje={hoje} onClassificar={onClassificar} />
      <div className="mt-numeros">
        <Numero id="entrou" rotulo="Entrou" valor={brl(v.entrou)} sub={`${curto(ant)}: ${brl(va.entrou)}`} />
        <Numero id="saiu" rotulo="Saiu" valor={brl(v.saiu)} sub={`${curto(ant)}: ${brl(va.saiu)}`} />
        <Numero id="sobrou" rotulo="Sobrou" valor={brl(v.sobrou)} alerta={v.sobrou < 0} sub={v.guardado > 0 ? `${brl(v.guardado)} foram para a reserva` : 'entrou menos o que saiu'} />
        <div className="mt-num" data-numero="reserva">
          <span className="mt-num-rot">Reserva</span>
          <b className="mt-num-val">{pat.reservaLiquida < meta && <span className="mt-icone" aria-hidden>⚠ </span>}{brl(pat.reservaLiquida)}</b>
          <Medidor valor={pat.reservaLiquida} alvo={meta} rotulo={`Reserva em relação ${meta === PISO_RESERVA ? 'ao piso' : 'à meta'}`} />
          <span className="mt-num-sub">{pat.reservaLiquida < meta ? `abaixo do piso de ${brl(meta)}` : `acima do piso de ${brl(meta)}`} · investido {brl(pat.total)}</span>
        </div>
      </div>
      <div className="fg">
        <Cartao id="natureza" className="largo" titulo="Fixo, variável e pontual"
          leitura={nat.total ? <>Em {curto(foco)} o fixo foi <b>{brl(nat.fixo)}</b>; o variável, <b>{brl(nat.variavel)}</b>{nat.pontual ? <>; o pontual, {brl(nat.pontual)}</> : ''}.</> : `Nenhum gasto registrado em ${curto(foco)}.`}
          mais={<>
            <p className="fg-explica"><b>Fixo</b> vem todo mês (moradia, energia, impostos, assinatura, parcela). <b>Variável</b> muda com o mês (comida, mercado, transporte, Pix a pessoa física, compras). <b>Pontual</b> não se repete (empréstimo, compra grande). A natureza vem da categoria; um gasto pode ser trocado em Gastos, na lista do mês.</p>
            <p className="fg-explica" data-estimativa={est.base}><b>Gasto que se repete</b>: {brl(est.total)} por mês (fixo {brl(est.fixo)} + variável {brl(est.variavel)}; {textoEstimativa(est)}).</p>
            <table className="fg-tabela">
              <thead><tr><th>natureza</th><th className="num">{curto(foco)}</th><th className="num">{curto(ant)}</th></tr></thead>
              <tbody>{NATUREZAS.map((k) => <tr key={k}><td>{ROTULO_NATUREZA[k]}</td><td className="num">{num(nat[k])}</td><td className="num">{num(va.natureza[k])}</td></tr>)}
                <tr className="forte"><td>total</td><td className="num">{num(nat.total)}</td><td className="num">{num(va.natureza.total)}</td></tr></tbody>
            </table>
          </>}>
          <NaturezaComparada atual={nat} anterior={va.natureza} mes={foco} mesAnt={ant} />
        </Cartao>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ Gastos */

export function MetisGastos({ financeiro, hoje, foco, onNatureza, onPlano }: PaginaProps & { onNatureza: (l: Lancamento, v: string) => void; onPlano: () => void }) {
  const ls = financeiro.lancamentos;
  const hojeMes = hoje.slice(0, 7);
  const tetos = financeiro.orcamento?.tetos;
  const ant = somarMes(foco, -1);
  const cats = useMemo(() => categoriasDoMes(ls, foco, tetos), [ls, foco, tetos]);
  const medias = useMemo(() => new Map(gastosPorCategoria(ls, hojeMes, foco).linhas.map((l) => [l.categoria, l.media])), [ls, hojeMes, foco]);
  const tempo = useMemo(() => naturezaPorMes(ls, hojeMes), [ls, hojeMes]);
  const dif = useMemo(() => comparacaoCategorias(ls, foco), [ls, foco]);
  const grupos = useMemo(() => gastosAgrupados(ls, foco), [ls, foco]);
  const completos = useMemo(() => mesesCompletos(ls, hojeMes), [ls, hojeMes]);
  const [todas, setTodas] = useState(false);
  const comGasto = cats.filter((c) => c.total > 0);
  const total = comGasto.reduce((s, c) => s + c.total, 0);
  const visiveis = todas ? comGasto : comGasto.slice(0, MAX_LINHAS);
  const max = Math.max(1, ...visiveis.map((c) => Math.max(c.total, c.teto || 0)));
  const acima = comGasto.filter((c) => c.acima > 0);
  const linhas: LinhaBarra[] = visiveis.map((c) => {
    const media = medias.get(c.categoria);
    return {
      chave: c.categoria, rotulo: rotuloCategoria(c.categoria), valor: brl(c.total),
      extra: c.acima > 0 ? <span className="mt-estado"><span aria-hidden>⚠ </span>{brl(c.acima)} acima do teto</span> : undefined,
      segmentos: NATUREZAS.map((k) => ({ valor: c.porNatureza[k], cor: COR_NAT[k] })),
      marcador: c.teto ?? undefined,
      dica: { titulo: rotuloCategoria(c.categoria), linhas: [
        ...NATUREZAS.filter((k) => c.porNatureza[k] > 0).map((k) => ({ cor: COR_NAT[k], rotulo: ROTULO_NATUREZA[k].toLowerCase(), valor: brl(c.porNatureza[k]) })),
        { rotulo: curto(ant), valor: brl(c.anterior) },
        ...(media != null ? [{ rotulo: 'média de 3 meses', valor: brl(media) }] : []),
        { rotulo: 'teto', valor: c.teto === null ? 'sem teto' : brl(c.teto) },
      ] },
    };
  });
  const naturezasUsadas = NATUREZAS.filter((k) => comGasto.some((c) => c.porNatureza[k] > 0));
  const fixos = completos.map((m) => tempo.linhas[tempo.meses.indexOf(m)]?.fixo ?? 0);
  const subiu = dif.filter((d) => d.delta > 0)[0];
  const totalAnt = cats.reduce((s, c) => s + c.anterior, 0) + dif.filter((d) => !cats.some((c) => c.categoria === d.categoria)).reduce((s, d) => s + d.anterior, 0);
  const antParcial = tempo.parciais.includes(ant);
  if (!ls.length) return <p className="muted">Nada no razão ainda.</p>;
  return (
    <div className="fg">
      <Cartao id="categorias" className="largo" titulo="Por categoria"
        leitura={comGasto.length ? <>Em {curto(foco)} saíram <b>{brl(total)}</b>. A maior foi <b>{rotuloCategoria(comGasto[0].categoria)}</b> ({brl(comGasto[0].total)}).{tetos ? (acima.length ? <> <span aria-hidden>⚠ </span>{acima.length} acima do teto.</> : ' Tudo dentro do teto.') : ''}</> : `Nenhum gasto registrado em ${curto(foco)}.`}
        mais={<>
          <p className="fg-explica">Gasto = saída paga, no mês em que o dinheiro saiu, mais a compra no cartão no mês da compra (a fatura paga não entra, senão contaria duas vezes). A cor diz a natureza; o traço vertical é o teto do orçamento.</p>
          <table className="fg-tabela">
            <thead><tr><th>categoria</th><th className="num">{curto(foco)}</th><th className="num">{curto(ant)}</th><th className="num">teto</th></tr></thead>
            <tbody>{cats.map((c) => <tr key={c.categoria}><td>{rotuloCategoria(c.categoria)}</td><td className="num">{num(c.total)}</td><td className="num">{num(c.anterior)}</td><td className="num">{c.teto === null ? 'sem teto' : num(c.teto)}</td></tr>)}</tbody>
          </table>
        </>}>
        {comGasto.length > 0 && <>
          <Legenda itens={[...naturezasUsadas.map((k) => ({ cor: COR_NAT[k], rotulo: ROTULO_NATUREZA[k] })), ...(tetos ? [{ cor: 'var(--ink)', rotulo: 'teto', linha: true }] : [])]} />
          <BarrasH linhas={linhas} max={max} rotulo={`Gastos por categoria em ${curto(foco)}`} />
          {comGasto.length > MAX_LINHAS && <button className="linkbtn mt-ver" onClick={() => setTodas(!todas)}>{todas ? 'Ver só as maiores' : `Ver as ${comGasto.length} categorias`}</button>}
          {!tetos && <p className="fg-explica mt-semteto">Sem teto definido. <button className="linkbtn" onClick={onPlano}>Definir tetos</button></p>}
        </>}
      </Cartao>

      <Cartao id="natureza-tempo" titulo="Fixo, variável e pontual por mês"
        leitura={completos.length >= 2
          ? <>O fixo fica perto de <b>{brl(mediana(fixos))}</b> por mês; o que muda de um mês para o outro é o variável.</>
          : <>Só {completos.length} {completos.length === 1 ? 'mês completo' : 'meses completos'} com o banco ligado: ainda não dá para dizer o que é normal.</>}
        mais={<>
          <p className="fg-explica">Mês com ponto (·) é incompleto: o banco começou no meio ou o mês ainda está andando.</p>
          <table className="fg-tabela">
            <thead><tr><th>mês</th>{NATUREZAS.map((k) => <th key={k} className="num">{ROTULO_NATUREZA[k].toLowerCase()}</th>)}<th className="num">total</th></tr></thead>
            <tbody>{tempo.meses.map((m, i) => <tr key={m} className={m === foco ? 'hoje' : ''}><td>{curto(m)}{tempo.parciais.includes(m) ? '·' : ''}</td>{NATUREZAS.map((k) => <td key={k} className="num">{num(tempo.linhas[i][k])}</td>)}<td className="num">{num(tempo.linhas[i].total)}</td></tr>)}</tbody>
          </table>
        </>}>
        <NaturezaNoTempo r={tempo} foco={foco} />
      </Cartao>

      <Cartao id="diferenca" titulo={`Comparado com ${curto(ant)}`}
        leitura={dif.length ? <>Saiu <b>{brl(Math.abs(total - totalAnt))}</b> a {total >= totalAnt ? 'mais' : 'menos'} que em {curto(ant)}{subiu ? <>; o que mais subiu foi <b>{rotuloCategoria(subiu.categoria)}</b> ({sinal(subiu.delta)})</> : ''}.{antParcial ? ` ${curto(ant)} está incompleto: a diferença exagera.` : ''}</> : 'Nada mudou de um mês para o outro.'}
        mais={dif.length > 6 ? (
          <table className="fg-tabela">
            <thead><tr><th>categoria</th><th className="num">{curto(foco)}</th><th className="num">{curto(ant)}</th><th className="num">diferença</th></tr></thead>
            <tbody>{dif.map((d) => <tr key={d.categoria}><td>{rotuloCategoria(d.categoria)}</td><td className="num">{num(d.atual)}</td><td className="num">{num(d.anterior)}</td><td className="num">{d.delta > 0 ? '+' : ''}{num(d.delta)}</td></tr>)}</tbody>
          </table>
        ) : undefined}>
        {dif.length > 0 && <Diferencas itens={dif.slice(0, 6)} />}
      </Cartao>

      <Cartao id="lista" className="largo" titulo={`Gastos de ${curto(foco)}`}
        leitura={grupos.length ? <>Agrupados por natureza e categoria. Um gasto que não é da natureza da categoria troca pela lista: vale só para ele.</> : 'Nada neste mês.'}>
        <ListaAgrupada grupos={grupos} onNatureza={onNatureza} />
      </Cartao>
    </div>
  );
}

/* ------------------------------------------------------------ Entradas */

export function MetisEntradas({ financeiro, hoje, foco }: PaginaProps) {
  const ls = financeiro.lancamentos;
  const hojeMes = hoje.slice(0, 7);
  const ent = useMemo(() => entradasPorCliente(ls, foco), [ls, foco]);
  const contratos = useMemo(() => contratosDeRenda(ls, hojeMes), [ls, hojeMes]);
  const renda = useMemo(() => rendaRecorrente(ls, hojeMes, financeiro.orcamento?.tetos), [ls, hojeMes, financeiro.orcamento]);
  const vencido = useMemo(() => aReceberVencido(ls, hoje), [ls, hoje]);
  const cli = useMemo(() => clientesRealizado(ls, hoje), [ls, hoje]);
  if (!ls.length) return <p className="muted">Nada no razão ainda.</p>;
  const previsto = ent.reduce((s, c) => s + c.previsto, 0);
  const recebido = ent.reduce((s, c) => s + c.recebido, 0);
  const totalVencido = vencido.reduce((s, c) => s + c.total, 0);
  const max = Math.max(1, ...ent.map((c) => c.previsto));
  const acabam = contratos.filter((c) => !c.semFim && renda.caiEm && c.fim < renda.caiEm && c.fim >= somarMes(renda.caiEm, -1));
  return (
    <div className="fg">
      <Cartao id="por-cliente" className="largo" titulo={`Por cliente em ${curto(foco)}`}
        leitura={ent.length ? <>Previsto <b>{brl(previsto)}</b>; entrou <b>{brl(recebido)}</b>{previsto - recebido > 0 ? <>, falta {brl(previsto - recebido)}</> : ''}.{totalVencido > 0 && <> <span aria-hidden>⚠ </span><b>{brl(totalVencido)}</b> vencido e ainda aberto.</>}</> : `Nenhuma entrada prevista para ${curto(foco)}.`}
        mais={<>
          <p className="fg-explica">Previsto = entradas com vencimento no mês (as sem prazo ficam fora). Atraso = dias entre o vencimento e o dia em que o dinheiro entrou.</p>
          <table className="fg-tabela">
            <thead><tr><th>cliente</th><th className="num">previsto</th><th className="num">entrou</th><th className="num">falta</th></tr></thead>
            <tbody>{ent.map((c) => <tr key={c.cliente}><td>{c.cliente}</td><td className="num">{num(c.previsto)}</td><td className="num">{num(c.recebido)}</td><td className="num">{num(c.falta)}</td></tr>)}</tbody>
          </table>
          {vencido.length > 0 && (
            <table className="fg-tabela">
              <thead><tr><th>vencido · origem</th><th>o quê</th><th>venceu</th><th className="num">dias</th><th className="num">R$</th></tr></thead>
              <tbody>{vencido.flatMap((c) => c.itens.map((i, k) => <tr key={c.cliente + k}><td>{k === 0 ? c.cliente : ''}</td><td className="mt-quebra">{i.descricao}</td><td>{br(i.vencimento)}</td><td className="num">{i.dias}</td><td className="num">{num(i.valor)}</td></tr>))}</tbody>
            </table>
          )}
          <table className="fg-tabela">
            <thead><tr><th>cliente</th><th className="num">recebido até hoje</th><th className="num">atraso médio</th><th className="num">falta até o fim</th></tr></thead>
            <tbody>{cli.map((c) => <tr key={c.cliente}><td>{c.cliente}</td><td className="num">{num(c.recebido)}</td><td className="num">{c.atrasoMedio ? `${c.atrasoMedio} d` : 'em dia'}</td><td className="num">{num(c.falta)}{c.semFim ? ' · sem fim' : ''}</td></tr>)}</tbody>
          </table>
        </>}>
        {ent.length > 0 && <>
          <Legenda itens={[{ cor: 'var(--s1)', rotulo: 'entrou' }, { cor: 'var(--mt-falta)', rotulo: 'falta' }]} />
          <BarrasH max={max} rotulo={`Entradas por cliente em ${curto(foco)}`} linhas={ent.map((c) => ({
            chave: c.cliente, rotulo: c.cliente, valor: brl(c.recebido),
            extra: <span className="muted"> de {brl(c.previsto)}</span>,
            segmentos: [{ valor: c.recebido, cor: 'var(--s1)' }, { valor: c.falta, cor: 'var(--mt-falta)' }],
            dica: { titulo: c.cliente, linhas: [{ cor: 'var(--s1)', rotulo: 'entrou', valor: brl(c.recebido) }, { cor: 'var(--mt-falta)', rotulo: 'falta', valor: brl(c.falta) }, { rotulo: 'previsto', valor: brl(c.previsto) }] },
          }))} />
        </>}
      </Cartao>

      <Cartao id="contratos" className="largo" titulo="Renda que se repete: até quando"
        leitura={!contratos.length ? 'Nenhuma renda que se repete lançada.' : renda.caiEm
          ? <>Hoje entram <b>{brl(renda.antes)}</b> por mês que se repetem. Em <b>{curto(renda.caiEm)}</b> caem para <b>{brl(renda.depois)}</b>{acabam.length ? <> (acaba {[...new Set(acabam.map((c) => c.cliente))].join(' e ')})</> : ''}.</>
          : <>Hoje entram <b>{brl(renda.antes)}</b> por mês que se repetem, sem queda até {curto(renda.meses[renda.meses.length - 1] || hojeMes)}.</>}
        mais={<>
          <p className="fg-explica">Renda que se repete: o que está marcado para repetir todo mês (salário, mensalidade, acordo) e contrato em parcelas enquanto durar. Projeto e entrega única ficam de fora. "Segue" = sem data de fim.</p>
          <table className="fg-tabela">
            <thead><tr><th>cliente</th><th>o quê</th><th>de</th><th>até</th><th className="num">por mês</th></tr></thead>
            <tbody>{contratos.map((c) => <tr key={c.chave}><td>{c.cliente}</td><td className="mt-quebra">{c.rotulo}</td><td>{curto(c.inicio)}</td><td>{c.semFim ? 'segue' : curto(c.fim)}</td><td className="num">{num(c.valor)}</td></tr>)}</tbody>
          </table>
        </>}>
        <LinhaDoTempo contratos={contratos} hojeMes={hojeMes} />
      </Cartao>
    </div>
  );
}

/* ------------------------------------------------------------ Patrimônio (enxuto) */

export function MetisPatrimonio({ financeiro, hoje }: PaginaProps) {
  const ls = financeiro.lancamentos;
  const pat = useMemo(() => patrimonio(ls, (financeiro.retratos || []) as never, hoje), [ls, financeiro.retratos, hoje]);
  const meta = financeiro.orcamento?.metaReserva || PISO_RESERVA;
  const vazio = !pat.atuais.length;
  const falta = Math.max(0, meta - pat.reservaLiquida);
  return (
    <div className="fg">
      <Cartao id="reserva-piso" className="largo" titulo="Reserva"
        leitura={vazio ? 'Nenhuma posição ainda. A sincronização do banco preenche; o que não vem pelo Open Finance entra à mão em Lançamentos (= Saldo).'
          : <>A reserva tem <b>{brl(pat.reservaLiquida)}</b>: {falta > 0 ? <><span aria-hidden>⚠ </span>faltam <b>{brl(falta)}</b> para {meta === PISO_RESERVA ? 'o piso' : 'a meta'} de {brl(meta)}.</> : <>acima {meta === PISO_RESERVA ? 'do piso' : 'da meta'} de {brl(meta)}.</>}</>}
        mais={!vazio && <>
          <p className="fg-explica">Reserva = posição marcada como reserva ou de liquidez diária (a caixinha: sai no mesmo dia). O resto é investido e fica para o módulo de investimentos.</p>
          <table className="fg-tabela">
            <thead><tr><th>onde</th><th>o quê</th><th>data</th><th className="num">saldo</th><th>reserva</th></tr></thead>
            <tbody>{pat.atuais.map((a) => <tr key={a.chave}><td>{a.instituicao}</td><td className="mt-quebra">{a.descricao}{a.manual ? ' · à mão' : ''}</td><td>{br(a.data)}</td><td className="num">{num(a.valor)}</td><td>{a.reserva || a.liquidez === 'diaria' ? 'sim' : ''}</td></tr>)}</tbody>
          </table>
        </>}>
        {!vazio && (
          <div className="mt-reserva-bloco">
            <div className="mt-numeros mt-numeros-2">
              <div className="mt-num" data-numero="reserva">
                <span className="mt-num-rot">Reserva × {meta === PISO_RESERVA ? 'piso' : 'meta'} de {brl(meta)}</span>
                <b className="mt-num-val">{falta > 0 && <span className="mt-icone" aria-hidden>⚠ </span>}{brl(pat.reservaLiquida)}</b>
                <Medidor valor={pat.reservaLiquida} alvo={meta} rotulo="Reserva em relação ao piso" />
              </div>
              <Numero id="investido" rotulo="Investido no total" valor={brl(pat.total)} sub="inclui a reserva" />
            </div>
          </div>
        )}
      </Cartao>
      <section className="fg-card largo mt-embreve" data-grafico="investimentos">
        <h3 className="fg-titulo">Investimentos <span className="mt-tag">em breve</span></h3>
        <p className="fg-leitura muted">Carteira por tipo, evolução, estudo, projeção e simulação vão ganhar um módulo próprio.</p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ Pronoia */

export function MetisPronoia({ financeiro, hoje }: PaginaProps) {
  const ls = financeiro.lancamentos;
  const hojeMes = hoje.slice(0, 7);
  const renda = useMemo(() => rendaRecorrente(ls, hojeMes, financeiro.orcamento?.tetos), [ls, hojeMes, financeiro.orcamento]);
  const receita = useMemo(() => receitaPorCliente(ls), [ls]);
  const reserva = useMemo(() => reservaAcumulada(ls, hojeMes, financeiro.orcamento?.metaReserva || PISO_RESERVA), [ls, hojeMes, financeiro.orcamento]);
  const cartao = useMemo(() => cartaoFuturo(ls, hojeMes), [ls, hojeMes]);
  const projecao = useMemo(() => projetar(ls, hojeMes), [ls, hojeMes]);
  const contagem = useMemo(() => contarSaidas(ls), [ls]);
  const fora = useMemo(() => foraDaProjecao(ls), [ls]);
  if (!ls.length) return <p className="muted">Nada no razão ainda.</p>;
  const e = renda.estimativa;
  const iQueda = renda.caiEm ? renda.meses.indexOf(renda.caiEm) : -1;
  const ultimoProj = projecao[projecao.length - 1];
  return (
    <div className="fg">
      <Cartao id="sobra" className="largo" titulo="Daqui pra frente: o que sobra por mês"
        leitura={e.base === 'nenhum' ? 'Ainda não há mês completo com o banco ligado: sem base para estimar o gasto que se repete.'
          : <>Com o gasto que se repete em <b>{brl(e.total)}</b> por mês, {sobraTxt(renda.sobra[0] ?? 0)}{iQueda > 0 ? <> até {curto(renda.ateQuando)}; em {curto(renda.caiEm)}, {sobraTxt(renda.sobra[iQueda])}</> : ''}.</>}
        mais={<>
          <p className="fg-explica" data-estimativa={e.base}>Gasto que se repete = fixo {brl(e.fixo)} (mediana dos meses completos) + variável {brl(e.variavel)} ({textoEstimativa(e)}). O pontual não entra. Meses usados: {e.meses.map(curto).join(', ') || 'nenhum'}. Renda que se repete: ver Entradas.</p>
          <table className="fg-tabela">
            <thead><tr><th>mês</th><th className="num">renda que se repete</th><th className="num">gasto que se repete</th><th className="num">sobra</th></tr></thead>
            <tbody>{renda.meses.map((m, i) => <tr key={m} className={i === 0 ? 'hoje' : ''}><td>{curto(m)}</td><td className="num">{num(renda.entradas[i])}</td><td className="num">{num(renda.gastoBase)}</td><td className="num">{num(renda.sobra[i])}</td></tr>)}</tbody>
          </table>
        </>}>
        {e.base !== 'nenhum' && <>
          {renda.sobra.some((v) => v < 0) && <Legenda itens={[{ cor: 'var(--s1)', rotulo: 'sobra' }, { cor: 'var(--mt-neg)', rotulo: 'falta' }]} />}
          <SobraNoTempo meses={renda.meses} sobra={renda.sobra} />
        </>}
      </Cartao>
      <Receita r={receita} hojeMes={hojeMes} />
      <Reserva r={reserva} hojeMes={hojeMes} />
      <Cartao5 c={cartao} />
      <Cartao id="projecao" className="largo" titulo="Projeção mês a mês"
        leitura={ultimoProj ? <>Do que está lançado e aberto até {curto(ultimoProj.mes)}: a reserva programada chega a <b>{brl(ultimoProj.reservaAcum)}</b>.{contagem.saidas <= 1 ? ' Quase nenhuma saída lançada: o acumulado é teto, não previsão.' : ''}</> : 'Nada aberto com data à frente.'}
        mais={<>
          <p className="fg-explica">Só o que está aberto: o que já foi pago ou recebido saiu do futuro. Item sem dia conta no mês do arquivo. Guarda não é gasto: vira reserva.{fora.itens > 0 ? ` Fora da projeção: ${fora.itens} item(ns) sem cronograma (${brl(fora.receber)} a receber, ${brl(fora.pagar)} a pagar).` : ''}</p>
          <div className="mt-rolagem">
            <table className="fin-tabela fin-proj">
              <thead><tr><th>mês</th><th className="num">entra</th><th className="num">sai</th><th className="num">guarda</th><th className="num">sobra</th><th className="num">reserva acum.</th></tr></thead>
              <tbody>
                {projecao.map((l) => (
                  <tr key={l.mes} className={l.mes === hojeMes ? 'hoje' : ''}>
                    <td className="ag-td-data">{curto(l.mes)}{l.semDia > 0 && <span className="fin-semdia" title="itens sem dia definido, projetados no mês do arquivo">{l.semDia} sem dia</span>}</td>
                    <td className="num entrada">{l.entra ? brl(l.entra) : '—'}</td>
                    <td className="num saida">{l.sai ? brl(l.sai) : '—'}</td>
                    <td className="num guarda">{l.guarda ? brl(l.guarda) : '—'}</td>
                    <td className="num">{brl(l.sobra)}</td>
                    <td className="num forte">{brl(l.reservaAcum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}>
        <span />
      </Cartao>
    </div>
  );
}

/* ------------------------------------------------------------ Plano */

export function MetisPlano({ financeiro, hoje, foco, onOrcamento, editarAoAbrir }: PaginaProps & {
  onOrcamento: (tetos: Record<string, string>, meta: string) => Promise<void>; editarAoAbrir?: boolean;
}) {
  const ls = financeiro.lancamentos;
  const hojeMes = hoje.slice(0, 7);
  const orcamento = financeiro.orcamento;
  const tetos = orcamento?.tetos || null;
  const [editando, setEditando] = useState(!!editarAoAbrir);
  const orc = useMemo(() => orcamentoDoMes(ls, foco, tetos), [ls, foco, tetos]);
  const paraTeto = useMemo(() => categoriasParaTeto(ls, hojeMes, tetos), [ls, hojeMes, tetos]);
  const pat = useMemo(() => patrimonio(ls, (financeiro.retratos || []) as never, hoje), [ls, financeiro.retratos, hoje]);
  const meta = orcamento?.metaReserva || PISO_RESERVA;
  const plano = useMemo(() => planoReserva(ls, pat.reservaLiquida, hojeMes, foco, meta), [ls, pat.reservaLiquida, hojeMes, foco, meta]);
  const comTeto = orc.linhas.filter((l) => l.teto !== null);
  const semTeto = orc.linhas.filter((l) => l.teto === null && l.gasto > 0);
  const max = Math.max(1, ...comTeto.map((l) => Math.max(l.gasto, l.teto || 0)));
  return (
    <div className="fg">
      <Cartao id="orcamento" className="largo" titulo={`Orçamento de ${curto(foco)}`}
        leitura={!orc.temTeto ? 'Sem teto definido.'
          : <>Nas categorias com teto saíram <b>{brl(orc.gastoComTeto)}</b> de <b>{brl(orc.tetoTotal)}</b>.{orc.acima ? <> <span aria-hidden>⚠ </span>{orc.acima} acima do teto.</> : ' Tudo dentro.'}</>}
        mais={orc.temTeto && semTeto.length ? (
          <table className="fg-tabela">
            <thead><tr><th>sem teto</th><th className="num">{curto(foco)}</th></tr></thead>
            <tbody>{semTeto.map((l) => <tr key={l.categoria}><td>{rotuloCategoria(l.categoria)}</td><td className="num">{num(l.gasto)}</td></tr>)}</tbody>
          </table>
        ) : undefined}>
        {editando ? (
          <EditorTetos categorias={paraTeto} metaAtual={orcamento?.metaReserva}
            onSalvar={async (t, m) => { await onOrcamento(t, m); setEditando(false); }} onCancelar={() => setEditando(false)} />
        ) : (<>
          {comTeto.length > 0 && <>
            <Legenda itens={[{ cor: 'var(--s1)', rotulo: 'gasto' }, { cor: 'var(--ink)', rotulo: 'teto', linha: true }]} />
            <BarrasH max={max} rotulo={`Teto × gasto em ${curto(foco)}`} linhas={comTeto.map((l) => ({
              chave: l.categoria, rotulo: rotuloCategoria(l.categoria), valor: brl(l.gasto),
              extra: l.situacao === 'acima' ? <span className="mt-estado"><span aria-hidden>⚠ </span>{brl(l.gasto - (l.teto || 0))} acima</span> : <span className="muted"> de {brl(l.teto || 0)}</span>,
              segmentos: [{ valor: l.gasto, cor: 'var(--s1)' }], marcador: l.teto || 0,
              dica: { titulo: rotuloCategoria(l.categoria), linhas: [{ cor: 'var(--s1)', rotulo: 'gasto', valor: brl(l.gasto) }, { rotulo: 'teto', valor: brl(l.teto || 0) }, { rotulo: 'sobra no teto', valor: brl((l.teto || 0) - l.gasto) }] },
            }))} />
          </>}
          <button className="mt-botao" onClick={() => setEditando(true)}>{orc.temTeto ? 'Mudar tetos' : 'Definir tetos'}</button>
        </>)}
      </Cartao>

      <Cartao id="meta-reserva" className="largo" titulo={meta === PISO_RESERVA ? 'Meta da reserva (piso)' : 'Meta da reserva'}
        leitura={plano.falta > 0
          ? <><span aria-hidden>⚠ </span>Faltam <b>{brl(plano.falta)}</b> para {brl(plano.meta)}.{plano.chegaEm ? <> No ritmo de {brl(plano.ritmo)} por mês, chega em <b>{curto(plano.chegaEm)}</b>.</> : ' Sem aporte pago ainda para medir o ritmo.'}</>
          : <>A reserva passou da meta de {brl(plano.meta)}.</>}
        mais={<p className="fg-explica">Ritmo = mediana dos aportes pagos nos últimos meses com aporte ({plano.ritmoMeses}). Reserva = posição marcada como reserva ou de liquidez diária. A meta muda junto com os tetos (vazio = piso de R$ 5.000).</p>}>
        <div className="mt-numeros mt-numeros-2">
          <div className="mt-num" data-numero="reserva">
            <span className="mt-num-rot">Reserva hoje</span>
            <b className="mt-num-val">{brl(plano.reserva)}</b>
            <Medidor valor={plano.reserva} alvo={plano.meta} rotulo="Reserva em relação à meta" />
          </div>
          <Numero id="aporte" rotulo={`Aporte de ${curto(foco)}`} valor={brl(plano.aporte.guardado)} sub={plano.aporte.programado > plano.aporte.guardado ? `de ${brl(plano.aporte.programado)} programado` : 'guardado no mês'} />
        </div>
      </Cartao>
    </div>
  );
}
