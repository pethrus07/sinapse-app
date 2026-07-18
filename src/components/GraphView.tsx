import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { GraphData } from '../types';
import { colorForArea } from '../lib/colors';

interface Props {
  data: GraphData;
  onSelect: (id: string) => void;
}

export function GraphView({ data, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    let width = wrap.clientWidth || 800;
    let height = wrap.clientHeight || 600;

    const nodes: any[] = data.nodes.map((n) => ({ ...n }));
    const edges: any[] = data.edges.map((e) => ({ ...e }));

    const neighbor = new Map<string, Set<string>>();
    for (const e of data.edges) {
      if (!neighbor.has(e.source)) neighbor.set(e.source, new Set());
      if (!neighbor.has(e.target)) neighbor.set(e.target, new Set());
      neighbor.get(e.source)!.add(e.target);
      neighbor.get(e.target)!.add(e.source);
    }

    const radius = (n: any) => Math.max(4, Math.min(24, 4 + (n.degree || 0) * 1.7));

    let transform = d3.zoomIdentity.translate(width / 2, height / 2);
    let hovered: any = null;

    const sim = d3
      .forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id((d: any) => d.id).distance(58).strength(0.22))
      .force('charge', d3.forceManyBody().strength(-150))
      .force('x', d3.forceX(0).strength(0.06))
      .force('y', d3.forceY(0).strength(0.06))
      .force('collide', d3.forceCollide().radius((d: any) => radius(d) + 6))
      .on('tick', draw);

    const zoomB = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 6])
      .on('zoom', (ev: any) => {
        transform = ev.transform;
        draw();
      });
    const sel: any = d3.select(canvas);
    sel.call(zoomB);
    sel.call(zoomB.transform, transform);

    function draw() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      const hood = hovered ? neighbor.get(hovered.id) : null;

      for (const e of edges) {
        const s = e.source, t = e.target;
        if (!s || !t || s.x == null) continue;
        const active = hovered && (s.id === hovered.id || t.id === hovered.id);
        ctx.strokeStyle = active
          ? 'rgba(44,212,192,0.75)'
          : e.ghost
          ? 'rgba(130,140,160,0.08)'
          : 'rgba(130,140,160,0.20)';
        ctx.lineWidth = (active ? 1.6 : 1) / transform.k;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }

      for (const n of nodes) {
        if (n.x == null) continue;
        const dim = hovered && n.id !== hovered.id && !(hood && hood.has(n.id));
        const r = radius(n);
        ctx.globalAlpha = dim ? 0.22 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.ghost ? '#232a37' : colorForArea(n.area);
        ctx.fill();
        if (hovered && n.id === hovered.id) {
          ctx.lineWidth = 2 / transform.k;
          ctx.strokeStyle = '#eaf6f4';
          ctx.stroke();
        } else if (n.ghost) {
          ctx.lineWidth = 1 / transform.k;
          ctx.strokeStyle = '#3c4658';
          ctx.setLineDash([2 / transform.k, 2 / transform.k]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const showLabel = r >= 9 || (hovered && (n.id === hovered.id || (hood && hood.has(n.id))));
        if (showLabel) {
          ctx.save();
          ctx.translate(n.x, n.y);
          ctx.scale(1 / transform.k, 1 / transform.k);
          ctx.globalAlpha = dim ? 0.25 : 0.92;
          ctx.fillStyle = '#c9d2e0';
          ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText(n.title, r * transform.k + 5, 4);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    function resize() {
      width = wrap.clientWidth || width;
      height = wrap.clientHeight || height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      draw();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    function toGraph(px: number, py: number) {
      return { x: (px - transform.x) / transform.k, y: (py - transform.y) / transform.k };
    }
    function pick(px: number, py: number) {
      const { x, y } = toGraph(px, py);
      let best: any = null;
      let bd = Infinity;
      for (const n of nodes) {
        if (n.x == null) continue;
        const dx = n.x - x, dy = n.y - y, d = dx * dx + dy * dy;
        const rr = radius(n) + 4;
        if (d < rr * rr && d < bd) {
          bd = d;
          best = n;
        }
      }
      return best;
    }
    function onMove(ev: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const n = pick(ev.clientX - rect.left, ev.clientY - rect.top);
      if (n !== hovered) {
        hovered = n;
        canvas.style.cursor = n ? 'pointer' : 'grab';
        draw();
      }
    }
    function onClick(ev: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const n = pick(ev.clientX - rect.left, ev.clientY - rect.top);
      if (n && !n.ghost) onSelectRef.current(n.id);
    }
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);
    canvas.style.cursor = 'grab';

    return () => {
      sim.stop();
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
    };
  }, [data]);

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
      <div className="graph-hint">arraste pra mover · scroll pra zoom · clique num nó pra abrir</div>
    </div>
  );
}
