/**
 * Client 半侧共享类型。
 * 线上运行期这些类型来自宿主提供的 peer 依赖包；此处仅声明插件内部使用的形状。
 */

/** 一次拖拽/粘贴/选择后待插入输入框的引用项 */
export interface InsertItem {
  label: string
  reference: {
    source: 'workbuddy'
    ref: string
    label: string
    appearance: 'file' | 'folder'
    clipboardText: string
  }
}

/** 目录树遍历得到的文件条目 */
export interface TreeFile {
  /** 相对路径（'/' 分隔，含顶层目录名；松散文件时就是文件名） */
  rel: string
  name: string
  size: number
  file: File
}

/** 后台上传任务：松散文件，或待遍历的目录 entry */
export type UploadJob = {
  kind: 'file'
  file: File
  rel: string
  name: string
} | {
  kind: 'dir'
  entry: FileSystemEntry
}

/** drops.stat / drops.list 等 RPC 的返回形状 */
export interface DropsStat {
  ok: boolean
  exists?: boolean
  path: string
  type?: string
  size?: number | null
  error?: string
}

export interface DropsItem {
  name: string
  path: string
  type: string
  size: number | null
}

/** 拖拽/粘贴总线状态 */
export interface BusState {
  active: boolean
  count: number
  toast: { text: string; level: 'info' | 'error' } | null
}
