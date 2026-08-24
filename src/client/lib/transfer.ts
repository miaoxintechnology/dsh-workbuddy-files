import type { DropsItem, DropsStat, TreeFile, UploadJob } from '../types'

/** 引用文本格式：无空格直接 @path；含空格/引号用 @"path"；目录保留尾斜杠 */
export function mentionFor(path: string, isDir: boolean): string {
  let p = String(path)
  if (isDir) p = p.replace(/[\\/]+$/, '') + '/'
  if (/\s|"/.test(p)) return '@"' + p + '"'
  return '@' + p
}

/** 从用户消息文本中提取 @ 文件引用（消息发送后的序列化形式） */
export function extractRefs(content: ReadonlyArray<{ type: string; text?: string }>): string[] {
  const out: string[] = []
  for (const b of content) {
    if (b !== null && b !== undefined && b.type === 'text' && typeof b.text === 'string') {
      const re = /@"([^"]+)"|@([^\s"@]+)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(b.text)) !== null) {
        const p = (m[1] !== undefined ? m[1] : m[2]).trim()
        if (p !== '' && !out.includes(p)) out.push(p)
      }
    }
  }
  return out.slice(0, 40)
}

/**
 * 后台上传任务队列：逐个落盘（目录任务先遍历），不阻塞输入。
 * 交付物版本走 webServer 二进制路由（/workbuddy-drops），无 base64、无 JSON 体积上限。
 * @returns 成功数量与失败清单（文件名 + 原因）
 */
export async function runUploadJobs(jobs: UploadJob[], batch: string, maxFileBytes = 256 * 1048576): Promise<{ ok: number; failed: string[] }> {
  let ok = 0
  const failed: string[] = []
  for (const j of jobs) {
    const files: TreeFile[] = j.kind === 'dir' ? await walkEntry(j.entry, '') : [{ rel: j.rel, name: j.name, size: j.file.size, file: j.file }]
    for (const f of files) {
      if (f.file.size > maxFileBytes) { failed.push(f.name + '（超过大小上限）'); continue }
      const url = '/workbuddy-drops/save?batch=' + encodeURIComponent(batch) + '&rel=' + encodeURIComponent(f.rel)
      const res = await fetch(url, { method: 'POST', body: f.file })
      if (res.ok) {
        const body = await res.json() as { ok?: boolean; error?: string }
        if (body.ok === true) { ok += 1; continue }
        failed.push(f.name + '（' + (body.error ?? '写入失败') + '）')
      } else {
        failed.push(f.name + '（HTTP ' + res.status + '）')
      }
    }
  }
  return { ok, failed }
}

/** 缓存根目录（~/.dsh-drops） */
export async function dropsHome(): Promise<string | null> {
  try {
    const res = await fetch('/workbuddy-drops/home')
    const body = await res.json() as { ok?: boolean; root?: string }
    if (body.ok === true && typeof body.root === 'string') return body.root
    return null
  } catch {
    return null
  }
}

export function walkEntry(entry: FileSystemEntry, rel: string): Promise<TreeFile[]> {
  return new Promise((resolve2) => {
    if (entry.isFile) {
      const fe = entry as FileSystemFileEntry
      fe.file(
        (f) => resolve2([{ rel: rel === '' ? entry.name : rel + '/' + entry.name, name: entry.name, size: f.size, file: f }]),
        () => resolve2([]),
      )
      return
    }
    if (entry.isDirectory) {
      const de = entry as FileSystemDirectoryEntry
      const reader = de.createReader()
      const found: FileSystemEntry[] = []
      const readBatch = () => reader.readEntries((ents) => {
        if (ents.length === 0) {
          Promise.all(found.map((e) => walkEntry(e, rel === '' ? entry.name : rel + '/' + entry.name)))
            .then((rs) => resolve2(rs.flat()))
            .catch(() => resolve2([]))
          return
        }
        found.push(...ents)
        readBatch()
      }, () => resolve2([]))
      readBatch()
      return
    }
    resolve2([])
  })
}

export async function dropsList(query: string): Promise<DropsItem[]> {
  try {
    const res = await fetch('/workbuddy-drops/list?query=' + encodeURIComponent(query))
    const body = await res.json() as { items?: DropsItem[] }
    return body.items ?? []
  } catch {
    return []
  }
}

export async function dropsStat(path: string): Promise<DropsStat> {
  try {
    const res = await fetch('/workbuddy-drops/stat?path=' + encodeURIComponent(path))
    return await res.json() as DropsStat
  } catch {
    return { ok: false, path }
  }
}
