// Gráficos do Aion (skill dataviz + regra do Pedro: pouca coisa, muito respiro, borda só para estado).
//  - Por tipo × regra: barra horizontal ordenada, UMA cor (--s1: é uma série só, os nomes dizem o
//    tipo); a faixa da regra é um trilho mais claro do mesmo tom e o alvo um traço (como o teto da
//    Métis). Fora da faixa = estado, sempre com ícone e texto.
//  - Rendimento × CDI × IPCA: ênfase (a carteira em --s1, CDI e IPCA no cinza de referência).
//  - Cenários: faixa ruim–bom (área do mesmo tom, clara) + linha da base; "antes" do "e se" = linha
//    cinza (--mt-anterior, validado: ΔE 16,1 do --s1). Um eixo só, em reais de hoje.
//  - Todo gráfico com dica (hover e foco) e a tabela em "Mais opções" na página.
import { scaleLinear } from 'd3';
import { brl } from '../lib/financeiro';
import type { LinhaTipo } from '../lib/aion';
import { ROTULO_TIPO } from '../lib/aion';
import type { PontoSim } from '../lib/aionSimular';
import { ComPorque } from './AionPorque';
import { Dica, EixoY, M, num, useDica, useLargura } from './FinanceiroGraficos';

const pctTxt = (v: number | null | undefined, casas = 1) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
const larg = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / Math.max(max, 0.0001)) * 100))}%`;

/** Fora da reserva, por tipo: % de cada um, a faixa da regra e o alvo. */
export function BarrasTipo({ linhas }: { linhas: LinhaTipo[] }) {
  const max = Math.min(100, Math.max(10, ...linhas.map((l) => Math.max(l.pctFora || 0, l.max || 0))) * 1.08);
  return (
    <ul className="mt-barras ai-tipos" aria-label="Carteira fora da reserva, por tipo, em % e contra a regra">
      {linhas.map((l) => (
        <ComPorque key={l.tipo} como="li" alvo={l.tipo} rotulo={ROTULO_TIPO[l.tipo]} className="mt-barra">
          <span className="mt-barra-nome">{ROTULO_TIPO[l.tipo]}</span>
          <span className="mt-barra-val">
            <b>{pctTxt(l.pctFora)}</b><span className="muted">{brl(l.valor)}</span>
            {l.situacao === 'acima' && <span className="mt-estado"><span aria-hidden>⚠ </span>{pctTxt(l.desvio)} acima do alvo</span>}
            {l.situacao === 'abaixo' && <span className="mt-estado"><span aria-hidden>⚠ </span>{pctTxt(Math.abs(l.desvio || 0))} abaixo do alvo</span>}
            {l.situacao === 'dentro' && <span className="muted">dentro da faixa</span>}
          </span>
          <span className="mt-barra-trilho" aria-hidden>
            {l.min !== null && l.max !== null && <span className="ai-faixa-regra" style={{ left: larg(l.min, max), width: `calc(${larg(l.max, max)} - ${larg(l.min, max)})` }} />}
            {(l.pctFora || 0) > 0 && <span className="mt-seg" style={{ width: larg(l.pctFora || 0, max), background: 'var(--s1)' }} />}
            {l.alvo !== null && <span className="mt-marcador" style={{ left: larg(l.alvo, max) }} />}
          </span>
        </ComPorque>
      ))}
    </ul>
  );
}

/** Três números comparáveis (a carteira, o CDI e o IPCA do mesmo período). */
export function Comparacao({ itens }: { itens: { chave: string; alvo: string; rotulo: string; pct: number | null; destaque?: boolean; sub?: string }[] }) {
  const max = Math.max(0.5, ...itens.map((i) => Math.abs(i.pct || 0)));
  return (
    <ul className="mt-barras" aria-label="Rendimento da carteira comparado com CDI e IPCA no mesmo período">
      {itens.map((i) => (
        <ComPorque key={i.chave} como="li" alvo={i.alvo} rotulo={i.rotulo} className="mt-barra" >
          <span className="mt-barra-nome">{i.rotulo}</span>
          <span className="mt-barra-val"><b>{pctTxt(i.pct, 2)}</b>{i.sub && <span className="muted">{i.sub}</span>}</span>
          <span className="mt-barra-trilho" aria-hidden>
            {i.pct !== null && i.pct > 0 && <span className="mt-seg" style={{ width: larg(i.pct, max), background: i.destaque ? 'var(--s1)' : 'var(--mt-anterior)' }} />}
          </span>
        </ComPorque>
      ))}
    </ul>
  );
}

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
