import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import notesData from './data/notes.json';
import graphData from './data/graph.json';
import statsData from './data/stats.json';
import roadmapData from './data/roadmap.json';
import agendaData from './data/agenda.json';
import financeiroData from './data/financeiro.json';
import type { Agenda, Financeiro, GraphData, Note, Stats } from './types';
import { GraphView } from './components/GraphView';
import { RoadmapCanvasView } from './components/RoadmapCanvasView';
import { NoteView } from './components/NoteView';
import { SearchView } from './components/SearchView';
import { RoadmapView } from './components/RoadmapView';
import { ProjectsView } from './components/ProjectsView';
import { TreeView } from './components/TreeView';
import { SkillTreeView } from './components/SkillTreeView';
import { AgendaView } from './components/AgendaView';
import { FinanceiroView } from './components/FinanceiroView';
import { NoteEditor } from './components/NoteEditor';
import { acaoFinanceiro, buscarIndice, buscarVersao, criarDaily, lancarFinanceiro, setProgress } from './lib/api';
import { corpoDaDaily, normalizar } from './lib/agenda';
import { normalizarFin } from './lib/financeiro';
import { areaLabel, colorForArea } from './lib/colors';

function go(path: string) {
  window.location.hash = path;
}

type Route =
  | { type: 'graph' | 'search' | 'roadmap' | 'projetos' | 'arvore' | 'skills' | 'nova' | 'agenda' | 'financeiro' }
  | { type: 'note' | 'area'; arg: string };

function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const f = () => setHash(window.location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const m = hash.replace(/^#\/?/, '');
  if (m.startsWith('note/')) return { type: 'note', arg: decodeURIComponent(m.slice(5).split('?')[0]) };
  if (m.startsWith('area/')) return { type: 'area', arg: decodeURIComponent(m.slice(5)) };
  if (m.startsWith('search')) return { type: 'search' };
  if (m.startsWith('grafo')) return { type: 'graph' };
  if (m.startsWith('projetos')) return { type: 'projetos' };
  if (m.startsWith('arvore')) return { type: 'arvore' };
  if (m.startsWith('skills')) return { type: 'skills' };
  if (m.startsWith('agenda')) return { type: 'agenda' };
  if (m.startsWith('financeiro')) return { type: 'financeiro' };
  if (m.startsWith('nova')) return { type: 'nova' };
  return { type: 'roadmap' };
}

function StatsPanel({ stats }: { stats: Stats }) {
  const level = Math.floor(stats.notes / 5) + 1;
  const p3 = stats.notes ? Math.round((stats.with3 / stats.notes) * 100) : 0;
  const density = stats.notes ? (stats.links / stats.notes).toFixed(2) : '0';
  return (
    <div className="stats">
      <div className="stats-top">
        <span className="level">Nível {level}</span>
        <span className="muted small">densidade {density}</span>
      </div>
      <div className="stat-grid">
        <div className="stat"><b>{stats.notes}</b><span>notas</span></div>
        <div className="stat"><b>{stats.links}</b><span>conexões</span></div>
        <div className="stat"><b>{stats.ghosts}</b><span>sementes</span></div>
      </div>
      <div className="xp">
        <div className="xp-label">
          <span>Regra dos 3 links</span>
          <span>{stats.with3}/{stats.notes}</span>
        </div>
        <div className="xp-bar"><div className="xp-fill" style={{ width: p3 + '%' }} /></div>
      </div>
    </div>
  );
}

// Projeto com roadmap → abas (Visão geral · Roadmap canvas). É o fluxo Projetos → Commagente → Canvas.
function ProjectView({ note, byId, roadmap, onNav, onIndex }: {
  note: Note; byId: Map<string, Note>; roadmap: any; onNav: (p: string) => void; onIndex: (i: any) => void;
}) {
  const [tab, setTab] = useState<'nota' | 'roadmap'>('nota');
  return (
    <div className="proj-detail">
      <div className="proj-tabs">
        <button className={'proj-tab' + (tab === 'nota' ? ' active' : '')} onClick={() => setTab('nota')}>📄 Visão geral</button>
        <button className={'proj-tab' + (tab === 'roadmap' ? ' active' : '')} onClick={() => setTab('roadmap')}>🗺️ Roadmap · {roadmap.items?.length ?? 0}</button>
      </div>
      <div className="proj-tabbody">
        {tab === 'nota' ? (
          <NoteView note={note} byId={byId} onNav={onNav} onIndex={onIndex} />
        ) : (
          <RoadmapCanvasView roadmap={roadmap} onOpenSource={() => onNav('/note/' + encodeURIComponent(roadmap.id || 'commagente-roadmap'))} />
        )}
      </div>
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState(notesData as unknown as Note[]);
  const [graph, setGraph] = useState(graphData as unknown as GraphData);
  const [stats, setStats] = useState(statsData as unknown as Stats);
  const [agenda, setAgenda] = useState<Agenda>(() => normalizar(agendaData as unknown as Agenda));
  const [financeiro, setFinanceiro] = useState<Financeiro>(() => normalizarFin(financeiroData as unknown as Financeiro));

  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const areas = useMemo(() => Object.entries(stats.byArea).sort((a, b) => b[1] - a[1]), [stats]);

  function applyIndex(idx: any) {
    if (idx?.notes) setNotes(idx.notes as Note[]);
    if (idx?.graph) setGraph(idx.graph as GraphData);
    if (idx?.stats) setStats(idx.stats as Stats);
    if (idx?.agenda) setAgenda(normalizar(idx.agenda as Agenda));
    if (idx?.financeiro) setFinanceiro(normalizarFin(idx.financeiro as Financeiro));
  }

  // O JSON empacotado (src/data) fica no server.watch.ignored do Vite, logo pode estar
  // velho: reindex por CLI, edicao do .md na mao ou outra aba nao invalidam o cache.
  // Por isso a fonte de verdade e o /api/indice — no mount e ao voltar o foco.
  useEffect(() => {
    let vivo = true;
    const versaoRef = { atual: -1 };

    const puxar = async () => {
      try {
        const idx = await buscarIndice();
        if (!vivo) return;
        versaoRef.atual = idx.versao ?? versaoRef.atual;
        applyIndex(idx);
      } catch {
        /* build estatico ou servidor fora: segue com o JSON empacotado */
      }
    };

    const revalidar = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const { versao } = await buscarVersao();
        if (vivo && versao !== versaoRef.atual) await puxar();
      } catch {
        /* sem servidor: nada a revalidar */
      }
    };

    puxar();
    window.addEventListener('focus', revalidar);
    document.addEventListener('visibilitychange', revalidar);
    return () => {
      vivo = false;
      window.removeEventListener('focus', revalidar);
      document.removeEventListener('visibilitychange', revalidar);
    };
  }, []);

  async function handleProgress(rel: string, progresso: string) {
    try {
      const idx = await setProgress(rel, progresso);
      applyIndex(idx);
    } catch (e) {
      alert('Não deu pra salvar o progresso: ' + (e as Error).message + '\n(o app precisa estar rodando via npm run dev)');
    }
  }

  async function handleCriarDaily(dia: string) {
    try {
      const idx = await criarDaily(dia, corpoDaDaily(dia));
      applyIndex(idx);
      go('/note/' + encodeURIComponent(dia));
    } catch (e) {
      alert('Nao deu pra criar a daily: ' + (e as Error).message + String.fromCharCode(10) + '(o app precisa estar rodando via npm run dev)');
    }
  }

  async function handleLancar(l: Record<string, unknown>) {
    const idx = await lancarFinanceiro(l);
    applyIndex(idx);
  }

  async function handleAcaoFin(acao: 'liquidar' | 'reabrir' | 'remover', mes: string, id: string) {
    try {
      const idx = await acaoFinanceiro(acao, mes, id);
      applyIndex(idx);
    } catch (e) {
      alert('Nao deu pra salvar: ' + (e as Error).message);
    }
  }

  function onSearchChange(v: string) {
    setQuery(v);
    if (v && route.type !== 'search') go('/search');
  }

  const roadmap = roadmapData as any;
  let main: ReactNode;
  if (route.type === 'note') {
    const note = byId.get(route.arg);
    const temRoadmap = note && roadmap.projeto === note.id && (roadmap.items?.length ?? 0) > 0;
    main = note ? (
      temRoadmap ? (
        <ProjectView note={note} byId={byId} roadmap={roadmap} onNav={go} onIndex={applyIndex} />
      ) : (
        <NoteView note={note} byId={byId} onNav={go} onIndex={applyIndex} />
      )
    ) : (
      <div className="pad-scroll">
        <h2 className="page-title">Nota não encontrada</h2>
        <p className="muted">
          “{route.arg}” ainda não existe.{' '}
          <button className="linkbtn" onClick={() => go('/nova?title=' + encodeURIComponent(route.arg))}>
            Criar essa nota →
          </button>
        </p>
      </div>
    );
  } else if (route.type === 'area') {
    const list = notes
      .filter((n) => n.area.toLowerCase() === route.arg.toLowerCase())
      .sort((a, b) => b.degree - a.degree);
    main = (
      <div className="pad-scroll">
        <h2 className="page-title">{areaLabel(route.arg)}</h2>
        <p className="muted small">{list.length} nota(s)</p>
        <div className="cards">
          {list.map((n) => (
            <button key={n.id} className="card" onClick={() => go('/note/' + encodeURIComponent(n.id))}>
              <div className="card-title">{n.title}</div>
              <div className="card-sub">{n.degree} conexões</div>
            </button>
          ))}
        </div>
      </div>
    );
  } else if (route.type === 'search') {
    main = <SearchView notes={notes} query={query} onOpen={(id) => go('/note/' + encodeURIComponent(id))} />;
  } else if (route.type === 'projetos') {
    main = <ProjectsView notes={notes} onOpen={(id) => go('/note/' + encodeURIComponent(id))} />;
  } else if (route.type === 'arvore') {
    main = <TreeView notes={notes} onOpen={(id) => go('/note/' + encodeURIComponent(id))} />;
  } else if (route.type === 'agenda') {
    main = (
      <AgendaView
        agenda={agenda}
        notes={notes}
        onOpen={(id) => go('/note/' + encodeURIComponent(id))}
        onCriarDaily={handleCriarDaily}
      />
    );
  } else if (route.type === 'financeiro') {
    main = (
      <FinanceiroView
        financeiro={financeiro}
        notes={notes}
        onOpen={(id) => go('/note/' + encodeURIComponent(id))}
        onLancar={handleLancar}
        onAcao={handleAcaoFin}
      />
    );
  } else if (route.type === 'skills') {
    main = <SkillTreeView notes={notes} onOpen={(id) => go('/note/' + encodeURIComponent(id))} />;
  } else if (route.type === 'graph') {
    main = <GraphView data={graph} onSelect={(id) => go('/note/' + encodeURIComponent(id))} />;
  } else if (route.type === 'nova') {
    main = (
      <NoteEditor
        mode="new"
        onIndex={applyIndex}
        onDone={(id) => go('/note/' + encodeURIComponent(id))}
        onCancel={() => go('/')}
      />
    );
  } else {
    main = <RoadmapView notes={notes} onOpen={(id) => go('/note/' + encodeURIComponent(id))} onProgress={handleProgress} />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">🧠</span>
          <div>
            <div className="brand-name">Sinapse</div>
            <div className="brand-sub">segundo cérebro · v1</div>
          </div>
        </div>
        <div className="search">
          <input placeholder="Buscar…" value={query} onChange={(e) => onSearchChange(e.target.value)} />
        </div>
        <div className="newnote">
          <button onClick={() => go('/nova')}>＋ Nova nota</button>
        </div>
        <nav className="nav">
          <a className={'nav-item' + (route.type === 'roadmap' ? ' active' : '')} href="#/">
            <span className="nav-text">🗺️ Roadmap</span>
          </a>
          <a className={'nav-item' + (route.type === 'agenda' ? ' active' : '')} href="#/agenda">
            <span className="nav-text">🗓️ Agenda</span>
          </a>
          <a className={'nav-item' + (route.type === 'financeiro' ? ' active' : '')} href="#/financeiro">
            <span className="nav-text">💰 Financeiro</span>
          </a>
          <a className={'nav-item' + (route.type === 'projetos' ? ' active' : '')} href="#/projetos">
            <span className="nav-text">🚀 Projetos</span>
          </a>
          <a className={'nav-item' + (route.type === 'arvore' ? ' active' : '')} href="#/arvore">
            <span className="nav-text">🌳 Árvore</span>
          </a>
          <a className={'nav-item' + (route.type === 'graph' ? ' active' : '')} href="#/grafo">
            <span className="nav-text">🕸️ Grafo</span>
          </a>
          <a className={'nav-item' + (route.type === 'skills' ? ' active' : '')} href="#/skills">
            <span className="nav-text">🌟 Skill Tree</span>
          </a>
          <div className="nav-label">Áreas</div>
          {areas.map(([area, count]) => (
            <a
              key={area}
              className={'nav-item' + (route.type === 'area' && route.arg === area ? ' active' : '')}
              href={'#/area/' + encodeURIComponent(area)}
            >
              <span className="dot" style={{ background: colorForArea(area) }} />
              <span className="nav-text">{areaLabel(area)}</span>
              <span className="nav-count">{count}</span>
            </a>
          ))}
        </nav>
        <StatsPanel stats={stats} />
      </aside>
      <main className="main">{main}</main>
    </div>
  );
}
