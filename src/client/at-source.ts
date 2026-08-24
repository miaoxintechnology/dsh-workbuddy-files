import type { InputTriggerSource, InputTriggerCandidate } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { iconFor } from './lib/icons'
import { dropsList, mentionFor } from './lib/transfer'

/**
 * @ 触发源「workbuddy」：输入 @ 时在菜单中追加「文件缓存」分组 ——
 * ~/.dsh-drops 中拖拽/粘贴/选择落地的文件与目录树，支持搜索。
 * 选中后由输入管线的 onPick → { insert } 在触发词位置铸造原生气泡。
 *
 * 工作区文件/文件夹的 @ 检索由 DSH 官方 ui-reference 源提供（文件与文件夹 +
 * Session 分组），本插件与之共存，无需重复实现。
 *
 * 所有引用在拖入时已完成落地（真实绝对路径），因此 codec 序列化是恒等函数，
 * 发送消息不可能因文件未落地而失败。
 */
export function createAtSource(): InputTriggerSource {
  return {
    trigger: '@',
    name: 'workbuddy',
    order: 5,
    showGroupTitle: true,
    async candidates(_session, req) {
      const q = (req && req.query) || ''
      const items = await dropsList(q)
      const out: InputTriggerCandidate[] = []
      for (const it of items) {
        const isDir = it.type === 'directory'
        out.push({
          name: (isDir ? '📁 ' : iconFor(it.name) + ' ') + it.name + (isDir ? '/' : ''),
          description: it.path,
          section: '文件缓存 · ~/.dsh-drops',
          value: JSON.stringify({ kind: isDir ? 'folder' : 'file', name: it.name, path: it.path }),
        })
      }
      return out.slice(0, 60)
    },
    onPick(pick) {
      let v: { kind?: string; name?: string; path?: string } | null = null
      try { v = JSON.parse(pick.candidate.value || 'null') } catch { return undefined }
      if (v === null || typeof v !== 'object' || typeof v.path !== 'string') return undefined
      const mention = mentionFor(v.path, v.kind === 'folder')
      return {
        insert: {
          source: 'workbuddy',
          ref: mention,
          label: v.name ?? '',
          appearance: v.kind === 'folder' ? 'folder' : 'file',
          clipboardText: mention,
        },
      }
    },
    codec: {
      clipboardText: (ref) => ref,
      serialize: (ref) => Promise.resolve(ref),
    },
  }
}
