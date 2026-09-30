import type { DropBus } from '../lib/bus'
import type { DropHandlers } from '../lib/drop'
import type { TreeFile } from '../types'
import type { ReactLike } from './overlay'

/**
 * 📎 引用按钮（挂在 conversation.input.left 列表槽）：
 * 统一走 <input type=file>（多选 / webkitdirectory）→ 立即插入气泡 →
 * 后台缓存（所有浏览器行为一致）。
 *
 * 该槽位是 session 作用域，标准属性里的 `sessionId` 是 0.2.0 获取当前会话的
 * 官方途径（sessions 服务已不再暴露列表快照），在此上报给插件共享状态。
 */
export function createPickButtonComponent(
  React: ReactLike,
  bus: DropBus,
  handlers: Pick<DropHandlers, 'acceptTree'>,
  onSession: (sessionId: string | undefined) => void,
) {
  return function PickButton(props: { sessionId?: string }) {
    const [open, setOpen] = React.useState(false)
    const newBatch = () => 'drop-' + Date.now().toString(36)

    React.useEffect(() => {
      onSession(props.sessionId)
    }, [props.sessionId])

    const pickFolder = async () => {
      setOpen(false)
      const input = document.createElement('input')
      input.type = 'file'
      input.setAttribute('webkitdirectory', '')
      input.onchange = () => {
        const files: TreeFile[] = []
        const tops: string[] = []
        for (const f of Array.from(input.files ?? [])) {
          files.push({ rel: f.webkitRelativePath || f.name, name: f.name, size: f.size, file: f })
          const top = (f.webkitRelativePath || '').split('/')[0]
          if (top !== '' && !tops.includes(top)) tops.push(top)
        }
        if (files.length > 0) void handlers.acceptTree(files, tops, newBatch())
      }
      input.click()
    }

    const pickFiles = async () => {
      setOpen(false)
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.onchange = () => {
        const files: TreeFile[] = []
        for (const f of Array.from(input.files ?? [])) files.push({ rel: f.name, name: f.name, size: f.size, file: f })
        if (files.length > 0) void handlers.acceptTree(files, [], newBatch())
      }
      input.click()
    }

    return React.createElement('div', { className: 'wbd-pick' },
      React.createElement('button', { type: 'button', className: 'wbd-pick-btn', title: '引用文件/文件夹（也可直接拖拽或粘贴）', onClick: () => setOpen(!open) }, '📎'),
      open ? React.createElement('div', { className: 'wbd-pick-menu' },
        React.createElement('button', { type: 'button', onClick: pickFiles }, '选择文件…'),
        React.createElement('button', { type: 'button', onClick: pickFolder }, '选择文件夹…（保留目录树）'),
      ) : null,
    )
  }
}
