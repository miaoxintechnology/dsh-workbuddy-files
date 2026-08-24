import { defineConfig } from 'tsdown'

/**
 * Client 半侧：IIFE 纯副作用脚本（无 import/export 语法），输出 lib/client.js。
 * DSH 模块加载器要求 client 产物是普通脚本：加载即执行
 * window.__ModuleLoader__.load({ id: 'dsh-workbuddy-files', factory })。
 */
export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: ['iife'],
  outDir: 'lib',
  outExtensions: () => ({ js: '.js' }),
  dts: false,
  clean: false,
  deps: { neverBundle: true },
})
