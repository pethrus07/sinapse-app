// Gráficos da Métis (o módulo financeiro) sobre o razão do vault. As páginas que os montam
// (Visão e Pronoia) estão em MetisPaginas.tsx; as análises novas em FinanceiroAnalises.tsx.
// Regras (skill de visualização + preferência do Pedro): pouca coisa por cartão, cartão sem
// borda, a leitura do gráfico em uma frase, o resto em "Mais opções" (tabela de cada gráfico).
// Cor por papel: entra/sai/guarda e clientes usam a paleta categórica validada para o fundo
// escuro do app (#11141C); "vencido" usa a cor de estado, sempre com ícone e texto.
import { useEffect, useRef, useState } from 'react';
import { scaleBand, scaleLinear } from 'd3';
import { brl } from '../lib/financeiro';
import {
  aReceberVencido, cartaoFuturo, receitaPorCliente, reservaAcumulada,
  type LinhaFluxo,
} from '../lib/financeiroGraficos';

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const curto = (m: string) => `${MES[+m.slice(5, 7) - 1]}/${m.slice(2, 4)}`;
const tick = (m: string, i: number) => (i === 0 || m.endsWith('-01') ? curto(m) : MES[+m.slice(5, 7) - 1]);
export const longo = (m: string) => `${MES_LONGO[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`;
export const num = (v: number) => Math.round(v).toLocaleString('pt-BR');
export const reais = (v: number) => 'R$ ' + num(v);

/** Largura do contêiner, para o SVG desenhar no tamanho real (sem esticar texto). */
export function useLargura<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ---------------------------------------------------------------- dica (tooltip) */

interface Dica { x: number; y: number; titulo: string; linhas: { cor?: string; rotulo: string; valor: string; leve?: boolean }[] }

export function Dica({ d, largura }: { d: Dica | null; largura: number }) {
  if (!d) return null;
  const esquerda = Math.min(Math.max(d.x + 12, 0), Math.max(largura - 210, 0));
  return (
    <div className="fg-dica" style={{ left: esquerda, top: Math.max(d.y - 12, 0) }} role="status">
      <div className="fg-dica-tit">{d.titulo}</div>
      {d.linhas.map((l, i) => (
        <div key={i} className="fg-dica-lin">
          {l.cor && <span className="fg-chave-lin" style={{ background: l.cor, opacity: l.leve ? 0.45 : 1 }} />}
          <b>{l.valor}</b>
          <span>{l.rotulo}</span>
        </div>
      ))}
    </div>
  );
}

export function useDica(caixa: React.RefObject<HTMLElement>) {
  const [d, setD] = useState<Dica | null>(null);
  const mostrar = (e: { clientX: number; clientY: number } | null, alvo: Element | null, info: Omit<Dica, 'x' | 'y'>) => {
    const r = caixa.current?.getBoundingClientRect();
    if (!r) return;
    if (e) return setD({ ...info, x: e.clientX - r.left, y: e.clientY - r.top });
    const b = alvo?.getBoundingClientRect();
    if (b) setD({ ...info, x: b.right - r.left, y: b.top - r.top });
  };
  return { d, mostrar, esconder: () => setD(null) };
}

/* ---------------------------------------------------------------- pedaços comuns */

export const M = { top: 18, right: 14, bottom: 28, left: 48 };

export function EixoY({ y, largura, ticks = 4 }: { y: ReturnType<typeof scaleLinear<number, number>>; largura: number; ticks?: number }) {
  return (
    <g className="fg-eixo">
      {y.ticks(ticks).map((t) => (
        <g key={t} transform={`translate(0,${y(t)})`}>
          <line x1={M.left} x2={largura - M.right} className={t === 0 ? 'fg-base' : 'fg-grade'} />
          <text x={M.left - 8} dy="0.32em" textAnchor="end">{num(t)}</text>
        </g>
      ))}
    </g>
  );
}

/** Coluna com cantos de 4 px só no topo (quadrada na linha de base). */
export function colunaPath(x: number, y: number, w: number, h: number, raio = 4) {
  if (h <= 0) return '';
  const r = Math.min(raio, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function Legenda({ itens }: { itens: { cor: string; rotulo: string; leve?: number; linha?: boolean; tracejada?: boolean }[] }) {
  return (
    <div className="fg-legenda">
      {itens.map((i) => (
        <span key={i.rotulo} className="fg-leg-item">
          {i.linha ? (
            <svg width="18" height="8" aria-hidden><line x1="1" x2="17" y1="4" y2="4" stroke={i.cor} strokeWidth="2" strokeDasharray={i.tracejada ? '4 3' : undefined} strokeLinecap="round" /></svg>
          ) : (
            <span className="fg-sw" style={{ background: i.cor, opacity: i.leve ?? 1 }} />
          )}
          {i.rotulo}
        </span>
      ))}
    </div>
  );
}

export function Cartao({ titulo, leitura, children, mais, className = '', id }: {
  titulo: string; leitura: React.ReactNode; children: React.ReactNode; mais?: React.ReactNode; className?: string; id: string;
}) {
  return (
    <section className={'fg-card ' + className} data-grafico={id}>
      <h3 className="fg-titulo">{titulo}</h3>
      <p className="fg-leitura">{leitura}</p>
      {children}
      {mais && (
        <details className="fg-mais">
          <summary>Mais opções</summary>
          <div className="fg-mais-corpo">{mais}</div>
        </details>
      )}
    </section>
  );
}

export const COR = { entra: 'var(--s1)', sai: 'var(--s2)', guarda: 'var(--s3)' } as const;
export const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
export const LEVE = 0.38; // previsto / extrapolado: o mesmo tom, mais claro

/* ---------------------------------------------------------------- 1 · fluxo do mês */

function FluxoGrafico({ linhas, hojeMes }: { linhas: LinhaFluxo[]; hojeMes: string }) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  const H = 230;
  const tipos = ['entra', 'sai', 'guarda'] as const;
  const nome = { entra: 'Entra', sai: 'Sai', guarda: 'Guarda' };
  const max = Math.max(1, ...linhas.flatMap((l) => tipos.map((t) => l[t].realizado + l[t].previsto)));
  const y = scaleLinear().domain([0, max]).nice(4).range([H - M.bottom, M.top]);
  const x = scaleBand().domain(linhas.map((l) => l.mes)).range([M.left, Math.max(w - M.right, M.left + 1)]).paddingInner(0.28).paddingOuter(0.1);
  const gap = 2;
  const bw = Math.min(24, (x.bandwidth() - gap * 2) / 3);
  const grupo = bw * 3 + gap * 2;
  return (
    <div ref={ref} className="fg-plot" onPointerLeave={esconder}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Entradas, saídas e reserva por mês, realizado e previsto">
          <EixoY y={y} largura={w} />
          {linhas.map((l, i) => {
            const x0 = (x(l.mes) || 0) + (x.bandwidth() - grupo) / 2;
            return (
              <g key={l.mes}>
                {tipos.map((t, k) => {
                  const r = l[t].realizado, p = l[t].previsto;
                  const bx = x0 + k * (bw + gap);
                  const yR = y(r), yT = y(r + p);
                  const info = { titulo: `${nome[t]} · ${curto(l.mes)}`, linhas: [
                    { cor: COR[t], rotulo: 'realizado', valor: brl(r) },
                    { cor: COR[t], rotulo: 'previsto', valor: brl(p), leve: true },
                  ] };
                  return (
                    <g key={t} className="fg-hit" tabIndex={0} aria-label={`${nome[t]} em ${curto(l.mes)}: realizado ${brl(r)}, previsto ${brl(p)}`}
                      onPointerMove={(e) => mostrar(e, null, info)} onFocus={(e) => mostrar(null, e.currentTarget, info)} onBlur={esconder}>
                      <rect x={bx - 1} y={M.top} width={bw + 2} height={H - M.top - M.bottom} fill="transparent" />
                      {/* previsto em cima do realizado; o vão de 2 px é a cor do fundo */}
                      <path d={r > 0 ? colunaPath(bx, yR, bw, y(0) - yR, p > 0 ? 0 : 4) : ''} fill={COR[t]} />
                      <path d={p > 0 ? colunaPath(bx, yT, bw, Math.max(0, yR - yT - (r > 0 ? gap : 0))) : ''} fill={COR[t]} opacity={LEVE} />
                    </g>
                  );
                })}
                <text className={'fg-xtick' + (l.mes === hojeMes ? ' hoje' : '')} x={(x(l.mes) || 0) + x.bandwidth() / 2} y={H - 8} textAnchor="middle">{tick(l.mes, i)}</text>
              </g>
            );
          })}
        </svg>
      )}
      <Dica d={d} largura={w} />
    </div>
  );
}

export function Fluxo({ linhas, hojeMes }: { linhas: LinhaFluxo[]; hojeMes: string }) {
  const agora = linhas.find((l) => l.mes === hojeMes);
  const soma = (p: { realizado: number; previsto: number }) => p.realizado + p.previsto;
  const sobra = agora ? soma(agora.entra) - soma(agora.sai) - soma(agora.guarda) : 0;
  return (
    <Cartao id="fluxo" className="largo" titulo="Fluxo do mês"
      leitura={agora
        ? <>Em {longo(hojeMes)} entram <b>{brl(soma(agora.entra))}</b>, saem <b>{brl(soma(agora.sai))}</b> e {brl(soma(agora.guarda))} vão para a reserva. Sobra <b>{brl(sobra)}</b>.</>
        : 'Nada lançado no mês de hoje.'}
      mais={
        <>
          <p className="fg-explica">O que já foi pago ou recebido conta no mês em que o dinheiro mexeu; o que segue aberto conta no mês do vencimento. Item sem cronograma fica fora.</p>
          <table className="fg-tabela">
            <thead><tr><th>mês</th><th>entra</th><th>sai</th><th>guarda</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.mes} className={l.mes === hojeMes ? 'hoje' : ''}>
                  <td>{curto(l.mes)}</td>
                  {(['entra', 'sai', 'guarda'] as const).map((t) => (
                    <td key={t} className="num">{num(l[t].realizado)} <span className="muted">+ {num(l[t].previsto)}</span></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fg-explica">Em cada célula: realizado + previsto, em reais.</p>
        </>
      }>
      <Legenda itens={[
        { cor: COR.entra, rotulo: 'Entra' }, { cor: COR.sai, rotulo: 'Sai' }, { cor: COR.guarda, rotulo: 'Guarda' },
        { cor: 'var(--soft)', rotulo: 'forte = realizado' }, { cor: 'var(--soft)', rotulo: 'fraco = previsto', leve: LEVE },
      ]} />
      <FluxoGrafico linhas={linhas} hojeMes={hojeMes} />
    </Cartao>
  );
}

/* ------------------------------------------------------ 2 · receita por cliente */

export function Receita({ r, hojeMes }: { r: ReturnType<typeof receitaPorCliente>; hojeMes: string }) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  const H = 250;
  if (!r.meses.length) return null;
  const iHoje = Math.max(0, r.meses.indexOf(hojeMes));
  const ultimoRazao = r.meses[r.meses.length - 2];
  const y = scaleLinear().domain([0, Math.max(1, ...r.totais)]).nice(4).range([H - M.bottom, M.top]);
  const x = scaleBand().domain(r.meses).range([M.left, Math.max(w - M.right, M.left + 1)]).paddingInner(0.3).paddingOuter(0.1);
  const bw = Math.min(24, x.bandwidth());
  const gap = 2;
  const nDepois = r.meses.length - 1;
  return (
    <Cartao id="receita" className="largo" titulo="Receita por cliente"
      leitura={<>De <b>{brl(r.totais[iHoje])}</b> em {curto(r.meses[iHoje])} para <b>{brl(r.estavel)}</b> depois de {curto(ultimoRazao)}: é o que segue sem data de fim.</>}
      mais={
        <>
          <p className="fg-explica"><b>Estável</b> = entrada recorrente sem fim declarado. Parcela termina sozinha; acordo com prazo tem o último mês marcado no lançamento. A última coluna, {curto(r.mesDepois)}, não tem arquivo no razão: mostra só o estável.</p>
          <table className="fg-tabela">
            <thead><tr><th>cliente</th><th>até</th>{r.meses.map((m) => <th key={m} className="num">{curto(m)}</th>)}</tr></thead>
            <tbody>
              {r.series.map((s) => (
                <tr key={s.cliente}><td>{s.cliente}</td><td>{s.fim ? curto(s.fim) : 'segue'}</td>{s.valores.map((v, i) => <td key={i} className="num">{v ? num(v) : '·'}</td>)}</tr>
              ))}
              <tr className="forte"><td>total</td><td />{r.totais.map((v, i) => <td key={i} className="num">{num(v)}</td>)}</tr>
            </tbody>
          </table>
        </>
      }>
      <Legenda itens={[
        ...r.series.map((s) => ({ cor: SLOTS[s.slot], rotulo: s.cliente + (s.fim ? ` · até ${curto(s.fim)}` : '') })),
        { cor: 'var(--ink)', rotulo: 'estável', linha: true },
      ]} />
      <div ref={ref} className="fg-plot" onPointerLeave={esconder}>
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label="Receita por cliente por mês, com a receita estável">
            <EixoY y={y} largura={w} />
            {r.meses.map((m, i) => {
              const bx = (x(m) || 0) + (x.bandwidth() - bw) / 2;
              let acum = 0;
              const visiveis = r.series.filter((s) => s.valores[i] > 0);
              const info = { titulo: curto(m) + (i === nDepois ? ' · depois do razão' : ''), linhas: [
                ...visiveis.map((s) => ({ cor: SLOTS[s.slot], rotulo: s.cliente, valor: brl(s.valores[i]) })),
                { rotulo: 'total', valor: brl(r.totais[i]) },
              ] };
              return (
                <g key={m} className="fg-hit" tabIndex={0} aria-label={`${curto(m)}: ${brl(r.totais[i])}`}
                  onPointerMove={(e) => mostrar(e, null, info)} onFocus={(e) => mostrar(null, e.currentTarget, info)} onBlur={esconder}>
                  <rect x={x(m)} y={M.top} width={x.bandwidth()} height={H - M.top - M.bottom} fill="transparent" />
                  {visiveis.map((s, k) => {
                    const v = s.valores[i];
                    const y1 = y(acum + v), y0 = y(acum);
                    acum += v;
                    const topo = k === visiveis.length - 1;
                    const h = Math.max(0, y0 - y1 - (k > 0 ? gap : 0));
                    return <path key={s.cliente} d={topo ? colunaPath(bx, y1, bw, h) : `M${bx},${y1}h${bw}v${h}h${-bw}Z`} fill={SLOTS[s.slot]} opacity={i === nDepois ? 0.55 : 1} />;
                  })}
                  {(i === iHoje || i === nDepois) && (
                    <text className="fg-rot" x={bx + bw / 2} y={y(r.totais[i]) - 6} textAnchor="middle">{num(r.totais[i])}</text>
                  )}
                  <text className={'fg-xtick' + (m === hojeMes ? ' hoje' : '')} x={(x(m) || 0) + x.bandwidth() / 2} y={H - 8} textAnchor="middle">{tick(m, i)}</text>
                </g>
              );
            })}
            {r.estavel > 0 && (
              <g className="fg-ref" pointerEvents="none">
                <line x1={M.left} x2={w - M.right} y1={y(r.estavel)} y2={y(r.estavel)} />
              </g>
            )}
          </svg>
        )}
        <Dica d={d} largura={w} />
      </div>
    </Cartao>
  );
}

/* ------------------------------------------------------- 3 · reserva acumulada */

export function Reserva({ r, hojeMes }: { r: ReturnType<typeof reservaAcumulada>; hojeMes: string }) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  const [foco, setFoco] = useState<string | null>(null);
  const H = 220;
  const pts = r.pontos;
  if (!pts.length) return null;
  const y = scaleLinear().domain([0, Math.max(r.piso * 1.1, ...pts.map((p) => p.programado))]).nice(4).range([H - M.bottom, M.top]);
  const x = scaleBand().domain(pts.map((p) => p.mes)).range([M.left, Math.max(w - M.right, M.left + 1)]).padding(0.5);
  const cx = (m: string) => (x(m) || 0) + x.bandwidth() / 2;
  const linha = (vals: [string, number][]) => vals.map(([m, v], i) => `${i ? 'L' : 'M'}${cx(m)},${y(v)}`).join('');
  const guard = pts.filter((p) => p.guardado !== null).map((p) => [p.mes, p.guardado!] as [string, number]);
  const prog = pts.map((p) => [p.mes, p.programado] as [string, number]);
  const ultimo = pts[pts.length - 1];
  const agora = pts.find((p) => p.mes === hojeMes);
  const tocar = (clientX: number) => {
    const b = ref.current?.getBoundingClientRect();
    if (!b) return;
    const px = clientX - b.left;
    const perto = pts.reduce((a, p) => (Math.abs(cx(p.mes) - px) < Math.abs(cx(a.mes) - px) ? p : a), pts[0]);
    setFoco(perto.mes);
    mostrar({ clientX: b.left + cx(perto.mes), clientY: b.top + y(perto.programado) }, null, {
      titulo: curto(perto.mes),
      linhas: [
        ...(perto.guardado !== null ? [{ cor: COR.guarda, rotulo: 'guardado', valor: brl(perto.guardado) }] : []),
        { cor: COR.guarda, rotulo: 'programado', valor: brl(perto.programado), leve: true },
        { rotulo: 'piso', valor: brl(r.piso) },
      ],
    });
  };
  return (
    <Cartao id="reserva" titulo="Reserva acumulada"
      leitura={r.baseEm
        ? <>Hoje <b>{brl(agora?.guardado ?? r.base)}</b> guardados; com os aportes lançados chega a <b>{brl(ultimo.programado)}</b> em {curto(ultimo.mes)}.</>
        : <>O saldo de partida não está no razão: a curva mostra só os aportes lançados, que somam <b>{brl(ultimo.programado)}</b> até {curto(ultimo.mes)}.</>}
      mais={
        <>
          <p className="fg-explica">Piso de {brl(r.piso)}: colchão de emergência. {r.baseEm ? `Parte do saldo de ${brl(r.base)} em ${r.baseEm.split('-').reverse().join('/')} (investimentos marcados como reserva).` : 'Para a curva partir do saldo real, lance a posição da reserva em Investimentos com "reserva": true.'} Guardado = aporte marcado como feito; programado = feito + lançado.</p>
          <table className="fg-tabela">
            <thead><tr><th>mês</th><th className="num">guardado</th><th className="num">programado</th></tr></thead>
            <tbody>{pts.map((p) => <tr key={p.mes} className={p.mes === hojeMes ? 'hoje' : ''}><td>{curto(p.mes)}</td><td className="num">{p.guardado === null ? '·' : num(p.guardado)}</td><td className="num">{num(p.programado)}</td></tr>)}</tbody>
          </table>
        </>
      }>
      <Legenda itens={[
        { cor: COR.guarda, rotulo: 'guardado', linha: true },
        { cor: COR.guarda, rotulo: 'programado', linha: true, tracejada: true },
        { cor: 'var(--soft)', rotulo: `piso ${reais(r.piso)}`, linha: true },
      ]} />
      <div ref={ref} className="fg-plot" onPointerMove={(e) => tocar(e.clientX)} onPointerLeave={() => { setFoco(null); esconder(); }}
        tabIndex={0} aria-label="Reserva acumulada por mês" onFocus={() => tocar((ref.current?.getBoundingClientRect().left || 0) + cx(pts.some((p) => p.mes === hojeMes) ? hojeMes : pts[0].mes))} onBlur={() => { setFoco(null); esconder(); }}>
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label={`Reserva: ${brl(ultimo.programado)} programados até ${curto(ultimo.mes)}; piso ${brl(r.piso)}`}>
            <EixoY y={y} largura={w} />
            <g className="fg-ref piso"><line x1={M.left} x2={w - M.right} y1={y(r.piso)} y2={y(r.piso)} /><text x={M.left + 4} y={y(r.piso) - 6}>piso</text></g>
            {foco && <line className="fg-mira" x1={cx(foco)} x2={cx(foco)} y1={M.top} y2={H - M.bottom} />}
            <path d={linha(prog)} fill="none" stroke={COR.guarda} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
            {guard.length > 0 && <path d={linha(guard)} fill="none" stroke={COR.guarda} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
            {guard.length > 0 && <circle cx={cx(guard[guard.length - 1][0])} cy={y(guard[guard.length - 1][1])} r={4.5} fill={COR.guarda} stroke="var(--panel)" strokeWidth={2} />}
            <circle cx={cx(ultimo.mes)} cy={y(ultimo.programado)} r={4.5} fill={COR.guarda} stroke="var(--panel)" strokeWidth={2} />
            <text className="fg-rot" x={cx(ultimo.mes)} y={y(ultimo.programado) - 10} textAnchor="end">{num(ultimo.programado)}</text>
            {pts.map((p, i) => <text key={p.mes} className={'fg-xtick' + (p.mes === hojeMes ? ' hoje' : '')} x={cx(p.mes)} y={H - 8} textAnchor="middle">{w < 520 && i % 2 ? '' : tick(p.mes, i)}</text>)}
          </svg>
        )}
        <Dica d={d} largura={w} />
      </div>
    </Cartao>
  );
}

/* ----------------------------------------------------------- 4 · a receber vencido */

export function Vencido({ v }: { v: ReturnType<typeof aReceberVencido> }) {
  const total = v.reduce((s, c) => s + c.total, 0);
  const max = Math.max(1, ...v.map((c) => c.total));
  return (
    <Cartao id="vencido" titulo="A receber vencido"
      leitura={v.length
        ? <><span aria-hidden>⚠ </span><b>{brl(total)}</b> com vencimento passado e ainda aberto, de {v.length} {v.length === 1 ? 'origem' : 'origens'}. Se já entrou, é só marcar como recebido.</>
        : 'Nada vencido em aberto.'}
      mais={v.length ? (
        <table className="fg-tabela">
          <thead><tr><th>origem</th><th>o quê</th><th>venceu</th><th className="num">dias</th><th className="num">R$</th></tr></thead>
          <tbody>{v.flatMap((c) => c.itens.map((i, k) => (
            <tr key={c.cliente + k}><td>{k === 0 ? c.cliente : ''}</td><td>{i.descricao}</td><td>{i.vencimento.split('-').reverse().join('/')}</td><td className="num">{i.dias}</td><td className="num">{num(i.valor)}</td></tr>
          )))}</tbody>
        </table>
      ) : undefined}>
      {v.length > 0 && (
        <ul className="fg-barras" aria-label="A receber vencido por origem">
          {v.map((c) => (
            <li key={c.cliente} tabIndex={0} title={`${c.cliente}: ${brl(c.total)}, há ${c.diasMax} dias`}>
              <span className="fg-barra-nome">{c.cliente}</span>
              <span className="fg-barra-trilho"><span className="fg-barra vencido" style={{ width: `${(c.total / max) * 100}%` }} /></span>
              <span className="fg-barra-val"><b>{brl(c.total)}</b> <span className="muted">há {c.diasMax} {c.diasMax === 1 ? 'dia' : 'dias'}</span></span>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

/* -------------------------------------------------------------- 5 · cartão no futuro */

const TOM = { medido: 1, extrapolado: 0.45, estimado: 0.22 } as const;

export function Cartao5({ c }: { c: ReturnType<typeof cartaoFuturo> }) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  const H = 200;
  if (!c.length) return (
    <Cartao id="cartao" titulo="Cartão parcelado" leitura="Nenhuma fatura lançada do mês de hoje em diante."><span /></Cartao>
  );
  const y = scaleLinear().domain([0, Math.max(1, ...c.map((m) => m.valor))]).nice(4).range([H - M.bottom, M.top]);
  const x = scaleBand().domain(c.map((m) => m.mes)).range([M.left, Math.max(w - M.right, M.left + 1)]).paddingInner(0.3).paddingOuter(0.1);
  const bw = Math.min(24, x.bandwidth());
  const total = c.reduce((s, m) => s + m.valor, 0);
  const ultMedido = [...c].reverse().find((m) => m.confianca === 'medido');
  const tem = (k: keyof typeof TOM) => c.some((m) => m.confianca === k);
  return (
    <Cartao id="cartao" titulo="Cartão parcelado"
      leitura={<>Piso de <b>{brl(total)}</b> em faturas até {curto(c[c.length - 1].mes)}{ultMedido ? <>; medido no banco até {curto(ultMedido.mes)}, depois é conta de parcela</> : ''}. Compra nova entra em cima.</>}
      mais={
        <>
          <p className="fg-explica">Todo valor é <b>piso</b>: só o parcelamento já assumido. Medido = valor da fatura lido no banco; extrapolado = conta feita com as parcelas que faltam.</p>
          <table className="fg-tabela">
            <thead><tr><th>vence</th><th className="num">R$</th><th>confiança</th></tr></thead>
            <tbody>{c.map((m) => <tr key={m.mes}><td>{curto(m.mes)}</td><td className="num">{num(m.valor)}</td><td>{m.confianca}</td></tr>)}</tbody>
          </table>
        </>
      }>
      <Legenda itens={(['medido', 'extrapolado', 'estimado'] as const).filter(tem).map((k) => ({ cor: COR.sai, rotulo: k, leve: TOM[k] }))} />
      <div ref={ref} className="fg-plot" onPointerLeave={esconder}>
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label="Faturas do cartão por mês, medido e extrapolado">
            <EixoY y={y} largura={w} ticks={3} />
            {c.map((m, i) => {
              const bx = (x(m.mes) || 0) + (x.bandwidth() - bw) / 2;
              const info = { titulo: `vence ${curto(m.mes)}`, linhas: [{ cor: COR.sai, rotulo: m.confianca, valor: brl(m.valor), leve: m.confianca !== 'medido' }] };
              return (
                <g key={m.mes} className="fg-hit" tabIndex={0} aria-label={`${curto(m.mes)}: ${brl(m.valor)}, ${m.confianca}`}
                  onPointerMove={(e) => mostrar(e, null, info)} onFocus={(e) => mostrar(null, e.currentTarget, info)} onBlur={esconder}>
                  <rect x={x(m.mes)} y={M.top} width={x.bandwidth()} height={H - M.top - M.bottom} fill="transparent" />
                  <path d={colunaPath(bx, y(m.valor), bw, y(0) - y(m.valor))} fill={COR.sai} opacity={TOM[m.confianca]} />
                  {(i === 0 || i === c.length - 1) && <text className="fg-rot" x={bx + bw / 2} y={y(m.valor) - 6} textAnchor="middle">{num(m.valor)}</text>}
                  <text className="fg-xtick" x={(x(m.mes) || 0) + x.bandwidth() / 2} y={H - 8} textAnchor="middle">{tick(m.mes, i)}</text>
                </g>
              );
            })}
          </svg>
        )}
        <Dica d={d} largura={w} />
      </div>
    </Cartao>
  );
}
