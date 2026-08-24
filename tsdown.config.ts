import { defineConfig } from 'tsdown'

/**
 * 构建两个产物（与 dsh 官方插件一致）：
 *   lib/index.js  —— Host 半侧入口（main / exports["."]）
 *   lib/client.js  —— 浏览器半侧入口（exports["./client"]）
 * node_modules 依赖（react / @deepseek-ai/*）全部外部化，由宿主提供。
 */
export default defineConfig({
  entry: {
    index: 'src/host/index.ts',
    client: 'src/client/index.ts',
  },
  format: ['esm'],
  outDir: 'lib',
  outExtensions: () => ({ js: '.js' }),
  dts: false,
  clean: true,
  deps: { neverBundle: true },
})
