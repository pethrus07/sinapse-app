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

// hexágono pointy-top de raio r (dá o ar de "skill node" de RPG)
function hexPath(r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`);
  }
  return 'M' + pts.join('L') + 'Z';
}

export function SkillTreeView({ notes, onOpen }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fitted = useRef(false);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);

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
      .map(([dominio, sm]) => ({
        dominio,
        total: [...sm.values()].reduce((a, v) => a + v.length, 0),
        subs: [...sm.entries()]
          .map(([sub, items]) => ({
            sub,
            items: items.sort(
              (x, y) => (x.ordem ?? 99) - (y.ordem ?? 99) || (x.title > y.title ? 1 : -1),
            ),
          }))
          .sort((a, b) => b.items.length - a.items.length),
      }))
      .sort((a, b) => b.total - a.total);
  }, [notes]);

  const { nodes, links, radius } = useMemo(() => {
    const R = 110 + notes.length * 6;
    const rootData: any = {
      name: 'Você',
      root: true,
      children: domains.map((d) => ({
        name: d.dominio,
        dom: d.dominio,
        isDom: true,
        count: d.total,
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
    return { nodes: root.descendants(), links: root.links(), radius: R };
  }, [domains, notes.length]);

  const dominadas = useMemo(() => notes.filter((n) => estado(n) === 'mastered').length, [notes]);
  const treinando = useMemo(() => notes.filter((n) => estado(n) === 'active').length, [notes]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoomB = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.12, 2.6])
      .on('zoom', (ev: any) => setT({ x: ev.transform.x, y: ev.transform.y, k: ev.transform.k }));
    const sel: any = d3.select(svg);
    sel.call(zoomB);
    if (!fitted.current) {
      const w = wrapRef.current?.clientWidth || 900;
      const h = wrapRef.current?.clientHeight || 600;
      const k = Math.min(1, (Math.min(w, h) * 0.46) / radius);
      const init = d3.zoomIdentity.translate(w / 2, h / 2).scale(k);
      sel.call(zoomB.transform, init);
      setT({ x: w / 2, y: h / 2, k });
      fitted.current = true;
    }
    return () => {
      sel.on('.zoom', null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  const linkGen = d3.linkRadial<any, any>().angle((d: any) => d.x).radius((d: any) => d.y);

  return (
    <div className="skill-wrap" ref={wrapRef}>
      <div className="skill-head">
        <div className="eyebrow-mono">Árvore de habilidades</div>
        <h1 className="rm-title" style={{ margin: '4px 0 2px' }}>Skill Tree</h1>
        <p className="muted small">
          {notes.length} habilidades · {domains.length} domínios ·{' '}
          <b style={{ color: '#FFC53D' }}>{dominadas} dominadas</b> ·{' '}
          <b style={{ color: '#2CD4C0' }}>{treinando} treinando</b> — arraste, scroll pra zoom, clique num nó.
        </p>
      </div>
      <svg ref={svgRef} className="skill-svg">
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
          {links.map((l: any, i: number) => {
            const st: Estado = l.target.data.leaf ? estado(l.target.data.note) : 'known';
            const branch = !l.target.data.leaf; // núcleo→domínio→sub = "galho" (sempre aceso)
            const glow = st === 'mastered' || st === 'active' || l.target.data.isDom;
            return (
              <path
                key={i}
                className="sk-link"
                d={linkGen(l) || ''}
                style={{
                  stroke: colorForArea(l.target.data.dom || ''),
                  strokeWidth: branch ? (l.target.data.isDom ? 2.8 : 1.8) : 1.1,
                  opacity: branch ? 0.6 : st === 'locked' ? 0.16 : 0.4,
                  filter: glow ? 'url(#sk-glow)' : undefined,
                }}
              />
            );
          })}
          {nodes.map((n: any, i: number) => {
            const isRoot = !!n.data.root;
            const isDom = !!n.data.isDom;
            const isSub = !!n.data.isSub;
            const leaf = !!n.data.leaf;
            const x = isRoot ? 0 : Math.cos(n.x - Math.PI / 2) * n.y;
            const y = isRoot ? 0 : Math.sin(n.x - Math.PI / 2) * n.y;
            const st: Estado = leaf ? estado(n.data.note) : 'known';
            const r = isRoot ? 18 : isDom ? 13 : isSub ? 8 : st === 'mastered' ? 7 : st === 'active' ? 6 : 5;
            const cor = isRoot ? '#FFC53D' : leaf ? EST_COR[st] : colorForArea(n.data.dom || '');
            const lit = isRoot || isDom || isSub || st === 'mastered' || st === 'active';
            const ang = ((n.x - Math.PI / 2) * 180) / Math.PI;
            const flip = n.x >= Math.PI;
            const isHover = hover === n.data.id;
            const showLabel = isRoot || isDom || isSub || isHover || st === 'mastered' || t.k > 1.2;
            return (
              <g
                key={i}
                transform={`translate(${x},${y})`}
                className={'sk-node sk-' + st}
                onMouseEnter={() => leaf && setHover(n.data.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => (leaf ? onOpen(n.data.id) : null)}
                style={{ cursor: leaf ? 'pointer' : 'default' }}
              >
                {(isRoot || isDom || st === 'mastered') && (
                  <path d={hexPath(r + 4)} fill="none" stroke={cor} strokeWidth={1.4} opacity={0.5} style={{ filter: 'url(#sk-glow)' }} />
                )}
                <path
                  className="sk-core"
                  d={hexPath(r)}
                  fill={lit ? cor : '#141a24'}
                  stroke={cor}
                  strokeWidth={isDom || isRoot ? 2 : 1.4}
                  style={{ filter: lit ? 'url(#sk-glow)' : undefined, opacity: st === 'locked' ? 0.7 : 1 }}
                />
                {st === 'mastered' && leaf && (
                  <text textAnchor="middle" dy="0.32em" style={{ fontSize: 8, fill: '#141a24', fontWeight: 700 }}>★</text>
                )}
                {isRoot && (
                  <text textAnchor="middle" dy="0.34em" style={{ fontSize: 16 }}>🧠</text>
                )}
                {showLabel && (
                  <text
                    className="sk-label"
                    transform={
                      leaf || isSub
                        ? `rotate(${flip ? ang + 180 : ang}) translate(${flip ? -(r + 8) : r + 8},0)`
                        : `translate(0,${-(r + 10)})`
                    }
                    dy="0.32em"
                    textAnchor={leaf || isSub ? (flip ? 'end' : 'start') : 'middle'}
                    style={{
                      fontSize: isRoot ? 14 : isDom ? 13 : isSub ? 11 : 10.5,
                      fontWeight: isRoot ? 700 : isDom ? 700 : isSub ? 600 : isHover ? 600 : 400,
                      fill: isHover ? '#fff' : isDom ? colorForArea(n.data.dom || '') : undefined,
                    }}
                  >
                    {isDom || isSub ? `${n.data.name} · ${n.data.count}` : n.data.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="skill-legend">
        <span><i style={{ background: '#FFC53D' }} /> dominada ★</span>
        <span><i style={{ background: '#2CD4C0' }} /> treinando</span>
        <span><i style={{ background: '#9AA6B8' }} /> desbloqueada</span>
        <span><i style={{ background: '#141a24', borderColor: '#5B6472' }} /> a fazer</span>
      </div>
    </div>
  );
}
