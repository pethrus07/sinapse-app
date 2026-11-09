import { test } from "node:test";
import assert from "node:assert/strict";
import { lerLembretes, posicaoNoBloco, montarTexto, xmlDoToast } from "./avisar.mjs";

const AGUA = { titulo: "Hora da água", texto: "Copo agora. {feitos} de {total}.", dias: "uteis", inicio: "10:00", fim: "16:00", intervalo_min: 60 };
const seg = (h, m = 0) => new Date(2026, 10, 9, h, m); // segunda-feira 09/11/2026

test("lê o bloco lembretes do markdown e recusa nota sem bloco", () => {
  const md = "# L\n\n```lembretes\n{\"agua\": {\"titulo\": \"x\"}}\n```\n";
  assert.equal(lerLembretes(md).agua.titulo, "x");
  assert.throws(() => lerLembretes("# nada"), /sem bloco/);
});

test("das 10h às 16h de hora em hora são 7 avisos, numerados pela hora", () => {
  assert.deepEqual(posicaoNoBloco(AGUA, seg(10)), { feitos: 1, total: 7 });
  assert.deepEqual(posicaoNoBloco(AGUA, seg(12, 7)), { feitos: 3, total: 7 }, "tarefa atrasou 7 min: ainda é o 3º");
  assert.deepEqual(posicaoNoBloco(AGUA, seg(16)), { feitos: 7, total: 7 });
});

test("fora da janela ou no fim de semana não avisa", () => {
  assert.equal(posicaoNoBloco(AGUA, seg(9, 30)), null);
  assert.equal(posicaoNoBloco(AGUA, seg(17)), null);
  assert.equal(posicaoNoBloco(AGUA, new Date(2026, 10, 8, 12)), null, "domingo");
  assert.deepEqual(posicaoNoBloco({ ...AGUA, dias: "todos" }, new Date(2026, 10, 8, 12)), { feitos: 3, total: 7 });
});

test("texto com a contagem e XML do toast escapado", () => {
  assert.equal(montarTexto(AGUA, { feitos: 3, total: 7 }), "Copo agora. 3 de 7.");
  const xml = xmlDoToast("A & B", "menor <que>", true);
  assert.match(xml, /A &amp; B/);
  assert.match(xml, /menor &lt;que&gt;/);
  assert.match(xml, /scenario="reminder"/);
  assert.doesNotMatch(xmlDoToast("t", "x"), /reminder/);
});
