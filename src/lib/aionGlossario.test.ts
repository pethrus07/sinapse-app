// Testes do glossário do Aion. O principal: toda tela que marca um termo (<Termo id="...">,
// termo="..." ou TERMO_DO_TIPO) tem verbete. Lê o código das telas e falha se achar um termo sem
// verbete. Rodar: node --test src/lib/aionGlossario.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLOSSARIO, oQueEAtivo, verbete } from './aionGlossario.ts';

const COMP = join(dirname(fileURLToPath(import.meta.url)), '..', 'components');
const telas = readdirSync(COMP).filter((f) => /^Aion.*\.tsx$/.test(f)).map((f) => ({ f, t: readFileSync(join(COMP, f), 'utf8') }));

test('toda tela do Aion só marca termo que tem verbete', () => {
  const usados = new Map<string, string>();
  for (const { f, t } of telas) {
    for (const m of t.matchAll(/<Termo\s+id="([^"]+)"/g)) usados.set(m[1], f);
    for (const m of t.matchAll(/\btermo="([^"]+)"/g)) usados.set(m[1], f);
    for (const m of t.matchAll(/\btermo=\{'([^']+)'\}/g)) usados.set(m[1], f);
  }
  assert.ok(usados.size >= 15, `poucos termos marcados nas telas (${usados.size}): o leitor do teste quebrou?`);
  const sem = [...usados].filter(([id]) => !verbete(id)).map(([id, f]) => `${id} (${f})`);
  assert.deepEqual(sem, [], `termo marcado sem verbete: ${sem.join(', ')}`);
});

test('verbete: 2 a 3 linhas de texto simples, sem travessão, com bloco da trilha de 1 a 11', () => {
  for (const [id, v] of Object.entries(GLOSSARIO)) {
    assert.ok(v.termo && v.texto, id);
    assert.ok(!/[—–]/.test(v.texto + v.termo), `travessão em ${id}`);
    assert.ok(v.texto.length >= 80 && v.texto.length <= 320, `${id}: ${v.texto.length} caracteres (2 a 3 linhas)`);
    assert.ok(Number.isInteger(v.bloco) && v.bloco >= 1 && v.bloco <= 11, `${id}: bloco ${v.bloco}`);
  }
});

test('o que é um ativo: companhia pela CVM (setor e atividade), FII pelo informe, sem fonte só o tipo', () => {
  const m = {
    cvm: { empresas: { TEST3: { nome: 'EMPRESA TESTE S.A.' } }, perfis: { TEST3: { setor: 'Energia', atividade: 'Geração de energia.' } }, fiis: { FUND11: { nome: 'FUNDO TESTE FII', segmento: 'Logística', mes: '2030-01' } } },
  };
  const a = oQueEAtivo('test3', 'acao', m);
  assert.equal(a.titulo, 'EMPRESA TESTE S.A.');
  assert.match(a.linhas[0], /^Ação de uma companhia do setor "Energia"/);
  assert.match(a.linhas[1], /Geração de energia\.$/);
  assert.match(a.fonte!.nome, /CVM/);
  const f = oQueEAtivo('FUND11', 'fii', m);
  assert.match(f.linhas[0], /segmento "Logística".*01\/2030/);
  const s = oQueEAtivo('OBSV3', 'acao', null);
  assert.equal(s.fonte, null);
  assert.match(s.linhas[1], /a fonte ainda não deu/);
});
