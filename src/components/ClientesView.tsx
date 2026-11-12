import { useMemo, useState } from 'react';
import type { Financeiro, Note } from '../types';
import { brl } from '../lib/financeiro';

interface Props {
  notes: Note[];
  financeiro: Financeiro;
  onOpen: (id: string) => void;
}

interface Canal { id: string; nome: string }
interface Cliente {
  id: string; nome: string; canal: string; indicadoPor?: string; nota?: string;
  projetos?: string[]; receita?: string[]; estado?: string; obs?: string; emprego?: boolean;
}

// cor por canal (fundo escuro, distintas entre si); "a confirmar" é cinza: lacuna, não canal
const COR_CANAL: Record<string, string> = {
  '99freelas': '#4FA3F0',
  indicacao: '#E8A33D',
  pessoal: '#F2739D',
  faculdade: '#7FD858',
  'a-confirmar': '#5d6678',
};
const corCanal = (id: string) => COR_CANAL[id] || '#9A8CF0';
const parado = (e?: string) => ['concluido', 'encerrado', 'parado'].includes(e || '');

// Lê o bloco ```clientes da nota 04-NEGOCIO/clientes.md (vem no corpo da nota, sem passo de índice)
function lerClientes(notes: Note[]): { canais: Canal[]; clientes: Cliente[]; erro: string } {
  const nota = notes.find((n) => n.type === 'clientes');
  if (!nota) return { canais: [], clientes: [], erro: 'sem nota de clientes (tipo: clientes) no vault' };
  const m = (nota.body || '').match(/```clientes\s*\n([\s\S]*?)```/);
  if (!m) return { canais: [], clientes: [], erro: 'a nota de clientes não tem o bloco ```clientes' };
  try {
    const j = JSON.parse(m[1]);
    return { canais: j.canais || [], clientes: j.clientes || [], erro: '' };
  } catch (e) {
    return { canais: [], clientes: [], erro: 'bloco de clientes com JSON inválido: ' + (e as Error).message };
  }
}

// Mapa de clientes: canal → cliente → projetos, com quem indicou quem. A receita de cada cliente
// é a soma dos lançamentos de entrada da Métis com os nomes listados em `receita`.
export function ClientesView({ notes, financeiro, onOpen }: Props) {
  const { canais, clientes, erro } = useMemo(() => lerClientes(notes), [notes]);
  const [sobre, setSobre] = useState<string | null>(null);
  const titulo = useMemo(() => new Map(notes.map((n) => [n.id, n.title])), [notes]);

  // receita recebida e a receber, por cliente
  const dinheiro = useMemo(() => {
    const m = new Map<string, { recebido: number; aReceber: number }>();
    for (const c of clientes) {
      const nomes = new Set((c.receita || []).map((x) => x.toLowerCase()));
      let recebido = 0, aReceber = 0;
      for (const l of financeiro.lancamentos) {
        if (l.tipo !== 'entrada' || !nomes.has((l.cliente || '').toLowerCase())) continue;
        if (l.status === 'recebido') recebido += Number(l.valor) || 0;
        else if (l.status === 'a-receber') aReceber += Number(l.valor) || 0;
      }
      m.set(c.id, { recebido, aReceber });
    }
    return m;
  }, [clientes, financeiro.lancamentos]);

  // a "raiz" de cada cliente: segue o indicadoPor até o primeiro; o canal da raiz é o canal da rede
  const raiz = (c: Cliente, visto = new Set<string>()): Cliente => {
    const pai = c.indicadoPor && clientes.find((x) => x.id === c.indicadoPor);
    if (!pai || visto.has(pai.id)) return c;
    visto.add(c.id);
    return raiz(pai, visto);
  };

  const porCanal = useMemo(() => {
    return canais
      .map((ca) => {
        const diretos = clientes.filter((c) => c.canal === ca.id);
        const rede = clientes.filter((c) => c.canal !== ca.id && c.indicadoPor && raiz(c).canal === ca.id);
        const daRede = [...diretos, ...rede].filter((c) => !c.emprego);
        const recebido = daRede.reduce((s, c) => s + (dinheiro.get(c.id)?.recebido || 0), 0);
        return { ...ca, diretos, rede, recebido };
      })
      .filter((ca) => ca.diretos.length || ca.rede.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canais, clientes, dinheiro]);

  if (erro) return <div className="pad-scroll"><div className="cl-page"><p className="muted">{erro}</p></div></div>;

  // ---------- desenho: canais | clientes | projetos ----------
  // clientes na ordem do canal; o indicado vem logo abaixo de quem indicou
  const ordem: Cliente[] = [];
  const colocar = (c: Cliente) => {
    if (ordem.includes(c)) return;
    ordem.push(c);
    for (const f of clientes.filter((x) => x.indicadoPor === c.id)) colocar(f);
  };
  for (const ca of canais) for (const c of clientes.filter((x) => x.canal === ca.id && !x.indicadoPor)) colocar(c);
  for (const c of clientes) colocar(c);

  const LIN = 40, TOPO = 30;
  const X_CANAL = 20, W_CANAL = 170, X_CLI = 330, W_CLI = 290, X_PROJ = 760;
  const yCli = new Map<string, number>();
  const linhasProj: { cli: string; id: string; y: number }[] = [];
  let y = TOPO;
  for (const c of ordem) {
    const projs = [c.nota, ...(c.projetos || [])].filter((p): p is string => !!p && titulo.has(p));
    const altura = Math.max(1, projs.length) * LIN;
    yCli.set(c.id, y + altura / 2);
    projs.forEach((p, i) => linhasProj.push({ cli: c.id, id: p, y: y + i * LIN + LIN / 2 }));
    y += altura + 14;
  }
  const H = y + 10;
  // canal: centrado nos seus clientes diretos
  const yCanal = new Map<string, number>();
  for (const ca of canais) {
    const ys = clientes.filter((c) => c.canal === ca.id && !c.indicadoPor).map((c) => yCli.get(c.id)!).filter((v) => v != null);
    if (ys.length) yCanal.set(ca.id, ys.reduce((a, b) => a + b, 0) / ys.length);
  }
  // escala das barras só entre clientes de freela: o salário (emprego) achatava todas as outras
  const maior = Math.max(1, ...clientes.filter((c) => !c.emprego).map((c) => dinheiro.get(c.id)?.recebido || 0));
  const aceso = (ids: string[]) => !sobre || ids.includes(sobre);
  const curva = (x0: number, y0: number, x1: number, y1: number) => `M${x0},${y0}C${(x0 + x1) / 2},${y0} ${(x0 + x1) / 2},${y1} ${x1},${y1}`;

  const total = clientes.filter((c) => !c.emprego).reduce((s, c) => s + (dinheiro.get(c.id)?.recebido || 0), 0);
  const aConfirmar = clientes.filter((c) => c.canal === 'a-confirmar').length;

  return (
    <div className="pad-scroll">
      <div className="cl-page">
        <header className="cl-topo">
          <div className="eyebrow-mono">Captação</div>
          <h1 className="rm-title">De onde vem o trabalho</h1>
          <p className="muted small">
            {clientes.length} clientes · {brl(total)} recebidos de freela desde que a Métis registra (sem o salário).
            {aConfirmar > 0 && <> {aConfirmar} com origem a confirmar.</>} A fonte é a nota Clientes, em 04-NEGOCIO.
          </p>
        </header>

        <div className="cl-canais">
          {porCanal.map((ca) => (
            <div key={ca.id} className="cl-canal" style={{ borderTopColor: corCanal(ca.id) }} onMouseEnter={() => setSobre(ca.id)} onMouseLeave={() => setSobre(null)}>
              <div className="cl-canal-nome">{ca.nome}</div>
              <div className="cl-canal-valor">{ca.recebido ? brl(ca.recebido) : '—'}</div>
              <div className="cl-canal-sub">
                {ca.diretos.length} {ca.diretos.length === 1 ? 'cliente' : 'clientes'}
                {ca.rede.length > 0 && <> + {ca.rede.length} por indicação</>}
              </div>
            </div>
          ))}
        </div>

        <section className="cl-mapa">
          <div className="cl-colunas">
            <span style={{ left: X_CANAL }}>Canal</span>
            <span style={{ left: X_CLI }}>Cliente · recebido</span>
            <span style={{ left: X_PROJ }}>Projetos</span>
          </div>
          <svg viewBox={`0 0 1140 ${H}`} className="cl-svg">
            <defs>
              <marker id="cl-seta" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0L10,5L0,10z" fill="#E8A33D" />
              </marker>
            </defs>
            {/* canal → cliente direto */}
            {clientes.filter((c) => !c.indicadoPor && yCanal.has(c.canal)).map((c) => (
              <path key={'cc' + c.id} d={curva(X_CANAL + W_CANAL, yCanal.get(c.canal)!, X_CLI, yCli.get(c.id)!)}
                className="cl-fio" style={{ stroke: corCanal(c.canal), opacity: aceso([c.id, c.canal]) ? 0.55 : 0.08 }} />
            ))}
            {/* quem indicou quem: arco pela esquerda dos cartões */}
            {clientes.filter((c) => c.indicadoPor && yCli.has(c.indicadoPor)).map((c) => {
              const y0 = yCli.get(c.indicadoPor!)!, y1 = yCli.get(c.id)!;
              const dx = 34 + Math.min(40, (y1 - y0) / 12);
              return (
                <g key={'in' + c.id} style={{ opacity: aceso([c.id, c.indicadoPor!, 'indicacao']) ? 1 : 0.12 }}>
                  <path d={`M${X_CLI},${y0 + 6}C${X_CLI - dx},${y0 + 6} ${X_CLI - dx},${y1} ${X_CLI - 2},${y1}`} className="cl-indicou" markerEnd="url(#cl-seta)" />
                  <text x={X_CLI - dx - 6} y={(y0 + y1) / 2} textAnchor="end" className="cl-indicou-rot">indicou</text>
                </g>
              );
            })}
            {/* cliente → projetos */}
            {linhasProj.map((p, i) => (
              <path key={'cp' + i} d={curva(X_CLI + W_CLI, yCli.get(p.cli)!, X_PROJ - 6, p.y)} className="cl-fio"
                style={{ stroke: '#3a4252', opacity: aceso([p.cli]) ? 1 : 0.15 }} />
            ))}

            {/* canais */}
            {canais.filter((ca) => yCanal.has(ca.id)).map((ca) => (
              <g key={ca.id} transform={`translate(${X_CANAL},${yCanal.get(ca.id)! - 18})`} onMouseEnter={() => setSobre(ca.id)} onMouseLeave={() => setSobre(null)}>
                <rect width={W_CANAL} height={36} rx={18} className="cl-canal-pilula" style={{ stroke: corCanal(ca.id) }} />
                <circle cx={18} cy={18} r={5} fill={corCanal(ca.id)} />
                <text x={32} y={18} dy="0.35em" className="cl-txt forte">{ca.nome}</text>
              </g>
            ))}

            {/* clientes: barra de receita embaixo do nome */}
            {ordem.map((c) => {
              const yc = yCli.get(c.id)!;
              const d = dinheiro.get(c.id)!;
              const cor = corCanal(c.indicadoPor ? 'indicacao' : c.canal);
              const w = d.recebido ? Math.min(W_CLI - 24, Math.max(4, (d.recebido / maior) * (W_CLI - 24))) : 0;
              return (
                <g key={c.id} transform={`translate(${X_CLI},${yc - 21})`} className={'cl-cli' + (parado(c.estado) ? ' parado' : '')}
                  style={{ opacity: aceso([c.id, c.canal, c.indicadoPor || '']) ? 1 : 0.25, cursor: c.nota ? 'pointer' : 'default' }}
                  onMouseEnter={() => setSobre(c.id)} onMouseLeave={() => setSobre(null)} onClick={() => c.nota && onOpen(c.nota)}>
                  <title>{[c.nome, c.obs].filter(Boolean).join(' · ')}</title>
                  <rect width={W_CLI} height={42} rx={9} className="cl-cli-caixa" style={{ stroke: cor }} />
                  <text x={12} y={16} className="cl-txt forte">{c.nome}{c.emprego ? ' · emprego' : ''}</text>
                  <text x={W_CLI - 12} y={16} textAnchor="end" className="cl-txt valor">
                    {d.recebido ? brl(d.recebido) : c.estado || ''}
                  </text>
                  <rect x={12} y={27} width={W_CLI - 24} height={5} rx={2.5} fill="#1d232f" />
                  {w > 0 && <rect x={12} y={27} width={w} height={5} rx={2.5} fill={cor} />}
                  {d.aReceber > 0 && <text x={W_CLI - 12} y={39} textAnchor="end" className="cl-txt mini">+ {brl(d.aReceber)} a receber</text>}
                </g>
              );
            })}

            {/* projetos */}
            {linhasProj.map((p, i) => (
              <g key={'p' + i} transform={`translate(${X_PROJ},${p.y})`} className="cl-proj" style={{ opacity: aceso([p.cli]) ? 1 : 0.2 }} onClick={() => onOpen(p.id)}>
                <circle r={4} fill="#5d6678" />
                <text x={12} dy="0.35em" className="cl-txt">{(titulo.get(p.id) || p.id).slice(0, 48)}</text>
              </g>
            ))}
          </svg>
        </section>

        <div className="cl-legenda">
          {canais.filter((ca) => yCanal.has(ca.id) || ca.id === 'indicacao').map((ca) => (
            <span key={ca.id}><i style={{ background: corCanal(ca.id) }} /> {ca.nome}</span>
          ))}
          <span><i className="seta" /> indicou (cliente que trouxe outro)</span>
          <span><i className="barra" /> recebido (o que a Métis registra)</span>
          <span className="apagado">cliente parado ou encerrado aparece apagado</span>
        </div>
      </div>
    </div>
  );
}
