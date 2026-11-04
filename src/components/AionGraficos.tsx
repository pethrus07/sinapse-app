// Gráficos do Aion (skill dataviz + regra do Pedro: pouca coisa, muito respiro, borda só para estado).
// Forma antes de cor, um eixo só (nunca dois), legenda com 2+ séries e rótulo direto no fim da linha,
// hover (e foco pelo teclado) em tudo, a tabela em "Mais opções" na página. Paleta: slots 1 a 3 da
// categórica validada no fundo escuro do app (#11141C, validate_palette.js --pairs all: CVD ΔE 9,4,
// normal 20,9, contraste ≥ 3:1); série única = slot 1; previsto/andando = o mesmo tom mais claro com
// contorno (fracoSvg); referência e "antes" = cinza --mt-anterior.
//  - BarrasTipo: fora da reserva por tipo × a regra (o nome é termo, o valor tem porquê).
//  - GraficoLinhas: linhas no tempo (rendimento em base 100, juros e inflação, Focus, preço com os
//    marcadores de evento, caminho das metas com faixa). Com 1 ponto, desenha o ponto e a página avisa.
//  - GraficoColunas: colunas por mês, empilhadas (reserva × resto) ou simples (aportes, renda passiva).
//  - FaixaCenarios: a faixa ruim–bom da simulação. Sparkline e Faixa52: a linha de preço e a régua de
//    52 semanas da Observação.
import { line as d3line, scaleBand, scaleLinear } from 'd3';
import { useState } from 'react';
import { brl } from '../lib/financeiro';
import type { LinhaTipo } from '../lib/aion';
import { ROTULO_TIPO } from '../lib/aion';
import type { PontoSim } from '../lib/aionSimular';
import type { Porque } from '../lib/aionPorques';
import { TERMO_DO_TIPO } from '../lib/aionGlossario';
import { ComPorque, Termo, type FonteNumero } from './AionPorque';
import { colunaPath, curto, Dica, EixoY, fracoSvg, M, num, useDica, useLargura } from './FinanceiroGraficos';

const pctTxt = (v: number | null | undefined, casas = 1) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
const larg = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / Math.max(max, 0.0001)) * 100))}%`;

/** Fora da reserva, por tipo: % de cada um, a faixa da regra e o alvo. O nome abre "O que é"; o número, "Por quê". */
export function BarrasTipo({ linhas, fonte }: { linhas: LinhaTipo[]; fonte: FonteNumero }) {
  const max = Math.min(100, Math.max(10, ...linhas.map((l) => Math.max(l.pctFora || 0, l.max || 0))) * 1.08);
  return (
    <ul className="mt-barras ai-tipos" aria-label="Carteira fora da reserva, por tipo, em % e contra a regra">
      {linhas.map((l) => (
        <li key={l.tipo} className="mt-barra" data-tipo={l.tipo}>
          <span className="mt-barra-nome"><Termo id={TERMO_DO_TIPO[l.tipo]}>{ROTULO_TIPO[l.tipo]}</Termo></span>
          <ComPorque alvo={l.tipo} rotulo={`${ROTULO_TIPO[l.tipo]}: ${pctTxt(l.pctFora)}`} fonte={fonte} className="mt-barra-val ai-pq-num">
            <b>{pctTxt(l.pctFora)}</b><span className="muted">{brl(l.valor)}</span>
            {l.situacao === 'acima' && <span className="mt-estado"><span aria-hidden>⚠ </span>{pctTxt(l.desvio)} acima do alvo</span>}
            {l.situacao === 'abaixo' && <span className="mt-estado"><span aria-hidden>⚠ </span>{pctTxt(Math.abs(l.desvio || 0))} abaixo do alvo</span>}
            {l.situacao === 'dentro' && <span className="muted">dentro da faixa</span>}
          </ComPorque>
          <span className="mt-barra-trilho" aria-hidden>
            {l.min !== null && l.max !== null && <span className="ai-faixa-regra" style={{ left: larg(l.min, max), width: `calc(${larg(l.max, max)} - ${larg(l.min, max)})` }} />}
            {(l.pctFora || 0) > 0 && <span className="mt-seg" style={{ width: larg(l.pctFora || 0, max), background: 'var(--s1)' }} />}
            {l.alvo !== null && <span className="mt-marcador" style={{ left: larg(l.alvo, max) }} />}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------ linhas no tempo */

export interface SerieLinha { id: string; rotulo: string; cor: string; valores: (number | null)[]; tracejada?: boolean }
export interface FaixaLinha { rotulo: string; cor: string; lo: (number | null)[]; hi: (number | null)[] }
export type Forma = 'quadrado' | 'losango' | 'circulo' | 'triangulo';
export interface MarcaEvento { i: number; forma: Forma; rotulo: string; itens: Porque[]; fonte: FonteNumero }
export interface RefLinha { valor: number; rotulo: string }

/** Rótulos do fim da linha sem encostar um no outro (≥ 14 px), na ordem do valor. */
function afastar(ys: { id: string; y: number }[], min = 14) {
  const s = [...ys].sort((a, b) => a.y - b.y);
  for (let i = 1; i < s.length; i++) if (s[i].y - s[i - 1].y < min) s[i].y = s[i - 1].y + min;
  return new Map(s.map((x) => [x.id, x.y]));
}

/**
 * Linhas no mesmo eixo. `xs` = as chaves do eixo x (meses 'AAAA-MM' ou dias 'AAAA-MM-DD', em ordem);
 * a mira acha o x mais perto e a dica lista todas as séries naquele x. Setas do teclado andam na mira.
 */
export function GraficoLinhas({ xs, rotuloX, series, faixa, refs = [], marcas = [], fmt, fmtEixo, altura = 220, aria, zero = false, rotulosFim = true, tituloDica, dominioMax }: {
  xs: string[]; rotuloX: (x: string, i: number) => string; series: SerieLinha[]; faixa?: FaixaLinha; refs?: RefLinha[]; marcas?: MarcaEvento[];
  fmt: (v: number) => string; fmtEixo?: (v: number) => string; altura?: number; aria: string; zero?: boolean; rotulosFim?: boolean; tituloDica?: (x: string) => string;
  /** small multiples: o mesmo topo em todos os gráficos, para a escala ser a mesma */
  dominioMax?: number;
}) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  const [foco, setFoco] = useState<number | null>(null);
  const H = altura;
  const todos = [...series.flatMap((s) => s.valores), ...(faixa ? [...faixa.lo, ...faixa.hi] : []), ...refs.map((r) => r.valor)].filter((v): v is number => v != null && Number.isFinite(v));
  let lo = Math.min(...todos), hi = Math.max(...todos);
  if (!todos.length) { lo = 0; hi = 1; }
  if (zero) lo = Math.min(0, lo);
  if (dominioMax != null) hi = Math.max(hi, dominioMax);
  if (hi - lo < 1e-9) { const k = Math.abs(hi) * 0.05 || 1; lo -= k; hi += k; }
  const pad = (hi - lo) * 0.08;
  const y = scaleLinear().domain([zero && lo >= 0 ? 0 : lo - pad, hi + pad]).nice(4).range([H - M.bottom, M.top]);
  const direita = rotulosFim ? 64 : M.right + 6;
  const x0 = M.left + 8, x1 = Math.max(w - direita, x0 + 1);
  const x = (i: number) => (xs.length <= 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (xs.length - 1));
  const caminho = (vals: (number | null)[]) => d3line<number | null>().defined((v) => v != null).x((_, i) => x(i)).y((v) => y(v as number))(vals) || '';
  const area = faixa ? (() => {
    const idx = faixa.lo.map((v, i) => (v != null && faixa.hi[i] != null ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) return '';
    return `M${idx.map((i) => `${x(i).toFixed(1)},${y(faixa.hi[i]!).toFixed(1)}`).join('L')}L${[...idx].reverse().map((i) => `${x(i).toFixed(1)},${y(faixa.lo[i]!).toFixed(1)}`).join('L')}Z`;
  })() : '';
  const ultimo = (vals: (number | null)[]) => { for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i; return -1; };
  const fins = afastar(series.map((s) => ({ id: s.id, y: ultimo(s.valores) >= 0 ? y(s.valores[ultimo(s.valores)]!) : -999 })));
  const nTicks = w < 360 ? 3 : w < 640 ? 4 : 6;
  const passo = Math.max(1, Math.ceil((xs.length - 1) / (nTicks - 1)));
  const ticksX = xs.map((_, i) => i).filter((i) => i === 0 || i === xs.length - 1 || (i % passo === 0 && xs.length - 1 - i >= passo / 2));
  const fe = fmtEixo || fmt;
  const info = (i: number) => ({
    titulo: tituloDica ? tituloDica(xs[i]) : rotuloX(xs[i], i),
    linhas: [
      ...series.map((s) => ({ cor: s.cor, rotulo: s.rotulo, valor: s.valores[i] != null ? fmt(s.valores[i]!) : 'sem dado' })),
      ...(faixa && faixa.lo[i] != null && faixa.hi[i] != null ? [{ cor: faixa.cor, leve: true, rotulo: faixa.rotulo, valor: `${fmt(faixa.lo[i]!)} a ${fmt(faixa.hi[i]!)}` }] : []),
      ...refs.map((r) => ({ rotulo: r.rotulo, valor: fmt(r.valor) })),
    ],
  });
  const em = (i: number) => {
    setFoco(i);
    const b = ref.current?.getBoundingClientRect();
    const v = series.map((s) => s.valores[i]).find((v) => v != null);
    if (b) mostrar({ clientX: b.left + x(i), clientY: b.top + (v != null ? y(v) : M.top) }, null, info(i));
  };
  const perto = (px: number) => xs.reduce((a, _, i) => (Math.abs(x(i) - px) < Math.abs(x(a) - px) ? i : a), 0);
  const ySerie0 = (i: number) => { const v = series[0]?.valores[i]; return v != null ? y(v) : H - M.bottom; };
  return (
    <div ref={ref} className="fg-plot ai-linhas" tabIndex={0} aria-label={aria + ' (setas do teclado andam no tempo)'}
      onPointerMove={(e) => { const b = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); em(perto(e.clientX - b.left)); }}
      onPointerLeave={() => { setFoco(null); esconder(); }}
      onFocus={(e) => { if (e.target === e.currentTarget && xs.length) em(xs.length - 1); }}
      onBlur={(e) => { if (e.target === e.currentTarget) { setFoco(null); esconder(); } }}
      onKeyDown={(e) => {
        if (!xs.length) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); em(Math.max(0, (foco ?? xs.length - 1) - 1)); }
        if (e.key === 'ArrowRight') { e.preventDefault(); em(Math.min(xs.length - 1, (foco ?? 0) + 1)); }
      }}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={aria}>
          <g className="fg-eixo">
            {y.ticks(4).map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x1={M.left} x2={w - M.right} className={t === 0 ? 'fg-base' : 'fg-grade'} />
                <text x={M.left - 8} dy="0.32em" textAnchor="end">{fe(t)}</text>
              </g>
            ))}
          </g>
          {area && <path d={area} fill={faixa!.cor} opacity={0.16} />}
          {refs.map((r) => (
            <g key={r.rotulo} className="fg-ref piso"><line x1={M.left} x2={w - M.right} y1={y(r.valor)} y2={y(r.valor)} /><text x={M.left + 4} y={y(r.valor) - 6}>{r.rotulo}</text></g>
          ))}
          {foco !== null && <line className="fg-mira" x1={x(foco)} x2={x(foco)} y1={M.top} y2={H - M.bottom} />}
          {series.map((s) => {
            const vis = s.valores.filter((v) => v != null).length;
            const u = ultimo(s.valores);
            return (
              <g key={s.id} data-serie={s.id}>
                {vis > 1 && <path d={caminho(s.valores)} fill="none" stroke={s.cor} strokeWidth={2} strokeDasharray={s.tracejada ? '5 4' : undefined} strokeLinecap="round" strokeLinejoin="round" />}
                {u >= 0 && <circle cx={x(u)} cy={y(s.valores[u]!)} r={4.5} fill={s.cor} stroke="var(--panel)" strokeWidth={2} />}
                {rotulosFim && u >= 0 && <text className="fg-rot" x={x(u) + 9} y={fins.get(s.id)} dy="0.32em">{fmt(s.valores[u]!)}</text>}
              </g>
            );
          })}
          {ticksX.map((i) => <text key={'x' + i} className="fg-xtick" x={x(i)} y={H - 8} textAnchor={xs.length === 1 ? 'middle' : i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'}>{rotuloX(xs[i], i)}</text>)}
        </svg>
      )}
      {w > 0 && marcas.length > 0 && (
        <div className="ai-marcas">
          {marcas.map((m, k) => (
            <span key={k} className="ai-marca-pos" style={{ left: x(m.i) - 22, top: ySerie0(m.i) - 22 }}
              onPointerMove={(e) => e.stopPropagation()} onPointerEnter={() => { setFoco(null); esconder(); }}>
              <ComPorque alvo={m.itens[0]?.id || 'evento'} rotulo={m.rotulo} fonte={m.fonte} itens={m.itens} className="ai-marca-ev">
                <span className={'ai-forma ' + m.forma} aria-hidden />
              </ComPorque>
            </span>
          ))}
        </div>
      )}
      <Dica d={d} largura={w} />
    </div>
  );
}

/** A forma do marcador na legenda (a forma diz o tipo do evento; a cor não carrega nada sozinha). */
export function LegendaFormas({ itens }: { itens: { forma: Forma; rotulo: string }[] }) {
  return (
    <div className="fg-legenda ai-leg-formas">
      {itens.map((i) => <span key={i.forma} className="fg-leg-item"><span className={'ai-forma leg ' + i.forma} aria-hidden />{i.rotulo}</span>)}
    </div>
  );
}

/* ------------------------------------------------------------ colunas por mês */

export interface SerieColuna { id: string; rotulo: string; cor: string; valores: number[] }

/** Colunas por mês (empilhadas se houver mais de uma série). Mês "andando" no mesmo tom, mais claro. */
export function GraficoColunas({ meses, series, andando = [], fmt = brl, altura = 200, aria, hojeMes }: {
  meses: string[]; series: SerieColuna[]; andando?: boolean[]; fmt?: (v: number) => string; altura?: number; aria: string; hojeMes?: string;
}) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  const [foco, setFoco] = useState<number | null>(null);
  const H = altura;
  const totais = meses.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.valores[i] || 0), 0));
  const y = scaleLinear().domain([0, Math.max(1, ...totais)]).nice(4).range([H - M.bottom, M.top]);
  const x = scaleBand().domain(meses).range([M.left, Math.max(w - M.right, M.left + 1)]).padding(0.35);
  const bw = Math.min(x.bandwidth(), 56);
  // rótulo do mês a cada `passoX` colunas, contando do mês de hoje para trás (cada rótulo pede ~48 px)
  const passoX = Math.max(1, Math.ceil(48 / Math.max(1, x.step())));
  const info = (i: number) => ({
    titulo: curto(meses[i]) + (andando[i] ? ' · mês andando' : ''),
    linhas: [...series.map((s) => ({ cor: s.cor, rotulo: s.rotulo, valor: fmt(s.valores[i] || 0), leve: andando[i] })), ...(series.length > 1 ? [{ rotulo: 'total', valor: fmt(totais[i]) }] : [])],
  });
  const em = (i: number, alvo: Element | null) => { setFoco(i); mostrar(null, alvo, info(i)); };
  return (
    <div ref={ref} className="fg-plot" onPointerLeave={() => { setFoco(null); esconder(); }}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={aria}>
          <EixoY y={y} largura={w} />
          {meses.map((m, i) => {
            const cx = (x(m) || 0) + x.bandwidth() / 2, x0 = cx - bw / 2;
            let base = y(0);
            const segs = series.map((s, k) => {
              const v = Math.max(0, s.valores[i] || 0);
              const h = y(0) - y(v);
              const topo = series.slice(k + 1).every((t) => !(t.valores[i] > 0));
              const yy = base - h;
              const el = h > 0 ? (
                <path key={s.id} d={topo ? colunaPath(x0, yy, bw, Math.max(0, h - (k ? 2 : 0))) : `M${x0},${base - (k ? 2 : 0)}V${yy}H${x0 + bw}V${base - (k ? 2 : 0)}Z`}
                  {...(andando[i] ? fracoSvg(s.cor) : { fill: s.cor })} />
              ) : null;
              base = yy;
              return el;
            });
            return (
              <g key={m} className="fg-hit" tabIndex={0} aria-label={`${curto(m)}: ${series.map((s) => `${s.rotulo} ${fmt(s.valores[i] || 0)}`).join(', ')}${andando[i] ? ' (mês andando)' : ''}`}
                onPointerEnter={(e) => em(i, e.currentTarget)} onPointerMove={(e) => em(i, e.currentTarget)} onFocus={(e) => em(i, e.currentTarget)} onBlur={() => { setFoco(null); esconder(); }}>
                <rect x={x(m)} y={M.top} width={x.bandwidth()} height={H - M.top - M.bottom} fill="transparent" />
                {segs}
                {foco === i && totais[i] > 0 && <text className="fg-rot" x={cx} y={y(totais[i]) - 7} textAnchor="middle">{num(totais[i])}</text>}
              </g>
            );
          })}
          {meses.map((m, i) => <text key={'t' + m} className={'fg-xtick' + (m === hojeMes ? ' hoje' : '')} x={(x(m) || 0) + x.bandwidth() / 2} y={H - 8} textAnchor="middle">{(meses.length - 1 - i) % passoX ? '' : curto(m)}</text>)}
        </svg>
      )}
      <Dica d={d} largura={w} />
    </div>
  );
}

/* ------------------------------------------------------------ Observação: linha de preço e 52 semanas */

/** A linha do preço no histórico que a fonte deu (sem eixo; o primeiro e o último valor na dica do ativo). */
export function Sparkline({ pontos, rotulo }: { pontos: { data: string; fechamento: number }[]; rotulo: string }) {
  const W = 104, H = 30;
  if (pontos.length < 2) return null;
  const vs = pontos.map((p) => p.fechamento);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const y = scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).range([H - 4, 4]);
  const x = (i: number) => 2 + ((W - 8) * i) / (pontos.length - 1);
  const dpath = pontos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.fechamento).toFixed(1)}`).join('');
  return (
    <svg className="ai-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${rotulo}: de ${brl(vs[0])} em ${pontos[0].data.split('-').reverse().join('/')} a ${brl(vs[vs.length - 1])} em ${pontos[pontos.length - 1].data.split('-').reverse().join('/')}`}>
      <path d={dpath} fill="none" stroke="var(--s1)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pontos.length - 1)} cy={y(vs[vs.length - 1])} r={3} fill="var(--s1)" stroke="var(--panel)" strokeWidth={1.5} />
    </svg>
  );
}

/** Onde o preço de hoje está entre a mínima e a máxima de 52 semanas. */
export function Faixa52({ min, max, preco }: { min: number; max: number; preco: number }) {
  const p = Math.max(0, Math.min(1, (preco - min) / Math.max(max - min, 0.0001)));
  return (
    <span className="ai-52" role="img" aria-label={`52 semanas: mínima ${brl(min)}, máxima ${brl(max)}, hoje ${brl(preco)}`}>
      <span className="ai-52-num">{brl(min)}</span>
      <span className="ai-52-trilho"><span className="ai-52-ponto" style={{ left: `${p * 100}%` }} /></span>
      <span className="ai-52-num">{brl(max)}</span>
    </span>
  );
}

/* ------------------------------------------------------------ cenários da simulação */

const rotuloMeses = (k: number) => (k === 0 ? 'hoje' : k % 12 === 0 ? `${k / 12} ${k === 12 ? 'ano' : 'anos'}` : `${k} m`);

/** Faixa dos cenários no tempo (valor líquido real). `antes` = a linha base sem o "e se". */
export function FaixaCenarios({ ruim, base, bom, antes, marcas = [12, 36, 60] }: { ruim: PontoSim[]; base: PontoSim[]; bom: PontoSim[]; antes?: PontoSim[] | null; marcas?: number[] }) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  const H = 260;
  const meses = base.map((p) => p.mes);
  const fim = meses[meses.length - 1] || 60;
  const todos = [...ruim, ...bom, ...(antes || [])].map((p) => p.real);
  // linha e área não precisam do zero (barra precisa): o eixo começa perto do menor valor, para a faixa aparecer
  const lo = Math.min(...todos), hi = Math.max(1, ...todos);
  const y = scaleLinear().domain([Math.max(0, lo - (hi - lo) * 0.15), hi]).nice(4).range([H - M.bottom, M.top]);
  const x = scaleLinear().domain([0, fim]).range([M.left + 6, Math.max(w - M.right - 6, M.left + 7)]);
  const linha = (ps: PontoSim[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.mes).toFixed(1)},${y(p.real).toFixed(1)}`).join('');
  const area = `${linha(bom)}${[...ruim].reverse().map((p) => `L${x(p.mes).toFixed(1)},${y(p.real).toFixed(1)}`).join('')}Z`;
  const perto = (px: number) => base.reduce((a, p, i) => (Math.abs(x(p.mes) - px) < Math.abs(x(base[a].mes) - px) ? i : a), 0);
  const info = (i: number) => ({
    titulo: `Em ${rotuloMeses(base[i].mes)} · em reais de hoje, líquido de IR`,
    linhas: [
      { cor: 'var(--s1)', rotulo: 'bom', valor: brl(bom[i].real), leve: true },
      { cor: 'var(--s1)', rotulo: 'base', valor: brl(base[i].real) },
      { cor: 'var(--s1)', rotulo: 'ruim', valor: brl(ruim[i].real), leve: true },
      ...(antes ? [{ cor: 'var(--mt-anterior)', rotulo: 'base sem o "e se"', valor: brl(antes[i]?.real ?? 0) }] : []),
      { rotulo: 'aplicado', valor: brl(base[i].aplicado) },
    ],
  });
  const marcasVis = marcas.filter((k) => k <= fim);
  return (
    <div ref={ref} className="fg-plot" onPointerLeave={esconder}
      onPointerMove={(e) => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); mostrar(e, null, info(perto(e.clientX - r.left))); }}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Faixa de cenários bom, base e ruim, em reais de hoje, líquido de imposto">
          <EixoY y={y} largura={w} />
          <path d={area} fill="var(--s1)" opacity={0.16} />
          {antes && <path d={linha(antes)} fill="none" stroke="var(--mt-anterior)" strokeWidth={2} />}
          <path d={linha(base)} fill="none" stroke="var(--s1)" strokeWidth={2} />
          {marcasVis.map((k) => {
            const i = base.findIndex((p) => p.mes === k);
            if (i < 0) return null;
            return (
              <g key={k} className="fg-hit" tabIndex={0} aria-label={`${rotuloMeses(k)}: base ${brl(base[i].real)}, de ${brl(ruim[i].real)} a ${brl(bom[i].real)}`}
                onFocus={(e) => mostrar(null, e.currentTarget, info(i))} onBlur={esconder}>
                <line x1={x(k)} x2={x(k)} y1={y(bom[i].real)} y2={y(ruim[i].real)} stroke="var(--s1)" strokeWidth={1} opacity={0.6} />
                <circle cx={x(k)} cy={y(base[i].real)} r={4.5} fill="var(--s1)" stroke="var(--panel)" strokeWidth={2} />
                <text className="fg-rot" x={x(k)} y={y(bom[i].real) - 8} textAnchor={k === fim ? 'end' : 'middle'}>{num(base[i].real)}</text>
              </g>
            );
          })}
          {[0, ...marcasVis].map((k) => <text key={'t' + k} className="fg-xtick" x={x(k)} y={H - 8} textAnchor={k === 0 ? 'start' : k === fim ? 'end' : 'middle'}>{rotuloMeses(k)}</text>)}
        </svg>
      )}
      <Dica d={d} largura={w} />
    </div>
  );
}
