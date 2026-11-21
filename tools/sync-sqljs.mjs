/**
 * Copies the sql.js WebAssembly build into `public/sqljs/` so the SQL track runs
 * from our own origin instead of a CDN. Runs on `postinstall`-free demand:
 * `npm run sync:sqljs` (called by the build script).
 */
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = join(root, 'public', 'sqljs');
// The bundler resolves `sql.js` to its browser build, which asks for
// sql-wasm-browser.wasm; the plain build asks for sql-wasm.wasm. Ship both so
// the SQL track never fetches a wasm file that is not there.
const files = ['sql-wasm.wasm', 'sql-wasm-browser.wasm'];

mkdirSync(outDir, { recursive: true });
for (const name of files) {
  const from = join(root, 'node_modules', 'sql.js', 'dist', name);
  const to = join(outDir, name);
  try {
    copyFileSync(from, to);
    const kb = Math.round(statSync(to).size / 1024);
    console.log(`[visna] ${name} → public/sqljs (${kb} KB)`);
  } catch (error) {
    console.error(`[visna] ${name} missing — run \`npm install\` first.`);
    throw error;
  }
}
