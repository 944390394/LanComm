import { useState, type ReactElement } from 'react'
import type { ChatMessage, TransferItem } from '../../shared/types'
import { formatBytes, formatEta, formatSpeed, formatTime, messageImageSrc } from '../utils'

interface Props {
  message: ChatMessage
  transfer?: TransferItem
  showMeta: boolean
  onOpen?: (path: string) => void
  onReveal?: (path: string) => void
  onResend?: (message: ChatMessage) => Promise<void> | void
  onPreviewImage?: (message: ChatMessage) => void
  onCancelTransfer?: (transferId: string) => void
}

function deliveryLabel(message: ChatMessage, transfer?: TransferItem): string {
  if (message.direction !== 'out') return ''

  if (transfer) {
    if (transfer.status === 'failed') return '未送达'
    if (transfer.status === 'cancelled') return '已取消'
    if (transfer.status === 'completed') return '已送达'
    if (transfer.status === 'transferring') return '发送中'
  }

  if (message.deliveryStatus === 'failed') return '未送达'
  if (message.deliveryStatus === 'delivered') return '已送达'
  if (message.deliveryStatus === 'pending') return '发送中'
  return ''
}

export default function MessageBubble({
  message,
  transfer,
  showMeta,
  onOpen,
  onReveal,
  onResend,
  onPreviewImage,
  onCancelTransfer
}: Props): ReactElement {
  const [copied, setCopied] = useState(false)
  const mine = message.direction === 'out'
  const wrap = mine ? 'msg-out ml-auto' : 'msg-in mr-auto'
  const delivery = deliveryLabel(message, transfer)
  const failed = delivery === '未送达'

  function copyText(): void {
    if (!message.text) return
    void navigator.clipboard.writeText(message.text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  const meta = (showMeta || failed) && (
    <div
      className={`mt-1 flex items-center gap-2 text-[11px] ${mine ? 'justify-end' : ''} ${
        failed ? 'text-red-300' : 'text-ink-500'
      }`}
    >
      <span>
        {formatTime(message.createdAt)}
        {delivery ? ` · ${delivery}` : ''}
      </span>
      {failed && message.kind === 'text' && message.text && onResend && (
        <button type="button" className="text-mint-400 hover:underline" onClick={() => void onResend(message)}>
          重发
        </button>
      )}
    </div>
  )

  if (message.kind === 'text') {
    return (
      <div className={`group max-w-[75%] ${wrap}`}>
        <div className="relative">
          <div
            className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed ${
              mine
                ? 'rounded-br-md bg-mint-600 text-ink-950'
                : 'rounded-bl-md bg-ink-800 text-ink-100'
            }`}
          >
            {message.text}
          </div>
          <button
            type="button"
            title="复制"
            onClick={copyText}
            className={`absolute top-1 hidden rounded-md bg-ink-950/80 px-2 py-0.5 text-[11px] text-ink-300 group-hover:block hover:text-mint-400 ${
              mine ? '-left-12' : '-right-12'
            }`}
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        {meta}
      </div>
    )
  }

  const progress =
    transfer && transfer.fileSize > 0
      ? Math.min(100, Math.round((transfer.transferred / transfer.fileSize) * 100))
      : transfer?.status === 'completed'
        ? 100
        : 0
  const imageSrc = message.kind === 'image' ? messageImageSrc(message) : ''
  const inFlight = transfer?.status === 'transferring' || transfer?.status === 'pending'

  return (
    <div className={`max-w-[78%] ${wrap}`}>
      <div
        className={`overflow-hidden rounded-2xl border border-ink-700/70 bg-ink-900/90 ${
          mine ? 'rounded-br-md' : 'rounded-bl-md'
        }`}
      >
        {imageSrc && (
          <button
            type="button"
            className="block w-full"
            onClick={() => onPreviewImage?.(message)}
          >
            <img
              src={imageSrc}
              alt={message.fileName || '图片'}
              className="max-h-72 w-full object-cover"
            />
          </button>
        )}

        <div className="px-3.5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium text-sand-100">{message.fileName || '文件'}</div>
              <div className="mt-0.5 text-xs text-ink-500">
                {formatBytes(message.fileSize || transfer?.fileSize || 0)}
                {transfer?.status === 'transferring' && transfer.speedBps
                  ? ` · ${formatSpeed(transfer.speedBps)}`
                  : ''}
              </div>
            </div>

            <div className="flex shrink-0 gap-2 text-xs">
              {inFlight && transfer && onCancelTransfer && (
                <button
                  type="button"
                  className="text-red-300 hover:underline"
                  onClick={() => onCancelTransfer(transfer.id)}
                >
                  取消
                </button>
              )}
              {(message.localPath || transfer?.localPath) && !inFlight && (
                <>
                  <button
                    type="button"
                    className="text-mint-400 hover:underline"
                    onClick={() => onOpen?.(message.localPath || transfer?.localPath || '')}
                  >
                    打开
                  </button>
                  <button
                    type="button"
                    className="text-ink-300 hover:underline"
                    onClick={() => onReveal?.(message.localPath || transfer?.localPath || '')}
                  >
                    位置
                  </button>
                </>
              )}
            </div>
          </div>

          {inFlight && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div
                  className="h-full rounded-full bg-mint-500 transition-all duration-300 ease-out animate-progress-glow"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-ink-500">
                <span>{progress}%</span>
                {transfer && <span>{formatEta(transfer)}</span>}
              </div>
            </div>
          )}

          {transfer?.error && transfer.status === 'failed' && (
            <div className="mt-2 text-xs text-red-300/90">{transfer.error}</div>
          )}
        </div>
      </div>
      {meta}
    </div>
  )
}
