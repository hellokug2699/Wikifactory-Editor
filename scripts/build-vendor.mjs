import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  { entry: 'codemirror-entry.js', outfile: 'codemirror.bundle.js' },
  { entry: 'yaml-entry.js', outfile: 'yaml.bundle.js' },
];

for (const { entry, outfile } of targets) {
  await build({
    entryPoints: [path.join(root, 'scripts', entry)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    tsconfigRaw: {},
    outfile: path.join(root, 'app', 'assets', 'vendor', outfile),
  });
  console.log(`[vendor] app/assets/vendor/${outfile}`);
}
