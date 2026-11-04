// Gráficos da Métis v2 (lógica em src/lib/financeiroModelo.ts e financeiroAnalise.ts).
// Regras (skill dataviz + preferência do Pedro):
//  - forma antes de cor: comparação de tamanho = barra horizontal ordenada; composição no tempo =
//    coluna empilhada com vão de 2 px; o que é um número só vira número grande, não gráfico;
//  - cor por papel e fixa: natureza fixo/variável/pontual = slots 1/2/3 da paleta validada no fundo
//    escuro (#11141C); mês anterior = cinza neutro #666d7d (validado: ΔE 16,1 do slot 1, ≥ 3:1);
//    polaridade (sobra positiva × negativa) = azul × vermelho (ΔE 29); estado (abaixo do piso,
//    acima do teto) = cor de estado SEMPRE com ícone e texto;
//  - texto nunca na cor da série; legenda sempre que houver 2+ séries; um eixo só;
//  - todo gráfico com dica ao passar o mouse (e foco de teclado) e a tabela em "Mais opções".
import { useState } from 'react';
import { scaleBand, scaleLinear } from 'd3';
import type { Lancamento } from '../types';
import { brl, rotuloCategoria } from '../lib/financeiro';
import { ROTULO_NATUREZA, NATUREZAS, type Natureza } from '../lib/financeiroAnalise';
import type { NaturezaPorMes } from '../lib/financeiroModelo';
import { Cartao, colunaPath, curto, Dica, EixoY, Legenda, M, num, useDica, useLargura } from './FinanceiroGraficos';

export const COR_NAT: Record<Natureza, string> = { fixo: 'var(--s1)', variavel: 'var(--s2)', pontual: 'var(--s3)' };
export const COR_ANTERIOR = 'var(--mt-anterior)';
export const legendaNatureza = (quais: readonly Natureza[] = NATUREZAS) => quais.map((k) => ({ cor: COR_NAT[k], rotulo: ROTULO_NATUREZA[k] }));
const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / Math.max(max, 1)) * 100))}%`;

type InfoDica = { titulo: string; linhas: { cor?: string; rotulo: string; valor: string }[] };

/* ------------------------------------------------------------ número grande */

export function Numero({ rotulo, valor, sub, id, alerta }: { rotulo: string; valor: string; sub?: React.ReactNode; id: string; alerta?: boolean }) {
  return (
    <div className="mt-num" data-numero={id}>
      <span className="mt-num-rot">{rotulo}</span>
      <b className="mt-num-val">{alerta && <span className="mt-icone" aria-hidden>⚠ </span>}{valor}</b>
      {sub && <span className="mt-num-sub">{sub}</span>}
    </div>
  );
}

/** Medidor: a reserva contra o piso. Abaixo = estado de alerta, com ícone e texto (nunca só a cor). */
export function Medidor({ valor, alvo, rotulo }: { valor: number; alvo: number; rotulo: string }) {
  const abaixo = valor < alvo;
  return (
    <div className={'mt-medidor' + (abaixo ? ' abaixo' : '')} role="meter" aria-valuemin={0} aria-valuemax={alvo} aria-valuenow={valor} aria-label={rotulo}>
      <span style={{ width: pct(valor, alvo) }} />
    </div>
  );
}

/* ------------------------------------------------------------ barras horizontais */

export interface LinhaBarra {
  chave: string;
  rotulo: string;
  valor: string;                       // o número à direita do nome (texto, cor de texto)
  extra?: React.ReactNode;             // estado ao lado do valor (com ícone)
  segmentos: { valor: number; cor: string }[];
  marcador?: number;                   // teto: traço vertical
  dica: InfoDica;
}

/** Barras horizontais ordenadas: nome e valor em cima, a barra embaixo (cabe no celular). */
export function BarrasH({ linhas, max, rotulo, onClique, aberta }: {
  linhas: LinhaBarra[]; max: number; rotulo: string; onClique?: (chave: string) => void; aberta?: string | null;
}) {
  const [ref, w] = useLargura<HTMLUListElement>();
  const { d, mostrar, esconder } = useDica(ref as unknown as React.RefObject<HTMLElement>);
  return (
    <div className="fg-plot">
      <ul ref={ref} className="mt-barras" aria-label={rotulo} onPointerLeave={esconder}>
        {linhas.map((l) => {
          const corpo = (
            <>
              <span className="mt-barra-nome">{l.rotulo}</span>
              <span className="mt-barra-val"><b>{l.valor}</b>{l.extra}</span>
              <span className="mt-barra-trilho" aria-hidden>
                {l.segmentos.filter((s) => s.valor > 0).map((s, i) => <span key={i} className="mt-seg" style={{ width: pct(s.valor, max), background: s.cor }} />)}
                {l.marcador !== undefined && <span className="mt-marcador" style={{ left: pct(l.marcador, max) }} />}
              </span>
            </>
          );
          const eventos = {
            onPointerMove: (e: React.PointerEvent) => mostrar(e, null, l.dica),
            onFocus: (e: React.FocusEvent) => mostrar(null, e.currentTarget, l.dica),
            onBlur: esconder,
          };
          return (
            <li key={l.chave} className={aberta === l.chave ? 'aberta' : ''}>
              {onClique
                ? <button className="mt-barra" aria-expanded={aberta === l.chave} onClick={() => onClique(l.chave)} {...eventos}>{corpo}</button>
                : <div className="mt-barra" tabIndex={0} aria-label={`${l.rotulo}: ${l.valor}`} {...eventos}>{corpo}</div>}
            </li>
          );
        })}
      </ul>
      <Dica d={d} largura={w} />
    </div>
  );
}

/* ------------------------------------------------------------ Visão: natureza × mês anterior */

export function NaturezaComparada({ atual, anterior, mes, mesAnt }: {
  atual: Record<Natureza, number>; anterior: Record<Natureza, number>; mes: string; mesAnt: string;
}) {
  const [ref, w] = useLargura<HTMLUListElement>();
  const { d, mostrar, esconder } = useDica(ref as unknown as React.RefObject<HTMLElement>);
  const max = Math.max(1, ...NATUREZAS.flatMap((k) => [atual[k], anterior[k]]));
  return (
    <>
      <Legenda itens={[...legendaNatureza(), { cor: COR_ANTERIOR, rotulo: `${curto(mesAnt)} (mês anterior)` }]} />
      <div className="fg-plot">
        <ul ref={ref} className="mt-pares" aria-label={`Fixo, variável e pontual em ${curto(mes)} e ${curto(mesAnt)}`} onPointerLeave={esconder}>
          {NATUREZAS.map((k) => {
            const dif = atual[k] - anterior[k];
            const info: InfoDica = { titulo: ROTULO_NATUREZA[k], linhas: [
              { cor: COR_NAT[k], rotulo: curto(mes), valor: brl(atual[k]) },
              { cor: COR_ANTERIOR, rotulo: curto(mesAnt), valor: brl(anterior[k]) },
              { rotulo: 'diferença', valor: (dif > 0 ? '+' : dif < 0 ? '−' : '') + brl(Math.abs(dif)) },
            ] };
            return (
              <li key={k} tabIndex={0} data-natureza={k} aria-label={`${ROTULO_NATUREZA[k]}: ${brl(atual[k])} em ${curto(mes)}, ${brl(anterior[k])} em ${curto(mesAnt)}`}
                onPointerMove={(e) => mostrar(e, null, info)} onFocus={(e) => mostrar(null, e.currentTarget, info)} onBlur={esconder}>
                <span className="mt-par-nome">{ROTULO_NATUREZA[k]}</span>
                <span className="mt-par-linha">
                  <span className="mt-par-trilho"><span className="mt-seg" style={{ width: pct(atual[k], max), background: COR_NAT[k] }} /></span>
                  <b className="mt-par-val">{brl(atual[k])}</b>
                </span>
                <span className="mt-par-linha fraca">
                  <span className="mt-par-trilho"><span className="mt-seg" style={{ width: pct(anterior[k], max), background: COR_ANTERIOR }} /></span>
                  <span className="mt-par-val">{brl(anterior[k])}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <Dica d={d} largura={w} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------ Gastos: natureza por mês */

export function NaturezaNoTempo({ r, foco }: { r: NaturezaPorMes; foco: string }) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  const H = 230;
  const y = scaleLinear().domain([0, Math.max(1, ...r.linhas.map((l) => l.total))]).nice(4).range([H - M.bottom, M.top]);
  const x = scaleBand().domain(r.meses).range([M.left, Math.max(w - M.right, M.left + 1)]).paddingInner(0.35).paddingOuter(0.15);
  const bw = Math.min(24, x.bandwidth());
  const gap = 2;
  return (
    <>
      <Legenda itens={legendaNatureza()} />
      <div ref={ref} className="fg-plot" onPointerLeave={esconder}>
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label="Fixo, variável e pontual por mês">
            <EixoY y={y} largura={w} />
            {r.meses.map((m, i) => {
              const l = r.linhas[i];
              const bx = (x(m) || 0) + (x.bandwidth() - bw) / 2;
              const parcial = r.parciais.includes(m);
              const info: InfoDica = { titulo: curto(m) + (parcial ? ' · mês incompleto' : ''), linhas: [
                ...NATUREZAS.map((k) => ({ cor: COR_NAT[k], rotulo: ROTULO_NATUREZA[k].toLowerCase(), valor: brl(l[k]) })),
                { rotulo: 'total', valor: brl(l.total) },
              ] };
              const vis = NATUREZAS.filter((k) => l[k] > 0);
              let acum = 0;
              return (
                <g key={m} className="fg-hit" tabIndex={0} aria-label={`${curto(m)}: ${brl(l.total)}`}
                  onPointerMove={(e) => mostrar(e, null, info)} onFocus={(e) => mostrar(null, e.currentTarget, info)} onBlur={esconder}>
                  <rect x={x(m)} y={M.top} width={x.bandwidth()} height={H - M.top - M.bottom} fill="transparent" />
                  {vis.map((k, j) => {
                    const y1 = y(acum + l[k]), y0 = y(acum);
                    acum += l[k];
                    const h = Math.max(0, y0 - y1 - (j > 0 ? gap : 0));
                    return <path key={k} d={j === vis.length - 1 ? colunaPath(bx, y1, bw, h) : `M${bx},${y1}h${bw}v${h}h${-bw}Z`} fill={COR_NAT[k]} />;
                  })}
                  {m === foco && l.total > 0 && <text className="fg-rot" x={bx + bw / 2} y={y(l.total) - 6} textAnchor="middle">{num(l.total)}</text>}
                  <text className={'fg-xtick' + (m === foco ? ' hoje' : '')} x={(x(m) || 0) + x.bandwidth() / 2} y={H - 8} textAnchor="middle">{curto(m)}{parcial ? '·' : ''}</text>
                </g>
              );
            })}
          </svg>
        )}
        <Dica d={d} largura={w} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------ Gastos: o que mudou */

export function Diferencas({ itens }: { itens: { categoria: string; atual: number; anterior: number; delta: number }[] }) {
  const [ref, w] = useLargura<HTMLUListElement>();
  const { d, mostrar, esconder } = useDica(ref as unknown as React.RefObject<HTMLElement>);
  const max = Math.max(1, ...itens.map((i) => Math.abs(i.delta)));
  return (
    <div className="fg-plot">
      <div className="mt-dif-eixo" aria-hidden><span>gastou menos</span><span>gastou mais</span></div>
      <ul ref={ref} className="mt-dif" aria-label="Diferença por categoria em relação ao mês anterior" onPointerLeave={esconder}>
        {itens.map((i) => {
          const info: InfoDica = { titulo: rotuloCategoria(i.categoria), linhas: [
            { rotulo: 'este mês', valor: brl(i.atual) }, { rotulo: 'mês anterior', valor: brl(i.anterior) },
          ] };
          const larg = `${(Math.abs(i.delta) / max) * 50}%`;
          return (
            <li key={i.categoria} tabIndex={0} aria-label={`${rotuloCategoria(i.categoria)}: ${i.delta > 0 ? 'mais' : 'menos'} ${brl(Math.abs(i.delta))}`}
              onPointerMove={(e) => mostrar(e, null, info)} onFocus={(e) => mostrar(null, e.currentTarget, info)} onBlur={esconder}>
              <span className="mt-dif-nome">{rotuloCategoria(i.categoria)}</span>
              <span className="mt-dif-val">{i.delta > 0 ? '▲ +' : '▼ −'}{brl(Math.abs(i.delta))}</span>
              <span className="mt-dif-trilho">
                <span className={'mt-dif-barra' + (i.delta > 0 ? ' mais' : ' menos')} style={i.delta > 0 ? { left: '50%', width: larg } : { right: '50%', width: larg }} />
              </span>
            </li>
          );
        })}
      </ul>
      <Dica d={d} largura={w} />
    </div>
  );
}

/* ------------------------------------------------------------ Gastos: a lista agrupada */

const diaMes = (dt: string) => (dt ? `${dt.slice(8, 10)}/${dt.slice(5, 7)}` : '');

export function ListaAgrupada({ grupos, onNatureza }: {
  grupos: { natureza: Natureza; total: number; categorias: { categoria: string; total: number; itens: Lancamento[] }[] }[];
  onNatureza: (l: Lancamento, valor: string) => void;
}) {
  return (
    <div className="mt-grupos">
      {grupos.map((g) => (
        <section key={g.natureza} className="mt-grupo" data-grupo={g.natureza}>
          <h4 className="mt-grupo-tit"><span className="fg-sw" style={{ background: COR_NAT[g.natureza] }} aria-hidden />{ROTULO_NATUREZA[g.natureza]}<b>{brl(g.total)}</b></h4>
          {g.categorias.map((c) => (
            <details key={c.categoria} className="mt-cat-grupo">
              <summary><span>{rotuloCategoria(c.categoria)} <span className="muted">{c.itens.length}</span></span><b>{brl(c.total)}</b></summary>
              <ul className="mt-itens">
                {c.itens.map((l) => (
                  <li key={l.mes + l.id}>
                    <span className="muted">{diaMes(l.liquidadoEm || l.vencimento)}</span>
                    <span className="mt-quebra">{l.descricao}{l.viaCartao ? <span className="muted"> · cartão</span> : null}</span>
                    <b>{brl(Number(l.valor))}</b>
                    <select aria-label={`Natureza de ${l.descricao}`} value={l.natureza || ''} onChange={(e) => onNatureza(l, e.target.value)}>
                      <option value="">pela categoria{l.pontual ? ' (pontual)' : ''}</option>
                      <option value="fixo">fixo</option>
                      <option value="variavel">variável</option>
                      <option value="pontual">pontual</option>
                    </select>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Entradas: linha do tempo */

export function LinhaDoTempo({ contratos, hojeMes }: {
  contratos: { chave: string; cliente: string; rotulo: string; inicio: string; fim: string; semFim: boolean; valor: number }[]; hojeMes: string;
}) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  if (!contratos.length) return null;
  const somar = (m: string, k: number) => { const [a, b] = m.split('-').map(Number); const t = a * 12 + b - 1 + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  const de = hojeMes;
  const ultimo = contratos.filter((c) => !c.semFim).map((c) => c.fim).sort().pop() || hojeMes;
  let ate = somar(ultimo > hojeMes ? ultimo : hojeMes, 2);
  const meses: string[] = [];
  for (let m = de; m <= ate && meses.length < 24; m = somar(m, 1)) meses.push(m);
  ate = meses[meses.length - 1];
  const N = meses.length;
  const pos = (m: string) => Math.max(0, Math.min(N, meses.indexOf(m) < 0 ? (m < de ? 0 : N) : meses.indexOf(m)));
  const passo = w && w < 520 ? Math.ceil(N / 4) : Math.ceil(N / 10);
  // cliente com mais de um contrato: a linha leva o nome do contrato, não só o do cliente
  const repetido = new Set(contratos.map((c) => c.cliente).filter((c, i, a) => a.indexOf(c) !== i));
  return (
    <div ref={ref} className="fg-plot mt-tempo" onPointerLeave={esconder}>
      <div className="mt-tempo-eixo" aria-hidden>
        {meses.map((m, i) => (i % passo === 0 ? <span key={m} style={{ left: `${(i / N) * 100}%` }} className={m === hojeMes ? 'hoje' : ''}>{curto(m)}</span> : null))}
      </div>
      <ul className="mt-tempo-linhas" aria-label="Contratos de renda que se repete, do mês de hoje em diante">
        {contratos.map((c) => {
          const x0 = pos(c.inicio < de ? de : c.inicio);
          const x1 = c.semFim ? N : pos(c.fim) + 1;
          const nome = repetido.has(c.cliente) && c.rotulo ? c.rotulo : c.cliente;
          const info: InfoDica = { titulo: c.rotulo && c.rotulo !== c.cliente ? `${c.cliente} · ${c.rotulo}` : c.cliente, linhas: [
            { cor: 'var(--s1)', rotulo: 'por mês', valor: brl(c.valor) },
            { rotulo: c.semFim ? 'sem data de fim' : 'último mês', valor: c.semFim ? 'segue' : curto(c.fim) },
          ] };
          return (
            <li key={c.chave} tabIndex={0} aria-label={`${c.cliente}: ${brl(c.valor)} por mês, ${c.semFim ? 'sem data de fim' : 'até ' + curto(c.fim)}`}
              onPointerMove={(e) => mostrar(e, null, info)} onFocus={(e) => mostrar(null, e.currentTarget, info)} onBlur={esconder}>
              <span className="mt-barra-nome">{nome}</span>
              <span className="mt-barra-val"><b>{brl(c.valor)}</b><span className="muted">{c.semFim ? ' · segue →' : ` · até ${curto(c.fim)}`}</span></span>
              <span className="mt-tempo-trilho">
                <span className={'mt-tempo-barra' + (c.semFim ? ' segue' : '')} style={{ left: `${(x0 / N) * 100}%`, width: `${(Math.max(0.6, x1 - x0) / N) * 100}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
      <Dica d={d} largura={w} />
    </div>
  );
}

/* ------------------------------------------------------------ Pronoia: sobra por mês */

/** Coluna que desce da linha do zero (valor negativo): cantos de 4 px embaixo. */
function colunaParaBaixo(x: number, y: number, w: number, h: number, raio = 4) {
  const r = Math.min(raio, w / 2, h);
  return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
}

export function SobraNoTempo({ meses, sobra }: { meses: string[]; sobra: number[] }) {
  const [ref, w] = useLargura<HTMLDivElement>();
  const { d, mostrar, esconder } = useDica(ref);
  const H = 210;
  const lo = Math.min(0, ...sobra), hi = Math.max(1, ...sobra);
  const y = scaleLinear().domain([lo, hi]).nice(4).range([H - M.bottom, M.top]);
  const x = scaleBand().domain(meses).range([M.left, Math.max(w - M.right, M.left + 1)]).paddingInner(0.35).paddingOuter(0.15);
  const bw = Math.min(24, x.bandwidth());
  const ultimo = meses.length - 1;
  return (
    <div ref={ref} className="fg-plot" onPointerLeave={esconder}>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Sobra estimada por mês: renda que se repete menos gasto que se repete">
          <EixoY y={y} largura={w} />
          {meses.map((m, i) => {
            const v = sobra[i];
            const bx = (x(m) || 0) + (x.bandwidth() - bw) / 2;
            const neg = v < 0;
            const h = Math.abs(y(v) - y(0));
            const info: InfoDica = { titulo: curto(m) + (i === ultimo ? ' · depois do razão' : ''), linhas: [{ cor: neg ? 'var(--mt-neg)' : 'var(--s1)', rotulo: neg ? 'falta' : 'sobra', valor: brl(v) }] };
            return (
              <g key={m} className="fg-hit" tabIndex={0} aria-label={`${curto(m)}: ${neg ? 'falta' : 'sobra'} ${brl(Math.abs(v))}`}
                onPointerMove={(e) => mostrar(e, null, info)} onFocus={(e) => mostrar(null, e.currentTarget, info)} onBlur={esconder}>
                <rect x={x(m)} y={M.top} width={x.bandwidth()} height={H - M.top - M.bottom} fill="transparent" />
                {/* cantos de 4 px na ponta do dado, quadrada na linha do zero */}
                {h > 0 && (neg ? <path d={colunaParaBaixo(bx, y(0), bw, h)} fill="var(--mt-neg)" /> : <path d={colunaPath(bx, y(v), bw, h)} fill="var(--s1)" />)}
                {(i === 0 || i === ultimo) && <text className="fg-rot" x={bx + bw / 2} y={neg ? y(v) + 14 : y(v) - 6} textAnchor="middle">{neg ? '⚠ ' : ''}{num(v)}</text>}
                <text className={'fg-xtick' + (i === 0 ? ' hoje' : '')} x={(x(m) || 0) + x.bandwidth() / 2} y={H - 8} textAnchor="middle">{w < 520 && i % 2 && i !== ultimo ? '' : curto(m)}</text>
              </g>
            );
          })}
        </svg>
      )}
      <Dica d={d} largura={w} />
    </div>
  );
}

/* ------------------------------------------------------------ Plano: editor de tetos */

export function EditorTetos({ categorias, metaAtual, onSalvar, onCancelar }: {
  categorias: { categoria: string; natureza: Natureza; referencia: number; meses: number; teto: number | null }[];
  metaAtual?: number;
  onSalvar: (tetos: Record<string, string>, meta: string) => Promise<void>;
  onCancelar: () => void;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(categorias.map((c) => [c.categoria, c.teto ? String(c.teto).replace('.', ',') : ''])));
  const [meta, setMeta] = useState(metaAtual ? String(metaAtual).replace('.', ',') : '');
  const [nova, setNova] = useState('');
  const [msg, setMsg] = useState('');
  const [salvando, setSalvando] = useState(false);
  const lista = Object.keys(valores);
  const ref = Object.fromEntries(categorias.map((c) => [c.categoria, c]));
  return (
    <form className="mt-editor" onSubmit={async (e) => {
      e.preventDefault();
      setSalvando(true); setMsg('');
      try { await onSalvar(valores, meta); } catch (err) { setMsg('Não deu para salvar: ' + (err as Error).message); } finally { setSalvando(false); }
    }}>
      <p className="fg-explica">Teto por mês para cada categoria. Campo vazio = sem teto. A referência ao lado é a mediana do que já saiu{categorias[0] ? ` (${categorias[0].meses} ${categorias[0].meses === 1 ? 'mês completo' : 'meses completos'})` : ''}, só para apoiar: o valor é decisão sua.</p>
      <ul className="mt-editor-lista">
        {lista.map((c) => (
          <li key={c}>
            <label htmlFor={'teto-' + c}>{rotuloCategoria(c)} <span className="muted">· {ROTULO_NATUREZA[ref[c]?.natureza || 'variavel'].toLowerCase()}</span></label>
            <span className="muted mt-editor-ref">{ref[c] ? `referência ${brl(ref[c].referencia)}` : 'nova'}</span>
            <input id={'teto-' + c} inputMode="decimal" autoComplete="off" placeholder="sem teto" value={valores[c]} onChange={(e) => setValores({ ...valores, [c]: e.target.value })} />
          </li>
        ))}
      </ul>
      <div className="mt-editor-linha">
        <input aria-label="outra categoria" placeholder="outra categoria" value={nova} onChange={(e) => setNova(e.target.value)} />
        <button type="button" className="mt-botao fraco" onClick={() => { const k = nova.trim().toLowerCase(); if (k && !(k in valores)) setValores({ ...valores, [k]: '' }); setNova(''); }}>Incluir</button>
      </div>
      <label className="mt-editor-meta" htmlFor="meta-reserva">Meta da reserva <span className="muted">(vazio = piso de R$ 5.000)</span>
        <input id="meta-reserva" inputMode="decimal" autoComplete="off" placeholder="5.000,00" value={meta} onChange={(e) => setMeta(e.target.value)} />
      </label>
      <div className="mt-editor-linha">
        <button className="mt-botao" disabled={salvando}>{salvando ? 'salvando…' : 'Salvar tetos'}</button>
        <button type="button" className="mt-botao fraco" onClick={onCancelar}>Cancelar</button>
      </div>
      {msg && <p className="fin-erro" role="alert">{msg}</p>}
    </form>
  );
}

export { Cartao };
