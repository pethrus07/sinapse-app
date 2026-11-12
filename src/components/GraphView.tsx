import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { GraphData } from '../types';
import { areaLabel, colorForArea } from '../lib/colors';

interface Props {
  data: GraphData;
  onSelect: (id: string) => void;
}

// Grafo do vault. Cada área tem a sua região (força fraca puxando para um ponto no círculo), então a
// cor da legenda vira um lugar no mapa. Nome só aparece se couber: primeiro os mais conectados, e
// quem encosta num nome já escrito fica sem (mais nomes aparecem com o zoom).
export function GraphView({ data, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // área em foco (clique na legenda): as outras apagam
  const [foco, setFoco] = useState<string | null>(null);
  const focoRef = useRef<string | null>(null);
  const redesenhar = useRef<() => void>(() => {});
  const [legendaAberta, setLegendaAberta] = useState(true);

  const areas = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of data.nodes) if (!n.ghost) m.set(n.area || 'outros', (m.get(n.area || 'outros') || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);
  const fantasmas = useMemo(() => data.nodes.filter((n) => n.ghost).length, [data]);

  useEffect(() => {
    focoRef.current = foco;
    redesenhar.current();
  }, [foco]);

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

    const radius = (n: any) => (n.ghost ? 3 : Math.min(15, 3 + Math.sqrt(n.degree || 0) * 1.5));
    // região de cada área: um ponto no círculo, na ordem da legenda
    const ordem = areas.map(([a]) => a);
    const R0 = 120 + Math.sqrt(nodes.length) * 14;
    const ancora = (a: string) => {
      const i = Math.max(0, ordem.indexOf(a || 'outros'));
      const ang = (i / Math.max(1, ordem.length)) * Math.PI * 2 - Math.PI / 2;
      return [Math.cos(ang) * R0, Math.sin(ang) * R0];
    };
    // os mais conectados primeiro: são os que ganham nome quando falta espaço
    const porGrau = [...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0));

    let transform = d3.zoomIdentity;
    let hovered: any = null;

    const sim = d3
      .forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id((d: any) => d.id).distance(46).strength(0.12))
      .force('charge', d3.forceManyBody().strength(-90))
      .force('x', d3.forceX((d: any) => ancora(d.area)[0]).strength(0.07))
      .force('y', d3.forceY((d: any) => ancora(d.area)[1]).strength(0.07))
      .force('collide', d3.forceCollide().radius((d: any) => radius(d) + 3))
      .stop();
    // assenta antes de mostrar: animado, cada passo redesenha as 2 mil linhas e o grafo levava
    // segundos "explodindo" na tela; depois só um resto de movimento, já enquadrado
    sim.tick(160);
    {
      // enquadra pela massa, não pela caixa: as poucas notas soltas lá longe deslocavam o centro
      const xs = nodes.map((n) => n.x).sort((a, b) => a - b), ys = nodes.map((n) => n.y).sort((a, b) => a - b);
      const q = (l: number[], f: number) => l[Math.floor((l.length - 1) * f)];
      const x0 = q(xs, 0.05), x1 = q(xs, 0.95), y0 = q(ys, 0.05), y1 = q(ys, 0.95);
      const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
      const livreW = width - 290, livreH = height - 70; // à direita da legenda
      const k = 0.88 * Math.min(1.3, livreW / (x1 - x0 + 220), livreH / (y1 - y0 + 120));
      transform = d3.zoomIdentity.translate(280 + livreW / 2 - cx * k, 20 + livreH / 2 - cy * k).scale(k);
    }
    sim.alpha(0.03).on('tick', draw).restart();

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
      const focoArea = focoRef.current;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      const hood = hovered ? neighbor.get(hovered.id) : null;
      const apagado = (n: any) =>
        hovered ? n.id !== hovered.id && !(hood && hood.has(n.id)) : focoArea ? n.area !== focoArea : false;

      for (const e of edges) {
        const s = e.source, t = e.target;
        if (!s || !t || s.x == null) continue;
        const active = hovered && (s.id === hovered.id || t.id === hovered.id);
        const daArea = focoArea && !hovered && s.area === focoArea && t.area === focoArea;
        // cor de área pode vir em hsl (área nova): a transparência vai pelo globalAlpha
        ctx.globalAlpha = daArea ? 0.45 : 1;
        ctx.strokeStyle = active
          ? 'rgba(44,212,192,0.8)'
          : daArea
          ? colorForArea(focoArea!)
          : e.ghost
          ? 'rgba(130,140,160,0.07)'
          : hovered || focoArea
          ? 'rgba(130,140,160,0.05)'
          : 'rgba(130,140,160,0.14)';
        ctx.lineWidth = (active ? 1.6 : 1) / transform.k;
        if (e.ghost) ctx.setLineDash([3 / transform.k, 3 / transform.k]);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const n of nodes) {
        if (n.x == null) continue;
        const r = radius(n);
        ctx.globalAlpha = apagado(n) ? 0.12 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.ghost ? '#1a202b' : colorForArea(n.area);
        ctx.fill();
        if (hovered && n.id === hovered.id) {
          ctx.lineWidth = 2.5 / transform.k;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        } else if (n.ghost) {
          ctx.lineWidth = 1 / transform.k;
          ctx.strokeStyle = '#4a5468';
          ctx.setLineDash([2 / transform.k, 2 / transform.k]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.lineWidth = 1.2 / transform.k;
          ctx.strokeStyle = '#0C0E14';
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      // nomes em coordenada de tela, sem sobrepor: caixa ocupada não recebe outro nome
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ocupado: [number, number, number, number][] = [];
      const cabe = (b: [number, number, number, number]) =>
        !ocupado.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
      // quanto mais zoom, mais nomes; hover e vizinhos sempre
      const limite = Math.round(18 * transform.k * transform.k);
      let escritos = 0;
      const candidatos = hovered ? [hovered, ...porGrau.filter((n) => hood?.has(n.id)), ...porGrau] : porGrau;
      const vistos = new Set<string>();
      for (const n of candidatos) {
        if (n.x == null || n.ghost || vistos.has(n.id)) continue;
        vistos.add(n.id);
        const prioridade = hovered && (n.id === hovered.id || hood?.has(n.id));
        if (!prioridade && (apagado(n) || escritos >= limite)) continue;
        const sx = n.x * transform.k + transform.x, sy = n.y * transform.k + transform.y;
        if (sx < -50 || sy < -20 || sx > width + 50 || sy > height + 20) continue;
        const forte = hovered && n.id === hovered.id;
        ctx.font = `${forte ? 600 : (n.degree || 0) > 30 ? 600 : 400} ${forte ? 13 : 11.5}px ui-sans-serif, system-ui, sans-serif`;
        const texto = n.title.length > 42 ? n.title.slice(0, 40) + '…' : n.title;
        const w = ctx.measureText(texto).width;
        const x = sx + radius(n) * transform.k + 5, y = sy + 4;
        const caixa: [number, number, number, number] = [x - 2, y - 11, x + w + 2, y + 4];
        if (!cabe(caixa) && !forte) continue;
        ocupado.push(caixa);
        escritos++;
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(12,14,20,0.92)';
        ctx.strokeText(texto, x, y);
        ctx.fillStyle = forte ? '#ffffff' : prioridade ? '#e3e8f1' : '#b9c2d2';
        ctx.fillText(texto, x, y);
      }
      ctx.restore();
    }
    redesenhar.current = draw;

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
        const rr = radius(n) + 4 / transform.k;
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
  }, [data, areas]);

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
      <div className="graph-legenda">
        <button className="gl-topo" onClick={() => setLegendaAberta((v) => !v)}>
          <span className="eyebrow-mono">Legenda</span>
          <span className="gl-seta">{legendaAberta ? '−' : '+'}</span>
        </button>
        {legendaAberta && (
          <>
            <div className="gl-sec">Cor = área · clique para destacar</div>
            <div className="gl-areas">
              {areas.map(([a, n]) => (
                <button
                  key={a}
                  className={'gl-area' + (foco === a ? ' on' : foco ? ' off' : '')}
                  onClick={() => setFoco((f) => (f === a ? null : a))}
                >
                  <i style={{ background: colorForArea(a) }} />
                  <span>{areaLabel(a)}</span>
                  <b>{n}</b>
                </button>
              ))}
            </div>
            <div className="gl-sec">Tamanho = conexões</div>
            <div className="gl-tamanhos">
              {[2, 15, 60].map((g) => {
                const r = Math.min(15, 3 + Math.sqrt(g) * 1.5);
                return (
                  <span key={g}>
                    <i style={{ width: r * 2, height: r * 2 }} />
                    {g === 60 ? '60+' : g}
                  </span>
                );
              })}
            </div>
            <div className="gl-sec">Linhas</div>
            <div className="gl-linhas">
              <span><i className="cheia" /> link entre notas</span>
              {fantasmas > 0 && <span><i className="tracejada" /> nota que ainda não existe ({fantasmas})</span>}
            </div>
          </>
        )}
      </div>
      <div className="graph-hint">passe o mouse para ver os vizinhos · scroll dá zoom e mostra mais nomes · clique abre a nota</div>
    </div>
  );
}
