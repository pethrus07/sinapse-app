// As telas do Aion (investimentos). Regra do Pedro: pouca coisa à vista, muito respiro, o resto em
// "Mais opções"; borda só quando comunica estado. O Aion NÃO recomenda: mostra dado, fonte e data.
// Regra conceito × porquê (AionPorque.tsx): termo/nome/indicador → <Termo> ("O que é"); número que
// mudou → <ComPorque> ("Por quê", com a fonte do número); ativo inteiro → <ComAtivo> (os dois).
// Lógica em src/lib/aion*.ts; os gráficos em AionGraficos.tsx.
import { useMemo, useState } from 'react';
import type { Aion, AtivoObservado, Cotacao, Financeiro, RegraAion, TipoAtivo, TipoCarteira } from '../types';
import { brl } from '../lib/financeiro';
import {
  BLOCO_DO_TIPO, carteiraPorTipo, metasNoRitmo, PISO_RESERVA, META_CARTEIRA, posicoesAion, rendaPassiva, rendimentoDaCarteira, ritmoDeAporte, ROTULO_TIPO, TIPOS,
  type PosicaoAion,
} from '../lib/aion';
import { HORIZONTES, olharParaTras, premissasDoMercado, simular, type EntradaSimulacao, type Premissas } from '../lib/aionSimular';
import { FONTES_PORQUE, porquesDoAlvo, ROTULO_PORQUE, type Porque } from '../lib/aionPorques';
import { oQueEAtivo, TERMO_DO_TIPO, verbete, type IdTermo } from '../lib/aionGlossario';
import {
  aportesPorMes, avisoPoucoDado, caminhoDasMetas, eventosDoAtivo, patrimonioPorMes, rendaPassivaMeses, rendimentoIndexado, ROTULO_EVENTO, serieEconomia,
  type Caminho, type Evento, type TipoEvento,
} from '../lib/aionSeries';
import { somarMes } from '../lib/financeiroGraficos';
import { ComAtivo, ComPorque, ItemPorque, Termo, usePorques, type FonteNumero } from './AionPorque';
import { BarrasTipo, Faixa52, FaixaCenarios, GraficoColunas, GraficoLinhas, LegendaFormas, Sparkline, type Forma, type MarcaEvento } from './AionGraficos';
import { Cartao, curto, Legenda, longo, num } from './FinanceiroGraficos';
import { Medidor } from './MetisGraficos';

const br = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const pct = (v: number | null | undefined, casas = 2) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
const pct1 = (v: number) => pct(v, 1);
const sinalPct = (v: number | null | undefined) => (v == null ? '' : `${v > 0 ? '▲ +' : v < 0 ? '▼ −' : ''}${pct(Math.abs(v))}`);
const valorBR = (t: string) => { const s = String(t || '').trim().replace(/\./g, '').replace(',', '.'); const x = Number(s); return s && Number.isFinite(x) ? x : NaN; };
const indice = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const mesAno = (m: string) => curto(m.slice(0, 7));
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export interface PaginaAion { aion: Aion; financeiro: Financeiro; hoje: string }

/** Fonte dos números que vêm do razão da Métis. */
const fonteRazao = (data: string): FonteNumero => ({ nome: 'razão da Métis (Meu Pluggy, a última sincronização, e o que entrou à mão)', data });

/** Um número de topo: o rótulo é termo ("O que é"), o valor tem porquê (com marcador). */
function NumeroAion({ id, termo, rotulo, valor, alvo, fonte, sub, extra, alerta, children }: {
  id: string; termo: IdTermo; rotulo: string; valor: string; alvo: string; fonte: FonteNumero; sub?: React.ReactNode; extra?: React.ReactNode; alerta?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="mt-num" data-numero={id}>
      <span className="mt-num-rot"><Termo id={termo}>{rotulo}</Termo></span>
      <ComPorque alvo={alvo} rotulo={rotulo} fonte={fonte} extra={extra} className="ai-pq-num">
        <b className="mt-num-val">{alerta && <span className="mt-icone" aria-hidden>⚠ </span>}{valor}</b>
      </ComPorque>
      {children}
      {sub && <span className="mt-num-sub">{sub}</span>}
    </div>
  );
}

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
        <p className="fg-explica">Sem o token, a brapi só responde quatro ações de teste (a lista está em <code>BRAPI_SEM_TOKEN</code>, scripts/aion/fontes.mjs). Cripto vem da CoinGecko sem chave (a chave Demo é opcional: <code>-Servico coingecko</code>).</p>
      </div>
    </details>
  );
}

function FonteData({ fonte, data }: { fonte?: string; data?: string }) {
  if (!fonte) return null;
  return <span className="ai-fonte">{fonte}{data ? ` · ${br(data)}` : ''}</span>;
}

/** O aviso de pouco dado, sempre no mesmo lugar (abaixo do gráfico). */
function Aviso({ texto }: { texto: string }) {
  return texto ? <p className="ai-aviso" data-pouco-dado>{texto}</p> : null;
}

/* ------------------------------------------------------------ Carteira */

function cotacaoDe(aion: Aion, p: { ticker: string; tipo: TipoCarteira }): Cotacao | null {
  const m = aion.mercado;
  return (p.tipo === 'cripto' ? m?.cripto?.porCodigo?.[p.ticker] : m?.cotacoes?.porCodigo?.[p.ticker]) || null;
}

function fonteCotacao(aion: Aion, cripto: boolean, c: Cotacao | null, alt: FonteNumero): FonteNumero {
  const m = aion.mercado;
  if (!c) return alt;
  return cripto ? { nome: `${m?.cripto?.fonte} · ${m?.cripto?.citar}`, url: m?.cripto?.url, data: c.em } : { nome: m?.cotacoes?.fonte || 'brapi.dev', url: m?.cotacoes?.url, data: c.em };
}

/** DY do mês e P/VP do FII quando a CVM (e o preço) dão. */
function indicadoresFii(aion: Aion, codigo: string, c: Cotacao | null) {
  const f = aion.mercado?.cvm?.fiis?.[codigo];
  if (!f) return '';
  const partes = [];
  if (c?.preco != null && f.vpCota) partes.push(`P/VP ${(c.preco / f.vpCota).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`);
  if (f.dyMes != null) partes.push(`DY de ${f.mes.slice(5)}/${f.mes.slice(2, 4)}: ${pct(f.dyMes)}`);
  if (f.vpCota) partes.push(`valor patrimonial ${brl(f.vpCota)} por cota`);
  return partes.join(' · ') + ' (CVM)';
}

function ListaAtivos({ aion, posicoes, onAtivo }: { aion: Aion; posicoes: PosicaoAion[]; onAtivo: (c: string) => void }) {
  return (
    <ul className="ai-ativos" aria-label="Ativos da carteira (passe o mouse ou toque para ver o que é e o porquê; clique para ver no tempo)">
      {posicoes.map((p) => {
        const c = cotacaoDe(aion, p);
        const semToken = aion.mercado?.cotacoes?.semToken?.includes(p.ticker);
        const cod = p.ticker || p.descricao;
        const ind = p.tipo === 'fii' ? indicadoresFii(aion, p.ticker, c) : c?.pl != null ? `P/L ${c.pl.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}` : '';
        return (
          <ComAtivo key={p.chave} codigo={cod} tipo={p.tipo} rotulo={cod} className="ai-ativo" onAbrir={p.ticker ? () => onAtivo(p.ticker) : undefined}
            fonte={fonteCotacao(aion, p.tipo === 'cripto', c, fonteRazao(p.data))}>
            <span className="ai-ativo-nome"><b>{cod}</b><span className="muted">{ROTULO_TIPO[p.tipo]}</span></span>
            <span className="ai-ativo-val">{brl(p.valor)}</span>
            <span className={'ai-ativo-var ai-marcado' + (c?.variacaoDia == null ? ' muted' : '')}>
              {c?.variacaoDia != null ? <>{sinalPct(c.variacaoDia)} <span className="muted">{p.tipo === 'cripto' ? '24 h' : 'no dia'}</span></> : semToken ? 'sem cotação: falta o token da brapi' : 'sem cotação'}
            </span>
            {ind && <span className="ai-ativo-ind muted">{ind}</span>}
          </ComAtivo>
        );
      })}
    </ul>
  );
}

/** Os termos dos indicadores que aparecem dentro das linhas de ativo (a linha inteira é "O que é e por quê"). */
function TermosIndicadores({ ids }: { ids: IdTermo[] }) {
  return <p className="ai-termos">O que quer dizer: {ids.map((id, i) => <span key={id}>{i ? ' · ' : ''}<Termo id={id} /></span>)}</p>;
}

export function AionCarteira({ aion, financeiro, hoje, onTela, onAtivo }: PaginaAion & { onTela: (t: string) => void; onAtivo: (c: string) => void }) {
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
  const pat = useMemo(() => patrimonioPorMes(ls), [ls]);
  const ap = useMemo(() => aportesPorMes(ls, hojeMes), [ls, hojeMes]);
  const rpm = useMemo(() => rendaPassivaMeses(ls, hojeMes), [ls, hojeMes]);
  const idx = useMemo(() => rendimentoIndexado(pat, ap.meses, aion.mercado?.bcb?.cdiMensal?.pontos || [], aion.mercado?.bcb?.ipca?.mensal || [], hojeMes), [pat, ap, aion.mercado, hojeMes]);
  if (!pos.length) return (
    <div className="fg"><Cartao id="carteira-vazia" className="largo" titulo="Carteira" leitura="Nenhuma posição de investimento no razão ainda. A sincronização da Métis traz as do banco; cripto entra à mão em Métis › Lançamentos (= Saldo, classe cripto).">{null}</Cartao></div>
  );
  const fora = cart.linhas.filter((l) => l.tipo !== 'reserva');
  const res = cart.linhas.find((l) => l.tipo === 'reserva');
  const foraDaFaixa = fora.filter((l) => l.situacao === 'acima' || l.situacao === 'abaixo');
  const dataPos = pos.map((p) => p.data).sort().pop() || '';
  const ativos = pos.filter((p) => ['fii', 'acao', 'cripto'].includes(p.tipo));
  const semToken = ativos.filter((p) => aion.mercado?.cotacoes?.semToken?.includes(p.ticker));
  const fr = fonteRazao(dataPos);
  const fonteRenda: FonteNumero = { nome: 'razão da Métis (entradas recebidas de dividendo, JCP e rendimento)' };
  const ultimoPat = pat[pat.length - 1];
  const totalAportes = ap.meses.reduce((s, m) => s + m.valor, 0);
  const totalRenda = rpm.reduce((s, m) => s + m.valor, 0);
  // a frase compara o último mês em que a carteira e o CDI têm ponto (o CDI do mês corrente sai depois)
  const ultIdx = [...idx.pontos].reverse().find((p) => p.carteira != null && p.cdi != null && p.mes !== idx.base);
  return (
    <>
      <div className="mt-numeros">
        <NumeroAion id="total" termo="total-investido" rotulo="Total investido" alvo="carteira" fonte={fr} valor={brl(cart.total)} sub={`${pos.length} aplicações · posição de ${br(dataPos)}`}
          extra={<p className="ai-pq-txt">Soma das posições do razão da Métis e do que entrou à mão. Muda com aporte, resgate e rendimento.</p>} />
        <NumeroAion id="reserva" termo="reserva" rotulo="Reserva" alvo="reserva" fonte={fr} valor={brl(cart.reserva)} alerta={cart.reserva < cart.reservaMinima}
          sub={cart.reserva < cart.reservaMinima ? `faltam ${brl(cart.reservaMinima - cart.reserva)} para o piso de ${brl(cart.reservaMinima)}` : `acima do piso de ${brl(cart.reservaMinima)}`}>
          <Medidor valor={cart.reserva} alvo={cart.reservaMinima} rotulo="Reserva em relação ao piso" />
        </NumeroAion>
        <NumeroAion id="fora" termo="fora-da-reserva" rotulo="Fora da reserva" alvo="carteira-fora" fonte={fr} valor={brl(cart.fora)} sub="onde o risco é aceito"
          extra={<p className="ai-pq-txt">Tudo que não é reserva: renda fixa com prazo, FII, ação e cripto.</p>} />
        <NumeroAion id="renda-passiva" termo="renda-passiva" rotulo={`Renda passiva de ${curto(hojeMes)}`} alvo="renda-passiva" fonte={fonteRenda} valor={brl(rp.total)}
          sub={rp.total > 0 ? 'entrou no mês' : rpAnt.total > 0 ? `${curto(somarMes(hojeMes, -1))}: ${brl(rpAnt.total)}` : 'nada entrou ainda'}
          extra={rp.itens.length ? <p className="ai-pq-txt">Entrou no mês: {rp.itens.map((l) => `${l.descricao}: ${brl(Number(l.valor))}`).join(' · ')}</p> : undefined} />
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
          <BarrasTipo linhas={fora} fonte={fr} />
        </Cartao>

        <Cartao id="patrimonio" titulo="Patrimônio mês a mês"
          leitura={ultimoPat ? <>No retrato de {br(ultimoPat.data)}: <b>{brl(ultimoPat.total)}</b>, sendo {brl(ultimoPat.reserva)} de reserva e {brl(ultimoPat.resto)} fora dela.</> : 'Sem retrato do patrimônio no razão.'}
          mais={<>
            <p className="fg-explica">Um retrato por mês: as posições que a sincronização gravou no mês (a última de cada aplicação). Mês sem retrato não aparece; o Aion não inventa o meio.</p>
            <table className="fg-tabela"><thead><tr><th>mês</th><th className="num">reserva</th><th className="num">fora</th><th className="num">total</th></tr></thead>
              <tbody>{pat.map((p) => <tr key={p.mes}><td>{curto(p.mes)}</td><td className="num">{num(p.reserva)}</td><td className="num">{num(p.resto)}</td><td className="num">{num(p.total)}</td></tr>)}</tbody></table>
          </>}>
          <Legenda itens={[{ cor: 'var(--s1)', rotulo: 'reserva' }, { cor: 'var(--s2)', rotulo: 'fora da reserva' }]} />
          <GraficoColunas meses={pat.map((p) => p.mes)} hojeMes={hojeMes} aria="Patrimônio investido por mês, reserva e fora da reserva"
            series={[{ id: 'reserva', rotulo: 'reserva', cor: 'var(--s1)', valores: pat.map((p) => p.reserva) }, { id: 'resto', rotulo: 'fora da reserva', cor: 'var(--s2)', valores: pat.map((p) => p.resto) }]} />
          <Aviso texto={avisoPoucoDado(pat.length)} />
        </Cartao>

        <Cartao id="rendimento" titulo="Rendimento × CDI e IPCA"
          leitura={<>
            {rend.base === 'nenhuma' ? <>Ainda sem base para medir o rendimento. </> : <>Desde {br(rend.desde)} a parte com base rendeu <b>{pct(rend.pct)}</b> ({brl(rend.ganho)}); no mesmo período o <Termo id="cdi">CDI</Termo> foi {pct(rend.cdi?.pct)} e o <Termo id="ipca">IPCA</Termo> {pct(rend.ipca?.pct)}. </>}
            {ultIdx ? <>Em <Termo id="base-100">base 100</Termo> desde {mesAno(idx.base)}, em {curto(ultIdx.mes)}: carteira <b>{indice(ultIdx.carteira!)}</b>, CDI {indice(ultIdx.cdi!)}{ultIdx.ipca != null ? `, IPCA ${indice(ultIdx.ipca)}` : ''}.</> : null}
          </>}
          mais={<>
            <p className="fg-explica">{idx.explica}</p>
            {rend.base !== 'nenhuma' && <p className="fg-explica">O número da frase vem de outra base: {rend.explica}</p>}
            <table className="fg-tabela"><thead><tr><th>mês</th><th className="num">carteira</th><th className="num">CDI</th><th className="num">IPCA</th></tr></thead>
              <tbody>{idx.pontos.map((p) => <tr key={p.mes}><td>{curto(p.mes)}</td><td className="num">{p.carteira != null ? indice(p.carteira) : '·'}</td><td className="num">{p.cdi != null ? indice(p.cdi) : '·'}</td><td className="num">{p.ipca != null ? indice(p.ipca) : '·'}</td></tr>)}</tbody></table>
          </>}>
          {idx.pontos.length > 1 && <>
            <Legenda itens={[{ cor: 'var(--s1)', rotulo: 'sua carteira', linha: true }, { cor: 'var(--s2)', rotulo: 'CDI', linha: true }, { cor: 'var(--s3)', rotulo: 'IPCA', linha: true }]} nota={`base 100 em ${mesAno(idx.base)}`} />
            <GraficoLinhas xs={idx.pontos.map((p) => p.mes)} rotuloX={(m) => curto(m)} fmt={indice} fmtEixo={(v) => String(Math.round(v))} aria={`Carteira, CDI e IPCA em base 100 desde ${mesAno(idx.base)}`}
              series={[
                { id: 'carteira', rotulo: 'sua carteira', cor: 'var(--s1)', valores: idx.pontos.map((p) => p.carteira) },
                { id: 'cdi', rotulo: 'CDI', cor: 'var(--s2)', valores: idx.pontos.map((p) => p.cdi) },
                { id: 'ipca', rotulo: 'IPCA', cor: 'var(--s3)', valores: idx.pontos.map((p) => p.ipca) },
              ]} />
          </>}
          {idx.pontos.length === 1 && <p className="ai-aviso">As três linhas começam em 100 em {mesAno(idx.base)}, o primeiro retrato; a comparação aparece no mês que vem, com o segundo.</p>}
          <Aviso texto={idx.aviso} />
        </Cartao>

        <Cartao id="aportes" titulo="Aportes por mês"
          leitura={ap.meses.length ? <>{brl(totalAportes)} em {ap.meses.length} {ap.meses.length === 1 ? 'mês' : 'meses'}; <Termo id="ritmo">ritmo real</Termo> de <b>{brl(ap.ritmo.ritmo)} por mês</b> nos meses fechados{ap.ritmo.fraca ? ' (pouco dado: estimativa fraca)' : ''}.{ap.ritmo.mesAtual > 0 ? ` Em ${curto(hojeMes)}, que ainda está andando, já entraram ${brl(ap.ritmo.mesAtual)} (entram no ritmo quando o mês fechar).` : ''}</> : 'Sem aporte no razão ainda.'}
          mais={<>
            <p className="fg-explica">Conta como <Termo id="aporte">aporte</Termo> a reserva paga (Métis, "→ Guarda") e a saída para aplicação. O mês de hoje, mais claro, ainda está andando e não entra no ritmo.</p>
            <table className="fg-tabela"><thead><tr><th>mês</th><th className="num">aportado</th></tr></thead><tbody>{ap.meses.map((m) => <tr key={m.mes}><td>{curto(m.mes)}{m.andando ? ' (andando)' : ''}</td><td className="num">{num(m.valor)}</td></tr>)}</tbody></table>
          </>}>
          <GraficoColunas meses={ap.meses.map((m) => m.mes)} andando={ap.meses.map((m) => !!m.andando)} hojeMes={hojeMes} aria="Aportes por mês"
            series={[{ id: 'aporte', rotulo: 'aportado', cor: 'var(--s1)', valores: ap.meses.map((m) => m.valor) }]} />
          <Aviso texto={avisoPoucoDado(ap.meses.length)} />
        </Cartao>

        <Cartao id="renda-passiva-meses" titulo="Renda passiva por mês"
          leitura={rpm.length ? (totalRenda > 0 ? <>{brl(totalRenda)} de dividendos, JCP e rendimentos em {rpm.length} {rpm.length === 1 ? 'mês' : 'meses'}.</> : <>Nada de renda passiva no razão em {rpm.length} {rpm.length === 1 ? 'mês' : 'meses'}.</>) : 'Sem mês no razão ainda.'}
          mais={<>
            <p className="fg-explica">Entradas recebidas com categoria de rendimento, dividendo ou JCP (ou com essas palavras na descrição). O mês de hoje ainda está andando.</p>
            <table className="fg-tabela"><thead><tr><th>mês</th><th className="num">recebido</th></tr></thead><tbody>{rpm.map((m) => <tr key={m.mes}><td>{curto(m.mes)}</td><td className="num">{brl(m.valor)}</td></tr>)}</tbody></table>
          </>}>
          <GraficoColunas meses={rpm.map((m) => m.mes)} andando={rpm.map((m) => !!m.andando)} hojeMes={hojeMes} aria="Renda passiva por mês"
            series={[{ id: 'renda', rotulo: 'renda passiva', cor: 'var(--s1)', valores: rpm.map((m) => m.valor) }]} />
          <Aviso texto={avisoPoucoDado(rpm.length)} />
        </Cartao>

        <Cartao id="ativos" className="largo" titulo="Seus ativos hoje"
          leitura={ativos.length ? <>Passe o mouse (ou toque) num ativo para ver o que é e o porquê; clique para ver no tempo.{semToken.length ? ` ${semToken.length} de ${ativos.length} sem cotação.` : ''}</> : 'Nenhum FII, ação ou cripto na carteira.'}
          mais={semToken.length ? <ComoPegarToken /> : undefined}>
          <ListaAtivos aion={aion} posicoes={ativos} onAtivo={onAtivo} />
          {ativos.length > 0 && <TermosIndicadores ids={['variacao', 'pl', 'pvp', 'dy', 'vp-cota']} />}
        </Cartao>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ Ativo (preço no tempo com os eventos) */

const FORMA: Record<TipoEvento, Forma> = { resultado: 'quadrado', 'fato-relevante': 'losango', 'data-com': 'circulo', 'data-ex': 'circulo', 'decisao-copom': 'triangulo' };
const TERMO_EVENTO: Record<TipoEvento, IdTermo> = { resultado: 'resultado', 'fato-relevante': 'fato-relevante', 'data-com': 'data-com', 'data-ex': 'data-ex', 'decisao-copom': 'decisao-copom' };

export function AionAtivo({ aion, financeiro, codigo, onVoltar }: PaginaAion & { codigo: string; onVoltar: () => void }) {
  const m = aion.mercado;
  const c: Cotacao | null = m?.cotacoes?.porCodigo?.[codigo] || m?.cripto?.porCodigo?.[codigo] || null;
  const pos = useMemo(() => posicoesAion(financeiro.lancamentos).find((p) => p.ticker === codigo), [financeiro.lancamentos, codigo]);
  const obs = aion.observacao?.ativos.find((a) => a.codigo.toUpperCase() === codigo);
  const tipo: TipoCarteira | 'etf' | 'bdr' = pos?.tipo || (obs ? (obs.tipo === 'cripto' ? 'cripto' : obs.tipo === 'fii' ? 'fii' : obs.tipo) : /11[A-Z]?$/.test(codigo) ? 'fii' : 'acao');
  const o = oQueEAtivo(codigo, tipo, m);
  const v = usePorques();
  const hist = c?.historico || [];
  const eventos = useMemo(() => eventosDoAtivo(codigo, aion), [codigo, aion]);
  const xs = hist.map((h) => h.data);
  // eventos no mesmo pregão viram um marcador só (com os porquês juntos); fim de semana vai para o próximo pregão
  const marcas: MarcaEvento[] = useMemo(() => {
    const porDia = new Map<number, Evento[]>();
    for (const e of eventos) { const i = xs.findIndex((d) => d >= e.data); if (i >= 0) porDia.set(i, [...(porDia.get(i) || []), e]); }
    return [...porDia.entries()].map(([i, es]) => ({ i, forma: FORMA[es[0].tipo], rotulo: `${es.map((e) => ROTULO_EVENTO[e.tipo]).join(' e ')} em ${br(xs[i])}`, itens: es.map((e) => e.porque), fonte: { nome: es.map((e) => e.porque.fonte.nome).join(' · '), data: es[0].data } }));
  }, [eventos, xs]);
  const semToken = m?.cotacoes?.semToken?.includes(codigo);
  const outros = porquesDoAlvo(codigo, aion, v.ctx, v.todos, 8);
  const tiposNa = [...new Set(eventos.map((e) => e.tipo))];
  const formasLeg = [...new Map(tiposNa.map((t) => [FORMA[t], { forma: FORMA[t], rotulo: t === 'data-com' || t === 'data-ex' ? 'data com / data ex' : ROTULO_EVENTO[t] }])).values()];
  const primeiro = hist[0], ultimo = hist[hist.length - 1];
  const varPeriodo = primeiro && ultimo ? (ultimo.fechamento / primeiro.fechamento - 1) * 100 : null;
  return (
    <div className="fg">
      <div className="ai-voltar largo"><button className="mt-botao fraco" onClick={onVoltar}>← Voltar</button></div>
      <Cartao id="ativo-oque" titulo={`O que é · ${codigo}`}
        leitura={<><b>{o.titulo}</b>. {o.linhas[0]}</>}
        mais={<><p className="fg-explica">{o.linhas.slice(1).join(' ')}</p>{o.fonte && <p className="ai-fonte">Fonte: <a href={o.fonte.url} target="_blank" rel="noreferrer noopener">{o.fonte.nome}</a></p>}</>}>
        <p className="ai-termos">Tipo: <Termo id={o.termo} />{pos ? <> · na sua carteira: {brl(pos.valor)} em {br(pos.data)}</> : obs ? <> · na sua lista de observação desde {br(obs.desde)}</> : null}</p>
      </Cartao>
      <Cartao id="ativo-preco" className="largo" titulo={`${codigo}: preço no tempo`}
        leitura={hist.length > 1
          ? <>De {brl(primeiro.fechamento)} em {br(primeiro.data)} a <b>{brl(ultimo.fechamento)}</b> em {br(ultimo.data)} ({sinalPct(varPeriodo)}). {marcas.length ? <>{eventos.length} {eventos.length === 1 ? 'evento marcado' : 'eventos marcados'}: passe o mouse ou toque no marcador para ver o porquê.</> : 'Nenhum evento ligado neste período.'}</>
          : hist.length === 1 ? <>Só um dia de preço ({brl(hist[0].fechamento)} em {br(hist[0].data)}): o gráfico cresce com a coleta.</>
          : <>Sem histórico de preço. {semToken ? 'Falta o token da brapi: sem ele, a brapi só responde quatro ações de teste.' : tipo === 'cripto' ? 'A CoinGecko pública dá só o preço de hoje; o histórico de cripto ainda não é coletado.' : 'A cotação ainda não foi coletada.'} {eventos.length ? '' : 'Os eventos da CVM aparecem abaixo quando houver.'}</>}
        mais={<>
          <p className="fg-explica">Preço de fechamento diário pela brapi ({hist.length} pregões; o plano grátis dá 3 meses). Marcadores: resultado e fato relevante (CVM, dados abertos, atualização semanal), data com e data ex de provento (brapi) e decisões do Copom (BC). A forma diz o tipo do evento. Um evento perto de um movimento não prova que ele causou o movimento: o pop-up diz o que é causa conhecida e o que é só contexto.</p>
          {hist.length > 0 && <table className="fg-tabela"><thead><tr><th>dia</th><th className="num">fechamento</th></tr></thead><tbody>{[...hist].reverse().slice(0, 30).map((h) => <tr key={h.data}><td>{br(h.data)}</td><td className="num">{brl(h.fechamento)}</td></tr>)}</tbody></table>}
          {!hist.length && semToken && <ComoPegarToken />}
        </>}>
        {hist.length > 0 && <>
          {formasLeg.length > 0 && <LegendaFormas itens={formasLeg} />}
          <GraficoLinhas xs={xs} rotuloX={(d) => diaMes(d)} tituloDica={(d) => br(d)} fmt={(x) => brl(x)} fmtEixo={(x) => x.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} altura={260} rotulosFim={false}
            aria={`${codigo}: preço de fechamento de ${br(xs[0])} a ${br(xs[xs.length - 1])}`} marcas={marcas}
            series={[{ id: 'preco', rotulo: 'fechamento', cor: 'var(--s1)', valores: hist.map((h) => h.fechamento) }]} />
          <p className="ai-termos">Os marcadores: {tiposNa.length ? tiposNa.map((t, i) => <span key={t}>{i ? ' · ' : ''}<Termo id={TERMO_EVENTO[t]} /></span>) : 'nenhum neste período'}</p>
        </>}
        {!hist.length && eventos.length === 0 && (m?.cvm?.fatos || []).filter((f) => f.codigo === codigo).map((f) => <p key={f.data + f.assunto} className="fg-explica">{br(f.data)}: {f.assunto}</p>)}
      </Cartao>
      <Cartao id="ativo-porques" className="largo" titulo={`Por quê · ${codigo}`}
        leitura={outros.itens.length ? <>{outros.itens.length} {outros.itens.length === 1 ? 'explicação ligada' : 'explicações ligadas'}, com fonte e data.</> : outros.semNoticia}
        mais={outros.faltando.length ? <p className="fg-explica">Ainda não ligado: {outros.faltando.join(' · ')}.</p> : undefined}>
        {outros.itens.length > 0 && <div className="ai-lista-pq">{outros.itens.map((p) => <ItemPorque key={p.id} p={p} onEstudar={v.onEstudar} tituloBloco={v.tituloBloco} />)}</div>}
      </Cartao>
    </div>
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

export function AionObservacao({ aion, hoje, onSalvar, onAtivo }: PaginaAion & { onSalvar: (ativos: AtivoObservado[]) => Promise<void>; onAtivo: (c: string) => void }) {
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
  const comHist = ativos.filter((a) => (cot(a)?.historico?.length || 0) > 1);
  return (
    <div className="fg">
      <Cartao id="observacao" className="largo" titulo="Ativos que você acompanha sem ter"
        leitura={ativos.length ? <>{ativos.length} na lista. Passe o mouse (ou toque) para ver o que é e o porquê; clique para ver no tempo.{comHist.length ? ` A linha ao lado do preço é o histórico que a fonte deu (${comHist.length} com histórico).` : ''}</> : 'Nenhum ativo na lista ainda. Inclua um abaixo: a cotação chega na próxima coleta.'}
        mais={<>
          <p className="fg-explica">A lista mora no vault (04-NEGOCIO/financeiro/aion-observacao.md). O coletor busca a cotação destes também. A linha de preço mostra o histórico que a brapi deu (o plano grátis dá 3 meses, não 52 semanas); a régua mostra a mínima e a máxima de 52 semanas que a própria brapi informa. Indicadores de FII pela CVM (informe mensal).</p>
          {semToken.length > 0 && <ComoPegarToken />}
        </>}>
        {ativos.length > 0 && (
          <ul className="ai-ativos" aria-label="Lista de observação">
            {ativos.map((a) => {
              const c = cot(a);
              const cod = a.tipo === 'cripto' ? (c?.codigo || a.codigo.toUpperCase()) : a.codigo.toUpperCase();
              const tipoC: TipoCarteira | 'etf' | 'bdr' = a.tipo === 'cripto' ? 'cripto' : a.tipo;
              const fii = a.tipo === 'fii' ? indicadoresFii(aion, cod, c) : '';
              return (
                <li key={a.codigo} className="ai-obs-linha">
                  <ComAtivo como="div" codigo={cod} tipo={tipoC} rotulo={cod} className="ai-ativo" onAbrir={() => onAtivo(cod)}
                    fonte={fonteCotacao(aion, a.tipo === 'cripto', c, { nome: 'lista de observação (aion-observacao.md); cotação na próxima coleta' })}>
                    <span className="ai-ativo-nome"><b>{cod}</b><span className="muted">{TIPOS_OBS.find((t) => t.tipo === a.tipo)?.rotulo}{a.nota ? ` · ${a.nota}` : ''}</span></span>
                    <span className="ai-ativo-val">{c?.historico && c.historico.length > 1 && <Sparkline pontos={c.historico} rotulo={`${cod}, preço no histórico`} />}{c?.preco != null ? brl(c.preco) : '—'}</span>
                    <span className={'ai-ativo-var ai-marcado' + (c?.variacaoDia == null ? ' muted' : '')}>
                      {c?.variacaoDia != null ? <>{sinalPct(c.variacaoDia)} <span className="muted">{a.tipo === 'cripto' ? '24 h' : 'no dia'}</span></> : m?.cotacoes?.semToken?.includes(cod) ? 'sem cotação: falta o token da brapi' : 'cotação na próxima coleta'}
                    </span>
                    {(c && (c.pl != null || c.min52 != null)) || fii ? (
                      <span className="ai-ativo-ind muted">
                        {c?.pl != null ? `P/L ${c.pl.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}` : ''}
                        {c?.min52 != null && c.max52 != null && c.preco != null ? <> {c.pl != null ? '· ' : ''}52 sem.: <Faixa52 min={c.min52} max={c.max52} preco={c.preco} /></> : null}
                        {fii ? ` ${fii}` : ''}
                      </span>
                    ) : null}
                  </ComAtivo>
                  <button className="fin-mini del" aria-label={`Tirar ${cod} da lista`} disabled={salvando} onClick={() => salvar(ativos.filter((x) => x !== a))}>✕</button>
                </li>
              );
            })}
          </ul>
        )}
        {ativos.length > 0 && <TermosIndicadores ids={['variacao', 'pl', '52-semanas', 'pvp', 'dy']} />}
        <form className="ai-form" onSubmit={(e) => {
          e.preventDefault();
          const c = codigo.trim();
          if (!c) return setMsg('Escreva o código (ex.: ABCD3, WXYZ11, bitcoin).');
          salvar([...ativos, { codigo: c, tipo, nota: nota.trim(), desde: hoje }]).then(() => { setCodigo(''); setNota(''); });
        }}>
          <label className="fin-campo"><span>Código</span><input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="ABCD3, WXYZ11, bitcoin" autoComplete="off" /></label>
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
        leitura={h5 ? <>Em 5 anos, <Termo id="valor-real">em reais de hoje</Termo> e já tirado o imposto: entre <b>{brl(h5.ruim.real)}</b> e <b>{brl(h5.bom.real)}</b>, com a base em {brl(h5.base.real)}{temE ? <> (sem o "e se": {brl(simAntes.horizontes[60].base.real)})</> : ''}. É conta com premissas, não promessa.</> : '—'}
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
        <FaixaCenarios ruim={s.cenarios.ruim} base={s.cenarios.base} bom={s.cenarios.bom} antes={temE ? simAntes.cenarios.base : null} />
        <p className="ai-termos">O que quer dizer: <Termo id="cenarios" /> · <Termo id="volatilidade" /> · <Termo id="tabela-regressiva" /> · <Termo id="focus">Focus</Termo></p>
        <table className="fg-tabela ai-horizontes">
          <thead><tr><th>em</th><th className="num">ruim</th><th className="num">base</th><th className="num">bom</th>{temE && <th className="num">antes (base)</th>}<th className="num">aplicado</th></tr></thead>
          <tbody>{HORIZONTES.map((h) => { const x = s.horizontes[h]; return x ? <tr key={h}><td>{h / 12} {h === 12 ? 'ano' : 'anos'}</td><td className="num">{num(x.ruim.real)}</td><td className="num">{num(x.base.real)}</td><td className="num">{num(x.bom.real)}</td>{temE && <td className="num">{num(simAntes.horizontes[h].base.real)}</td>}<td className="num">{num(x.base.aplicado)}</td></tr> : null; })}</tbody>
        </table>
      </Cartao>
      <Cartao id="para-tras" titulo="Olhar para trás"
        leitura={tras ? <>R$ {num(valorBR(trasValor) || 0)} por mês desde {curto(tras.de)} no <Termo id="cdi">CDI</Termo> dariam <b>{brl(tras.saldo)}</b> em {curto(tras.ate)} (antes do imposto). Aplicado: {brl(tras.aplicado)}; corrigido pelo IPCA: {brl(tras.corrigido)}; <Termo id="juro-real">ganho real</Termo> {brl(tras.ganhoReal)}.</> : 'Sem série do CDI no cache para esse período.'}
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

/** O caminho de uma meta: o que já foi (retratos), a projeção pelo ritmo e a faixa; o alvo é a linha de referência. */
function GraficoCaminho({ c, rotulo, semRitmo }: { c: Caminho; rotulo: string; semRitmo: boolean }) {
  // sem aporte medido não há projeção (a data também não existe): só o que já foi e a meta
  const projecao = semRitmo ? [] : c.projecao;
  const meses = [...new Set([...c.realizado.map((r) => r.mes), ...projecao.map((p) => p.mes)])].sort();
  const real = new Map(c.realizado.map((r) => [r.mes, r.valor]));
  const proj = new Map(projecao.map((p) => [p.mes, p]));
  return (
    <>
      {!semRitmo && <Legenda itens={[{ cor: 'var(--s1)', rotulo: 'já foi', linha: true }, { cor: 'var(--s1)', rotulo: 'no ritmo real', linha: true, tracejada: true }, { cor: 'var(--s1)', rotulo: 'faixa', leve: 0.3 }]} />}
      <GraficoLinhas xs={meses} rotuloX={(m) => curto(m)} fmt={(v) => brl(v)} fmtEixo={(v) => num(v)} zero rotulosFim={false} aria={`${rotulo}: o que já foi${semRitmo ? '' : ' e a projeção pelo ritmo real'} até ${brl(c.alvo)}`}
        refs={[{ valor: c.alvo, rotulo: `meta ${brl(c.alvo)}` }]}
        faixa={semRitmo ? undefined : { rotulo: 'faixa', cor: 'var(--s1)', lo: meses.map((m) => proj.get(m)?.baixo ?? null), hi: meses.map((m) => proj.get(m)?.alto ?? null) }}
        series={[
          { id: 'real', rotulo: 'já foi', cor: 'var(--s1)', valores: meses.map((m) => real.get(m) ?? null) },
          ...(semRitmo ? [] : [{ id: 'proj', rotulo: 'no ritmo real', cor: 'var(--s1)', tracejada: true, valores: meses.map((m) => proj.get(m)?.base ?? null) }]),
        ]} />
      {semRitmo && <p className="ai-aviso">Sem aporte medido nos meses fechados: sem projeção. A linha do ritmo aparece quando um mês fechar com aporte.</p>}
    </>
  );
}

export function AionMetas({ aion, financeiro, hoje, onSalvar }: PaginaAion & { onSalvar: (m: Record<string, unknown>) => Promise<void> }) {
  const ls = financeiro.lancamentos;
  const hojeMes = hoje.slice(0, 7);
  const pos = useMemo(() => posicoesAion(ls), [ls]);
  const cart = useMemo(() => carteiraPorTipo(pos, null), [pos]);
  const ritmo = useMemo(() => ritmoDeAporte(ls, hojeMes), [ls, hojeMes]);
  const cdi = aion.mercado?.bcb?.cdi?.valor ?? 0;
  const metasArq = aion.metas ? aion.metas : financeiro.orcamento?.metaReserva ? { reserva: financeiro.orcamento.metaReserva, carteira: null, meta3: { nome: '', valor: null } } : null;
  const metas = useMemo(() => metasNoRitmo(cart.reserva, cart.fora, ritmo.ritmo, metasArq, cdi, hojeMes), [cart, ritmo, metasArq, cdi, hojeMes]);
  const pat = useMemo(() => patrimonioPorMes(ls), [ls]);
  const caminhos = useMemo(() => caminhoDasMetas(pat, ritmo, { reserva: metasArq?.reserva || PISO_RESERVA, carteira: metasArq?.carteira || META_CARTEIRA }, { reserva: cart.reserva, fora: cart.fora }, cdi, hojeMes),
    [pat, ritmo, metasArq, cart, cdi, hojeMes]);
  const [editando, setEditando] = useState(false);
  const [v, setV] = useState({ reserva: String(aion.metas?.reserva ?? ''), carteira: String(aion.metas?.carteira ?? ''), nome3: aion.metas?.meta3?.nome || '', valor3: aion.metas?.meta3?.valor != null ? String(aion.metas.meta3.valor) : '' });
  const [msg, setMsg] = useState('');
  const fonte: FonteNumero = { nome: 'razão da Métis (posições e aportes)' };
  return (
    <div className="fg">
      <Cartao id="ritmo" className="largo" titulo="Ritmo real de aporte"
        leitura={ritmo.nMeses ? <>Entrou em reserva e investimento, em média, <b>{brl(ritmo.ritmo)} por mês</b> nos últimos {ritmo.nMeses} {ritmo.nMeses === 1 ? 'mês fechado' : 'meses fechados'} (<Termo id="ritmo">ritmo real</Termo>).{ritmo.mesAtual > 0 ? ` Em ${curto(hojeMes)}, que ainda está andando, já entraram ${brl(ritmo.mesAtual)} (contam quando o mês fechar).` : ''}{ritmo.fraca ? <> <span aria-hidden>⚠ </span>Pouco dado: estimativa fraca, as datas abaixo mudam muito com um mês a mais.</> : ''}</> : 'Sem mês fechado no razão para medir o ritmo.'}
        mais={<>
          <p className="fg-explica">O que conta: reserva paga (Métis, "→ Guarda") e saída para aplicação (categoria investimento ou descrição com "aplicação"). Média dos meses fechados, com os meses sem aporte valendo zero. As datas supõem esse ritmo e o rendimento do CDI de hoje ({pct(cdi)} ao ano) em tudo, na ordem: reserva até o piso, depois a carteira, depois a meta 3. {caminhos.faixa}</p>
          <table className="fg-tabela"><thead><tr><th>mês</th><th className="num">aportado</th></tr></thead><tbody>{ritmo.meses.map((m) => <tr key={m.mes}><td>{curto(m.mes)}</td><td className="num">{num(m.valor)}</td></tr>)}</tbody></table>
        </>}>{null}</Cartao>
      {metas.map((m) => {
        const c = m.id === 'reserva' ? caminhos.reserva : m.id === 'carteira' ? caminhos.carteira : null;
        return (
          <Cartao key={m.id} id={'meta-' + m.id} titulo={m.id === 'meta3' ? `Meta 3 · ${m.nome}` : m.nome}
            leitura={m.alvo === null ? <>{m.explica}</> : m.falta <= 0 ? <>Chegou: {brl(m.atual)} de {brl(m.alvo)}.</>
              : <>Faltam <b>{brl(m.falta)}</b>. {m.chegaEm ? <>No ritmo real, chega em <b>{longo(m.chegaEm)}</b>{c && c.chega.baixo !== c.chega.alto ? <> (faixa: {c.chega.alto ? curto(c.chega.alto) : '?'} a {c.chega.baixo ? curto(c.chega.baixo) : 'depois de 5 anos'})</> : ''}{ritmo.fraca ? ', estimativa fraca' : ''}.</> : ritmo.ritmo > 0 ? 'Depois de 20 anos no ritmo de hoje.' : 'Sem aporte medido: sem data.'}</>}
            mais={<>
              <p className="fg-explica">{m.explica} {c ? caminhos.faixa : ''}</p>
              {c && <table className="fg-tabela"><thead><tr><th>mês</th><th className="num">já foi</th><th className="num">base</th><th className="num">faixa</th></tr></thead>
                <tbody>{[...c.realizado.map((r) => ({ mes: r.mes, real: r.valor, p: undefined as undefined | Caminho['projecao'][number] })), ...c.projecao.map((p) => ({ mes: p.mes, real: undefined as number | undefined, p }))].map((x, i) => <tr key={x.mes + i}><td>{curto(x.mes)}</td><td className="num">{x.real != null ? num(x.real) : '·'}</td><td className="num">{x.p ? num(x.p.base) : '·'}</td><td className="num">{x.p ? `${num(x.p.baixo)} a ${num(x.p.alto)}` : '·'}</td></tr>)}</tbody></table>}
            </>}>
            {m.alvo !== null && (
              <div className="mt-num ai-meta-num" data-meta={m.id}>
                <ComPorque alvo={m.id === 'reserva' ? 'reserva' : 'carteira-fora'} rotulo={m.nome} fonte={fonte} className="ai-pq-num">
                  <b className="mt-num-val">{brl(m.atual)} <span className="muted ai-de">de {brl(m.alvo)}</span></b>
                </ComPorque>
                <Medidor valor={m.atual} alvo={m.alvo} rotulo={`${m.nome}: quanto já tem`} />
              </div>
            )}
            {c && m.falta > 0 && <><GraficoCaminho c={c} rotulo={m.nome} semRitmo={ritmo.ritmo <= 0} /><Aviso texto={avisoPoucoDado(c.realizado.length)} /></>}
            <p className="ai-termos">O que quer dizer: <Termo id={m.id === 'reserva' ? 'piso' : m.id === 'carteira' ? 'fora-da-reserva' : 'meta'} /></p>
          </Cartao>
        );
      })}
      <Cartao id="metas-valores" className="largo" titulo="Valores das metas"
        leitura={aion.metas ? <>Definidos por você em {aion.metas.rel ? 'aion-metas.md' : 'o arquivo de metas'}.</> : <>Valendo o padrão: reserva {brl(PISO_RESERVA)} e carteira {brl(META_CARTEIRA)}; a meta 3 sem valor.</>}>
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
  const eco = useMemo(() => serieEconomia(m), [m]);
  if (!m) return <SemMercado />;
  const IND: [string, IdTermo, string, (v: number | undefined) => string][] = [
    ['IPCA', 'ipca', 'IPCA (%)', (v) => pct(v)], ['Selic', 'selic', 'Selic no fim do ano (%)', (v) => pct(v)], ['PIB Total', 'pib', 'PIB (%)', (v) => pct(v)], ['Câmbio', 'dolar', 'Dólar no fim do ano (R$)', (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))],
  ];
  // small multiples: um gráfico por série, todos na MESMA escala (os três em % ao ano), nunca dois eixos num gráfico
  const todosEco = eco.flatMap((s) => s.pontos.map((x) => x.valor));
  const domEco = todosEco.length ? Math.max(...todosEco) : 1;
  // o mesmo eixo x nos três (os mesmos meses): série que começa depois fica sem ponto no começo
  const mesesEco = [...new Set(eco.flatMap((s) => s.pontos.map((x) => x.data.slice(0, 7))))].sort();
  const desdeEco = mesesEco[0] || '';
  const hist = f?.historico;
  const fonteSelic: FonteNumero = { nome: b?.selicMeta?.fonte || 'Banco Central', url: b?.selicMeta?.url, data: b?.selicMeta?.data };
  return (
    <>
      <div className="mt-numeros">
        <NumeroAion id="selic" termo="selic" rotulo="Selic meta" alvo="selic" fonte={fonteSelic} valor={pct(b?.selicMeta?.valor)} sub={<FonteData fonte={b?.selicMeta?.fonte} data={b?.selicMeta?.data} />} />
        <NumeroAion id="cdi" termo="cdi" rotulo="CDI ao ano" alvo="cdi" fonte={{ nome: b?.cdi?.fonte || 'Banco Central', url: b?.cdi?.url, data: b?.cdi?.data }} valor={pct(b?.cdi?.valor)} sub={<FonteData fonte={b?.cdi?.fonte} data={b?.cdi?.data} />} />
        <NumeroAion id="ipca" termo="ipca" rotulo="IPCA em 12 meses" alvo="ipca" fonte={{ nome: b?.ipca?.fonte || 'IBGE', url: b?.ipca?.url, data: b?.ipca?.ultimo?.data }} valor={pct(b?.ipca?.doze)} sub={<>{b?.ipca?.ultimo ? `${curto(b.ipca.ultimo.data.slice(0, 7))}: ${pct(b.ipca.ultimo.valor)} no mês · ` : ''}<FonteData fonte={b?.ipca?.fonte} /></>} />
        <NumeroAion id="dolar" termo="dolar" rotulo="Dólar" alvo="dolar" fonte={{ nome: b?.dolar?.fonte || 'Banco Central', url: b?.dolar?.url, data: b?.dolar?.data }} valor={b?.dolar?.valor != null ? brl(b.dolar.valor) : '—'} sub={<FonteData fonte={b?.dolar?.fonte} data={b?.dolar?.data} />} />
      </div>
      <div className="fg">
        <Cartao id="juros-inflacao" className="largo" titulo="Selic, CDI e IPCA nos últimos anos"
          leitura={eco.length ? <>Desde {mesAno(desdeEco)}, em % ao ano. Hoje: {eco.map((s, i) => <span key={s.id}>{i ? ', ' : ''}<Termo id={s.id}>{s.rotulo}</Termo> {pct(s.pontos[s.pontos.length - 1].valor)}</span>)}. A distância entre a Selic e o IPCA é o <Termo id="juro-real">juro real</Termo>.</> : 'Sem série histórica no cache: rode a coleta.'}
          mais={<>
            <p className="fg-explica">Um gráfico por indicador, os três na mesma escala (nunca dois eixos num gráfico só). Selic meta: o valor no fim de cada mês (SGS 432). CDI e IPCA: acumulados em 12 meses, mês a mês, a partir das séries mensais do BC (4391 e 433); por isso começam um ano depois do primeiro dado.</p>
            <div className="mt-rolagem"><table className="fg-tabela"><thead><tr><th>mês</th>{eco.map((s) => <th key={s.id} className="num">{s.rotulo}</th>)}</tr></thead>
              <tbody>{[...new Set(eco.flatMap((s) => s.pontos.map((x) => x.data.slice(0, 7))))].sort().reverse().map((mes) => <tr key={mes}><td>{curto(mes)}</td>{eco.map((s) => { const x = s.pontos.find((q) => q.data.startsWith(mes)); return <td key={s.id} className="num">{x ? pct(x.valor) : '·'}</td>; })}</tr>)}</tbody></table></div>
          </>}>
          <div className="ai-multiplos">
            {eco.map((s) => (
              <div key={s.id} className="ai-multiplo" data-serie-eco={s.id}>
                <h4 className="ai-multiplo-tit"><Termo id={s.id}>{s.rotulo}</Termo> <span className="muted">{s.unidade}</span></h4>
                <GraficoLinhas xs={mesesEco} rotuloX={(mes) => curto(mes)} fmt={pct1} fmtEixo={(v) => `${Math.round(v)}%`} zero altura={180}
                  aria={`${s.rotulo}, ${s.unidade}, de ${mesAno(s.pontos[0].data)} a ${mesAno(s.pontos[s.pontos.length - 1].data)}`}
                  series={[{ id: s.id, rotulo: s.rotulo, cor: 'var(--s1)', valores: (() => { const mp = new Map(s.pontos.map((x) => [x.data.slice(0, 7), x.valor])); return mesesEco.map((mes) => mp.get(mes) ?? null); })() }]} dominioMax={domEco} />
                <p className="ai-fonte">{s.fonte.nome}</p>
              </div>
            ))}
          </div>
        </Cartao>
        <Cartao id="copom" titulo="Copom"
          leitura={ult ? <>Última decisão ({ult.numero}ª reunião, {br(ult.data)}): <b>{ult.titulo}</b>. {p?.numero ? <>Próxima: {p.numero}ª{p.dias ? <>, <b>{p.dias}</b></> : ' (data não cadastrada)'}{p.decisao === hoje ? ': a decisão sai hoje, no fim do dia (entra na próxima coleta)' : p.decisao && p.decisao < hoje ? ': a decisão já saiu, rode a coleta' : ''}.</> : ''}</> : 'Sem comunicado do Copom no cache.'}
          mais={<>
            {ult?.trecho && <p className="fg-explica">Nas palavras do Copom: “{ult.trecho}”</p>}
            {p?.fonteData && <p className="fg-explica">Data da próxima: {p.fonteData}. O BC não tem API do calendário; confira em <a href="https://www.bcb.gov.br/publicacoes/calendarioreunioescopom" target="_blank" rel="noreferrer noopener">bcb.gov.br</a>.</p>}
            {f?.selicPorReuniao?.length ? <table className="fg-tabela"><thead><tr><th>reunião</th><th className="num">Selic esperada (Focus)</th></tr></thead><tbody>{f.selicPorReuniao.map((r) => <tr key={r.reuniao}><td>{r.reuniao}</td><td className="num">{pct(r.mediana)}</td></tr>)}</tbody></table> : null}
            <p className="ai-fonte">{m.copom?.fonte}</p>
          </>}>
          <ComPorque alvo="copom" rotulo="Decisão do Copom" fonte={{ nome: m.copom?.fonte || 'Banco Central', url: m.copom?.url, data: ult?.data }} className="ai-bloco-alvo"><span className="ai-dica-txt">Por que o Copom decidiu assim →</span></ComPorque>
          <p className="ai-termos">O que é: <Termo id="copom" /> · <Termo id="meta-inflacao" /></p>
        </Cartao>
        <Cartao id="focus" titulo={f?.data ? `Focus de ${br(f.data)}` : 'Focus'}
          leitura={f?.data ? <><Termo id="mediana">Mediana</Termo> do mercado: IPCA <b>{pct(f.medianas.IPCA?.[ano])}</b> em {ano} e {pct(f.medianas.IPCA?.[prox])} em {prox}; Selic <b>{pct(f.medianas.Selic?.[ano])}</b> no fim de {ano}. É estimativa de quem responde ao BC, não previsão do Aion.</> : 'Sem Focus no cache.'}
          mais={<p className="ai-fonte">{f?.fonte} · base: todos os respondentes</p>}>
          {f?.data && (
            <table className="fg-tabela ai-focus"><thead><tr><th>indicador</th><th className="num">{ano}</th><th className="num">{prox}</th></tr></thead>
              <tbody>{IND.map(([k, t, r, fmt]) => <tr key={k}><td><Termo id={t}>{r}</Termo></td><td className="num"><ComPorque alvo="focus" rotulo={`Focus: ${r} em ${ano}`} fonte={{ nome: f.fonte, url: f.url, data: f.data }} className="ai-pq-num">{fmt(f.medianas[k]?.[ano])}</ComPorque></td><td className="num">{fmt(f.medianas[k]?.[prox])}</td></tr>)}</tbody></table>
          )}
          <p className="ai-termos">O que é: <Termo id="focus" /></p>
        </Cartao>
        <Cartao id="focus-semanas" className="largo" titulo="Focus semana a semana"
          leitura={hist && Object.keys(hist.porIndicador).length ? <>Como a <Termo id="mediana">mediana</Termo> do mercado mudou desde {br(hist.desde)}: {(['IPCA', 'Selic'] as const).filter((k) => hist.porIndicador[k]?.[ano]?.length).map((k, i) => { const s = hist.porIndicador[k][ano]; return <span key={k}>{i ? '; ' : ''}{k} de {ano} foi de {pct(s[0].mediana)} para <b>{pct(s[s.length - 1].mediana)}</b></span>; })}.</> : 'Sem o histórico do Focus no cache: rode a coleta (o coletor busca as medianas semana a semana).'}
          mais={hist ? <>
            <p className="fg-explica">Um ponto por semana: o último valor publicado na semana (o Focus sai às segundas com o dado da sexta). Base: todos os respondentes. Fonte: {f?.fonte}.</p>
            <div className="mt-rolagem"><table className="fg-tabela"><thead><tr><th>semana</th>{(['IPCA', 'Selic'] as const).flatMap((k) => hist.anos.map((a) => <th key={k + a} className="num">{k} {a}</th>))}</tr></thead>
              <tbody>{[...new Set(Object.values(hist.porIndicador).flatMap((x) => Object.values(x).flatMap((s) => s.map((q) => q.data))))].sort().reverse().map((d) => <tr key={d}><td>{br(d)}</td>{(['IPCA', 'Selic'] as const).flatMap((k) => hist.anos.map((a) => { const q = hist.porIndicador[k]?.[a]?.find((z) => z.data === d); return <td key={k + a} className="num">{q ? pct(q.mediana) : '·'}</td>; }))}</tr>)}</tbody></table></div>
          </> : undefined}>
          {hist && (
            <div className="ai-multiplos dois">
              {(['IPCA', 'Selic'] as const).filter((k) => hist.porIndicador[k]).map((k) => {
                const datas = [...new Set(hist.anos.flatMap((a) => (hist.porIndicador[k][a] || []).map((q) => q.data)))].sort();
                const serie = (a: string) => { const mp = new Map((hist.porIndicador[k][a] || []).map((q) => [q.data, q.mediana])); return datas.map((d) => mp.get(d) ?? null); };
                return (
                  <div key={k} className="ai-multiplo" data-focus={k}>
                    <h4 className="ai-multiplo-tit"><Termo id={k === 'IPCA' ? 'ipca' : 'selic'}>{k === 'IPCA' ? 'IPCA esperado' : 'Selic esperada no fim do ano'}</Termo> <span className="muted">mediana, % ao ano</span></h4>
                    <Legenda itens={hist.anos.map((a, i) => ({ cor: i ? 'var(--s2)' : 'var(--s1)', rotulo: a, linha: true }))} />
                    <GraficoLinhas xs={datas} rotuloX={(d) => mesAno(d)} tituloDica={(d) => `semana de ${br(d)}`} fmt={(v) => pct(v)} fmtEixo={(v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} altura={200}
                      aria={`${k} esperado pelo Focus, semana a semana, para ${hist.anos.join(' e ')}`}
                      series={hist.anos.map((a, i) => ({ id: a, rotulo: a, cor: i ? 'var(--s2)' : 'var(--s1)', valores: serie(a) }))} />
                    <Aviso texto={avisoPoucoDado(datas.length, 'semana')} />
                  </div>
                );
              })}
            </div>
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
        leitura={<>A <Termo id="regra">regra</Termo> é a sua política de investimento: quanto em cada tipo, quando aportar, quando mexer e o que não fazer, escrita antes do fato. Ela vem no fim da trilha (bloco 11), depois de estudar o resto. Com ela escrita, a Carteira mostra o desvio; quem decide é você.</>}>
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
        leitura={<>Escrita em {br(r.escritaEm)}{r.revisarEm ? `, revisar em ${curto(r.revisarEm)}` : ''}. Reserva mínima (<Termo id="piso">piso</Termo>): <b>{brl(r.reservaMinima || PISO_RESERVA)}</b>.</>}>
        <table className="fg-tabela ai-regra-tab">
          <thead><tr><th>tipo (fora da reserva)</th><th className="num"><Termo id="alocacao-alvo">alvo</Termo></th><th className="num">faixa</th></tr></thead>
          <tbody>{TIPOS_REGRA.filter((t) => r.alocacao[t]).map((t) => <tr key={t}><td><Termo id={TERMO_DO_TIPO[t]}>{ROTULO_TIPO[t]}</Termo></td><td className="num">{pct(r.alocacao[t]!.alvo, 0)}</td><td className="num">{pct(Math.max(0, r.alocacao[t]!.alvo - r.alocacao[t]!.tolerancia), 0)} a {pct(Math.min(100, r.alocacao[t]!.alvo + r.alocacao[t]!.tolerancia), 0)}</td></tr>)}</tbody>
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
        leitura={<>Os campos nascem vazios: o valor é decisão sua. A <Termo id="alocacao-alvo">alocação</Termo> é em % da carteira <b>fora</b> da reserva e precisa somar 100%. Soma agora: <b>{pct(soma, 0)}</b>.</>}>
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
export type TelaAion = (typeof TELAS_AION)[number]['tela'] | 'ativo';
export { BLOCO_DO_TIPO, TIPOS, ROTULO_PORQUE, verbete };
