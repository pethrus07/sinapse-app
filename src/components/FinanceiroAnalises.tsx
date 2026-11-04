// A fila "a classificar" da Métis (aba Lançamentos): o que a sincronização do banco não reconheceu.
// Um toque na categoria resolve; "lembrar" grava a regra no regras.json local (fora do git).
// (As análises que moravam aqui foram para MetisPaginas.tsx / MetisGraficos.tsx na Métis v2.)
import { useMemo, useState } from 'react';
import type { Lancamento } from '../types';
import { brl, rotuloCategoria } from '../lib/financeiro';
import { A_CLASSIFICAR } from '../lib/financeiroAnalise';

const diaMes = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');

/* -------------------------------------------------------- fila a classificar */

export function FilaClassificar({ ls, categorias, onClassificar }: {
  ls: Lancamento[];
  categorias: string[];
  onClassificar: (mes: string, id: string, categoria: string, lembrar: boolean) => Promise<{ lembrou: boolean; motivo?: string } | null>;
}) {
  const fila = useMemo(() => ls.filter((l) => (l.categoria || '') === A_CLASSIFICAR).sort((a, b) => String(b.liquidadoEm || b.vencimento).localeCompare(String(a.liquidadoEm || a.vencimento))), [ls]);
  const [lembrar, setLembrar] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [livre, setLivre] = useState('');
  const [msg, setMsg] = useState('');
  if (!fila.length) return (
    <section className="fin-bloco mt-fila vazia" aria-label="A classificar">
      <h3>A classificar <span className="muted">0</span></h3>
      <p className="muted small">{msg || 'Nada a classificar: tudo que veio do banco tem categoria.'}</p>
    </section>
  );
  const escolher = async (l: Lancamento, cat: string) => {
    const c = cat.trim();
    if (!c) return;
    try {
      const r = await onClassificar(l.mes, l.id, c, lembrar);
      setMsg(`"${l.descricao}" agora é ${rotuloCategoria(c)}.` + (lembrar ? (r?.lembrou ? ' Os próximos iguais já chegam com essa categoria.' : ` Não deu para lembrar: ${r?.motivo || 'sem dado do banco'}.`) : ''));
      setAberto(null); setLivre('');
    } catch (e) {
      setMsg('Não deu para salvar: ' + (e as Error).message);
    }
  };
  return (
    <section className="fin-bloco mt-fila" aria-label="A classificar">
      <div className="fin-listahead">
        <h3>A classificar <span className="muted">{fila.length}</span></h3>
        <label className="fin-check"><input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /><span>lembrar para os próximos</span></label>
      </div>
      <p className="muted small">O que a sincronização não reconheceu. Um toque na categoria resolve; com "lembrar", a regra vai para o arquivo de regras desta máquina (fora do git).</p>
      {msg && <p className="fin-nota" role="status">{msg}</p>}
      <ul className="mt-fila-lista">
        {fila.map((l) => (
          <li key={l.mes + l.id}>
            <button className="mt-fila-item" aria-expanded={aberto === l.id} onClick={() => setAberto(aberto === l.id ? null : l.id)}>
              <span className="muted">{diaMes(l.liquidadoEm || l.vencimento)}</span>
              <span className="mt-quebra">{l.descricao}{l.conta ? <span className="muted"> · {l.conta}</span> : null}</span>
              <b className={l.tipo === 'entrada' ? 'entrada' : 'saida'}>{l.tipo === 'entrada' ? '+' : '−'}{brl(Number(l.valor))}</b>
            </button>
            {aberto === l.id && (
              <div className="mt-fila-cats">
                {categorias.map((c) => <button key={c} className="mt-chip" onClick={() => escolher(l, c)}>{rotuloCategoria(c)}</button>)}
                <form onSubmit={(e) => { e.preventDefault(); escolher(l, livre); }} className="mt-chip-livre">
                  <input value={livre} onChange={(e) => setLivre(e.target.value)} placeholder="outra categoria" aria-label="outra categoria" />
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
