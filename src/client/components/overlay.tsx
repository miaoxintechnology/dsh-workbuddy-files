import type { DropBus } from '../lib/bus'

/** 组件只需 React 的这三个能力；由 app.ts 的 factory 通过 require('react') 注入 */
export interface ReactLike {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void]
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}

/**
 * 全屏拖拽遮罩 + toast（挂在 shell.overlay 列表槽）。
 * 遮罩只在拖拽含非图片文件/文件夹时出现（纯图片拖放交给原生图片轨道）；
 * 层本身点击穿透，遮罩激活时开启 pointer-events 承接 drop。
 */
export function createOverlayComponent(React: ReactLike, bus: DropBus) {
  return function WorkbuddyOverlay() {
    const [state, setState] = React.useState(bus.get())
    React.useEffect(() => bus.subscribe(setState), [])

    return React.createElement('div', { className: 'wbd-overlay' },
      state.active
        ? React.createElement('div', { className: 'wbd-shield' },
          React.createElement('div', { className: 'wbd-shield-inner' },
            React.createElement('div', { className: 'wbd-shield-icon' }, '📥'),
            React.createElement('div', { className: 'wbd-shield-title' }, '松开以接收文件'),
            React.createElement('div', { className: 'wbd-shield-sub' }, state.count + ' 项 · 将作为引用气泡插入输入框光标处'),
            React.createElement('div', { className: 'wbd-shield-hint' }, '文件（含图片）将缓存至 ~/.dsh-drops 并引用绝对路径'),
          ),
        )
        : null,
      state.toast
        ? React.createElement('div', { className: 'wbd-toast' + (state.toast.level === 'error' ? ' wbd-error' : '') }, state.toast.text)
        : null,
    )
  }
}
