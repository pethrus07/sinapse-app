import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { Note } from '../types';
import { areaLabel, colorForArea } from '../lib/colors';

interface Props {
  notes: Note[];
  onOpen: (id: string) => void;
}

// Galho do meio dentro de uma área: o estado da nota (o tipo quase sempre é "nota" e não separa nada)
const ESTADOS: [string, string][] = [
  ['ativo', 'Em andamento'],
  ['em-producao', 'Em produção'],
  ['aguardando', 'Aguardando'],
  ['ideia', 'Ideia'],
  ['pausado', 'Pausado'],
  ['concluido', 'Concluído'],
  ['arquivado', 'Arquivado'],
  ['', 'Notas'],
];
const nomeEstado = (s: string) => ESTADOS.find(([k]) => k === s)?.[1] || 'Notas';
const ordemEstado = (s: string) => {
  const i = ESTADOS.findIndex(([k]) => k === s);
  return i < 0 ? ESTADOS.length : i;
};
const apagada = (s: string) => s === 'concluido' || s === 'arquivado';
// x de cada coluna (o d3 chama de y na árvore horizontal) e onde a linha sai de cada tipo de nó
const COL = { area: 150, grupo: 470, folha: 720 };
const PILL = 236;
const larguraGrupo = (d: any) => (d.name.length + String(d.count).length) * 7.4 + 52;
const saida = (d: any) => (d.root ? 12 : d.isArea ? PILL + 4 : d.grupo ? larguraGrupo(d) : 0);

// Árvore do vault: abre com as áreas fechadas (o desenho inteiro cabe na tela) e uma área por vez se
// abre, com as notas agrupadas por estado. A visão se enquadra sozinha a cada abertura.
export function TreeView({ notes, onOpen }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<any>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(new Set());
  const [t, setT] = useState({ x: 110, y: 60, k: 1 });

  const areas = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const n of notes) {
      const a = n.area || 'outros';
      if (!map.has(a)) map.set(a, []);
      map.get(a)!.push(n);
    }
    return [...map.entries()]
      .map(([area, items]) => ({
        area,
        items,
        ativas: items.filter((n) => ['ativo', 'em-producao', 'aguardando'].includes(n.status || '')).length,
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [notes]);

  const { nodes, links } = useMemo(() => {
    const rootData: any = {
      name: 'Sinapse',
      root: true,
      children: areas.map((a) => {
        let children: any[] = [];
        if (aberta === a.area) {
          const grupos = new Map<string, Note[]>();
          for (const n of a.items) {
            const s = ESTADOS.some(([k]) => k === (n.status || '')) ? n.status || '' : '';
            if (!grupos.has(s)) grupos.set(s, []);
            grupos.get(s)!.push(n);
          }
          const folha = (n: Note) => ({ name: n.title, id: n.id, degree: n.degree, area: a.area, status: n.status || '', leaf: true });
          const ordenadas = (l: Note[]) => l.sort((x, y) => y.degree - x.degree || (x.title > y.title ? 1 : -1));
          children =
            grupos.size > 1
              ? [...grupos.entries()]
                  .sort((x, y) => ordemEstado(x[0]) - ordemEstado(y[0]))
                  .map(([s, l]) => {
                    // concluído e arquivado começam fechados: são a maior parte e o que menos se procura
                    const fechado = apagada(s) ? !gruposAbertos.has(a.area + ':' + s) : gruposAbertos.has(a.area + ':' + s + ':fechar');
                    return { name: nomeEstado(s), area: a.area, grupo: true, status: s, count: l.length, fechado, children: fechado ? [] : ordenadas(l).map(folha) };
                  })
              : ordenadas(a.items).map(folha);
        }
        return { name: areaLabel(a.area), area: a.area, isArea: true, count: a.items.length, ativas: a.ativas, children };
      }),
    };
    const root = d3.hierarchy(rootData);
    d3.tree<any>()
      .nodeSize([30, 250])
      .separation((x, y) => (x.parent === y.parent ? 1 : 1.6))(root);
    // colunas fixas: a etiqueta da área e o nome do estado ocupam largura, a linha sai do fim deles
    for (const n of root.descendants() as any[]) n.y = n.data.root ? 0 : n.data.isArea ? COL.area : n.data.grupo ? COL.grupo : n.depth === 2 ? COL.grupo : COL.folha;
    return { nodes: root.descendants(), links: root.links() };
  }, [areas, aberta, gruposAbertos]);

  // a chave guarda o desvio do padrão: "area:concluido" abre um fechado, "area:ativo:fechar" fecha um aberto
  function alternarGrupo(area: string, status: string) {
    const chave = apagada(status) ? `${area}:${status}` : `${area}:${status}:fechar`;
    setGruposAbertos((g) => {
      const ng = new Set(g);
      ng.has(chave) ? ng.delete(chave) : ng.add(chave);
      return ng;
    });
  }

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoomB = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 2.5])
      .on('zoom', (ev: any) => setT({ x: ev.transform.x, y: ev.transform.y, k: ev.transform.k }));
    zoomRef.current = zoomB;
    const sel: any = d3.select(svg);
    sel.call(zoomB);
    return () => {
      sel.on('.zoom', null);
    };
  }, []);

  // enquadra o que está aberto: a árvore inteira com tudo fechado; a área aberta quando há uma
  useEffect(() => {
    const svg = svgRef.current, wrap = wrapRef.current;
    if (!svg || !wrap || !zoomRef.current) return;
    const alvo = aberta ? nodes.filter((n: any) => n.data.root || n.data.area === aberta) : nodes;
    const xs = alvo.map((n: any) => n.x), ys = alvo.map((n: any) => n.y);
    const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + 30;
    const y0 = Math.min(...ys) - 110, y1 = Math.max(...ys) + (aberta ? 440 : PILL + 30); // nome da raiz (esq.), etiquetas e nomes das notas (dir.)
    // o svg já começa abaixo do cabeçalho: a altura útil é a dele
    const w = svg.clientWidth || 900, h = svg.clientHeight || 600;
    // nunca menor que 0,8: área grande fica legível e alinhada pelo topo (o resto, arrastando)
    const k = Math.max(0.8, Math.min(1.15, w / (y1 - y0), h / (x1 - x0)));
    const tx = Math.max(20, (w - (y1 - y0) * k) / 2) - y0 * k;
    const sobra = h - (x1 - x0) * k;
    const ty = (sobra > 0 ? sobra / 2 : 20) - x0 * k;
    d3.select(svg).transition().duration(450).call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }, [aberta, nodes]);

  const linkGen = d3
    .linkHorizontal<any, any>()
    .source((l: any) => ({ ...l.source, y: l.source.y + saida(l.source.data) }))
    .target((l: any) => ({ ...l.target, y: l.target.y - (l.target.data.isArea ? 0 : 6) }))
    .x((d: any) => d.y)
    .y((d: any) => d.x);
  const ativasTotal = areas.reduce((s, a) => s + a.ativas, 0);

  return (
    <div className="tree-wrap" ref={wrapRef}>
      <div className="tree-head">
        <div className="eyebrow-mono">Árvore de conhecimento</div>
        <h1 className="rm-title" style={{ margin: '4px 0 2px' }}>Tudo que você plantou</h1>
        <p className="muted small">
          {notes.length} notas em {areas.length} áreas · {ativasTotal} em andamento.{' '}
          {aberta ? 'Clique na área de novo para fechar, ou em outra para trocar.' : 'Clique numa área para abrir os galhos.'}
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
                stroke: l.source.data.root ? '#3a4252' : colorForArea(l.target.data.area),
                strokeWidth: l.target.data.leaf ? 1.2 : l.target.data.grupo ? 1.8 : 2.2,
                opacity: l.target.data.leaf && apagada(l.target.data.status) ? 0.22 : 0.5,
              }}
            />
          ))}
          {nodes.map((n: any, i: number) => {
            const d = n.data;
            const cor = d.root ? '#2CD4C0' : colorForArea(d.area);
            if (d.root)
              return (
                <g key={i} className="tw-node tw-root" transform={`translate(${n.y},${n.x})`}>
                  <circle r={11} fill="#0C0E14" stroke={cor} strokeWidth={2.5} />
                  <circle r={5} fill={cor} />
                  <text className="tw-label" x={-20} dy="0.32em" textAnchor="end" style={{ fontWeight: 700, fontSize: 16 }}>
                    Sinapse
                  </text>
                </g>
              );
            if (d.isArea) {
              const on = aberta === d.area;
              return (
                <g key={i} className={'tw-node tw-area' + (on ? ' on' : '')} transform={`translate(${n.y},${n.x})`} onClick={() => setAberta(on ? null : d.area)}>
                  <rect x={0} y={-15} width={PILL} height={30} rx={15} className="tw-pill" style={{ stroke: cor }} />
                  <circle cx={16} cy={0} r={5} fill={cor} />
                  <text className="tw-label" x={30} dy="0.34em" style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {d.name}
                  </text>
                  <text className="tw-count" x={PILL - 34} dy="0.34em" textAnchor="end">
                    {d.ativas ? `${d.ativas} / ${d.count}` : d.count}
                  </text>
                  <text className="tw-mais" x={PILL - 14} dy="0.34em" textAnchor="middle">
                    {on ? '−' : '+'}
                  </text>
                </g>
              );
            }
            if (d.grupo)
              return (
                <g key={i} className="tw-node tw-grupo" transform={`translate(${n.y},${n.x})`} onClick={() => alternarGrupo(d.area, d.status)}>
                  <circle r={4.5} fill={apagada(d.status) ? '#0C0E14' : cor} stroke={cor} strokeWidth={1.5} />
                  <text className="tw-label" x={11} dy="0.32em" style={{ fontWeight: 600, fontSize: 12.5 }}>
                    {d.name} <tspan className="tw-count">{d.count}</tspan> <tspan className="tw-mais">{d.fechado ? '+' : '−'}</tspan>
                  </text>
                </g>
              );
            const r = Math.max(3, Math.min(7, 3 + Math.sqrt(d.degree || 0) * 0.7));
            return (
              <g
                key={i}
                className={'tw-node tw-leaf' + (apagada(d.status) ? ' feita' : '')}
                transform={`translate(${n.y},${n.x})`}
                onClick={() => onOpen(d.id)}
              >
                <circle r={r} fill={cor} />
                <text className="tw-label" x={r + 8} dy="0.32em" style={{ fontSize: 12.5 }}>
                  {d.name.length > 64 ? d.name.slice(0, 62) + '…' : d.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="tree-legenda">
        <span><b>3 / 12</b> em andamento / total da área</span>
        <span><i className="ponto" /> nota (maior = mais conexões)</span>
        <span><i className="ponto apagado" /> concluída ou arquivada</span>
      </div>
    </div>
  );
}
