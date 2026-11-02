// node --test scripts/destinos-desenhos.test.mjs
// Testa o filtro --exceto do publicador e a trava de identidade, sem tocar em repositório nenhum.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { lerExceto, aplicarExceto, pastaAceita } from "./destinos-desenhos.mjs";

test("lerExceto aceita = e espaço, barra invertida e barra no fim", () => {
  assert.deepEqual(lerExceto(["--commit", "--exceto=retifica-os,esteira-qa"]), ["retifica-os", "esteira-qa"]);
  assert.deepEqual(lerExceto(["--exceto", "a, b\\c/ ,"]), ["a", "b/c"]);
  assert.deepEqual(lerExceto(["--gravar"]), []);
});

test("aplicarExceto tira a pasta dos destinos, dos intrusos e das sem sistema", () => {
  const P = path.resolve("/projetos");
  const plano = {
    destinos: new Map([[path.join(P, "retifica-os"), [{ id: "x" }]], [path.join(P, "hermes"), [{ id: "h" }]]]),
    intrusos: [{ pasta: "Esteira-QA", nome: "z", arquivos: [] }, { pasta: "koynus", nome: "q", arquivos: [] }],
    semSistema: [{ id: "s", pastas: ["desbravando-site", "outra"] }],
  };
  aplicarExceto(plano, ["retifica-os", "esteira-qa", "desbravando-site"], P);
  assert.deepEqual([...plano.destinos.keys()].map((d) => path.basename(d)), ["hermes"]);
  assert.deepEqual(plano.intrusos.map((i) => i.pasta), ["koynus"]);
  assert.deepEqual(plano.semSistema[0].pastas, ["outra"]);
  assert.ok(plano.foraDaRodada.has("retifica-os"));
});

test("trava de identidade: aceita pelo nome e pelo pastas da spec, recusa o resto", () => {
  const spec = { titulo: "Renatinho Motores · OS", pastas: ["retifica-os"] };
  assert.equal(pastaAceita("renatinho-motores", spec, "retifica-os"), true);
  assert.equal(pastaAceita("renatinho-motores", spec, "retifica"), false);
  assert.equal(pastaAceita("qa-parresia", { titulo: "qa-parresia · x" }, "koynus-paginas-publicas"), false);
  assert.equal(pastaAceita("hermes", { titulo: "Hermes · x" }, "hermes"), true);
});
