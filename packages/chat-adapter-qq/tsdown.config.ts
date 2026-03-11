import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts'
  },
  deps: {
    onlyAllowBundle: 'node-napcat-ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist'
});
