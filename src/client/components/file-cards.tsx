import { formatSize, iconFor } from '../lib/icons'
import { dropsStat } from '../lib/transfer'
import type { ReactLike } from './overlay'

/**
 * 对话区文件卡片（挂在 conversation.chat.turnTail 链式槽）：
 * 用户消息发送后，该轮次消息中引用的文件以「类型图标 + 文件名 + 大小/文件夹」卡片
 * 渲染在轮次尾部；点击卡片经 owner 的 openFile 打开文件。
 * selector 只匹配含文件引用的轮次（见 definitions.ts），不抢占其他链条目。
 */
export function createFileCardsComponent(React: ReactLike) {
  function FileCard(props: { path: string; openFile?: (path: string) => void }) {
    const { path, openFile } = props
    const [meta, setMeta] = React.useState<Awaited<ReturnType<typeof dropsStat>> | null>(null)
    React.useEffect(() => {
      let live = true
      dropsStat(path).then((r) => { if (live) setMeta(r) }, () => { if (live) setMeta({ ok: false, path }) })
      return () => { live = false }
    }, [path])

    const name = String(path).split(/[\\/]/).pop() || path
    const good = meta !== null && meta !== undefined && meta.ok === true && meta.exists === true
    const isDir = good && meta.type === 'directory'
    const icon = isDir ? '📁' : iconFor(name)
    const sub = meta === null ? '…' : (!good ? '不可用' : (isDir ? '文件夹' : formatSize(meta.size)))

    return React.createElement('button', {
      type: 'button',
      className: 'wbd-card',
      title: path,
      onClick: () => { if (typeof openFile === 'function') { try { openFile(path) } catch { /* ignore */ } } },
    },
      React.createElement('span', { className: 'wbd-card-icon' }, icon),
      React.createElement('span', { className: 'wbd-card-name' }, name),
      React.createElement('span', { className: 'wbd-card-sub' }, sub),
    )
  }

  return function FileCards(props: { matched: { refs: string[] }; openFile?: (path: string) => void }) {
    const matched = props.matched
    if (matched === null || matched === undefined || !Array.isArray(matched.refs) || matched.refs.length === 0) return null
    return React.createElement('div', { className: 'wbd-cards' },
      React.createElement('span', { className: 'wbd-cards-label' }, '📎 消息引用的文件'),
      matched.refs.map((path, i) => React.createElement(FileCard, { key: String(path) + ':' + i, path, openFile: props.openFile })),
    )
  }
}
