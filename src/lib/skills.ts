import type { Note } from '../types';

// Taxonomia de COMPETÊNCIAS — a Skill Tree agrupa por DOMÍNIO (engenharia, dev, dados,
// segurança, infra…) e subdivisão, NÃO pela pasta do vault. Cada subdomínio tem
// palavras-chave batidas contra tags + título + stack. Ordem importa (a 1ª regra vence).
type Regra = { dominio: string; sub: string; kw: string[] };

const REGRAS: Regra[] = [
  // ── Produto (antes de tudo: "Transição QA → PO" não pode cair em Qualidade pelo "qa") ──
  { dominio: 'Produto', sub: 'Product Owner & Descoberta', kw: ['product-owner', 'product owner', ' po ', 'produto', 'backlog', 'roadmap', 'descoberta', 'posthog', 'onboarding'] },
  // ── Negócio ─────────────────────────────────────────────────────
  { dominio: 'Negócio', sub: 'Preço & Formalização', kw: ['precificacao', 'precificação', 'cobranca', 'cobrança', 'formalizacao', 'formalização', 'cnpj', 'freelancer', 'comercial'] },
  { dominio: 'Negócio', sub: 'Finanças', kw: ['financeiro', 'financas', 'finanças', 'cartao', 'cartão', 'reorganizacao financeira', 'reorganização financeira', 'investimento'] },
  { dominio: 'Negócio', sub: 'Carreira', kw: ['carreira', 'salario', 'salário', 'linkedin', 'certificacao', 'certificação'] },
  // ── Desenvolvimento ─────────────────────────────────────────────
  { dominio: 'Desenvolvimento', sub: 'Front-end', kw: ['frontend', 'front-end', 'react', ' html', ' css', 'programacao web', 'programação web', 'aplicacoes para internet', 'aplicações para internet', 'jack herrington', 'jack-herrington', 'flutter', 'interface humano', 'ux', 'ui/'] },
  { dominio: 'Desenvolvimento', sub: 'Back-end', kw: ['backend', 'back-end', 'http', 'comunicacao backend', 'comunicação backend', ' api', 'fastify', 'servidor', 'cliente/servidor', 'cliente-servidor', 'design de backend', 'harness'] },
  { dominio: 'Desenvolvimento', sub: 'Fundamentos de Programação', kw: ['poo', 'orientada a objetos', 'programacao de computadores', 'programação de computadores', 'algoritmo', 'estrutura de dados', 'estruturas de dados', 'pensamento computacional', 'logica computacional', 'lógica computacional'] },
  // ── Dados ───────────────────────────────────────────────────────
  { dominio: 'Dados', sub: 'IA & Machine Learning', kw: ['machine learning', 'machine leaning', ' ml', 'inteligencia artificial', 'inteligência artificial', ' ia ', ' ia', 'ia no', 'analise preditiva', 'análise preditiva', 'classificacao', 'classificação', 'llm', 'embeddings'] },
  { dominio: 'Dados', sub: 'Bancos & Modelagem', kw: ['banco de dados', 'bancos de dados', 'bancos-de-dados', 'modelagem de dados', 'modelagem', 'nosql', ' sql', 'prisma', 'duckdb', 'postgres'] },
  { dominio: 'Dados', sub: 'Estatística & Matemática', kw: ['probabilidade', 'estatistica', 'estatística', 'calculo', 'cálculo', 'matematica', 'matemática'] },
  // ── Segurança (ANTES de Infra: "Segurança de Data Center" não pode cair em Cloud) ──
  { dominio: 'Segurança', sub: 'Segurança & Forense', kw: ['seguranca', 'segurança', 'forense', 'pericia', 'perícia', 'phishing', 'unphising', 'lgpd', 'credenciais', 'cofre', 'criptografia'] },
  // ── Infra & Nuvem ───────────────────────────────────────────────
  { dominio: 'Infra & Nuvem', sub: 'Redes', kw: ['redes', 'protocolo', 'proxies', 'proxy', ' tcp', ' dns'] },
  { dominio: 'Infra & Nuvem', sub: 'Cloud & DevOps', kw: ['cloud', 'nuvem', 'cloudflare', 'virtualizacao', 'virtualização', 'datacenter', 'data center', 'docker', 'deploy', 'devops', 'worker', 'wrangler'] },
  { dominio: 'Infra & Nuvem', sub: 'Sistemas & IoT', kw: ['sistemas operacionais', 'iot', 'internet das coisas', 'circuitos', 'arquitetura de computadores', 'organizacao e arquitetura', 'modbus', ' clp', 'industrial', 'machine monitor'] },
  // ── Engenharia de Software ──────────────────────────────────────
  { dominio: 'Engenharia', sub: 'Arquitetura', kw: ['arquitetura', 'multilayer', 'layered', 'vertical slice', 'vertical-slice', 'design de sistema'] },
  { dominio: 'Engenharia', sub: 'Processos & Ágil', kw: ['agil', 'ágil', 'metodos ageis', 'métodos ágeis', 'engenharia de software', 'analise e projeto', 'análise e projeto', 'scrum', 'tecnicas de pesquisa', 'técnicas de pesquisa'] },
  { dominio: 'Engenharia', sub: 'Qualidade & Testes', kw: ['qa', ' teste', 'playwright', ' e2e'] },
  // ── Comunicação & pessoal ───────────────────────────────────────
  { dominio: 'Comunicação', sub: 'Fala & Apresentação', kw: ['comunicacao', 'comunicação', 'fala', 'apresentacao', 'apresentação', 'oratoria', 'oratória', 'crescimento'] },
];

const OUTROS = { dominio: 'Outros', sub: 'Outros' };

export interface Skill {
  dominio: string;
  sub: string;
}

export function classify(n: Note): Skill {
  const hay = ` ${n.title} ${(n.tags || []).join(' ')} ${n.stack || ''} `.toLowerCase();
  for (const r of REGRAS) {
    if (r.kw.some((k) => hay.includes(k))) return { dominio: r.dominio, sub: r.sub };
  }
  // fallback pela pasta do vault (mantém tudo no mapa, sem furar)
  const a = (n.area || '').toLowerCase();
  if (a === 'fontes') return { dominio: 'Fontes & Referências', sub: 'Fontes' };
  if (a === 'projetos') return { dominio: 'Projetos aplicados', sub: 'Projetos' };
  if (a === 'sistema' || n.type === 'moc') return { dominio: 'Meta & Sistema', sub: 'Sistema' };
  if (a) return { dominio: 'Outros', sub: a };
  return OUTROS;
}
