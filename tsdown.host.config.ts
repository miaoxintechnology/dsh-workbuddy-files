import { defineConfig } from 'tsdown'

/** Host 半侧：ESM（Node），输出 lib/index.js */
export default defineConfig({
  entry: { index: 'src/host/index.ts' },
  format: ['esm'],
  outDir: 'lib',
  outExtensions: () => ({ js: '.js' }),
  dts: false,
  clean: true,
  deps: { neverBundle: true },
})
