export interface Note {
  id: string;
  rel: string;
  title: string;
  area: string;
  type: string;
  tags: string[];
  status: string;
  body: string;
  links: string[];
  backlinks: string[];
  degree: number;
}

export interface GraphNode {
  id: string;
  title: string;
  area: string;
  type: string;
  degree: number;
  ghost?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
  ghost?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Stats {
  notes: number;
  links: number;
  ghosts: number;
  with3: number;
  byArea: Record<string, number>;
  generatedFrom: string;
}
