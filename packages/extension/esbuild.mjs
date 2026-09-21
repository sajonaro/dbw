import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Two bundles: the extension, for the extension host (Node), and the
// results page, for the webview (a browser).  Everything is bundled in,
// so the packaged extension carries no node_modules.
const extension = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode', 'pg-native', 'cloudflare:sockets'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

const webview = {
  entryPoints: ['media/results.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: 'dist/media/results.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

// prqlc, as WebAssembly: prql-js reads its .wasm from beside its own file,
// so the pair is copied as-is into dist/prql and required from there at
// runtime rather than bundled.
const prqlDir = dirname(createRequire(import.meta.url).resolve('prql-js'));
mkdirSync('dist/prql', { recursive: true });
for (const f of ['prql_js.js', 'prql_js_bg.wasm', 'package.json']) cpSync(join(prqlDir, f), join('dist/prql', f));

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watching');
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
}
