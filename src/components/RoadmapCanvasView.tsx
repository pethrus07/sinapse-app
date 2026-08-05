import { useEffect, useRef } from 'react';

// Canvas do roadmap do SISTEMA (Commagente): lê do vault (nota tipo: roadmap → roadmap.json),
// rende como canvas nativo (lanes por status, dependências, pan/zoom, arrastar). Posições dos
// cards ficam no localStorage (cosméticas); o conteúdo é a fonte da verdade no vault.
type Item = { id: string; t: string; s: string; p: number; n: string; deps?: string[]; x?: number; y?: number };
interface Props {
  roadmap: { items: Item[]; title?: string; rel?: string };
  onOpenSource?: () => void;
}

const LANES = [
  { id: 'done', title: 'No ar', v: '--rc-done' },
  { id: 'ready', title: 'Pronto · fora do ar', v: '--rc-ready' },
  { id: 'plan', title: 'Previsto · roadmap', v: '--rc-plan' },
  { id: 'idea', title: 'Novo · ideias', v: '--rc-idea' },
  { id: 'strat', title: 'Estratégico · decisões', v: '--rc-strat' },
];
const STAG: Record<string, string> = { done: 'no ar ✓', ready: 'pronto', plan: 'roadmap', idea: 'ideia', strat: 'estratégia' };
const STLABEL: Record<string, string> = { done: 'No ar', ready: 'Pronto, fora do ar', plan: 'Previsto (roadmap)', idea: 'Novo (ideia)', strat: 'Decisão estratégica' };
const LANE_W = 520, PITCH = 520, X0 = 40, TOP = 64, GAP = 14, PAD = 14, CW = 452;

export function RoadmapCanvasView({ roadmap, onOpenSource }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = roadmap?.items || [];
    const laneIdx: Record<string, number> = {};
    LANES.forEach((l, i) => (laneIdx[l.id] = i));
    const KEY = 'commagente-roadmap-pos';
    let saved: Record<string, { x: number; y: number }> = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { saved = {}; }

    // auto-layout por lane + override do localStorage
    const laneY: Record<string, number> = {}; LANES.forEach((l) => (laneY[l.id] = TOP));
    const laneCount: Record<string, number> = {}; LANES.forEach((l) => (laneCount[l.id] = 0));
    const pos: Record<string, { x: number; y: number }> = {};
    const cardH = (it: Item) => 54 + Math.ceil((it.n || '').length / 46) * 15.5;
    for (const it of items) {
      const s = laneIdx[it.s] != null ? it.s : 'plan';
      const ax = X0 + laneIdx[s] * PITCH + PAD, ay = laneY[s];
      pos[it.id] = saved[it.id] || { x: ax, y: ay };
      laneY[s] = ay + cardH(it) + GAP; laneCount[s]++;
    }
    const worldH = Math.max(...Object.values(laneY), 400) + 60;
    const worldW = X0 + LANES.length * PITCH + 40;

    root.innerHTML = `
      <div class="rc-bar">
        <div class="rc-title"><b>Commagente · Roadmap do Sistema</b><span>${items.length} itens · do vault · arraste pra priorizar</span></div>
        <div class="rc-filters"></div>
        <div class="rc-zoomwrap"><div class="rc-zoom"><button data-z="out">−</button><span class="rc-zl">100%</span><button data-z="in">+</button></div>
          <button class="rc-btn" data-fit>Ajustar</button>
          ${onOpenSource ? '<button class="rc-btn" data-src>Abrir nota</button>' : ''}
          <button class="rc-btn" data-reset>Reorganizar</button></div>
      </div>
      <div class="rc-canvas"><div class="rc-world"><svg class="rc-wires"></svg></div>
        <div class="rc-hint">arraste os cards pra priorizar · arraste o fundo pra navegar · role pra zoom · clique num card pra detalhes</div>
        <div class="rc-detail"><span class="rc-x">✕</span><div class="rc-dst"></div><h3 class="rc-dt"></h3><p class="rc-dp"></p><div class="rc-dd"></div></div>
      </div>`;

    const canvas = root.querySelector('.rc-canvas') as HTMLDivElement;
    const world = root.querySelector('.rc-world') as HTMLDivElement;
    const wires = root.querySelector('.rc-wires') as unknown as SVGSVGElement;
    const detail = root.querySelector('.rc-detail') as HTMLDivElement;
    world.style.width = worldW + 'px'; world.style.height = worldH + 'px';
    wires.setAttribute('width', String(worldW)); wires.setAttribute('height', String(worldH));
    const cssv = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888';

    // lanes
    LANES.forEach((l, i) => {
      const d = document.createElement('div'); d.className = 'rc-lane';
      d.style.left = (X0 + i * PITCH) + 'px'; d.style.top = '34px'; d.style.width = LANE_W + 'px'; d.style.height = (worldH - 54) + 'px';
      d.innerHTML = `<h3><span class="rc-sw" style="background:var(${l.v})"></span>${l.title}</h3><span class="rc-cnt">${laneCount[l.id] || 0}</span>`;
      world.appendChild(d);
    });

    // cards
    const els: Record<string, HTMLDivElement> = {};
    for (const it of items) {
      const s = laneIdx[it.s] != null ? it.s : 'plan';
      const el = document.createElement('div'); el.className = 'rc-card'; el.dataset.id = it.id; el.dataset.st = s;
      el.style.left = pos[it.id].x + 'px'; el.style.top = pos[it.id].y + 'px'; el.style.width = CW + 'px';
      el.style.borderLeftColor = `var(${LANES[laneIdx[s]].v})`;
      const pri = it.p ? `<span class="rc-pri rc-p${it.p}">P${it.p}</span>` : '';
      el.innerHTML = `<div class="rc-top"><span class="rc-tag" style="color:var(${LANES[laneIdx[s]].v})">${STAG[s] || s}</span>${pri}</div><h4>${it.t}</h4><p>${it.n || ''}</p>`;
      world.appendChild(el); els[it.id] = el;
    }

    function drawWires() {
      const NS = 'http://www.w3.org/2000/svg';
      wires.innerHTML = `<defs><marker id="rcah" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="${cssv('--faint')}"/></marker></defs>`;
      for (const it of items) for (const dep of it.deps || []) {
        const a = els[dep], b = els[it.id]; if (!a || !b) continue;
        const ax = parseFloat(a.style.left) + a.offsetWidth / 2, ay = parseFloat(a.style.top) + a.offsetHeight;
        const bx = parseFloat(b.style.left) + b.offsetWidth / 2, by = parseFloat(b.style.top);
        const my = (ay + by) / 2;
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', `M${ax},${ay} C${ax},${my} ${bx},${my} ${bx},${by - 8}`);
        path.setAttribute('fill', 'none'); path.setAttribute('stroke', cssv('--faint'));
        path.setAttribute('stroke-width', '1.5'); path.setAttribute('stroke-opacity', '.5'); path.setAttribute('marker-end', 'url(#rcah)');
        wires.appendChild(path);
      }
    }
    requestAnimationFrame(drawWires);

    // pan / zoom
    let pan = { x: 0, y: 0 }, zoom = 1;
    const zl = root.querySelector('.rc-zl') as HTMLSpanElement;
    const apply = () => { world.style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`; zl.textContent = Math.round(zoom * 100) + '%'; };
    const fit = () => { const r = canvas.getBoundingClientRect(); zoom = Math.min(r.width / worldW, r.height / worldH) * 0.94; zoom = Math.max(0.2, Math.min(zoom, 1)); pan.x = (r.width - worldW * zoom) / 2; pan.y = 24; apply(); };
    root.querySelector('[data-z="in"]')!.addEventListener('click', () => { zoom = Math.min(2, zoom * 1.15); apply(); });
    root.querySelector('[data-z="out"]')!.addEventListener('click', () => { zoom = Math.max(0.2, zoom / 1.15); apply(); });
    root.querySelector('[data-fit]')!.addEventListener('click', fit);
    if (onOpenSource) root.querySelector('[data-src]')?.addEventListener('click', onOpenSource);
    root.querySelector('[data-reset]')!.addEventListener('click', () => { localStorage.removeItem(KEY); location.reload(); });
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const f = e.deltaY < 0 ? 1.1 : 1 / 1.1; const nz = Math.max(0.2, Math.min(2, zoom * f)); pan.x = mx - (mx - pan.x) * (nz / zoom); pan.y = my - (my - pan.y) * (nz / zoom); zoom = nz; apply(); };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // drag: pan vs card
    let mode: string | null = null, start: any = null, dragEl: HTMLElement | null = null, moved = false;
    const persist = () => { const map: any = {}; for (const it of items) map[it.id] = { x: parseFloat(els[it.id].style.left), y: parseFloat(els[it.id].style.top) }; try { localStorage.setItem(KEY, JSON.stringify(map)); } catch {} };
    const onDown = (e: MouseEvent) => {
      const card = (e.target as HTMLElement).closest('.rc-card') as HTMLElement | null;
      if (card) { mode = 'card'; dragEl = card; card.classList.add('rc-dragging'); start = { mx: e.clientX, my: e.clientY, cx: parseFloat(card.style.left), cy: parseFloat(card.style.top) }; }
      else { mode = 'pan'; canvas.classList.add('rc-grabbing'); start = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }; }
      moved = false;
    };
    const onMove = (e: MouseEvent) => {
      if (!mode) return; const dx = e.clientX - start.mx, dy = e.clientY - start.my; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (mode === 'pan') { pan.x = start.px + dx; pan.y = start.py + dy; apply(); }
      else if (mode === 'card' && dragEl) { dragEl.style.left = (start.cx + dx / zoom) + 'px'; dragEl.style.top = (start.cy + dy / zoom) + 'px'; drawWires(); }
    };
    const onUp = () => {
      if (mode === 'card' && dragEl) { dragEl.classList.remove('rc-dragging'); if (!moved) openDetail(dragEl.dataset.id!); else persist(); }
      mode = null; dragEl = null; canvas.classList.remove('rc-grabbing');
    };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // detail
    const openDetail = (id: string) => {
      const it = items.find((x) => x.id === id); if (!it) return;
      (root.querySelector('.rc-dst') as HTMLElement).innerHTML = `<span class="rc-sw" style="background:var(${LANES[laneIdx[it.s] ?? 2].v})"></span>${STLABEL[it.s] || it.s}${it.p ? ' · P' + it.p : ''}`;
      (root.querySelector('.rc-dt') as HTMLElement).textContent = it.t;
      (root.querySelector('.rc-dp') as HTMLElement).textContent = it.n || '';
      const dn = (it.deps || []).map((d) => { const dc = items.find((x) => x.id === d); return dc ? dc.t : d; });
      (root.querySelector('.rc-dd') as HTMLElement).textContent = dn.length ? '↳ depende de: ' + dn.join(' · ') : '';
      detail.classList.add('rc-show');
    };
    root.querySelector('.rc-x')!.addEventListener('click', () => detail.classList.remove('rc-show'));

    // filters
    const fbox = root.querySelector('.rc-filters') as HTMLDivElement;
    const active = new Set(LANES.map((l) => l.id));
    LANES.forEach((l) => {
      const b = document.createElement('span'); b.className = 'rc-chip'; b.innerHTML = `<span class="rc-sw" style="background:var(${l.v})"></span>${l.title.split(' ')[0]}`;
      b.addEventListener('click', () => {
        if (active.has(l.id)) { active.delete(l.id); b.classList.add('rc-off'); } else { active.add(l.id); b.classList.remove('rc-off'); }
        for (const it of items) els[it.id].classList.toggle('rc-dim', !active.has(it.s));
        drawWires();
      });
      fbox.appendChild(b);
    });

    fit();
    return () => { canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('mousedown', onDown); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); root.innerHTML = ''; };
  }, [roadmap, onOpenSource]);

  return <div className="rc-root" ref={ref} />;
}
