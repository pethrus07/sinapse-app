// CLI fino: usa buildIndex e imprime o resumo.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from './build-index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const VAULT = process.env.VAULT_PATH ? resolve(process.env.VAULT_PATH) : resolve(APP_ROOT, '..', 'sinapse');
const OUT = resolve(APP_ROOT, 'src', 'data');

const { stats } = buildIndex(VAULT, OUT);
console.log(`[index-vault] ${stats.notes} notas · ${stats.links} conexoes · ${stats.ghosts} sementes (de ${VAULT})`);
