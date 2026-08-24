import type { BusState } from '../types'

/**
 * 拖拽遮罩 / toast 的轻量发布订阅总线。
 * 动态（dynamic）插件里同一逻辑内联在 apply 中；这里抽成模块便于测试。
 */
export interface DropBus {
  get(): BusState
  set(next: BusState): void
  subscribe(fn: (s: BusState) => void): () => void
  toast(text: string, level?: 'info' | 'error'): void
}

export function createDropBus(): DropBus {
  let state: BusState = { active: false, count: 0, toast: null }
  const subs = new Set<(s: BusState) => void>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const get = () => state
  const set = (next: BusState) => {
    state = next
    for (const fn of subs) fn(state)
  }
  const subscribe = (fn: (s: BusState) => void) => {
    subs.add(fn)
    return () => { subs.delete(fn) }
  }
  const toast = (text: string, level: 'info' | 'error' = 'info') => {
    if (timer !== null) clearTimeout(timer)
    set({ ...state, toast: { text: String(text), level } })
    timer = setTimeout(() => { timer = null; set({ ...state, toast: null }) }, 4600)
  }
  return { get, set, subscribe, toast }
}
