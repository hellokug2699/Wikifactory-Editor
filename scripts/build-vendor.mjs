import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(root, 'scripts', 'codemirror-entry.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  tsconfigRaw: {},
  outfile: path.join(root, 'app', 'assets', 'vendor', 'codemirror.bundle.js'),
});

console.log('[vendor] app/assets/vendor/codemirror.bundle.js');
