/** 文件类型 → 图标/颜色映射（WorkBuddy 风格的类型标识） */

const ICONS: Record<string, string> = {
  pdf: '📕', doc: '📘', docx: '📘', xls: '📊', xlsx: '📊', csv: '📊', ppt: '📙', pptx: '📙',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', bmp: '🖼️',
  zip: '🗜️', '7z': '🗜️', rar: '🗜️', tar: '🗜️', gz: '🗜️',
  mp3: '🎵', wav: '🎵', flac: '🎵', mp4: '🎬', mov: '🎬', mkv: '🎬',
  md: '📝', txt: '📄', log: '📄',
  js: '💻', ts: '💻', jsx: '💻', tsx: '💻', py: '💻', go: '💻', rs: '💻', java: '💻',
  c: '💻', h: '💻', cpp: '💻', cs: '💻', json: '💻', yaml: '💻', yml: '💻', toml: '💻',
  sh: '💻', ps1: '💻', bat: '💻', css: '💻', html: '💻', vue: '💻', sql: '💻',
}

export function iconFor(name: string): string {
  const dot = String(name).lastIndexOf('.')
  const ext = dot >= 0 ? String(name).slice(dot + 1).toLowerCase() : ''
  return ICONS[ext] ?? '📄'
}

export function formatSize(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  if (n < 1024) return n + ' B'
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
  return (n / 1073741824).toFixed(2) + ' GB'
}
