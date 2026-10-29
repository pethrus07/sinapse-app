import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { lerDesenho, salvarDesenho } from '../lib/api';

// Assets do Excalidraw servidos pelo dev server (sem isso ele busca no unpkg e o app deixa de abrir
// offline), num caminho que troca Virgil e Cascadia pelas fontes da marca (vite.config.ts,
// fontesDoEditor). Precisa estar definido antes do pacote carregar.
(window as any).EXCALIDRAW_ASSET_PATH = '/excalidraw-ryze/';

// O pacote é grande (~2 MB): só carrega quando a aba Desenho abre.
const Excalidraw = lazy(() => import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })));

// Texto do editor: a Helvetica do Excalidraw 0.17 vira Plus Jakarta Sans, como no SVG. O resto do app
// não usa Helvetica (a pilha de --font acha a fonte do sistema antes).
let fonteDoTexto: Promise<void> | null = null;
function carregarFonteDoTexto() {
  fonteDoTexto ??= new FontFace('Helvetica', "url(./fontes-diagrama/corpo.woff2)")
    .load()
    .then((f) => void document.fonts.add(f))
    .catch(() => undefined);
  return fonteDoTexto;
}

interface Props {
  nota: string;
}

// Desenho do projeto (09-DESENHOS/<nota>.excalidraw). Nasce do gerador
// (scripts/gerar-desenhos.mjs); salvar aqui o torna do Pedro e o gerador não o toca mais.
// Abre no modo ver: os três diagramas como vão para o GitHub (src/lib/diagramaSvg.ts).
export function DesenhoView({ nota }: Props) {
  const [cena, setCena] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [modo, setModo] = useState<'ver' | 'editar'>('ver');
  const [folhas, setFolhas] = useState<string[] | null>(null);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const api = useRef<any>(null);
  const inicial = useRef<string>('');
  // Até o Pedro tocar no desenho, mudança é o Excalidraw assentando (normaliza elementos, remede
  // texto quando a fonte chega) e vira a linha de base. Depois do 1º clique ou tecla, é edição.
  // (A versão anterior usava uma janela de 2,5 s e engolia edição feita logo ao abrir.)
  const mexeu = useRef(false);

  useEffect(() => {
    let vivo = true;
    setCena(null);
    setErro('');
    setSujo(false);
    setModo('ver');
    lerDesenho(nota)
      .then((c) => {
        if (!vivo) return;
        inicial.current = '';
        mexeu.current = false;
        setCena(c);
      })
      .catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [nota]);

  useEffect(() => {
    if (!cena) return;
    let vivo = true;
    setFolhas(null);
    import('../lib/diagramaSvg')
      .then(async (m) => {
        const p = await m.partesSvg(cena);
        return p.length ? p : [await m.svgInteiro(cena)];
      })
      .then((p) => vivo && setFolhas(p))
      .catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [cena]);

  async function editar() {
    await carregarFonteDoTexto();
    api.current = null;
    inicial.current = '';
    mexeu.current = false;
    setSujo(false);
    setModo('editar');
  }

  function ver() {
    if (sujo && !confirm('Sair sem salvar o que mudou no desenho?')) return;
    setModo('ver');
  }

  async function salvar() {
    if (!api.current) return;
    setSalvando(true);
    try {
      const elements = api.current.getSceneElements();
      const nova = {
        elements,
        appState: { viewBackgroundColor: api.current.getAppState().viewBackgroundColor },
        files: api.current.getFiles(),
      };
      await salvarDesenho(nota, nova);
      inicial.current = assinatura(elements);
      setSujo(false);
      setCena({ ...cena, ...nova, source: 'sinapse-app' });
    } catch (e) {
      alert('Não deu pra salvar o desenho: ' + (e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div className="pad-scroll"><p className="muted">Sem desenho para esta nota ({erro}).</p></div>;
  if (!cena) return <div className="pad-scroll"><p className="muted">Abrindo o desenho…</p></div>;

  return (
    <div className="desenho">
      <div className="desenho-barra">
        <span className="muted small">
          {cena.source === 'sinapse-app' ? 'editado à mão' : 'gerado da especificação'} · 09-DESENHOS/{nota}.excalidraw
        </span>
        {modo === 'ver' ? (
          <button className="btn ghost" onClick={editar}>Editar</button>
        ) : (
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={ver}>Ver</button>
            <button className="btn primary" disabled={!sujo || salvando} onClick={salvar}>
              {salvando ? 'Salvando…' : sujo ? 'Salvar' : 'Salvo'}
            </button>
          </span>
        )}
      </div>
      {modo === 'ver' ? (
        <div className="desenho-folhas">
          {!folhas && <p className="muted">Montando os diagramas…</p>}
          {folhas?.map((svg, i) => <div key={i} className="desenho-folha" dangerouslySetInnerHTML={{ __html: svg }} />)}
        </div>
      ) : (
        <div
          className="desenho-tela"
          onPointerDownCapture={() => (mexeu.current = true)}
          onKeyDownCapture={() => (mexeu.current = true)}
        >
          <Suspense fallback={<p className="muted pad">Carregando o editor…</p>}>
            <Excalidraw
              excalidrawAPI={(a: any) => {
                if (!a || api.current === a) return;
                api.current = a;
                // abre com o desenho inteiro enquadrado, não em 100% cortado
                setTimeout(() => a.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.85 }), 150);
              }}
              // tema claro: os diagramas são desenhados sobre papel branco; o tema escuro do
              // Excalidraw inverte as cores do canvas
              initialData={{ elements: cena.elements, appState: { ...cena.appState, theme: 'light' }, files: cena.files }}
              theme="light"
              langCode="pt-BR"
              onChange={(els: readonly any[]) => {
                const a = assinatura(els);
                if (!inicial.current || !mexeu.current) inicial.current = a;
                setSujo(a !== inicial.current);
              }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

// Muda quando algum elemento muda: o Excalidraw sobe `version` a cada edição. Texto é exceção:
// ele também sobe `version` quando a fonte chega e o texto é remedido, sem edição nenhuma;
// por isso texto conta pelo conteúdo (e posição, se solto).
function assinatura(els: readonly any[] = []) {
  return els
    .filter((e) => !e.isDeleted)
    .map((e) =>
      e.type === 'text'
        ? `${e.id}:${e.originalText ?? e.text}:${e.containerId ? '' : Math.round(e.x) + ',' + Math.round(e.y)}`
        : e.id + ':' + e.version,
    )
    .join('|');
}
