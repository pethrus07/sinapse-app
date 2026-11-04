// O porquê em todas as telas do Aion: passar o mouse (ou tocar, no celular; ou focar pelo teclado)
// sobre um número, uma barra ou um ativo abre um pop-up com o motivo, a fonte, a data, o tipo da
// explicação (causa conhecida, fato, opinião, estimativa, hipótese, sem notícia) e o link para o
// bloco da trilha que explica o conceito. Sem nada ligado, diz isso. Lógica em src/lib/aionPorques.ts.
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Aion } from '../types';
import { porquesDoAlvo, ROTULO_PORQUE, todosOsPorques, type ContextoPorque, type Porque } from '../lib/aionPorques';

interface Valor { aion: Aion; ctx: ContextoPorque; todos: Porque[]; tituloBloco: (n: number) => string; onEstudar: (n: number) => void }
const Ctx = createContext<Valor | null>(null);

export function PorqueProvider({ aion, hoje, onEstudar, children }: { aion: Aion; hoje: string; onEstudar: (n: number) => void; children: React.ReactNode }) {
  const valor = useMemo(() => {
    const ctx = { hoje };
    const blocos = new Map(aion.trilha.blocos.map((b) => [b.n, b.titulo]));
    return { aion, ctx, todos: todosOsPorques(aion, ctx), tituloBloco: (n: number) => blocos.get(n) || '', onEstudar };
  }, [aion, hoje, onEstudar]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
export const usePorques = () => useContext(Ctx)!;

const br = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');

/** Um item do porquê: tipo, data, título, texto, quem disse, fonte e o bloco da trilha. */
export function ItemPorque({ p, onEstudar, tituloBloco }: { p: Porque; onEstudar?: (n: number) => void; tituloBloco?: (n: number) => string }) {
  return (
    <div className="ai-pq-item" data-tipo-porque={p.tipo}>
      <div className="ai-pq-meta"><span className={'ai-tag ' + p.tipo}>{ROTULO_PORQUE[p.tipo]}</span><span>{br(p.data)}</span></div>
      <b className="ai-pq-tit">{p.titulo}</b>
      <p className="ai-pq-txt">{p.texto}</p>
      <p className="ai-pq-fonte">{p.quem ? <>Quem diz: {p.quem}. </> : null}Fonte: <a href={p.fonte.url} target="_blank" rel="noreferrer noopener">{p.fonte.nome}</a></p>
      {p.bloco && onEstudar && <button type="button" className="linkbtn ai-pq-bloco" onClick={() => onEstudar(p.bloco!)}>Entender: bloco {p.bloco}{tituloBloco?.(p.bloco) ? ` · ${tituloBloco(p.bloco)}` : ''} →</button>}
    </div>
  );
}

/**
 * Envolve o que tem porquê. `alvo` = ticker ou chave ('selic', 'reserva', 'fii'...). Mouse: abre ao
 * entrar e fecha ao sair (o pop-up aceita o mouse em cima dele). Toque ou clique: abre e fica até
 * tocar fora ou de novo. Teclado: Enter/espaço abre, Esc fecha.
 */
export function ComPorque({ alvo, rotulo, children, className = '', como = 'div', extra }: {
  alvo: string; rotulo: string; children: React.ReactNode; className?: string; como?: 'div' | 'span' | 'li'; extra?: React.ReactNode;
}) {
  const v = usePorques();
  const [aberto, setAberto] = useState(false);
  const [preso, setPreso] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const fechar = useRef<number | undefined>(undefined);
  const id = useId();
  const exp = useMemo(() => (aberto ? porquesDoAlvo(alvo, v.aion, v.ctx, v.todos) : null), [aberto, alvo, v]);

  const abrir = () => { window.clearTimeout(fechar.current); setAberto(true); };
  const fecharDepois = () => { window.clearTimeout(fechar.current); fechar.current = window.setTimeout(() => { setAberto(false); setPreso(false); }, 140); };
  useEffect(() => () => window.clearTimeout(fechar.current), []);
  useEffect(() => {
    if (!preso) return;
    const fora = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setAberto(false); setPreso(false);
    };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [preso]);

  const Tag = como as 'div';
  return (
    <>
      <Tag
        ref={ref as React.RefObject<HTMLDivElement>}
        className={'ai-pq-alvo ' + className}
        data-porque={alvo}
        tabIndex={0}
        role="button"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        aria-label={`${rotulo}: ver o porquê`}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') abrir(); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !preso) fecharDepois(); }}
        onClick={() => { if (preso) { setPreso(false); setAberto(false); } else { setPreso(true); abrir(); } }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPreso(true); abrir(); }
          if (e.key === 'Escape') { setAberto(false); setPreso(false); }
        }}
        onBlur={(e) => { if (!popRef.current?.contains(e.relatedTarget as Node)) fecharDepois(); }}
      >
        {children}
      </Tag>
      {aberto && exp && ref.current && createPortal(
        <PopUp id={id} ancora={ref.current} refPop={popRef} rotulo={rotulo} onEntrar={abrir} onSair={() => { if (!preso) fecharDepois(); }}
          onFechar={() => { setAberto(false); setPreso(false); ref.current?.focus(); }}>
          {exp.itens.map((p) => <ItemPorque key={p.id} p={p} tituloBloco={v.tituloBloco} onEstudar={(n) => { setAberto(false); setPreso(false); v.onEstudar(n); }} />)}
          {exp.semNoticia && <p className="ai-pq-sem" data-sem-noticia>{exp.semNoticia}</p>}
          {extra}
          {exp.faltando.length > 0 && <p className="ai-pq-falta">Ainda não ligado: {exp.faltando.join(' · ')}.</p>}
        </PopUp>,
        document.body,
      )}
    </>
  );
}

function PopUp({ id, ancora, refPop, rotulo, children, onEntrar, onSair, onFechar }: {
  id: string; ancora: HTMLElement; refPop: React.RefObject<HTMLDivElement>; rotulo: string; children: React.ReactNode;
  onEntrar: () => void; onSair: () => void; onFechar: () => void;
}) {
  const [pos, setPos] = useState<{ left: number; top: number; largura: number; maxAltura: number } | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const r = ancora.getBoundingClientRect();
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const largura = Math.min(360, vw - 32);
      const left = Math.min(Math.max(16, r.left), vw - largura - 16);
      const h = refPop.current?.offsetHeight || 240;
      const abaixo = vh - r.bottom - 12, acima = r.top - 12;
      const emBaixo = abaixo >= Math.min(h, 260) || abaixo >= acima;
      const maxAltura = Math.max(160, (emBaixo ? abaixo : acima) - 8);
      const top = emBaixo ? r.bottom + 8 : Math.max(8, r.top - 8 - Math.min(h, maxAltura));
      setPos({ left, top, largura, maxAltura });
    };
    medir();
    window.addEventListener('scroll', medir, true);
    window.addEventListener('resize', medir);
    return () => { window.removeEventListener('scroll', medir, true); window.removeEventListener('resize', medir); };
  }, [ancora, refPop]);
  return (
    <div id={id} ref={refPop} className="ai-pq-pop" role="dialog" aria-label={`Por quê: ${rotulo}`}
      style={pos ? { left: pos.left, top: pos.top, width: pos.largura, maxHeight: pos.maxAltura } : { visibility: 'hidden', left: 0, top: 0 }}
      onPointerEnter={onEntrar} onPointerLeave={(e) => { if (e.pointerType === 'mouse') onSair(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onFechar(); }}>
      <div className="ai-pq-cab"><span>Por quê · {rotulo}</span><button type="button" className="ai-pq-x" aria-label="Fechar" onClick={onFechar}>×</button></div>
      {children}
    </div>
  );
}
