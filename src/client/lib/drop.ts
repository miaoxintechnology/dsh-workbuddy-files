import type { InsertItem, TreeFile, UploadJob } from '../types'
import type { DropBus } from './bus'
import type { InsertPipeline } from './insert'
import { mentionFor, walkEntry } from './transfer'

/**
 * 拖拽 / 粘贴处理（统一接管 + 拖入即插气泡）：
 *
 *  1. 任何文件拖入/粘贴（含图片）都走本插件：全屏遮罩 → 解析引用项；
 *  2. 最终缓存路径在拖入时即可确定（<dropsRoot>/<批次>/<相对路径>），
 *     因此**立即**在输入框光标处插入气泡 —— 不等上传；
 *  3. 文件落盘由 enqueueUpload 在后台异步进行（本地写盘，用户无感），
 *     完成/失败以 toast 告知；
 *  4. 接管时从 dragenter 起 stopPropagation（window capture 首站），
 *     DSH 原生图片拖放遮罩不会激活，也不会因收不到收尾事件而卡住页面。
 */

export interface DropDeps {
  bus: DropBus
  insert: InsertPipeline
  /** 缓存根目录（应用启动时预取，拖入时兜底拉取） */
  ensureRoot(): Promise<string | null>
  /** 后台上传入口（不阻塞输入；完成后自行 toast） */
  enqueueUpload(jobs: UploadJob[], batch: string): void
}

/** 任何文件拖拽都接管；items 不可用（Firefox dragenter/dragover）时按 types 兜底 */
export function interceptable(dt: { items: DataTransferItemList | DataTransferItem[]; types?: readonly string[] } | null | undefined): boolean {
  if (dt === null || dt === undefined) return false
  const types = Array.from(dt.types ?? [])
  if (types.includes('Files')) return true
  if (dt.items) {
    for (const it of Array.from(dt.items)) if (it.kind === 'file') return true
  }
  return false
}

export function countFiles(dt: { items: DataTransferItemList | DataTransferItem[] }): number {
  let n = 0
  for (const it of Array.from(dt.items)) if (it.kind === 'file') n += 1
  return n
}

export interface DropHandlers {
  /** 已同步收集的拖拽/粘贴条目 → 立即插气泡 + 后台缓存 */
  acceptAndInsert(synced: SyncedItem[], batch: string): Promise<void>
  /** 文件选择框（input.files）→ 立即插气泡 + 后台缓存 */
  acceptTree(files: TreeFile[], dirTops: string[], batch: string): Promise<void>
  installListeners(): () => void
}

/** drop/paste 事件内同步收集的结果（事件结束后 DataTransfer 即失效，不可再读） */
export interface SyncedItem {
  entry: FileSystemEntry | null
  file: File | null
}

/**
 * 关键：DataTransfer 只在事件同步阶段有效 —— getAsFile / webkitGetAsEntry
 * 必须在事件处理器内、任何 await 之前完成调用，否则浏览器清空 DataTransfer
 * 后全部返回 null。本函数专门在同步阶段收集 File / Entry。
 */
export function syncCollect(dt: { items: DataTransferItemList | DataTransferItem[] }): SyncedItem[] {
  const synced: SyncedItem[] = []
  for (const it of Array.from(dt.items)) {
    if (it.kind !== 'file') continue
    let entry: FileSystemEntry | null = null
    try {
      const getter = (it as unknown as { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry
        ?? (it as unknown as { getAsEntry?: () => FileSystemEntry | null }).getAsEntry
      entry = typeof getter === 'function' ? getter() : null
    } catch { entry = null }
    let file: File | null = null
    try { file = typeof (it as DataTransferItem).getAsFile === 'function' ? (it as DataTransferItem).getAsFile() : null } catch { file = null }
    if (entry === null && file === null) continue
    synced.push({ entry, file })
  }
  return synced
}

export function createDropHandlers(deps: DropDeps): DropHandlers {
  const { bus, insert } = deps

  const submitRefs = async (refs: InsertItem[], jobs: UploadJob[], batch: string): Promise<void> => {
    if (refs.length === 0) { bus.toast('无法读取拖入的内容', 'error'); return }
    // 1) 立即插入气泡（不等上传）
    const inserted = await insert(refs)
    if (inserted > 0) bus.toast('已引用 ' + inserted + ' 项，文件正在后台缓存')
    else bus.toast('未能插入引用（见上方提示）', 'error')
    // 2) 后台缓存
    deps.enqueueUpload(jobs, batch)
  }

  /** 文件选择框路径（已有 TreeFile 列表） */
  const acceptTree = async (files: TreeFile[], dirTops: string[], batch: string): Promise<void> => {
    const root = await deps.ensureRoot()
    if (root === null) { bus.toast('无法获取缓存目录，请重试', 'error'); return }
    const refs: InsertItem[] = []
    for (const top of dirTops) {
      const dirPath = root + '/' + batch + '/' + top
      refs.push({ label: top, reference: { source: 'workbuddy', ref: mentionFor(dirPath, true), label: top, appearance: 'folder', clipboardText: mentionFor(dirPath, true) } })
    }
    for (const f of files) {
      const path = root + '/' + batch + '/' + f.rel
      refs.push({ label: f.name, reference: { source: 'workbuddy', ref: mentionFor(path, false), label: f.name, appearance: 'file', clipboardText: mentionFor(path, false) } })
    }
    await submitRefs(refs, files.map((f) => ({ kind: 'file', file: f.file, rel: f.rel, name: f.name })), batch)
  }

  /**
   * 核心：先按预分配路径立即插入气泡，再交给后台缓存。
   * synced 必须在事件内同步收集完毕（见 syncCollect）。
   */
  const acceptAndInsert = async (synced: SyncedItem[], batch: string): Promise<void> => {
    const root = await deps.ensureRoot()
    if (root === null) { bus.toast('无法获取缓存目录，请重试', 'error'); return }

    const refs: InsertItem[] = []
    const jobs: UploadJob[] = []

    for (const s of synced) {
      const { entry, file } = s

      if (entry !== null && entry !== undefined && entry.isDirectory) {
        const top = entry.name
        const dirPath = root + '/' + batch + '/' + top
        refs.push({ label: top, reference: { source: 'workbuddy', ref: mentionFor(dirPath, true), label: top, appearance: 'folder', clipboardText: mentionFor(dirPath, true) } })
        jobs.push({ kind: 'dir', entry })
        continue
      }

      if (file !== null && file !== undefined) {
        const rel = file.name
        const path = root + '/' + batch + '/' + rel
        refs.push({ label: file.name, reference: { source: 'workbuddy', ref: mentionFor(path, false), label: file.name, appearance: 'file', clipboardText: mentionFor(path, false) } })
        jobs.push({ kind: 'file', file, rel, name: file.name })
        continue
      }

      // entry 是文件但 getAsFile 失败：尽力从 entry.file 取（事件外可能失效，尽力而为）
      if (entry !== null && entry !== undefined && entry.isFile) {
        const fe = entry as FileSystemFileEntry
        const f = await new Promise<File | null>((resolve2) => fe.file((ff) => resolve2(ff), () => resolve2(null)))
        if (f !== null && f !== undefined) {
          const rel = f.name
          const path = root + '/' + batch + '/' + rel
          refs.push({ label: f.name, reference: { source: 'workbuddy', ref: mentionFor(path, false), label: f.name, appearance: 'file', clipboardText: mentionFor(path, false) } })
          jobs.push({ kind: 'file', file: f, rel, name: f.name })
        }
      }
    }

    await submitRefs(refs, jobs, batch)
  }

  const installListeners = (): (() => void) => {
    let dragDepth = 0
    const onDragEnter = (e: DragEvent) => {
      if (!interceptable(e.dataTransfer)) return
      e.preventDefault()
      // 关键：capture 首站即阻断传播。DSH 原生图片拖放轨道在 document(bubble)
      // 上监听 dragenter 并无条件显示全屏遮罩；若它先激活、而我们的 drop 又
      // stopPropagation，它会收不到收尾事件而永久卡住页面。
      e.stopPropagation()
      dragDepth += 1
      bus.set({ ...bus.get(), active: true, count: countFiles(e.dataTransfer) })
    }
    const onDragOver = (e: DragEvent) => {
      if (!interceptable(e.dataTransfer)) return
      e.preventDefault()
      e.stopPropagation()
      if (!bus.get().active) { dragDepth = 1; bus.set({ ...bus.get(), active: true, count: countFiles(e.dataTransfer) }) }
    }
    const onDragLeave = (e: DragEvent) => {
      if (!interceptable(e.dataTransfer)) return
      e.preventDefault()
      e.stopPropagation()
      if (dragDepth > 0) dragDepth -= 1
      if (dragDepth === 0) bus.set({ ...bus.get(), active: false, count: 0 })
    }
    const onDrop = (e: DragEvent) => {
      const dt = e.dataTransfer
      if (dt === null || dt === undefined) return
      if (!interceptable(dt)) return
      e.preventDefault()
      e.stopPropagation()
      dragDepth = 0
      bus.set({ ...bus.get(), active: false, count: 0 })
      // 事件内同步收集（await 之前），否则 DataTransfer 失效
      const synced = syncCollect(dt)
      if (synced.length === 0) return
      acceptAndInsert(synced, 'drop-' + Date.now().toString(36)).catch((err) => {
        console.error('[workbuddy] drop 处理失败:', err)
        bus.toast('拖入处理失败：' + String((err as Error)?.message ?? err), 'error')
      })
    }
    const onDragEnd = () => {
      dragDepth = 0
      bus.set({ ...bus.get(), active: false, count: 0 })
    }
    const onPaste = (e: ClipboardEvent) => {
      const cd = e.clipboardData
      if (cd === null || cd === undefined || !cd.items) return
      let hasFile = false
      for (const it of Array.from(cd.items)) if (it.kind === 'file') { hasFile = true; break }
      if (!hasFile) return
      e.preventDefault()
      e.stopPropagation()
      // 事件内同步收集（await 之前），否则 clipboardData 失效
      const synced = syncCollect(cd)
      if (synced.length === 0) return
      acceptAndInsert(synced, 'drop-' + Date.now().toString(36)).catch((err) => {
        console.error('[workbuddy] 粘贴处理失败:', err)
        bus.toast('粘贴处理失败：' + String((err as Error)?.message ?? err), 'error')
      })
    }

    window.addEventListener('dragenter', onDragEnter, true)
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', onDragEnd, true)
    window.addEventListener('paste', onPaste, true)
    return () => {
      window.removeEventListener('dragenter', onDragEnter, true)
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', onDragEnd, true)
      window.removeEventListener('paste', onPaste, true)
    }
  }

  return { acceptAndInsert, acceptTree, installListeners }
}
