import type { ChatMessage, TransferItem } from '../shared/types'

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`
}

export function formatSpeed(bps: number): string {
  if (!bps || bps < 1) return ''
  return `${formatBytes(bps)}/s`
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function formatDayLabel(ts: number): string {
  const date = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)

  if (isSameDay(date, today)) return '今天'
  if (isSameDay(date, yesterday)) return '昨天'
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatEta(item: TransferItem): string {
  if (item.status !== 'transferring' || item.speedBps < 1) return ''
  const remaining = item.fileSize - item.transferred
  if (remaining <= 0) return ''

  const seconds = Math.round(remaining / item.speedBps)
  if (seconds < 60) return `剩余 ${seconds} 秒`
  return `剩余 ${Math.round(seconds / 60)} 分钟`
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return '等待中'
    case 'transferring':
      return '传输中'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'cancelled':
      return '已取消'
    default:
      return status
  }
}

export function localFileSrc(path: string): string {
  return `lop2p://local/?path=${encodeURIComponent(path)}`
}

export function messageImageSrc(message: ChatMessage): string {
  if (message.previewDataUrl) return message.previewDataUrl
  return message.localPath ? localFileSrc(message.localPath) : ''
}
