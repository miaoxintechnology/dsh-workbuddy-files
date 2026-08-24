// iife 构建产物会带 `.iife` 后缀（client.iife.js），重命名为 DSH 模块加载器
// 期望的 /plugins/dsh-workbuddy-files/client.js
import { existsSync, renameSync } from 'node:fs'

if (existsSync('lib/client.iife.js')) {
  renameSync('lib/client.iife.js', 'lib/client.js')
  console.log('[rename] lib/client.iife.js -> lib/client.js')
}
