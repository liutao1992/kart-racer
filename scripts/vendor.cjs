const { buildSync } = require('esbuild');
const { copyFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
mkdirSync(path.join(root, 'vendor'), { recursive: true });
buildSync({
  entryPoints: [require.resolve('three')],
  outfile: path.join(root, 'vendor/three.min.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'THREE',
  legalComments: 'inline',
  banner: { js: '/* Three.js 0.180.0 | MIT License | See three.LICENSE.txt */' }
});
copyFileSync(path.resolve(require.resolve('three'), '../../LICENSE'), path.join(root, 'vendor/three.LICENSE.txt'));
