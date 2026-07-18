import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Note } from '../types';
import { areaLabel, colorForArea } from '../lib/colors';

interface Props {
  notes: Note[];
  onOpen: (id: string) => void;
}

export function TreeView({ notes, onOpen }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fitted = useRef(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [t, setT] = useState({ x: 110, y: 60, k: 1 });

  const areas = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const n of notes) {
      const a = n.area || 'outros';
      if (!map.has(a)) map.set(a, []);
      map.get(a)!.push(n);
    }
    return [...map.entries()]
      .map(([area, items]) => ({ area, items: items.sort((x, y) => (x.title > y.title ? 1 : -1)) }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [notes]);

  const { nodes, links } = useMemo(() => {
    const rootData: any = {
      name: 'Sinapse',
      root: true,
      children: areas.map((a) => ({
        name: areaLabel(a.area),
        area: a.area,
        isArea: true,
        count: a.items.length,
        children: collapsed.has(a.area)
          ? []
          : a.items.map((n) => ({ name: n.title, id: n.id, degree: n.degree, area: a.area, leaf: true })),
      })),
    };
    const root = d3.hierarchy(rootData);
    d3.tree<any>()
      .nodeSize([24, 250])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.5))(root);
    return { nodes: root.descendants(), links: root.links() };
  }, [areas, collapsed]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoomB = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 2.5])
      .on('zoom', (ev: any) => setT({ x: ev.transform.x, y: ev.transform.y, k: ev.transform.k }));
    const sel: any = d3.select(svg);
    sel.call(zoomB);
    if (!fitted.current) {
      const h = wrapRef.current?.clientHeight || 600;
      const xs = nodes.map((n: any) => n.x);
      const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
      const init = d3.zoomIdentity.translate(120, h / 2 - mid);
      sel.call(zoomB.transform, init);
      setT({ x: 120, y: h / 2 - mid, k: 1 });
      fitted.current = true;
    }
    return () => {
      sel.on('.zoom', null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linkGen = d3.linkHorizontal<any, any>().x((d: any) => d.y).y((d: any) => d.x);

  function toggle(area: string) {
    setCollapsed((s) => {
      const ns = new Set(s);
      ns.has(area) ? ns.delete(area) : ns.add(area);
      return ns;
    });
  }

  return (
    <div className="tree-wrap" ref={wrapRef}>
      <div className="tree-head">
        <div className="eyebrow-mono">Árvore de conhecimento</div>
        <h1 className="rm-title" style={{ margin: '4px 0 2px' }}>Tudo que você plantou</h1>
        <p className="muted small">
          {notes.length} notas · {areas.length} galhos — arraste pra mover, scroll pra zoom, clique num galho pra recolher.
        </p>
      </div>
      <svg ref={svgRef} className="tree-svg">
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {links.map((l: any, i: number) => (
            <path
              key={i}
              className="tw-link"
              d={linkGen(l) || ''}
              style={{
                stroke: colorForArea(l.target.data.area),
                strokeWidth: l.target.data.leaf ? 1.4 : 2.4,
              }}
            />
          ))}
          {nodes.map((n: any, i: number) => {
            const isRoot = !!n.data.root;
            const isArea = !!n.data.isArea;
            const leaf = !!n.data.leaf;
            const r = isRoot ? 9 : isArea ? 7 : Math.max(3, Math.min(8, 3 + (n.data.degree || 0) * 0.7));
            const color = isRoot ? '#2CD4C0' : colorForArea(n.data.area);
            const anchorEnd = isRoot || isArea;
            const cls = 'tw-node ' + (leaf ? 'tw-leaf' : isArea ? 'tw-area' : 'tw-root');
            return (
              <g
                key={i}
                className={cls}
                transform={`translate(${n.y},${n.x})`}
                onClick={() => (leaf ? onOpen(n.data.id) : isArea ? toggle(n.data.area) : null)}
              >
                {isArea && collapsed.has(n.data.area) && (
                  <circle className="tw-collapsed-ring" r={r + 4} style={{ stroke: color }} />
                )}
                <circle r={r} fill={color} stroke={isRoot ? '#0C0E14' : 'none'} strokeWidth={2} />
                <text
                  className="tw-label"
                  x={anchorEnd ? -(r + 7) : r + 7}
                  dy="0.32em"
                  textAnchor={anchorEnd ? 'end' : 'start'}
                  style={{
                    fontWeight: isRoot ? 700 : isArea ? 600 : 400,
                    fontSize: isRoot ? 15 : isArea ? 13 : 12,
                  }}
                >
                  {isArea ? `${n.data.name} · ${n.data.count}` : n.data.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
