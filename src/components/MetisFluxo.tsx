// Métis › Fluxo: de onde veio e para onde foi o dinheiro do mês, num diagrama de fluxo (Sankey)
// desenhado à mão em 4 colunas (o d3-sankey não está no projeto e 4 colunas fixas não pedem ele):
// clientes → o mês → fixo, variável, pontual, reserva e sobra → categorias. A conta é a de
// fluxoDoMes (financeiroModelo.ts), a mesma regra da Visão: os números batem com as outras abas.
import { useMemo, useState } from 'react';
import { brl, rotuloCategoria } from '../lib/financeiro';
import { fluxoDoMes, type NoFluxo } from '../lib/financeiroModelo';
import { ROTULO_NATUREZA } from '../lib/financeiroAnalise';
import { Cartao, curto } from './FinanceiroGraficos';
import { COR_NAT } from './MetisGraficos';
import type { PaginaProps } from './MetisPaginas';

const COL_X = [190, 450, 670, 900];
const NO_L = 12;
const GAP = 12;
const VAGA = 17; // cada nó ocupa pelo menos isto na coluna: o nome de fatia pequena não encosta no vizinho
const COR_CLIENTE = '#5d6678';
const COR_SALDO = 'var(--mt-neg)';
const COR_RESERVA = 'var(--s7)';
const COR_SOBRA = 'var(--s4)';

const corDe = (no: NoFluxo) =>
  no.tipo === 'natureza' || no.tipo === 'categoria' ? COR_NAT[no.natureza!] : no.tipo === 'reserva' ? COR_RESERVA : no.tipo === 'sobra' ? COR_SOBRA : no.tipo === 'saldo' ? COR_SALDO : no.tipo === 'mes' ? '#c9d2e0' : COR_CLIENTE;
const rotuloDe = (no: NoFluxo) =>
  no.tipo === 'natureza' ? ROTULO_NATUREZA[no.natureza!] : no.tipo === 'categoria' ? (no.rotulo === 'outras' ? 'Outras' : rotuloCategoria(no.rotulo)) : no.rotulo;
const mil = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : Math.round(v).toLocaleString('pt-BR'));

export function MetisFluxo({ financeiro, foco }: PaginaProps) {
  const f = useMemo(() => fluxoDoMes(financeiro.lancamentos, foco), [financeiro.lancamentos, foco]);
  const [sobre, setSobre] = useState<string | null>(null);

  const desenho = useMemo(() => {
    if (!f.nos.length) return null;
    const cols = [0, 1, 2, 3].map((c) => f.nos.filter((x) => x.coluna === c));
    const maisAlta = Math.max(...cols.map((c) => c.length));
    const H = Math.max(380, 60 + maisAlta * 34);
    const total = f.nos.find((x) => x.id === 'mes')!.valor;
    // a mesma escala em todas as colunas: a coluna com mais nós (e mais vãos) manda
    const k = Math.min(...cols.filter((c) => c.length).map((c) => (H - 40 - (GAP + VAGA) * (c.length - 1)) / c.reduce((s, x) => s + x.valor, 0)));
    const pos = new Map<string, { x: number; y: number; h: number; no: NoFluxo }>();
    cols.forEach((c, i) => {
      const alturaCol = c.reduce((s, x) => s + Math.max(VAGA, x.valor * k), 0) + GAP * (c.length - 1);
      let y = 20 + (H - 40 - alturaCol) / 2;
      for (const no of c) {
        const h = Math.max(2, no.valor * k);
        pos.set(no.id, { x: COL_X[i], y, h, no });
        y += Math.max(VAGA, h) + GAP;
      }
    });
    // faixas: cada nó solta e recebe em ordem, de cima para baixo
    const saidaY = new Map<string, number>(), entradaY = new Map<string, number>();
    const faixas = f.ligacoes.map((l) => {
      const a = pos.get(l.de)!, b = pos.get(l.para)!;
      const h = Math.max(1, l.valor * k);
      const y0 = (saidaY.get(l.de) ?? a.y), y1 = (entradaY.get(l.para) ?? b.y);
      saidaY.set(l.de, y0 + h);
      entradaY.set(l.para, y1 + h);
      const x0 = a.x + NO_L, x1 = b.x, mx = (x0 + x1) / 2;
      const d = `M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}L${x1},${y1 + h}C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h}Z`;
      const cor = l.de === 'mes' || b.no.tipo === 'categoria' ? corDe(b.no) : corDe(a.no);
      return { ...l, d, cor };
    });
    return { H, pos, faixas, total };
  }, [f]);

  if (!desenho)
    return (
      <div className="fg">
        <Cartao id="fluxo" className="largo" titulo={`Fluxo de ${curto(foco)}`} leitura="Nenhum dinheiro entrou nem saiu neste mês.">
          <span />
        </Cartao>
      </div>
    );

  const { H, pos, faixas } = desenho;
  const nClientes = f.nos.filter((x) => x.tipo === 'cliente').length;
  const destacada = (de: string, para: string) => !sobre || sobre === de || sobre === para;

  return (
    <div className="fg">
      <Cartao
        id="fluxo"
        className="largo"
        titulo={`De onde veio e para onde foi em ${curto(foco)}`}
        leitura={
          <>
            Entrou <b>{brl(f.entrou)}</b> de {nClientes} {nClientes === 1 ? 'origem' : 'origens'}; saiu <b>{brl(f.saiu)}</b> em gasto
            {f.guardado > 0 && <>, guardou <b>{brl(f.guardado)}</b></>}
            {f.sobrou > 0 && <> e sobrou <b>{brl(f.sobrou)}</b></>}
            {f.doSaldo > 0 && <>. <span aria-hidden>⚠ </span>Gastou <b>{brl(f.doSaldo)}</b> além do que entrou: veio do saldo de antes</>}.
          </>
        }
        mais={
          <>
            <p className="fg-explica">
              Esquerda: entradas recebidas no mês, por cliente. Meio: o mês. Direita: o gasto por natureza (a mesma regra da Visão: saída paga mais a compra no cartão no mês da compra), o que foi para a reserva e o que sobrou; na última coluna, as categorias. Categoria com menos de 3% do gasto entra em "Outras". Passe o mouse num bloco para seguir só os fios dele.
            </p>
            <table className="fg-tabela">
              <thead><tr><th>de</th><th>para</th><th className="num">R$</th></tr></thead>
              <tbody>
                {f.ligacoes.map((l, i) => (
                  <tr key={i}><td>{rotuloDe(pos.get(l.de)!.no)}</td><td>{rotuloDe(pos.get(l.para)!.no)}</td><td className="num">{brl(l.valor)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        }
      >
        <svg className="mt-fluxo" viewBox={`0 0 1130 ${H}`} role="img" aria-label={`Fluxo do dinheiro em ${curto(foco)}`}>
          {faixas.map((l, i) => (
            <path key={i} d={l.d} fill={l.cor} opacity={destacada(l.de, l.para) ? 0.38 : 0.08}>
              <title>{`${rotuloDe(pos.get(l.de)!.no)} → ${rotuloDe(pos.get(l.para)!.no)}: ${brl(l.valor)}`}</title>
            </path>
          ))}
          {[...pos.values()].map(({ x, y, h, no }) => {
            const cor = corDe(no);
            const lado = no.coluna === 0 ? 'esq' : 'dir';
            const meioY = y + h / 2;
            return (
              <g key={no.id} onMouseEnter={() => setSobre(no.id)} onMouseLeave={() => setSobre(null)} style={{ cursor: 'default' }}>
                <rect x={x} y={y} width={NO_L} height={h} rx={2} fill={cor}>
                  <title>{`${rotuloDe(no)}: ${brl(no.valor)}`}</title>
                </rect>
                {no.tipo === 'mes' ? (
                  <text x={x + NO_L / 2} y={y - 8} textAnchor="middle" className="mt-fluxo-rot forte">
                    {curto(foco)} · R$ {mil(no.valor)}
                  </text>
                ) : (
                  <text
                    x={lado === 'esq' ? x - 10 : x + NO_L + 8}
                    y={meioY}
                    dy="0.35em"
                    textAnchor={lado === 'esq' ? 'end' : 'start'}
                    className={'mt-fluxo-rot' + (no.coluna === 2 ? ' forte' : '')}
                  >
                    {rotuloDe(no)} <tspan className="mt-fluxo-val">R$ {mil(no.valor)}</tspan>
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </Cartao>
    </div>
  );
}
