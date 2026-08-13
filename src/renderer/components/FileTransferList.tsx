import { useMemo, useState, type ReactElement } from 'react'
import type { TransferItem } from '../../shared/types'
import { formatBytes, formatEta, formatSpeed, formatTime, statusLabel } from '../utils'

type Filter = 'all' | 'in' | 'out'

interface Props {
  items: TransferItem[]
  peerId: string | null
  onOpenDir: () => void
  onOpen: (path: string) => void
  onReveal: (path: string) => void
  onCancel: (transferId: string) => void
}

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'in', label: '接收' },
  { value: 'out', label: '发送' }
]

export default function FileTransferList({
  items,
  peerId,
  onOpenDir,
  onOpen,
  onReveal,
  onCancel
}: Props): ReactElement {
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    const scoped = peerId ? items.filter((i) => i.peerId === peerId) : items
    return filter === 'all' ? scoped : scoped.filter((i) => i.direction === filter)
  }, [items, peerId, filter])

  const totalBytes = filtered
    .filter((i) => i.status === 'completed')
    .reduce((sum, i) => sum + i.fileSize, 0)

  return (
    <aside className="glass-panel flex h-full min-h-0 flex-col overflow-hidden border-y-0 border-l border-r-0 border-ink-700/60">
      <div className="panel-topbar">
        <div className="min-w-0">
          <div className="font-display text-base font-semibold leading-none tracking-wide text-sand-100">
            文件列表
          </div>
          <div className="mt-1.5 truncate text-xs text-ink-500">
            {peerId ? '当前会话收发记录' : '全部传输'}
            {totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenDir}
          className="shrink-0 rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:border-mint-500/40 hover:text-mint-400"
        >
          下载目录
        </button>
      </div>

      <div className="flex gap-1 border-b border-ink-700/50 px-3 py-2">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            className={`rounded-lg px-2.5 py-1 text-xs transition ${
              filter === option.value
                ? 'bg-mint-600/20 text-mint-400'
                : 'text-ink-500 hover:text-ink-300'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {filtered.length === 0 ? (
          <div className="mt-8 px-2 text-center text-sm text-ink-500">还没有文件传输</div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((item, index) => {
              const pct =
                item.fileSize > 0
                  ? Math.min(100, Math.round((item.transferred / item.fileSize) * 100))
                  : 0
              const inFlight = item.status === 'transferring' || item.status === 'pending'

              return (
                <li
                  key={item.id}
                  className="animate-rise rounded-xl border border-ink-700/60 bg-ink-900/70 p-3"
                  style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink-100">
                        {item.fileName}
                      </div>
                      <div className="mt-1 text-[11px] text-ink-500">
                        {item.direction === 'out' ? '发送' : '接收'} · {formatBytes(item.fileSize)}{' '}
                        · {statusLabel(item.status)}
                        {item.status === 'transferring' && item.speedBps
                          ? ` · ${formatSpeed(item.speedBps)}`
                          : ''}
                      </div>
                    </div>
                    <div className="shrink-0 text-[11px] text-ink-500">
                      {formatTime(item.createdAt)}
                    </div>
                  </div>

                  {inFlight && (
                    <div className="mt-2">
                      <div className="h-1 overflow-hidden rounded-full bg-ink-700">
                        <div
                          className="h-full rounded-full bg-mint-500 transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-[11px] text-ink-500">
                        <span>{formatEta(item)}</span>
                        <button
                          type="button"
                          className="text-red-300 hover:underline"
                          onClick={() => onCancel(item.id)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}

                  {item.localPath && item.status === 'completed' && (
                    <div className="mt-2 flex gap-3 text-xs">
                      <button
                        type="button"
                        className="text-mint-400 hover:underline"
                        onClick={() => onOpen(item.localPath as string)}
                      >
                        打开
                      </button>
                      <button
                        type="button"
                        className="text-ink-300 hover:underline"
                        onClick={() => onReveal(item.localPath as string)}
                      >
                        所在文件夹
                      </button>
                    </div>
                  )}

                  {item.error && item.status !== 'cancelled' && (
                    <div className="mt-2 text-xs text-red-300/90">{item.error}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
