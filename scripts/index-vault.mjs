// CLI fino: usa buildIndex e imprime o resumo.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from './build-index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const VAULT = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(APP_ROOT, '..', 'sinapse');
const OUT = process.env.INDEX_OUT ? resolve(process.env.INDEX_OUT) : resolve(APP_ROOT, 'src', 'data');

const { stats, agenda, financeiro, compromissos } = buildIndex(VAULT, OUT);
const ag = `${agenda.blocos.length} blocos · ${agenda.semanal.length} semanais · ${agenda.mensal.length} mensais · ${agenda.datas.length} datas · ${agenda.dailys.length} dailys`;
console.log(`[index-vault] ${stats.notes} notas · ${stats.links} conexoes · ${stats.ghosts} sementes (de ${VAULT})`);
console.log(`[index-vault] agenda: ${ag}`);
console.log(`[index-vault] financeiro: ${financeiro.lancamentos.length} lancamentos em ${financeiro.meses.length} mes(es)`);
if (compromissos.existe) {
  const c = compromissos.contagem;
  const semFrente = compromissos.itens.filter((i) => !i.frente).length;
  console.log(
    `[index-vault] compromissos: ${compromissos.itens.length} (${semFrente} sem frente) de ${c.reunioes} reunioes` +
      ` · fora por tipo ${c.foraPorTipo} · sem ata ${c.semAta} · feitos ${c.feitos} · antigos ${c.antigos} (de ${compromissos.fonte})`,
  );
} else {
  console.log(`[index-vault] compromissos: Atas nao encontrado em ${compromissos.fonte} (ATAS_PATH)`);
}
