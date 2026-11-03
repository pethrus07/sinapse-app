// Análises da Métis (o módulo financeiro): gastos por categoria, recorrente × pontual,
// patrimônio, clientes e a fila "a classificar". Lógica em src/lib/financeiroAnalise.ts.
// Mesma régua dos outros cartões: uma frase de leitura, pouca coisa à vista, o detalhe em
// "Mais opções". Cor por papel: gasto = cor de "sai"; pontual = o mesmo tom, fraco; média =
// traço da cor do texto; patrimônio por grupo = paleta categórica em ordem fixa (GRUPOS).
import { useMemo, useState } from 'react';
import { scaleBand, scaleLinear } from 'd3';
import type { Lancamento } from '../types';
import { brl, rotuloCategoria } from '../lib/financeiro';
import {
  A_CLASSIFICAR, GRUPOS, lancamentosDaCategoria,
  type ClienteResumo, type GastosPorCategoria, type Patrimonio, type RecorrenteMes, type RendaRecorrente,
} from '../lib/financeiroAnalise';
import { Cartao, colunaPath, COR, curto, Dica, EixoY, Legenda, LEVE, fracoCss, M, num, SLOTS, useDica, useLargura } from './FinanceiroGraficos';

const br = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const diaMes = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
const MAX_LINHAS = 8;

/* ------------------------------------------------------------ seletor de mês */

export function SeletorMes({ meses, foco, parciais, onFoco }: { meses: string[]; foco: string; parciais: string[]; onFoco: (m: string) => void }) {
  return (
    <div className="mt-meses" role="tablist" aria-label="Mês das análises">
      {meses.map((m) => (
        <button key={m} role="tab" aria-selected={m === foco} className={'mt-mes' + (m === foco ? ' on' : '')} onClick={() => onFoco(m)}
          title={parciais.includes(m) ? 'mês incompleto: fica fora da média' : undefined}>
          {curto(m)}{parciais.includes(m) && <span className="mt-parcial" aria-label="incompleto">·</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------ gastos por categoria */

export function GastosCategoria({ g, ls }: { g: GastosPorCategoria; ls: Lancamento[] }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const iFoco = g.meses.indexOf(g.foco);
  const linhas = g.linhas.filter((l) => l.atual > 0 || (l.media || 0) > 0);
  const visiveis = linhas.slice(0, MAX_LINHAS);
  const max = Math.max(1, ...visiveis.map((l) => Math.max(l.atual, l.media || 0)));
  const total = g.totais[iFoco] || 0;
  const fugiu = linhas.filter((l) => l.desvio === 'acima' || l.desvio === 'nova');
  const semMedia = linhas.every((l) => l.media === null);
  const itens = aberta ? lancamentosDaCategoria(ls, aberta, g.foco) : [];
  const parcial = g.parciais.includes(g.foco);
  return (
    <Cartao id="gastos" className="largo" titulo="Gastos por categoria"
      leitura={!linhas.length ? `Nenhum gasto registrado em ${curto(g.foco)}.` : <>
        Em {curto(g.foco)}{parcial ? ' (até agora)' : ''} saíram <b>{brl(total)}</b>.{' '}
        {semMedia ? 'A média precisa de 3 meses completos com o banco ligado: ainda não há.'
          : fugiu.length ? <>Fugiu da média: <b>{fugiu.slice(0, 2).map((l) => rotuloCategoria(l.categoria)).join(' e ')}</b>{fugiu.length > 2 ? ` e mais ${fugiu.length - 2}` : ''}.</>
          : 'Nada fugiu da média.'}
      </>}
      mais={
        <>
          <p className="fg-explica">Gasto = saída paga, no mês em que o dinheiro saiu, mais a compra no cartão no mês da compra (a fatura paga não entra, senão contaria duas vezes). Média = os {g.linhas[0]?.baseMedia || 3} meses completos antes de {curto(g.foco)}, sem os gastos marcados como pontuais. Destaque quando a diferença passa de R$ 50 e de 30% da média. Mês com ponto (·) é incompleto e fica fora da média.</p>
          <table className="fg-tabela">
            <thead><tr><th>categoria</th>{g.meses.map((m) => <th key={m} className="num">{curto(m)}{g.parciais.includes(m) ? '·' : ''}</th>)}<th className="num">média</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.categoria}><td>{rotuloCategoria(l.categoria)}</td>{l.valores.map((v, i) => <td key={i} className="num">{v ? num(v) : '·'}</td>)}<td className="num">{l.media === null ? '—' : num(l.media)}</td></tr>
              ))}
              <tr className="forte"><td>total</td>{g.totais.map((v, i) => <td key={i} className="num">{num(v)}</td>)}<td /></tr>
            </tbody>
          </table>
        </>
      }>
      {linhas.length > 0 && (
        <>
          <Legenda itens={[
            { cor: COR.sai, rotulo: 'gasto' }, { cor: COR.sai, rotulo: 'pontual', leve: LEVE },
            ...(semMedia ? [] : [{ cor: 'var(--ink)', rotulo: 'média de 3 meses', linha: true }]),
          ]} />
          <ul className="mt-cats" aria-label={`Gastos por categoria em ${curto(g.foco)}`}>
            {visiveis.map((l) => {
              const pontual = l.atual - l.atualRecorrente;
              const aberto = aberta === l.categoria;
              const delta = l.media !== null ? l.atualRecorrente - l.media : 0;
              return (
                <li key={l.categoria} className={aberto ? 'aberta' : ''}>
                  <button className="mt-cat" aria-expanded={aberto} onClick={() => setAberta(aberto ? null : l.categoria)}
                    title={`${rotuloCategoria(l.categoria)}: ${brl(l.atual)}${pontual ? ` (${brl(pontual)} pontual)` : ''}${l.media !== null ? ` · média ${brl(l.media)}` : ''}`}>
                    <span className="mt-cat-nome">{rotuloCategoria(l.categoria)}</span>
                    <span className="mt-cat-val">
                      <b>{brl(l.atual)}</b>
                      {l.desvio === 'acima' && <span className="mt-desvio acima">▲ {brl(delta)} acima da média</span>}
                      {l.desvio === 'abaixo' && <span className="mt-desvio">▼ {brl(-delta)} abaixo</span>}
                      {l.desvio === 'nova' && <span className="mt-desvio acima">● nova</span>}
                    </span>
                    <span className="mt-cat-trilho" aria-hidden>
                      <span className="mt-cat-barra" style={{ width: `${(l.atualRecorrente / max) * 100}%` }} />
                      {pontual > 0 && <span className="mt-cat-barra pontual" style={{ width: `${(pontual / max) * 100}%`, ...fracoCss(COR.sai) }} />}
                      {l.media !== null && l.media > 0 && <span className="mt-cat-media" style={{ left: `${(l.media / max) * 100}%` }} />}
                    </span>
                  </button>
                  {aberto && (
                    <table className="fg-tabela mt-cat-itens">
                      <tbody>
                        {itens.map((x) => (
                          <tr key={x.id}><td>{diaMes(x.liquidadoEm || x.vencimento)}</td><td className="mt-quebra">{x.descricao}{x.pontual ? ' · pontual' : ''}{x.viaCartao ? ' · cartão' : ''}</td><td className="num">{num(Number(x.valor))}</td></tr>
                        ))}
                        {!itens.length && <tr><td className="muted">Nada neste mês.</td></tr>}
                      </tbody>
                    </table>
                  )}
                </li>
              );
            })}
          </ul>
          {linhas.length > MAX_LINHAS && <p className="fg-explica">E mais {linhas.length - MAX_LINHAS} categorias menores em "Mais opções".</p>}
        </>
      )}
    </Cartao>
  );
}

/* ------------------------------------------------------ recorrente × pontual */

function RendaNoTempo({ renda }: { renda: RendaRecorrente }) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  const H = 170;
  const y = scaleLinear().domain([0, Math.max(1, renda.gastoBase, ...renda.entradas)]).nice(3).range([H - M.bottom, M.top]);
  const x = scaleBand().domain(renda.meses).range([M.left, Math.max(w - M.right, M.left + 1)]).paddingInner(0.3).paddingOuter(0.1);
  const bw = Math.min(24, x.bandwidth());
  return (
    <div ref={ref} className="fg-plot" onPointerLeave={esconder}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={`Renda que se repete por mês${renda.caiEm ? `, cai em ${curto(renda.caiEm)}` : ''}`}>
          <EixoY y={y} largura={w} ticks={3} />
          {renda.meses.map((m, i) => {
            const v = renda.entradas[i];
            const bx = (x(m) || 0) + (x.bandwidth() - bw) / 2;
            const info = { titulo: curto(m), linhas: [
              { cor: COR.entra, rotulo: 'renda que se repete', valor: brl(v) },
              { rotulo: 'sobra sobre o gasto de referência', valor: brl(renda.sobra[i]) },
            ] };
            const rotular = i === 0 || m === renda.caiEm;
            return (
              <g key={m} className="fg-hit" tabIndex={0} aria-label={`${curto(m)}: ${brl(v)}`}
                onPointerMove={(e) => mostrar(e, null, info)} onFocus={(e) => mostrar(null, e.currentTarget, info)} onBlur={esconder}>
                <rect x={x(m)} y={M.top} width={x.bandwidth()} height={H - M.top - M.bottom} fill="transparent" />
                <path d={colunaPath(bx, y(v), bw, y(0) - y(v))} fill={COR.entra} />
                {rotular && <text className="fg-rot" x={bx + bw / 2} y={y(v) - 6} textAnchor="middle">{num(v)}</text>}
                <text className={'fg-xtick' + (i === 0 ? ' hoje' : '')} x={(x(m) || 0) + x.bandwidth() / 2} y={H - 8} textAnchor="middle">{w < 520 && i % 2 && m !== renda.caiEm ? '' : curto(m)}</text>
              </g>
            );
          })}
          {renda.gastoBase > 0 && <g className="fg-ref" pointerEvents="none"><line x1={M.left} x2={w - M.right} y1={y(renda.gastoBase)} y2={y(renda.gastoBase)} /></g>}
        </svg>
      )}
      <Dica d={d} largura={w} />
    </div>
  );
}

export function Recorrente({ r, renda, parcial }: { r: RecorrenteMes; renda: RendaRecorrente; parcial: boolean }) {
  const positivo = r.sobraRecorrente >= 0;
  const sobraDepois = renda.caiEm ? renda.sobra[renda.meses.indexOf(renda.caiEm)] : null;
  return (
    <Cartao id="recorrente" className="largo" titulo="Renda que se repete: até quando"
      leitura={renda.caiEm
        ? <>A renda que se repete é de <b>{brl(renda.antes)}</b> por mês e se sustenta até <b>{curto(renda.ateQuando)}</b>. Em {curto(renda.caiEm)} cai para <b>{brl(renda.depois)}</b>{sobraDepois !== null && renda.gastoBase > 0 ? <>: contra um gasto que se repete de {brl(renda.gastoBase)}, a sobra vai de {brl(renda.sobra[0])} para <b>{brl(sobraDepois)}</b></> : ''}.</>
        : <>A renda que se repete é de <b>{brl(renda.antes)}</b> por mês e não cai até {curto(renda.meses[renda.meses.length - 1] || '')}.</>}
      mais={
        <>
          <p className="fg-explica">Renda que se repete: o que está marcado para repetir todo mês (salário, mensalidade, acordo mensal), e contrato pago em parcelas mensais enquanto as parcelas durarem. Projeto e entrega única ficam de fora. No último mês, depois do que está lançado, sobra só o que não tem data de fim. Gasto que se repete: tudo, menos o que foi marcado como pontual (empréstimo, compra grande que não volta); a referência é a média dos meses completos ({renda.baseMeses.map(curto).join(', ') || 'nenhum ainda'}).</p>
          <table className="fg-tabela">
            <thead><tr><th>mês</th><th className="num">renda que se repete</th><th className="num">sobra</th></tr></thead>
            <tbody>{renda.meses.map((m, i) => <tr key={m} className={i === 0 ? 'hoje' : ''}><td>{curto(m)}</td><td className="num">{num(renda.entradas[i])}</td><td className="num">{num(renda.sobra[i])}</td></tr>)}</tbody>
          </table>
          {r.pontuais.length > 0 && (
            <table className="fg-tabela">
              <thead><tr><th>pontual em {curto(r.mes)}</th><th className="num">R$</th></tr></thead>
              <tbody>{r.pontuais.map((p, i) => <tr key={i}><td>{p.descricao}</td><td className="num">{num(p.valor)}</td></tr>)}</tbody>
            </table>
          )}
        </>
      }>
      <div className="fg-numeros mt-recorrente">
        <div><span className="fg-num-rot">Gasto que se repete · {curto(r.mes)}{parcial ? ' até agora' : ''}</span><b>{brl(r.gastoRecorrente)}</b></div>
        <div><span className="fg-num-rot">Pontual · {curto(r.mes)}</span><b className="mt-fraco">{brl(r.pontual)}</b></div>
        <div><span className="fg-num-rot">Sobra · {curto(r.mes)}</span><b className={positivo ? '' : 'mt-negativo'}>{positivo ? '' : '⚠ '}{brl(r.sobraRecorrente)}</b></div>
      </div>
      <Legenda itens={[{ cor: COR.entra, rotulo: 'renda que se repete' }, { cor: 'var(--ink)', rotulo: `gasto que se repete ${num(renda.gastoBase)}`, linha: true }]} />
      <RendaNoTempo renda={renda} />
    </Cartao>
  );
}

/* ----------------------------------------------------------------- patrimônio */

function Evolucao({ p }: { p: Patrimonio }) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  const H = 120, ml = 8, mr = 8, mt = 10, mb = 22;
  const s = p.serie;
  if (s.length < 2) return <p className="fg-explica">A evolução começa a ser desenhada a partir do segundo dia de sincronização ({s.length} retrato até agora).</p>;
  const t0 = Date.parse(s[0].data), t1 = Date.parse(s[s.length - 1].data);
  const x = (dt: string) => ml + ((Date.parse(dt) - t0) / Math.max(1, t1 - t0)) * Math.max(1, w - ml - mr);
  const y = scaleLinear().domain([0, Math.max(p.piso, ...s.map((r) => r.total))]).nice(3).range([H - mb, mt]);
  const linha = (k: 'total' | 'diaria') => s.map((r, i) => `${i ? 'L' : 'M'}${x(r.data)},${y(r[k])}`).join('');
  return (
    <div ref={ref} className="fg-plot" onPointerLeave={esconder}
      onPointerMove={(e) => {
        const b = ref.current?.getBoundingClientRect();
        if (!b) return;
        const px = e.clientX - b.left;
        const r = s.reduce((a, c) => (Math.abs(x(c.data) - px) < Math.abs(x(a.data) - px) ? c : a), s[0]);
        mostrar({ clientX: b.left + x(r.data), clientY: b.top + y(r.total) }, null, { titulo: br(r.data), linhas: [
          { cor: 'var(--ink)', rotulo: 'total', valor: brl(r.total) }, { cor: 'var(--soft)', rotulo: 'liquidez diária', valor: brl(r.diaria) },
        ] });
      }}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={`Patrimônio de ${br(s[0].data)} a ${br(s[s.length - 1].data)}`}>
          <g className="fg-ref piso"><line x1={ml} x2={w - mr} y1={y(p.piso)} y2={y(p.piso)} /><text x={ml + 2} y={y(p.piso) - 5}>piso</text></g>
          {/* cores neutras: as categóricas já são dos grupos, logo acima */}
          <path d={linha('total')} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d={linha('diaria')} fill="none" stroke="var(--soft)" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
          <text className="fg-xtick" x={ml} y={H - 6}>{diaMes(s[0].data)}</text>
          <text className="fg-xtick" x={w - mr} y={H - 6} textAnchor="end">{diaMes(s[s.length - 1].data)}</text>
        </svg>
      )}
      <Dica d={d} largura={w} />
    </div>
  );
}

export function PatrimonioCard({ p }: { p: Patrimonio }) {
  const vazio = !p.atuais.length;
  const pct = Math.min(100, (p.reservaLiquida / p.piso) * 100);
  const corGrupo = (g: string) => SLOTS[Math.max(0, GRUPOS.indexOf(g as (typeof GRUPOS)[number]))];
  return (
    <Cartao id="patrimonio" titulo="Patrimônio"
      leitura={vazio
        ? 'Nenhuma posição ainda. A sincronização do banco preenche; cripto e o que não vem pelo Open Finance entram à mão em Lançamentos (= Saldo).'
        : <><b>{brl(p.total)}</b> aplicados. Reserva líquida de <b>{brl(p.reservaLiquida)}</b>: {p.falta > 0 ? <>faltam <b>{brl(p.falta)}</b> para o piso de {brl(p.piso)}.</> : <>acima do piso de {brl(p.piso)}.</>}</>}
      mais={!vazio && (
        <>
          <p className="fg-explica">Reserva líquida = só o que sai no mesmo dia (liquidez diária). FII e ação vendem na bolsa e o dinheiro cai em dois dias úteis; cripto entra à mão. A evolução guarda um retrato por dia de sincronização.</p>
          <table className="fg-tabela">
            <thead><tr><th>grupo</th><th>onde</th><th>o quê</th><th>data</th><th className="num">saldo</th></tr></thead>
            <tbody>{p.atuais.map((a) => <tr key={a.chave}><td>{a.grupo}</td><td>{a.instituicao}</td><td>{a.descricao}{a.manual ? ' · à mão' : ''}</td><td>{br(a.data)}</td><td className="num">{num(a.valor)}</td></tr>)}</tbody>
          </table>
        </>
      )}>
      {!vazio && (
        <>
          <div className={'mt-reserva' + (p.falta > 0 ? ' abaixo' : '')}>
            <div className="mt-reserva-topo"><span className="fg-num-rot">Reserva líquida × piso</span><span className="mt-reserva-num"><b>{brl(p.reservaLiquida)}</b> <span className="muted">de {brl(p.piso)}</span></span></div>
            <div className="mt-reserva-trilho" role="meter" aria-valuemin={0} aria-valuemax={p.piso} aria-valuenow={p.reservaLiquida} aria-label="Reserva líquida em relação ao piso">
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="mt-pilha" aria-hidden>
            {p.porGrupo.map((g) => <span key={g.grupo} style={{ flexGrow: g.valor, background: corGrupo(g.grupo) }} title={`${g.grupo}: ${brl(g.valor)}`} />)}
          </div>
          <Legenda itens={p.porGrupo.map((g) => ({ cor: corGrupo(g.grupo), rotulo: `${g.grupo} ${num(g.valor)}` }))} />
          {p.serie.length >= 2 && <Legenda itens={[{ cor: 'var(--ink)', rotulo: 'total no tempo', linha: true }, { cor: 'var(--soft)', rotulo: 'liquidez diária', linha: true, tracejada: true }]} />}
          <Evolucao p={p} />
        </>
      )}
    </Cartao>
  );
}

/* --------------------------------------------- clientes: realizado × previsto */

export function Clientes({ c, hojeMes }: { c: ClienteResumo[]; hojeMes: string }) {
  const visiveis = c.filter((x) => x.recebido + x.falta > 0);
  if (!visiveis.length) return null;
  const max = Math.max(1, ...visiveis.map((x) => x.recebido + x.falta));
  const vencidos = visiveis.filter((x) => x.vencido > 0);
  const recebido = visiveis.reduce((s, x) => s + x.recebido, 0);
  const falta = visiveis.reduce((s, x) => s + x.falta, 0);
  return (
    <Cartao id="clientes" className="largo" titulo="Fontes de renda: recebido × o que falta"
      leitura={<>Recebido <b>{brl(recebido)}</b> até hoje; faltam <b>{brl(falta)}</b> até o fim do que está combinado.{vencidos.length ? <> <span aria-hidden>⚠ </span>{vencidos.length} com valor vencido.</> : ' Ninguém com valor vencido.'}</>}
      mais={
        <>
          <p className="fg-explica">Atraso = dias entre o vencimento e o dia em que o dinheiro entrou (pelo banco, quando conciliado). "Falta" soma o que está aberto daqui até o último mês lançado; o que não tem prazo fica fora. Fonte "sem fim" (salário) segue depois disso: o fim mostrado é só o da projeção.</p>
          <table className="fg-tabela">
            <thead><tr><th>cliente</th><th>o quê</th><th>venceu</th><th>pago em</th><th className="num">dias</th><th className="num">R$</th></tr></thead>
            <tbody>{visiveis.flatMap((x) => x.pagamentos.map((pg, k) => (
              <tr key={x.cliente + k}><td>{k === 0 ? x.cliente : ''}</td><td className="mt-quebra">{pg.descricao}</td><td>{br(pg.vencimento)}</td><td>{br(pg.pagoEm)}</td><td className="num">{pg.atraso || '·'}</td><td className="num">{num(pg.valor)}</td></tr>
            )))}</tbody>
          </table>
        </>
      }>
      <Legenda itens={[{ cor: COR.entra, rotulo: 'recebido' }, { cor: COR.entra, rotulo: 'falta', leve: LEVE }]} />
      <ul className="fg-barras" aria-label="Recebido e o que falta por fonte de renda">
        {visiveis.map((x) => {
          const ultimo = x.pagamentos[0];
          const estado = x.vencido > 0 ? `⚠ vencido há ${x.diasVencido} ${x.diasVencido === 1 ? 'dia' : 'dias'}`
            : x.atrasoMedio > 0 ? `paga com ${x.atrasoMedio} ${x.atrasoMedio === 1 ? 'dia' : 'dias'} de atraso` : 'em dia';
          return (
            <li key={x.cliente} tabIndex={0} title={`${x.cliente}: recebido ${brl(x.recebido)}${ultimo ? `, último em ${br(ultimo.pagoEm)}` : ''}; falta ${brl(x.falta)}${x.semFim ? ' (sem fim)' : x.fim ? ` até ${curto(x.fim)}` : ''}`}>
              <span className="fg-barra-nome">{x.cliente}</span>
              <span className="fg-barra-val"><b>{brl(x.recebido)}</b> <span className="muted">{x.falta > 0 ? `+ ${brl(x.falta)} ${x.semFim ? 'lançados · sem fim' : `até ${curto(x.fim || hojeMes)}`}` : 'nada aberto'} · </span><span className={x.vencido > 0 ? 'mt-vencido' : 'muted'}>{estado}</span></span>
              <span className="fg-barra-trilho mt-duplo">
                <span className="fg-barra" style={{ width: `${(x.recebido / max) * 100}%`, background: COR.entra }} />
                {x.falta > 0 && <span className="fg-barra" style={{ width: `${(x.falta / max) * 100}%`, ...fracoCss(COR.entra) }} />}
              </span>
            </li>
          );
        })}
      </ul>
    </Cartao>
  );
}

/* -------------------------------------------------------- fila a classificar */

export function FilaClassificar({ ls, categorias, onClassificar }: {
  ls: Lancamento[];
  categorias: string[];
  onClassificar: (mes: string, id: string, categoria: string, lembrar: boolean) => Promise<{ lembrou: boolean; motivo?: string } | null>;
}) {
  const fila = useMemo(() => ls.filter((l) => (l.categoria || '') === A_CLASSIFICAR).sort((a, b) => String(b.liquidadoEm || b.vencimento).localeCompare(String(a.liquidadoEm || a.vencimento))), [ls]);
  const [lembrar, setLembrar] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [livre, setLivre] = useState('');
  const [msg, setMsg] = useState('');
  if (!fila.length) return null;
  const escolher = async (l: Lancamento, cat: string) => {
    const c = cat.trim();
    if (!c) return;
    try {
      const r = await onClassificar(l.mes, l.id, c, lembrar);
      setMsg(`"${l.descricao}" agora é ${rotuloCategoria(c)}.` + (lembrar ? (r?.lembrou ? ' Os próximos iguais já chegam com essa categoria.' : ` Não deu para lembrar: ${r?.motivo || 'sem dado do banco'}.`) : ''));
      setAberto(null); setLivre('');
    } catch (e) {
      setMsg('Não deu para salvar: ' + (e as Error).message);
    }
  };
  return (
    <section className="fin-bloco mt-fila" aria-label="A classificar">
      <div className="fin-listahead">
        <h3>A classificar <span className="muted">{fila.length}</span></h3>
        <label className="fin-check"><input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /><span>lembrar para os próximos</span></label>
      </div>
      <p className="muted small">O que a sincronização não reconheceu. Um toque na categoria resolve; com "lembrar", a regra vai para o arquivo de regras desta máquina (fora do git).</p>
      {msg && <p className="fin-nota" role="status">{msg}</p>}
      <ul className="mt-fila-lista">
        {fila.map((l) => (
          <li key={l.mes + l.id}>
            <button className="mt-fila-item" aria-expanded={aberto === l.id} onClick={() => setAberto(aberto === l.id ? null : l.id)}>
              <span className="muted">{diaMes(l.liquidadoEm || l.vencimento)}</span>
              <span className="mt-quebra">{l.descricao}{l.conta ? <span className="muted"> · {l.conta}</span> : null}</span>
              <b className={l.tipo === 'entrada' ? 'entrada' : 'saida'}>{l.tipo === 'entrada' ? '+' : '−'}{brl(Number(l.valor))}</b>
            </button>
            {aberto === l.id && (
              <div className="mt-fila-cats">
                {categorias.map((c) => <button key={c} className="mt-chip" onClick={() => escolher(l, c)}>{rotuloCategoria(c)}</button>)}
                <form onSubmit={(e) => { e.preventDefault(); escolher(l, livre); }} className="mt-chip-livre">
                  <input value={livre} onChange={(e) => setLivre(e.target.value)} placeholder="outra categoria" aria-label="outra categoria" />
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
