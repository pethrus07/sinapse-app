// Aion: o módulo de investimentos do Sinapse (o tempo longo dos gregos, o dos juros compostos).
// Item próprio no menu, ao lado da Métis; rota #/aion/<tela>, abre na Carteira. Oito telas:
// Carteira, Porquês, Observação, Simular, Metas, Economia, Estudo e Minha regra. O porquê está em
// todas, como pop-up (AionPorque.tsx). O Aion não recomenda: quem decide é o Pedro.
import { useCallback, useEffect, useState } from 'react';
import type { Aion, AtivoObservado, Financeiro } from '../types';
import { hojeYmd } from '../lib/agenda';
import { PorqueProvider } from './AionPorque';
import {
  AionCarteira, AionEconomia, AionEstudo, AionMetas, AionObservacao, AionPorques, AionRegra, AionSimular, SemMercado, TELAS_AION, type TelaAion,
} from './AionPaginas';

interface Props {
  aion: Aion;
  financeiro: Financeiro;
  onSalvar: (payload: Record<string, unknown>) => Promise<void>;
  onOpen: (id: string) => void;
}

const telaDoHash = (): { tela: TelaAion; bloco: number | null } => {
  const resto = location.hash.replace(/^#\/aion\/?/, '');
  const [t, q] = resto.split('?');
  const tela = (TELAS_AION.find((x) => x.tela === t.split('/')[0])?.tela) || 'carteira';
  const bloco = Number(new URLSearchParams(q || '').get('bloco')) || null;
  return { tela, bloco };
};

const br = (d: string) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const horas = (iso: string) => (Date.now() - Date.parse(iso)) / 3600000;

export function AionView({ aion, financeiro, onSalvar, onOpen }: Props) {
  const hoje = hojeYmd();
  const [{ tela, bloco }, setEstado] = useState(telaDoHash);
  useEffect(() => {
    const ouvir = () => { if (location.hash.startsWith('#/aion')) setEstado(telaDoHash()); };
    window.addEventListener('hashchange', ouvir);
    return () => window.removeEventListener('hashchange', ouvir);
  }, []);
  const irPara = useCallback((t: TelaAion, b: number | null = null) => {
    setEstado({ tela: t, bloco: b });
    history.replaceState(null, '', t === 'carteira' ? '#/aion' : `#/aion/${t}${b ? `?bloco=${b}` : ''}`);
  }, []);
  const onEstudar = useCallback((n: number) => irPara('estudo', n), [irPara]);
  // a tela ativa à vista no celular (as abas rolam de lado)
  useEffect(() => {
    const el = document.querySelector('.aion .mt-abas [aria-selected="true"]') as HTMLElement | null;
    const pai = el?.parentElement;
    if (el && pai && (el.offsetLeft < pai.scrollLeft || el.offsetLeft + el.offsetWidth > pai.scrollLeft + pai.clientWidth)) pai.scrollLeft = el.offsetLeft - 16;
    if (tela === 'estudo' && bloco) document.getElementById(`bloco-${bloco}`)?.scrollIntoView({ block: 'center' });
  }, [tela, bloco]);
  const info = TELAS_AION.find((t) => t.tela === tela)!;
  const m = aion.mercado;
  const velho = m?.geradoEm ? horas(m.geradoEm) > 72 : false;
  const props = { aion, financeiro, hoje };
  return (
    <PorqueProvider aion={aion} hoje={hoje} onEstudar={onEstudar}>
      <div className="pad-scroll metis aion">
        <div className="mt-topo">
          <div className="eyebrow-mono">Aion{tela !== 'carteira' ? ` › ${info.rotulo}` : ''}</div>
          <h1 className="rm-title">{info.titulo}</h1>
          <nav className="mt-abas" role="tablist" aria-label="Telas do Aion">
            {TELAS_AION.map((t) => (
              <button key={t.tela} role="tab" aria-selected={tela === t.tela} className={'proj-tab' + (tela === t.tela ? ' active' : '')} onClick={() => irPara(t.tela)}>{t.rotulo}</button>
            ))}
          </nav>
          <p className="ai-topo-nota">
            {m ? <>Dado de mercado de {br(m.geradoEm)} {m.geradoEm.slice(11, 16)}{velho ? <> <span aria-hidden>⚠ </span>(mais de 3 dias: rode a coleta)</> : ''}. </> : 'Sem dado de mercado. '}
            O Aion mostra dado, fonte e data; quem decide é você.
          </p>
          {aion.erros.length > 0 && <p className="fg-aviso" role="alert"><span aria-hidden>⚠ </span>{aion.erros.map((e) => `${e.arquivo}: ${e.erro}`).join(' · ')}. Nada foi regravado em cima; corrija o arquivo.</p>}
        </div>
        {tela === 'carteira' && <AionCarteira {...props} onTela={(t) => irPara(t as TelaAion)} />}
        {tela === 'porques' && (m ? <AionPorques {...props} /> : <SemMercado />)}
        {tela === 'observacao' && <AionObservacao {...props} onSalvar={(ativos: AtivoObservado[]) => onSalvar({ acao: 'observacao', ativos })} />}
        {tela === 'simular' && <AionSimular key={m?.geradoEm || 'sem'} {...props} />}
        {tela === 'metas' && <AionMetas {...props} onSalvar={(x) => onSalvar({ acao: 'metas', ...x })} />}
        {tela === 'economia' && <AionEconomia {...props} />}
        {tela === 'estudo' && <AionEstudo {...props} blocoFoco={bloco} onProgresso={(n, p) => onSalvar({ acao: 'estudo', bloco: n, progresso: p })} onNota={() => aion.trilha.nota && onOpen(aion.trilha.nota)} />}
        {tela === 'regra' && <AionRegra {...props} onSalvar={(r) => onSalvar({ acao: 'regra', ...r })} onEstudar={onEstudar} />}
        {m?.cripto && <p className="ai-rodape">{m.cripto.citar}</p>}
      </div>
    </PorqueProvider>
  );
}
