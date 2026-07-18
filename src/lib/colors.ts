const AREA_COLORS: Record<string, string> = {
  estudo: '#2CD4C0',
  projetos: '#E8A33D',
  negocio: '#9A8CF0',
  pessoas: '#F2739D',
  fontes: '#4FA3F0',
  ideias: '#7BE0A3',
  sistema: '#9AA3B2',
  diario: '#C0C7D4',
};

export function colorForArea(area?: string): string {
  return AREA_COLORS[(area || '').toLowerCase()] || '#8A93A6';
}

export function areaLabel(area: string): string {
  const map: Record<string, string> = {
    estudo: '📚 Estudo',
    projetos: '🚀 Projetos',
    negocio: '🏢 Negócio',
    pessoas: '👥 Pessoas',
    fontes: '📎 Fontes',
    ideias: '💡 Ideias',
    sistema: '⚙️ Sistema',
    diario: '🗓️ Diário',
  };
  return map[area?.toLowerCase()] || area;
}

export { AREA_COLORS };
