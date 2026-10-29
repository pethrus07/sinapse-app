// Diagramas do Sinapse em SVG, com as fontes da RYZE. O Excalidraw 0.17 só conhece três fontes
// (Virgil, Helvetica, Cascadia): o gerador (scripts/gerar-desenhos.mjs) usa cada uma como um papel e
// aqui elas viram as da marca, embutidas no próprio SVG. O GitHub mostra SVG como imagem e imagem
// não carrega nada de fora, então a fonte tem que ir dentro do arquivo.
// Usado pela aba Desenho (o que o Pedro vê primeiro) e por exportar.html (o que vai para os repos).
import { exportToSvg } from '@excalidraw/excalidraw';

const FONTES: Record<string, { nome: string; arquivo: string }> = {
  Virgil: { nome: 'RYZE Titulo', arquivo: 'titulo.woff2' }, // Space Grotesk 600
  Helvetica: { nome: 'RYZE Texto', arquivo: 'corpo.woff2' }, // Plus Jakarta Sans 400
  Cascadia: { nome: 'RYZE Mono', arquivo: 'mono.woff2' }, // JetBrains Mono 500
};
// fontes do public/, recortadas para latim (public/fontes-diagrama, licença OFL)
const PASTA = "./fontes-diagrama/"; // relativo à página: base "./" no vite.config

const cache = new Map<string, Promise<string>>();
function base64(arquivo: string) {
  if (!cache.has(arquivo)) {
    cache.set(
      arquivo,
      fetch(PASTA + arquivo)
        .then((r) => {
          if (!r.ok) throw new Error(`fonte ${arquivo}: HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((b) => {
          let s = '';
          const u = new Uint8Array(b);
          for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
          return btoa(s);
        }),
    );
  }
  return cache.get(arquivo)!;
}

// troca as fontes do Excalidraw pelas da marca e embute só as que o SVG usa
async function aplicarMarca(svg: SVGSVGElement) {
  svg.querySelectorAll('style').forEach((s) => {
    if (s.textContent?.includes('@font-face')) s.remove();
  });
  const usadas = new Set<string>();
  svg.querySelectorAll('text').forEach((t) => {
    const atual = (t.getAttribute('font-family') || '').split(',')[0].trim().replace(/"/g, '');
    const f = FONTES[atual];
    if (!f) return;
    usadas.add(atual);
    t.setAttribute('font-family', `"${f.nome}", sans-serif`);
  });
  const regras = await Promise.all(
    [...usadas].map(async (k) => `@font-face{font-family:"${FONTES[k].nome}";src:url(data:font/woff2;base64,${await base64(FONTES[k].arquivo)}) format("woff2");}`),
  );
  const estilo = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  // a Plus Jakarta tem espaço estreito: em 12 px "marca a lista" quase virava uma palavra só
  estilo.textContent = regras.join('') + 'text[font-family*="RYZE Texto"]{word-spacing:0.1em}';
  svg.insertBefore(estilo, svg.firstChild);
  return svg;
}

async function paraSvg(elements: readonly any[], files: any, padding: number) {
  const svg = await exportToSvg({
    elements: elements as any,
    appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false } as any,
    files: files || {},
    exportPadding: padding,
  });
  return aplicarMarca(svg);
}

export async function svgInteiro(cena: { elements: readonly any[]; files?: any }) {
  return (await paraSvg(cena.elements.filter((e) => !e.isDeleted), cena.files, 40)).outerHTML;
}

// Um SVG por diagrama (UML, BPMN, C4), cortado no conteúdo: separa os elementos pela altura dos
// cabeçalhos "1 · ", "2 · ", "3 · ". A parte 1 começa no próprio cabeçalho: título e resumo do
// projeto ficam de fora (o cabeçalho de cada parte já leva o nome). Desenho sem os três cabeçalhos
// (editado à mão) devolve lista vazia.
export async function partesSvg(cena: { elements: readonly any[]; files?: any }) {
  const els = cena.elements.filter((e) => !e.isDeleted);
  const topos = [1, 2, 3].map((n) => els.find((e) => e.type === 'text' && e.text.startsWith(`${n} · `))?.y as number | undefined);
  if (topos.some((y) => y == null)) return [];
  const partes: string[] = [];
  for (let i = 0; i < 3; i++) {
    const y0 = topos[i]! - 10,
      y1 = i < 2 ? topos[i + 1]! - 10 : Infinity;
    const parte = els.filter((e) => e.y >= y0 && e.y < y1);
    // texto preso numa forma acompanha a forma
    const ids = new Set(parte.map((e) => e.id));
    for (const e of els) if (e.containerId && ids.has(e.containerId) && !ids.has(e.id)) parte.push(e);
    partes.push((await paraSvg(parte, cena.files, 32)).outerHTML);
  }
  return partes;
}
