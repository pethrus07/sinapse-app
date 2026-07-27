const AREA_COLORS: Record<string, string> = {
  estudo: '#2CD4C0',
  projetos: '#E8A33D',
  negocio: '#9A8CF0',
  pessoas: '#F2739D',
  fontes: '#4FA3F0',
  ideias: '#7BE0A3',
  crescimento: '#7FD858',
  sistema: '#9AA3B2',
  diario: '#C0C7D4',
};

// cor estável por hash — pra qualquer área NOVA sem cor fixa não cair no cinza
function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 62% 62%)`;
}

export function colorForArea(area?: string): string {
  const a = (area || '').toLowerCase();
  return AREA_COLORS[a] || (a ? hashColor(a) : '#8A93A6');
}

export function areaLabel(area: string): string {
  const map: Record<string, string> = {
    estudo: '📚 Estudo',
    projetos: '🚀 Projetos',
    negocio: '🏢 Negócio',
    pessoas: '👥 Pessoas',
    fontes: '📎 Fontes',
    ideias: '💡 Ideias',
    crescimento: '🌱 Crescimento',
    sistema: '⚙️ Sistema',
    diario: '🗓️ Diário',
  };
  return map[area?.toLowerCase()] || area;
}

export { AREA_COLORS };
