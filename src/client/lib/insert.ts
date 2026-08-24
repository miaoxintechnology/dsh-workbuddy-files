import type { InsertItem } from '../types'

/**
 * 气泡插入管线 —— 整个插件的核心：
 *
 * 通过对话包暴露的 `conversation.input`（InputHub，SessionInputResolver 面）
 * 解析当前会话的输入 shell，读取实时 InputState（draft/draftRev），在
 * 光标位置调用 `shell.insertReference(reference, span)` 铸造原生引用气泡
 * （occurrence）。span 采用 draftRev CAS：若插入期间用户输入导致修订号
 * 变化，重试读取新状态（最多 8 次）；非 plain 阶段（提交中）插入被拒。
 *
 * 兜底 1：insertReference 反复失败 → setDraft 直接写草稿文本（保证输入框有内容）；
 * 兜底 2：无 facade → 聚焦 textarea 时 document.execCommand 纯文本插入。
 */
export interface InsertDeps {
  sessions: {
    list: { getSnapshot(): { current: string | undefined } }
  }
  conversation: {
    input: {
      /**
       * id 寻址服务面（InputHub.shell）—— 直接返回会话输入 shell，
       * 无需 sessions.scope()（后者返回 cordis Context，动态门面拒绝暴露）。
       */
      shell(id: string): {
        state: { getSnapshot(): { draft: string; draftRev: number } }
        insertReference(reference: InsertItem['reference'], span: { start: number; end: number; draftRev: number }): boolean
        setDraft(text: string): void
        notify(level: 'info' | 'error', text: string): void
      }
    }
  }
  toast(text: string, level?: 'info' | 'error'): void
}

export type InsertPipeline = (items: InsertItem[]) => Promise<number>

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function readCaret(fallbackLen: number): number {
  const el = document.activeElement
  if (el !== null && el !== undefined && String(el.tagName).toUpperCase() === 'TEXTAREA' && typeof (el as HTMLTextAreaElement).selectionStart === 'number') {
    return (el as HTMLTextAreaElement).selectionStart
  }
  return fallbackLen
}

export function createInsertPipeline(deps: InsertDeps): InsertPipeline {
  return async function insertItems(items: InsertItem[]): Promise<number> {
    const sessionId = deps.sessions.list.getSnapshot().current
    if (sessionId === undefined) {
      deps.toast('请先打开或新建一个会话，再拖入文件', 'error')
      return 0
    }
    let shell: null | {
      state: { getSnapshot(): { draft: string; draftRev: number } }
      insertReference(reference: InsertItem['reference'], span: { start: number; end: number; draftRev: number }): boolean
      setDraft(text: string): void
      notify(level: 'info' | 'error', text: string): void
    } = null
    try { shell = deps.conversation.input.shell(sessionId) } catch { shell = null }

    let inserted = 0
    let firstCaret: number | null = null
    for (const item of items) {
      if (shell !== null && shell !== undefined) {
        let ok = false
        for (let attempt = 0; attempt < 8 && !ok; attempt += 1) {
          try {
            const st = shell.state.getSnapshot()
            let caret = st.draft.length
            if (firstCaret === null) {
              firstCaret = readCaret(st.draft.length)
              caret = firstCaret
            }
            const pos = Math.min(caret, st.draft.length)
            ok = shell.insertReference(item.reference, { start: pos, end: pos, draftRev: st.draftRev })
          } catch { ok = false }
          if (!ok) await sleep(90)
        }
        if (ok) { inserted += 1; continue }
        // 兜底 1：直接写草稿文本（无气泡，但输入框立刻有内容）
        try {
          const st = shell.state.getSnapshot()
          const pos = Math.min(firstCaret !== null ? firstCaret : st.draft.length, st.draft.length)
          const mention = typeof item.reference.ref === 'string' ? item.reference.ref : String(item.label)
          const next = st.draft.slice(0, pos) + mention + ' ' + st.draft.slice(pos)
          shell.setDraft(next)
          inserted += 1
          continue
        } catch (err2) {
          try { shell.notify('error', '未能插入引用「' + item.label + '」：' + String((err2 as Error)?.message ?? err2)) } catch { /* ignore */ }
        }
      } else {
        // 兜底 2：无 facade —— 聚焦 textarea 时 execCommand 纯文本插入
        const text = item.reference.ref
        const el = document.activeElement
        if (el !== null && el !== undefined && String(el.tagName).toUpperCase() === 'TEXTAREA') {
          try { document.execCommand('insertText', false, text + ' '); inserted += 1 } catch { /* ignore */ }
        } else {
          deps.toast('输入区不可用，未能插入「' + item.label + '」', 'error')
        }
      }
    }
    return inserted
  }
}
