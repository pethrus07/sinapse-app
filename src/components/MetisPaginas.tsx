// As páginas da Métis (o módulo financeiro do Sinapse; por dentro segue "financeiro").
//  · Visão: o mês de hoje e o que já aconteceu (avisos, fluxo, gastos, recorrente, patrimônio,
//    clientes, vencido).
//  · Pronoia (previdência): o que vem pela frente (renda futura por cliente, reserva projetada,
//    cartão parcelado). A tabela de projeção mês a mês fica embaixo, na FinanceiroView.
import { useMemo, useState } from 'react';
import type { Financeiro } from '../types';
import { brl } from '../lib/financeiro';
import { aReceberVencido, avisosConexao, cartaoFuturo, fluxoMensal, receitaPorCliente, reservaAcumulada, somarMes } from '../lib/financeiroGraficos';
import { avisosFinanceiro, clientesRealizado, gastosPorCategoria, patrimonio, recorrenteDoMes, rendaRecorrente } from '../lib/financeiroAnalise';
import { Cartao5, curto, Fluxo, Receita, Reserva, Vencido } from './FinanceiroGraficos';
import { Clientes, GastosCategoria, PatrimonioCard, Recorrente, SeletorMes } from './FinanceiroAnalises';

const br = (d: string) => d.slice(0, 10).split('-').reverse().join('/');

function Avisos({ financeiro, hoje, onClassificar }: { financeiro: Financeiro; hoje: string; onClassificar: () => void }) {
  const conexao = useMemo(() => avisosConexao(financeiro.conexoes || [], hoje), [financeiro.conexoes, hoje]);
  const outros = useMemo(() => avisosFinanceiro(financeiro.lancamentos, hoje, { ultimaSync: financeiro.ultimaSync, ultimaFalha: financeiro.ultimaFalha }),
    [financeiro.lancamentos, financeiro.ultimaSync, financeiro.ultimaFalha, hoje]);
  if (!conexao.length && !outros.length) return null;
  return (
    <div className="mt-avisos">
      {outros.map((a, i) => (
        <p key={'o' + i} className="fg-aviso" role="alert" data-aviso={a.tipo}>
          <span aria-hidden>⚠ </span>
          {a.tipo === 'fatura' && <>A fatura do cartão de <b>{brl(a.valor)}</b>{a.medido ? ' (valor do banco)' : ' (estimada)'} vence {a.dias === 0 ? <b>hoje</b> : <>em <b>{a.dias} {a.dias === 1 ? 'dia' : 'dias'}</b> ({br(a.vencimento)})</>}.</>}
          {a.tipo === 'sync-falhou' && <>A sincronização com o banco falhou em {br(a.em)}{a.mensagem ? <>: {a.mensagem}</> : ''}. O razão está como na última vez que deu certo.</>}
          {a.tipo === 'sync-parada' && <>A sincronização com o banco não roda desde <b>{br(a.desde)}</b> ({a.dias} dias). A tarefa das 17h está ligada?</>}
          {a.tipo === 'a-classificar' && <><b>{a.qtd}</b> {a.qtd === 1 ? 'lançamento' : 'lançamentos'} do banco sem categoria ({brl(a.valor)}). <button className="linkbtn" onClick={onClassificar}>Classificar</button></>}
        </p>
      ))}
      {conexao.map((a) => (
        <p key={a.rotulo + a.motivo} className="fg-aviso" role="alert" data-aviso={'conexao-' + a.motivo}>
          <span aria-hidden>⚠ </span>
          {a.motivo === 'renovar' && <>A autorização do Open Finance ({a.rotulo}) vence em <b>{br(a.data)}</b>. Renove em meu.pluggy.ai antes disso: depois as leituras voltam vazias.</>}
          {a.motivo === 'vencida' && <>A autorização do Open Finance ({a.rotulo}) venceu em <b>{br(a.data)}</b>. A sincronização parou até renovar em meu.pluggy.ai.</>}
          {a.motivo === 'erro' && <>A conexão do Open Finance ({a.rotulo}) está com erro. Abra meu.pluggy.ai e confira.</>}
        </p>
      ))}
    </div>
  );
}

/** Visão: o mês e o que já aconteceu. */
export function MetisVisao({ financeiro, hoje, onClassificar }: { financeiro: Financeiro; hoje: string; onClassificar: () => void }) {
  const ls = financeiro.lancamentos;
  const hojeMes = hoje.slice(0, 7);
  // o mês em foco das análises: o último fechado (o de hoje ainda está andando)
  const [foco, setFoco] = useState(() => somarMes(hojeMes, -1));
  const fluxo = useMemo(() => fluxoMensal(ls), [ls]);
  const gastos = useMemo(() => gastosPorCategoria(ls, hojeMes, foco), [ls, hojeMes, foco]);
  const rec = useMemo(() => recorrenteDoMes(ls, foco), [ls, foco]);
  const renda = useMemo(() => rendaRecorrente(ls, hojeMes), [ls, hojeMes]);
  const pat = useMemo(() => patrimonio(ls, (financeiro.retratos || []) as never, hoje), [ls, financeiro.retratos, hoje]);
  const cli = useMemo(() => clientesRealizado(ls, hoje), [ls, hoje]);
  const vencido = useMemo(() => aReceberVencido(ls, hoje), [ls, hoje]);
  if (!ls.length) return <p className="muted">Nada no razão ainda.</p>;
  return (
    <>
      <Avisos financeiro={financeiro} hoje={hoje} onClassificar={onClassificar} />
      <div className="fg">
        <Fluxo linhas={fluxo} hojeMes={hojeMes} />
        <div className="mt-filtro largo">
          <span className="fg-num-rot">Mês das análises</span>
          <SeletorMes meses={gastos.meses} foco={gastos.foco} parciais={gastos.parciais} onFoco={setFoco} />
        </div>
        <Recorrente r={rec} renda={renda} parcial={gastos.parciais.includes(foco)} />
        <GastosCategoria g={gastos} ls={ls} />
        <PatrimonioCard p={pat} />
        <Vencido v={vencido} />
        <Clientes c={cli} hojeMes={hojeMes} />
      </div>
    </>
  );
}

/** Pronoia: o que vem pela frente. */
export function MetisPronoia({ financeiro, hoje }: { financeiro: Financeiro; hoje: string }) {
  const ls = financeiro.lancamentos;
  const hojeMes = hoje.slice(0, 7);
  const receita = useMemo(() => receitaPorCliente(ls), [ls]);
  const reserva = useMemo(() => reservaAcumulada(ls, hojeMes), [ls, hojeMes]);
  const cartao = useMemo(() => cartaoFuturo(ls, hojeMes), [ls, hojeMes]);
  if (!ls.length) return <p className="muted">Nada no razão ainda.</p>;
  return (
    <>
      <div className="fg">
        <Receita r={receita} hojeMes={hojeMes} />
        <Reserva r={reserva} hojeMes={hojeMes} />
        <Cartao5 c={cartao} />
      </div>
    </>
  );
}
