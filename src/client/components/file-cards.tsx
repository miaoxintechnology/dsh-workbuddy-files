import { formatSize, iconFor } from '../lib/icons'
import { dropsStat } from '../lib/transfer'
import type { ReactLike } from './overlay'

/**
 * 对话区文件卡片（挂在 conversation.chat.turnTail —— 0.2.0 起是 **list 槽**）：
 * 每个完成的轮次都会渲染本条目，从 ownerProps.turn 的轮次位置数据里读
 * `workbuddy-file-refs`（由 definitions.ts 注册的会话定义聚合自用户消息），
 * 有引用时渲染「类型图标 + 文件名 + 大小/文件夹」卡片，无引用返回 null。
 * 点击卡片经 owner 的 openFile 打开文件。
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

  interface TurnTailProps {
    /** 0.2.0 的 turnTail list ownerProps：完成的轮次位置 */
    turn?: { data: { get(key: string): { refs?: string[] } | undefined } }
    seq?: number
    openFile?: (path: string) => void
  }

  return function FileCards(props: TurnTailProps) {
    // 0.2.0：turnTail 是 list 条目，ownerProps 直接给出 { turn, seq, openFile }
    const turn = props.turn
    const data = turn !== undefined && turn !== null && turn.data !== undefined && typeof turn.data.get === 'function'
      ? turn.data.get('workbuddy-file-refs')
      : undefined
    const refs = data !== undefined && data !== null && Array.isArray(data.refs) ? data.refs : []
    if (refs.length === 0) return null
    return React.createElement('div', { className: 'wbd-cards' },
      React.createElement('span', { className: 'wbd-cards-label' }, '📎 消息引用的文件'),
      refs.map((path: string, i: number) => React.createElement(FileCard, { key: String(path) + ':' + i, path, openFile: props.openFile })),
    )
  }
}
