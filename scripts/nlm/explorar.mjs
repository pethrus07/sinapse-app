// Passo 1 de 2: abre o NotebookLM no Chrome com um perfil DEDICADO (nao mexe no
// seu perfil normal), espera voce logar UMA vez e tira um raio-x da pagina.
// O login fica salvo no perfil — da proxima vez o extrator entra direto.
//
// Uso: node explorar.mjs
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROFILE = join(homedir(), '.sinapse-nlm-profile');
const OUT = process.env.NLM_OUT || join(homedir(), '.sinapse-nlm-out');
mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: false,
  viewport: null,
  args: ['--start-maximized'],
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto('https://notebooklm.google.com/', { waitUntil: 'domcontentloaded' });

// Raio-x: nomes de componentes Angular presentes + candidatos a "card de notebook".
async function radiografar() {
  return page.evaluate(() => {
    const tags = {};
    for (const el of document.querySelectorAll('*')) {
      const t = el.tagName.toLowerCase();
      if (t.includes('-')) tags[t] = (tags[t] || 0) + 1;
    }
    const links = [...document.querySelectorAll('a[href*="/notebook/"]')].map((a) => ({
      href: a.getAttribute('href'),
      texto: (a.innerText || '').trim().slice(0, 120),
    }));
    return {
      url: location.href,
      titulo: document.title,
      tags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 40),
      links,
      texto: (document.body.innerText || '').slice(0, 6000),
    };
  });
}

const LIMITE_MS = 8 * 60 * 1000; // tempo pra voce logar sem pressa
const t0 = Date.now();
let raio = null;
while (Date.now() - t0 < LIMITE_MS) {
  await page.waitForTimeout(3000);
  const url = page.url();
  if (/accounts\.google\.com|signin/.test(url)) { console.log('[nlm] aguardando login...'); continue; }
  raio = await radiografar().catch(() => null);
  if (!raio) continue;
  const temConteudo = raio.links.length > 0 || /notebook/i.test(raio.texto);
  console.log(`[nlm] ${raio.url} · componentes=${raio.tags.length} · links-notebook=${raio.links.length}`);
  if (temConteudo && raio.tags.length > 3) break;
}

if (!raio) { console.error('[nlm] nao consegui ler a pagina (login nao concluido?)'); await ctx.close(); process.exit(1); }

writeFileSync(join(OUT, 'raio-x.json'), JSON.stringify(raio, null, 2), 'utf8');
await page.screenshot({ path: join(OUT, 'home.png'), fullPage: true }).catch(() => {});
console.log(`[nlm] raio-x salvo em ${OUT}`);
console.log(`[nlm] componentes: ${raio.tags.map(([t, n]) => `${t}(${n})`).join(' ')}`);
console.log(`[nlm] links de notebook: ${raio.links.length}`);
console.log('[nlm] PRONTO — pode fechar a janela.');
await ctx.close();
