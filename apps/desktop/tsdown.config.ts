import { defineConfig } from 'tsdown'

/** Bundle the Electron main/preload and separate Node Host entrypoints. */
export default defineConfig({
  entry: ['lib/types/main.js', 'lib/types/preload.js', 'lib/types/host.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['electron', 'tsx/esm'] },
})
