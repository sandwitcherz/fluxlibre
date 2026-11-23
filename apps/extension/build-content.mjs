import { resolve } from 'node:path';
import { build } from 'vite';

/**
 * Les content scripts Chrome MV3 sont des scripts classiques : aucune
 * instruction `import` n'est autorisée. On compile donc chaque script
 * séparément en IIFE autonome (tout le code partagé est inliné).
 */
const entries = {
  'content/leboncoin': 'src/content/leboncoin.ts',
  'content/vinted': 'src/content/vinted.ts',
};

for (const [name, file] of Object.entries(entries)) {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(process.cwd(), file),
        formats: ['iife'],
        name: 'FluxLibreContent',
        fileName: () => `${name}.js`,
      },
    },
  });
  console.log(`content script: dist/${name}.js`);
}
