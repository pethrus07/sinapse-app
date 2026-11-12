import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Note } from '../types';
import { colorForArea } from '../lib/colors';
import { classify } from '../lib/skills';

interface Props {
  notes: Note[];
  onOpen: (id: string) => void;
}

// Estado da "habilidade": progresso (eixo do estudo) manda; senão o status (ciclo de vida).
//   progresso: a-fazer · estudando · revisar · dominado
//   status:    ideia · ativo · aguardando · pausado · em-producao · concluido · arquivado
type Estado = 'mastered' | 'active' | 'locked' | 'known';
function estado(n: Note): Estado {
  const p = (n.progresso || '').toLowerCase();
  if (p) {
    if (p === 'dominado') return 'mastered';
    if (p === 'estudando') return 'active';
    if (p === 'revisar') return 'known'; // já passou por mim, mas pede releitura
    return 'locked'; // a-fazer
  }
  const s = (n.status || '').toLowerCase();
  if (s === 'em-producao' || s === 'concluido') return 'mastered';
  if (s === 'ativo') return 'active';
  if (s === 'ideia' || s === 'aguardando' || s === 'pausado' || s === 'arquivado') return 'locked';
  return 'known';
}
const EST_COR: Record<Estado, string> = {
  mastered: '#FFC53D',
  active: '#2CD4C0',
  locked: '#5B6472',
  known: '#9AA6B8',
};
const EST_NOME: Record<Estado, string> = { mastered: 'dominada', active: 'treinando', known: 'desbloqueada', locked: 'a fazer' };
const EST_ORDEM: Record<Estado, number> = { active: 0, mastered: 1, known: 2, locked: 3 };

// hexágono pointy-top de raio r (o ar de "skill node" de RPG)
function hexPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
  }
  return 'M' + pts.join('L') + 'Z';
}
// arco de anel (progresso) de a0 a a1, em fração da volta, começando no topo
function arco(r: number, a0: number, a1: number): string {
  if (a1 - a0 <= 0) return '';
  if (a1 - a0 >= 0.9999) return `M0,${-r}A${r},${r} 0 1 1 0,${r}A${r},${r} 0 1 1 0,${-r}`;
  const p = (f: number) => [Math.sin(f * 2 * Math.PI) * r, -Math.cos(f * 2 * Math.PI) * r];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

// nome de domínio longo em duas linhas, cortando no espaço mais perto do meio (vizinhos no anel
// ficam a ~100 px: "Fontes & Referências" numa linha só encostava em "Comunicação")
function duasLinhas(nome: string): string[] {
  if (nome.length <= 13 || !nome.includes(' ')) return [nome];
  const meio = nome.length / 2;
  let corte = -1;
  for (let i = 0; i < nome.length; i++) if (nome[i] === ' ' && (corte < 0 || Math.abs(i - meio) < Math.abs(corte - meio))) corte = i;
  return [nome.slice(0, corte), nome.slice(corte + 1)];
}

// Skill Tree: visão geral com os domínios como insígnias (anel = dominadas e treinando) e as
// habilidades como pontos; clicar num domínio aproxima dele e abre a ficha com as habilidades.
export function SkillTreeView({ notes, onOpen }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<any>(null);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [foco, setFoco] = useState<string | null>(null);

  // agrupa por DOMÍNIO → SUBDIVISÃO → habilidades (classificador de competências)
  const domains = useMemo(() => {
    const dmap = new Map<string, Map<string, Note[]>>();
    for (const n of notes) {
      const { dominio, sub } = classify(n);
      if (!dmap.has(dominio)) dmap.set(dominio, new Map());
      const sm = dmap.get(dominio)!;
      if (!sm.has(sub)) sm.set(sub, []);
      sm.get(sub)!.push(n);
    }
    return [...dmap.entries()]
      .map(([dominio, sm]) => {
        const todas = [...sm.values()].flat();
        return {
          dominio,
          total: todas.length,
          dominadas: todas.filter((n) => estado(n) === 'mastered').length,
          treinando: todas.filter((n) => estado(n) === 'active').length,
          subs: [...sm.entries()]
            .map(([sub, items]) => ({
              sub,
              items: items.sort(
                (x, y) => EST_ORDEM[estado(x)] - EST_ORDEM[estado(y)] || (x.ordem ?? 99) - (y.ordem ?? 99) || (x.title > y.title ? 1 : -1),
              ),
            }))
            .sort((a, b) => b.items.length - a.items.length),
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [notes]);

  const { nodes, links, radius } = useMemo(() => {
    const R = 140 + notes.length * 3.2;
    const rootData: any = {
      name: 'Você',
      root: true,
      children: domains.map((d) => ({
        name: d.dominio,
        dom: d.dominio,
        isDom: true,
        info: d,
        children: d.subs.map((s) => ({
          name: s.sub,
          dom: d.dominio,
          isSub: true,
          count: s.items.length,
          children: s.items.map((n) => ({ name: n.title, id: n.id, note: n, dom: d.dominio, leaf: true })),
        })),
      })),
    };
    const root = d3.hierarchy(rootData);
    d3
      .cluster<any>()
      .size([2 * Math.PI, R])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2.4) / Math.max(1, a.depth))(root);
    // domínios espaçados por igual no anel do meio raio, na mesma ordem das folhas (nenhuma linha
    // cruza): no ângulo natural os domínios pequenos se amontoavam e as insígnias se cobriam
    const doms = (root.children || []) as any[];
    const passo = (2 * Math.PI) / Math.max(1, doms.length);
    const desvio = doms.length ? doms[0].x - passo / 2 : 0;
    doms.forEach((n, i) => {
      n.x = desvio + passo * (i + 0.5);
      n.y = R * 0.55;
    });
    return { nodes: root.descendants(), links: root.links(), radius: R };
  }, [domains, notes.length]);

  const dominadas = useMemo(() => notes.filter((n) => estado(n) === 'mastered').length, [notes]);
  const treinando = useMemo(() => notes.filter((n) => estado(n) === 'active').length, [notes]);
  const pos = (n: any): [number, number] => (n.data.root ? [0, 0] : [Math.cos(n.x - Math.PI / 2) * n.y, Math.sin(n.x - Math.PI / 2) * n.y]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoomB = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.12, 3])
      .on('zoom', (ev: any) => setT({ x: ev.transform.x, y: ev.transform.y, k: ev.transform.k }));
    zoomRef.current = zoomB;
    const sel: any = d3.select(svg);
    sel.call(zoomB);
    return () => {
      sel.on('.zoom', null);
    };
  }, []);

  // enquadra: a árvore inteira, ou o domínio em foco (no espaço à esquerda da ficha)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    const w = svg.clientWidth || 900, h = svg.clientHeight || 600;
    let alvo: d3.ZoomTransform;
    if (!foco) {
      const k = Math.min(1, (Math.min(w, h) * 0.47) / (radius + 60));
      alvo = d3.zoomIdentity.translate(w / 2, h / 2).scale(k);
    } else {
      const pts = nodes.filter((n: any) => n.data.dom === foco).map(pos);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs) - 200, x1 = Math.max(...xs) + 200, y0 = Math.min(...ys) - 120, y1 = Math.max(...ys) + 120;
      const livre = w - 380; // a ficha ocupa a direita
      const k = Math.max(0.35, Math.min(1.4, livre / (x1 - x0), h / (y1 - y0)));
      alvo = d3.zoomIdentity.translate(livre / 2 - ((x0 + x1) / 2) * k, h / 2 - ((y0 + y1) / 2) * k).scale(k);
    }
    d3.select(svg).transition().duration(550).call(zoomRef.current.transform, alvo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco, radius]);

  const linkGen = d3.linkRadial<any, any>().angle((d: any) => d.x).radius((d: any) => d.y);
  const dominioFoco = domains.find((d) => d.dominio === foco);

  return (
    <div className="skill-wrap" ref={wrapRef}>
      <div className="skill-head">
        <div className="eyebrow-mono">Árvore de habilidades</div>
        <h1 className="rm-title" style={{ margin: '4px 0 2px' }}>Skill Tree</h1>
        <p className="muted small">
          {notes.length} habilidades em {domains.length} domínios ·{' '}
          <b style={{ color: EST_COR.mastered }}>{dominadas} dominadas</b> ·{' '}
          <b style={{ color: EST_COR.active }}>{treinando} treinando</b>.{' '}
          {foco ? 'Clique fora ou no X para voltar à árvore inteira.' : 'Clique num domínio para ver as habilidades.'}
        </p>
      </div>
      <svg ref={svgRef} className="skill-svg" onClick={(e) => e.target === svgRef.current && setFoco(null)}>
        <defs>
          <filter id="sk-glow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {/* anéis de nível ao fundo: núcleo, domínios e a borda das habilidades */}
          {[radius * 0.55, (radius * 2) / 3, radius].map((r, i) => (
            <circle key={i} r={r} className="sk-anel" />
          ))}
          {links.map((l: any, i: number) => {
            const st: Estado = l.target.data.leaf ? estado(l.target.data.note) : 'known';
            const branch = !l.target.data.leaf;
            const fora = foco && l.target.data.dom !== foco;
            return (
              <path
                key={i}
                className="sk-link"
                d={linkGen(l) || ''}
                style={{
                  stroke: colorForArea(l.target.data.dom || ''),
                  strokeWidth: branch ? (l.target.data.isDom ? 3 : 1.8) : 1,
                  opacity: fora ? 0.05 : branch ? 0.55 : st === 'locked' ? 0.12 : 0.32,
                }}
              />
            );
          })}
          {nodes.map((n: any, i: number) => {
            const d = n.data;
            const [x, y] = pos(n);
            const fora = !!foco && !d.root && d.dom !== foco;
            if (d.root)
              return (
                <g key={i} transform={`scale(${Math.max(1, 0.8 / t.k)})`}>
                  <path d={hexPath(30)} fill="none" stroke="#FFC53D" strokeWidth={1.4} opacity={0.5} style={{ filter: 'url(#sk-glow)' }} />
                  <path d={hexPath(24)} fill="#1a1f2b" stroke="#FFC53D" strokeWidth={2} />
                  <text textAnchor="middle" dy="0.36em" style={{ fontSize: 22 }}>🧠</text>
                </g>
              );
            if (d.isDom) {
              const info = d.info;
              const cor = colorForArea(d.dom);
              const on = foco === d.dom;
              const fd = info.dominadas / info.total, ft = info.treinando / info.total;
              return (
                <g
                  key={i}
                  // a insígnia guarda tamanho de tela legível em qualquer zoom (a árvore inteira cabe a ~25%)
                  transform={`translate(${x},${y}) scale(${Math.max(1, 0.8 / t.k)})`}
                  className={'sk-dom' + (on ? ' on' : '')}
                  style={{ opacity: fora ? 0.25 : 1, cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFoco(on ? null : d.dom);
                  }}
                >
                  <circle r={40} className="sk-dom-fundo" />
                  <circle r={34} fill="none" stroke="#232935" strokeWidth={6} />
                  <path d={arco(34, 0, fd)} fill="none" stroke={EST_COR.mastered} strokeWidth={6} strokeLinecap="round" />
                  <path d={arco(34, fd, fd + ft)} fill="none" stroke={EST_COR.active} strokeWidth={6} strokeLinecap="round" />
                  <path d={hexPath(24)} fill={cor} stroke="#0C0E14" strokeWidth={2} style={{ filter: on ? 'url(#sk-glow)' : undefined }} />
                  <text textAnchor="middle" dy="0.36em" className="sk-dom-num">{info.total}</text>
                  <text textAnchor="middle" y={58} className="sk-dom-nome">
                    {duasLinhas(d.name).map((l, j) => (
                      <tspan key={j} x={0} dy={j ? 17 : 0}>{l}</tspan>
                    ))}
                  </text>
                  <text textAnchor="middle" y={duasLinhas(d.name).length > 1 ? 93 : 76} className="sk-dom-sub">
                    <tspan fill={EST_COR.mastered}>★ {info.dominadas}</tspan>
                    <tspan dx={10} fill={EST_COR.active}>▶ {info.treinando}</tspan>
                  </text>
                </g>
              );
            }
            if (d.isSub) {
              const cor = colorForArea(d.dom);
              const mostra = (foco === d.dom || t.k > 0.9) && !fora;
              const ang = ((n.x - Math.PI / 2) * 180) / Math.PI;
              const flip = n.x >= Math.PI;
              return (
                <g key={i} transform={`translate(${x},${y})`} style={{ opacity: fora ? 0.12 : 1 }}>
                  <path d={hexPath(7)} fill="#141a24" stroke={cor} strokeWidth={1.6} />
                  {mostra && (
                    <text
                      className="sk-label sk-sub"
                      transform={`rotate(${flip ? ang + 180 : ang}) translate(${flip ? -13 : 13},0)`}
                      dy="0.32em"
                      textAnchor={flip ? 'end' : 'start'}
                    >
                      {d.name} · {d.count}
                    </text>
                  )}
                </g>
              );
            }
            const st: Estado = estado(d.note);
            const cor = EST_COR[st];
            const r = st === 'mastered' ? 6 : st === 'active' ? 5.5 : 4;
            const lit = st === 'mastered' || st === 'active';
            const isHover = hover === d.id;
            const ang = ((n.x - Math.PI / 2) * 180) / Math.PI;
            const flip = n.x >= Math.PI;
            const mostra = isHover || (!fora && (foco === d.dom || t.k > 1.5));
            return (
              <g
                key={i}
                transform={`translate(${x},${y})`}
                className={'sk-node sk-' + st}
                style={{ opacity: fora ? 0.1 : 1, cursor: 'pointer' }}
                onMouseEnter={() => setHover(d.id)}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(d.id);
                }}
              >
                <path
                  className="sk-core"
                  d={hexPath(r)}
                  fill={st === 'locked' ? '#141a24' : cor}
                  stroke={cor}
                  strokeWidth={1.3}
                  style={{ filter: lit && !fora ? 'url(#sk-glow)' : undefined }}
                />
                {mostra && (
                  <text
                    className="sk-label"
                    transform={`rotate(${flip ? ang + 180 : ang}) translate(${flip ? -(r + 8) : r + 8},0)`}
                    dy="0.32em"
                    textAnchor={flip ? 'end' : 'start'}
                    style={{ fontSize: 12, fontWeight: isHover ? 600 : 400, fill: isHover ? '#fff' : st === 'locked' ? '#7E8595' : undefined }}
                  >
                    {d.name.length > 52 ? d.name.slice(0, 50) + '…' : d.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {dominioFoco && (
        <aside className="sk-ficha">
          <div className="sk-ficha-topo">
            <div>
              <div className="eyebrow-mono" style={{ color: colorForArea(dominioFoco.dominio) }}>Domínio</div>
              <h2>{dominioFoco.dominio}</h2>
            </div>
            <button className="btn ghost" onClick={() => setFoco(null)} aria-label="Fechar">✕</button>
          </div>
          <div className="sk-barra">
            <i style={{ width: `${(dominioFoco.dominadas / dominioFoco.total) * 100}%`, background: EST_COR.mastered }} />
            <i style={{ width: `${(dominioFoco.treinando / dominioFoco.total) * 100}%`, background: EST_COR.active }} />
          </div>
          <p className="muted small">
            {dominioFoco.total} habilidades · <b style={{ color: EST_COR.mastered }}>{dominioFoco.dominadas} dominadas</b> ·{' '}
            <b style={{ color: EST_COR.active }}>{dominioFoco.treinando} treinando</b>
          </p>
          {dominioFoco.subs.map((s) => (
            <section key={s.sub} className="sk-ficha-sub">
              <h3>
                {s.sub} <span>{s.items.length}</span>
              </h3>
              {s.items.map((n) => {
                const st = estado(n);
                return (
                  <button key={n.id} className={'sk-item sk-item-' + st} onClick={() => onOpen(n.id)} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
                    <svg width="14" height="14" viewBox="-7 -7 14 14">
                      <path d={hexPath(5.5)} fill={st === 'mastered' || st === 'active' ? EST_COR[st] : '#141a24'} stroke={EST_COR[st]} strokeWidth={1.3} />
                    </svg>
                    <span className="sk-item-nome">{n.title}</span>
                    <span className="sk-item-est">{EST_NOME[st]}</span>
                  </button>
                );
              })}
            </section>
          ))}
        </aside>
      )}

      <div className="skill-legend">
        <span><i style={{ background: EST_COR.mastered }} /> dominada</span>
        <span><i style={{ background: EST_COR.active }} /> treinando</span>
        <span><i style={{ background: EST_COR.known }} /> desbloqueada</span>
        <span><i style={{ background: '#141a24', borderColor: EST_COR.locked }} /> a fazer</span>
        <span className="sep">anel do domínio = dominadas + treinando</span>
      </div>
    </div>
  );
}
