import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { lerDesenho, salvarDesenho } from '../lib/api';

// Fontes do Excalidraw servidas do próprio node_modules pelo dev server: sem isso ele busca no
// unpkg e o app deixa de abrir offline. Precisa estar definido antes do pacote carregar.
(window as any).EXCALIDRAW_ASSET_PATH = '/node_modules/@excalidraw/excalidraw/dist/';

// O pacote é grande (~2 MB): só carrega quando a aba Desenho abre.
const Excalidraw = lazy(() => import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })));

interface Props {
  nota: string;
}

// Desenho do projeto (09-DESENHOS/<nota>.excalidraw). Nasce do gerador
// (scripts/gerar-desenhos.mjs); salvar aqui o torna do Pedro e o gerador não o toca mais.
export function DesenhoView({ nota }: Props) {
  const [cena, setCena] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const api = useRef<any>(null);
  const inicial = useRef<string>('');
  const assentaAte = useRef(0);

  useEffect(() => {
    let vivo = true;
    setCena(null);
    setErro('');
    setSujo(false);
    lerDesenho(nota)
      .then((c) => {
        if (!vivo) return;
        // a linha de base é a cena depois de assentar: ao carregar, o Excalidraw normaliza os
        // elementos e remede os textos quando a fonte chega (sobe `version`), e comparar com
        // o arquivo marcaria "sujo" sem edição nenhuma
        inicial.current = '';
        assentaAte.current = Date.now() + 2500;
        setCena(c);
      })
      .catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [nota]);

  async function salvar() {
    if (!api.current) return;
    setSalvando(true);
    try {
      const elements = api.current.getSceneElements();
      await salvarDesenho(nota, {
        elements,
        appState: { viewBackgroundColor: api.current.getAppState().viewBackgroundColor },
        files: api.current.getFiles(),
      });
      inicial.current = assinatura(elements);
      setSujo(false);
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
        <button className="btn primary" disabled={!sujo || salvando} onClick={salvar}>
          {salvando ? 'Salvando…' : sujo ? 'Salvar' : 'Salvo'}
        </button>
      </div>
      <div className="desenho-tela">
        <Suspense fallback={<p className="muted pad">Carregando o editor…</p>}>
          <Excalidraw
            excalidrawAPI={(a: any) => {
              if (!a || api.current === a) return;
              api.current = a;
              assentaAte.current = Date.now() + 2500;
              // abre com o desenho inteiro enquadrado, não em 100% cortado
              setTimeout(() => a.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.85 }), 150);
              // fonte fria remede os textos depois: a cena após as fontes é a linha de base
              document.fonts.ready.then(() =>
                setTimeout(() => {
                  inicial.current = assinatura(a.getSceneElements());
                  setSujo(false);
                }, 600),
              );
            }}
            initialData={{ elements: cena.elements, appState: { ...cena.appState, theme: 'dark' }, files: cena.files }}
            theme="dark"
            langCode="pt-BR"
            onChange={(els: readonly any[]) => {
              const a = assinatura(els);
              if (!inicial.current || Date.now() < assentaAte.current) inicial.current = a;
              setSujo(a !== inicial.current);
            }}
          />
        </Suspense>
      </div>
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
