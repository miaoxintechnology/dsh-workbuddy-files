import { extractRefs } from './lib/transfer'

/**
 * 会话事件定义（conversationEvents 注册表）—— 按轮次聚合用户消息中的
 * 文件引用，发布为 Turn 级位置数据，供 turnTail 文件卡片的 selector
 * 无快照、纯数据地判断「这一轮是否渲染卡片」。
 *
 * 关联规则：turn/start 时通过 reader.previous 取最近的前置用户消息上下文；
 * 结合 turn 边界定义（workbuddy-turn-boundary）排除「无用户消息的轮次
 * （如 goal 轮）」错误继承上一轮引用的情况。
 */
export interface UserMessageEvent {
  type: 'user/message'
  seq: number
  data: {
    id: string
    source: { kind: string }
    content: ReadonlyArray<{ type: string; text?: string }>
  }
}

export interface TurnBoundaryEvent {
  type: 'turn/start' | 'turn/end'
  seq: number
  data: { turn: number }
}

export const boundaryDef = {
  kind: 'workbuddy-turn-boundary',
  match: (event: { type: string; data: { turn: number } }) =>
    event.type === 'turn/start' ? { id: String(event.data.turn), role: 'start' as const }
      : event.type === 'turn/end' ? { id: String(event.data.turn), role: 'update' as const }
        : null,
  start: (_context: unknown, match: { event: TurnBoundaryEvent }) => {
    if (match.event.type !== 'turn/start') throw new Error('workbuddy-turn-boundary start requires turn/start')
    return { turn: match.event.data.turn, startSeq: match.event.seq }
  },
  update: (context: { state: unknown }) => context.state,
}

export const fileRefsDef = {
  kind: 'workbuddy-file-refs',
  match: (event: { type: string; seq: number; data: { id?: string; turn?: number; source?: { kind: string }; content?: ReadonlyArray<{ type: string; text?: string }> } }) => {
    if (event.type === 'user/message' && event.data?.source?.kind === 'user' && event.data.id !== undefined) {
      return { id: String(event.data.id), role: 'start' as const }
    }
    if (event.type === 'turn/start' && event.data.turn !== undefined) {
      return { id: 'turn-' + String(event.data.turn), role: 'start' as const }
    }
    return null
  },
  start: (context: { state: unknown }, match: { event: UserMessageEvent | TurnBoundaryEvent }, reader: { previous(kind: string): { startSeq: number; state: unknown } | undefined }) => {
    if (match.event.type === 'turn/start') {
      let refs: string[] = []
      const prev = reader.previous('workbuddy-file-refs')
      const prevBoundary = reader.previous('workbuddy-turn-boundary')
      if (prev !== undefined && prev.state !== undefined && Array.isArray((prev.state as { refs?: unknown }).refs)) {
        const afterBoundary = prevBoundary === undefined || prevBoundary.state === undefined || prev.startSeq > prevBoundary.startSeq
        if (afterBoundary) refs = (prev.state as { refs: string[] }).refs
      }
      return { turn: match.event.data.turn, refs }
    }
    void context
    const ev = match.event as UserMessageEvent
    return { seq: ev.seq, refs: extractRefs(ev.data?.content ?? []) }
  },
  update: (context: { state: unknown }) => context.state,
  buildLocationData: (context: { state: unknown }, scope: string) => {
    if (scope !== 'turn') return null
    const s = context.state as { turn?: number; refs?: string[] } | undefined
    if (s === undefined || s.turn === undefined || !Array.isArray(s.refs) || s.refs.length === 0) return null
    return { kind: 'turn', turn: s.turn, key: 'workbuddy-file-refs', value: { refs: s.refs } }
  },
}

/** turnTail chain selector：仅当该轮次存在文件引用时返回 matched，避免抢占其他链条目 */
export function selectTurnFileRefs(owner: { turn?: { data: { get(key: string): { refs?: string[] } | undefined } } } | null | undefined): { refs: string[] } | null {
  const t = owner !== null && owner !== undefined ? owner.turn : undefined
  if (t === undefined || t.data === undefined || typeof t.data.get !== 'function') return null
  const data = t.data.get('workbuddy-file-refs')
  if (data === undefined || data === null || !Array.isArray(data.refs) || data.refs.length === 0) return null
  return { refs: data.refs }
}
