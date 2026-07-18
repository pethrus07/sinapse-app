import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import notesData from './data/notes.json';
import graphData from './data/graph.json';
import statsData from './data/stats.json';
import type { GraphData, Note, Stats } from './types';
import { GraphView } from './components/GraphView';
import { NoteView } from './components/NoteView';
import { SearchView } from './components/SearchView';
import { RoadmapView } from './components/RoadmapView';
import { ProjectsView } from './components/ProjectsView';
import { areaLabel, colorForArea } from './lib/colors';

const notes = notesData as unknown as Note[];
const graph = graphData as unknown as GraphData;
const stats = statsData as unknown as Stats;
const byId = new Map(notes.map((n) => [n.id, n]));

function go(path: string) {
  window.location.hash = path;
}

type Route = { type: 'graph' | 'search' | 'roadmap' | 'projetos' } | { type: 'note' | 'area'; arg: string };

function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const f = () => setHash(window.location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const m = hash.replace(/^#\/?/, '');
  if (m.startsWith('note/')) return { type: 'note', arg: decodeURIComponent(m.slice(5)) };
  if (m.startsWith('area/')) return { type: 'area', arg: decodeURIComponent(m.slice(5)) };
  if (m.startsWith('search')) return { type: 'search' };
  if (m.startsWith('grafo')) return { type: 'graph' };
  if (m.startsWith('projetos')) return { type: 'projetos' };
  return { type: 'roadmap' };
}

function StatsPanel() {
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
        <div className="stat">
          <b>{stats.notes}</b>
          <span>notas</span>
        </div>
        <div className="stat">
          <b>{stats.links}</b>
          <span>conexões</span>
        </div>
        <div className="stat">
          <b>{stats.ghosts}</b>
          <span>sementes</span>
        </div>
      </div>
      <div className="xp">
        <div className="xp-label">
          <span>Regra dos 3 links</span>
          <span>
            {stats.with3}/{stats.notes}
          </span>
        </div>
        <div className="xp-bar">
          <div className="xp-fill" style={{ width: p3 + '%' }} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const [query, setQuery] = useState('');

  const areas = useMemo(
    () => Object.entries(stats.byArea).sort((a, b) => b[1] - a[1]),
    []
  );

  function onSearchChange(v: string) {
    setQuery(v);
    if (v && route.type !== 'search') go('/search');
  }

  let main: ReactNode;
  if (route.type === 'note') {
    const note = byId.get(route.arg);
    main = note ? (
      <NoteView note={note} byId={byId} onNav={go} />
    ) : (
      <div className="pad-scroll">
        <h2 className="page-title">Nota não encontrada</h2>
        <p className="muted">“{route.arg}” não existe (ainda). É uma semente esperando pra virar nota.</p>
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
  } else if (route.type === 'graph') {
    main = <GraphView data={graph} onSelect={(id) => go('/note/' + encodeURIComponent(id))} />;
  } else {
    main = <RoadmapView notes={notes} onOpen={(id) => go('/note/' + encodeURIComponent(id))} />;
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
        <nav className="nav">
          <a className={'nav-item' + (route.type === 'roadmap' ? ' active' : '')} href="#/">
            <span className="nav-text">🗺️ Roadmap</span>
          </a>
          <a className={'nav-item' + (route.type === 'projetos' ? ' active' : '')} href="#/projetos">
            <span className="nav-text">🚀 Projetos</span>
          </a>
          <a className={'nav-item' + (route.type === 'graph' ? ' active' : '')} href="#/grafo">
            <span className="nav-text">🕸️ Grafo</span>
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
        <StatsPanel />
      </aside>
      <main className="main">{main}</main>
    </div>
  );
}
