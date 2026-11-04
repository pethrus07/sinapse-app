// O pop-up do Aion, com a regra conceito × porquê (docs/aion-formato.md):
//  - <Termo id>      um nome, termo ou indicador  → "O que é": o conceito (src/lib/aionGlossario.ts) e o
//                    bloco da trilha. Na tela: sublinhado pontilhado discreto.
//  - <ComPorque>     um número que mudou           → "Por quê": motivo, fonte, data e o tipo da explicação
//                    (causa, fato, opinião, estimativa, hipótese, sem notícia; src/lib/aionPorques.ts).
//                    Na tela: um marcador pequeno ao lado do número. Nunca "Por quê" sem fonte: `fonte`
//                    é obrigatória e aparece no fim ("Fonte do número").
//  - <ComAtivo>      um ativo inteiro (cartão/linha) → os dois: "O que é" em cima, "Por quê" embaixo.
// Abre ao passar o mouse, ao tocar (celular) ou pelo teclado (Enter/espaço; Esc fecha).
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Aion, TipoCarteira } from '../types';
import { porquesDoAlvo, ROTULO_PORQUE, todosOsPorques, type ContextoPorque, type Porque } from '../lib/aionPorques';
import { oQueEAtivo, verbete, type IdTermo } from '../lib/aionGlossario';

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
      {p.bloco && onEstudar && <BotaoBloco n={p.bloco} onEstudar={onEstudar} tituloBloco={tituloBloco} />}
    </div>
  );
}

function BotaoBloco({ n, onEstudar, tituloBloco }: { n: number; onEstudar: (n: number) => void; tituloBloco?: (n: number) => string }) {
  return <button type="button" className="linkbtn ai-pq-bloco" onClick={() => onEstudar(n)}>Entender: bloco {n}{tituloBloco?.(n) ? ` · ${tituloBloco(n)}` : ''} →</button>;
}

/* ------------------------------------------------------------ o alvo (hover, toque, teclado) */

type Modo = 'termo' | 'porque' | 'ativo';
const TITULO: Record<Modo, string> = { termo: 'O que é', porque: 'Por quê', ativo: 'O que é e por quê' };

function Alvo({ modo, rotulo, titulo, dados, className, como = 'span', children, conteudo, onAbrir }: {
  modo: Modo; rotulo: string; titulo: string; dados: Record<string, string>; className: string; como?: 'div' | 'span' | 'li';
  children: React.ReactNode; conteudo: (fechar: () => void) => React.ReactNode; onAbrir?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [preso, setPreso] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const fechar = useRef<number | undefined>(undefined);
  const ponteiro = useRef('');
  const id = useId();
  const abrir = () => { window.clearTimeout(fechar.current); setAberto(true); };
  const fecharDepois = () => { window.clearTimeout(fechar.current); fechar.current = window.setTimeout(() => { setAberto(false); setPreso(false); }, 140); };
  const fecharJa = () => { setAberto(false); setPreso(false); };
  useEffect(() => () => window.clearTimeout(fechar.current), []);
  useEffect(() => {
    if (!preso) return;
    const fora = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      fecharJa();
    };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [preso]);
  const Tag = como as 'span';
  return (
    <>
      <Tag
        ref={ref as React.RefObject<HTMLSpanElement>}
        className={`ai-alvo ai-alvo-${modo} ${className}`}
        {...dados}
        tabIndex={0}
        role="button"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        aria-label={`${rotulo}: ${TITULO[modo].toLowerCase()}`}
        onPointerDown={(e) => { ponteiro.current = e.pointerType; }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') abrir(); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !preso) fecharDepois(); }}
        onClick={(e) => {
          e.stopPropagation();
          // com mouse, o clique no ativo abre o gráfico dele; no toque, o primeiro toque abre o pop-up
          if (onAbrir && ponteiro.current === 'mouse') { fecharJa(); onAbrir(); return; }
          if (preso) fecharJa(); else { setPreso(true); abrir(); }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setPreso(true); abrir(); }
          if (e.key === 'Escape') fecharJa();
        }}
        onBlur={(e) => { if (!popRef.current?.contains(e.relatedTarget as Node)) fecharDepois(); }}
      >
        {children}
      </Tag>
      {aberto && ref.current && createPortal(
        <PopUp id={id} modo={modo} ancora={ref.current} refPop={popRef} titulo={titulo} onEntrar={abrir} onSair={() => { if (!preso) fecharDepois(); }}
          onFechar={() => { fecharJa(); ref.current?.focus(); }}>
          {conteudo(fecharJa)}
        </PopUp>,
        document.body,
      )}
    </>
  );
}

function PopUp({ id, modo, ancora, refPop, titulo, children, onEntrar, onSair, onFechar }: {
  id: string; modo: Modo; ancora: HTMLElement; refPop: React.RefObject<HTMLDivElement>; titulo: string; children: React.ReactNode;
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
    <div id={id} ref={refPop} className={'ai-pq-pop ' + modo} role="dialog" aria-label={`${TITULO[modo]}: ${titulo}`} data-pop={modo}
      style={pos ? { left: pos.left, top: pos.top, width: pos.largura, maxHeight: pos.maxAltura } : { visibility: 'hidden', left: 0, top: 0 }}
      onPointerEnter={onEntrar} onPointerLeave={(e) => { if (e.pointerType === 'mouse') onSair(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onFechar(); }}>
      <div className="ai-pq-cab"><span className="ai-pq-cab-tit">{TITULO[modo]} · {titulo}</span><button type="button" className="ai-pq-x" aria-label="Fechar" onClick={onFechar}>×</button></div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ O que é (termo) */

/** O conceito de um termo do glossário: 2 a 3 linhas e o bloco da trilha. */
function ConteudoTermo({ id, fechar }: { id: string; fechar: () => void }) {
  const v = usePorques();
  const t = verbete(id)!;
  return (
    <div className="ai-oq" data-oque={id}>
      <p className="ai-oq-txt">{t.texto}</p>
      <BotaoBloco n={t.bloco} tituloBloco={v.tituloBloco} onEstudar={(n) => { fechar(); v.onEstudar(n); }} />
    </div>
  );
}

/**
 * Um termo com conceito: sublinhado pontilhado; o pop-up diz "O que é". Sem verbete, o texto sai
 * sem marcação (e com data-termo-sem-verbete, que o e2e e o teste do glossário pegam).
 */
export function Termo({ id, children, className = '' }: { id: IdTermo; children?: React.ReactNode; className?: string }) {
  const t = verbete(id);
  if (!t) return <span data-termo-sem-verbete={id}>{children}</span>;
  return (
    <Alvo modo="termo" rotulo={t.termo} titulo={t.termo} dados={{ 'data-termo': id }} className={className} conteudo={(f) => <ConteudoTermo id={id} fechar={f} />}>
      {children ?? t.termo}
    </Alvo>
  );
}

/* ------------------------------------------------------------ Por quê (número) */

export interface FonteNumero { nome: string; url?: string; data?: string }

function ConteudoPorque({ alvo, itens, extra, fonte, fechar }: { alvo: string; itens?: Porque[]; extra?: React.ReactNode; fonte: FonteNumero; fechar: () => void }) {
  const v = usePorques();
  const exp = useMemo(() => porquesDoAlvo(alvo, v.aion, v.ctx, v.todos), [alvo, v]);
  const lista = itens ?? exp.itens;
  const semNoticia = itens ? '' : exp.semNoticia;
  return (
    <div className="ai-pq" data-pq={alvo}>
      {lista.map((p) => <ItemPorque key={p.id} p={p} tituloBloco={v.tituloBloco} onEstudar={(n) => { fechar(); v.onEstudar(n); }} />)}
      {semNoticia && <p className="ai-pq-sem" data-sem-noticia>{semNoticia}</p>}
      {extra}
      {!itens && exp.faltando.length > 0 && <p className="ai-pq-falta">Ainda não ligado: {exp.faltando.join(' · ')}.</p>}
      <p className="ai-pq-fonte ai-pq-fonte-num" data-fonte-numero>Fonte do número: {fonte.url ? <a href={fonte.url} target="_blank" rel="noreferrer noopener">{fonte.nome}</a> : fonte.nome}{fonte.data ? `, ${br(fonte.data)}` : ''}.</p>
    </div>
  );
}

/**
 * Um número que mudou, com o porquê. `alvo` = ticker ou chave ('selic', 'reserva', 'fii'...); `itens`
 * troca a busca por alvo por uma lista própria (o marcador de um evento no gráfico de preço). `fonte`
 * é de onde veio o próprio número: obrigatória (nunca "Por quê" sem fonte).
 */
export function ComPorque({ alvo, rotulo, fonte, children, className = '', como = 'span', extra, itens }: {
  alvo: string; rotulo: string; fonte: FonteNumero; children: React.ReactNode; className?: string; como?: 'div' | 'span' | 'li'; extra?: React.ReactNode; itens?: Porque[];
}) {
  return (
    <Alvo modo="porque" rotulo={rotulo} titulo={rotulo} dados={{ 'data-porque': alvo }} className={className} como={como}
      conteudo={(f) => <ConteudoPorque alvo={alvo} itens={itens} extra={extra} fonte={fonte} fechar={f} />}>
      {children}
    </Alvo>
  );
}

/* ------------------------------------------------------------ ativo inteiro: O que é + Por quê */

/** Uma linha ou cartão de ativo: "O que é" em cima, "Por quê" embaixo; clique (mouse) abre o gráfico do ativo. */
export function ComAtivo({ codigo, tipo, rotulo, fonte, children, className = '', como = 'li', onAbrir }: {
  codigo: string; tipo: TipoCarteira | 'etf' | 'bdr'; rotulo: string; fonte: FonteNumero; children: React.ReactNode; className?: string; como?: 'div' | 'span' | 'li'; onAbrir?: () => void;
}) {
  const v = usePorques();
  return (
    <Alvo modo="ativo" rotulo={rotulo} titulo={rotulo} dados={{ 'data-porque': codigo, 'data-ativo': codigo }} className={className} como={como} onAbrir={onAbrir}
      conteudo={(f) => {
        const o = oQueEAtivo(codigo, tipo, v.aion.mercado);
        const t = verbete(o.termo)!;
        return (
          <>
            <section className="ai-oq" data-oque={codigo}>
              <h4 className="ai-pq-secao">O que é</h4>
              <b className="ai-pq-tit">{o.titulo}</b>
              {o.linhas.map((l, i) => <p key={i} className="ai-oq-txt">{l}</p>)}
              {o.fonte && <p className="ai-pq-fonte">Fonte: <a href={o.fonte.url} target="_blank" rel="noreferrer noopener">{o.fonte.nome}</a></p>}
              <BotaoBloco n={t.bloco} tituloBloco={v.tituloBloco} onEstudar={(n) => { f(); v.onEstudar(n); }} />
            </section>
            <section className="ai-pq-parte" data-parte="porque">
              <h4 className="ai-pq-secao">Por quê</h4>
              <ConteudoPorque alvo={codigo} fonte={fonte} fechar={f} />
            </section>
            {onAbrir && <button type="button" className="mt-botao ai-pq-abrir" onClick={() => { f(); onAbrir(); }}>Ver {codigo} no tempo →</button>}
          </>
        );
      }}>
      {children}
    </Alvo>
  );
}
