import { useEffect, useRef, type ReactElement } from 'react'
import type { ChatMessage, PeerInfo, TransferItem } from '../../shared/types'
import MessageBubble from './MessageBubble'
import Composer from './Composer'
import { formatDayLabel, isSameDay } from '../utils'

const META_GAP_MS = 120_000

interface Props {
  peer: PeerInfo | null
  connected: boolean
  messages: ChatMessage[]
  transfers: TransferItem[]
  dragging: boolean
  filesPanelOpen: boolean
  onToggleFilesPanel: () => void
  onClearMessages: () => void
  onSendText: (text: string) => Promise<void>
  onPickFiles: () => Promise<void>
  onPasteFiles: (files: File[]) => Promise<void>
  onSendClipboard: () => Promise<void>
  onOpen: (path: string) => void
  onReveal: (path: string) => void
  onResend: (message: ChatMessage) => Promise<void>
  onPreviewImage: (message: ChatMessage) => void
  onCancelTransfer: (transferId: string) => void
}

export default function ChatPanel({
  peer,
  connected,
  messages,
  transfers,
  dragging,
  filesPanelOpen,
  onToggleFilesPanel,
  onClearMessages,
  onSendText,
  onPickFiles,
  onPasteFiles,
  onSendClipboard,
  onOpen,
  onReveal,
  onResend,
  onPreviewImage,
  onCancelTransfer
}: Props): ReactElement {
  const listRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    const el = listRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, transfers])

  function onScroll(): void {
    const el = listRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  if (!peer) {
    return (
      <section className="chat-panel relative">
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="brand-mark text-4xl font-bold leading-tight">局域网通信软件</div>
          <p className="mt-4 max-w-md text-base text-ink-300">
            选择左侧设备开始互传文件、图片与消息。两台电脑在同一局域网即可自动发现。
          </p>
        </div>
      </section>
    )
  }

  const transferMap = new Map(transfers.map((t) => [t.id, t]))

  return (
    <section className={`chat-panel relative ${dragging ? 'drop-active' : ''}`}>
      <header className="panel-topbar">
        <div className="min-w-0">
          <div className="truncate font-display text-base font-semibold leading-none text-sand-100">
            {peer.name}
          </div>
          <div className="mt-1.5 truncate text-xs text-ink-500">
            {peer.hostname} · {peer.ip}
            {connected ? ' · 会话已连接' : peer.online ? ' · 准备连接' : ' · 离线'}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div
            className={`rounded-full px-3 py-1 text-xs ${
              peer.online ? 'bg-mint-600/15 text-mint-400' : 'bg-ink-800 text-ink-500'
            }`}
          >
            {peer.online ? '在线' : '离线'}
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              title="清空当前会话"
              className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:border-red-400/40 hover:text-red-300"
              onClick={onClearMessages}
            >
              清空
            </button>
          )}
          <button
            type="button"
            title={filesPanelOpen ? '隐藏文件列表' : '显示文件列表'}
            className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:border-mint-500/40 hover:text-mint-400"
            onClick={onToggleFilesPanel}
          >
            {filesPanelOpen ? '收起文件' : '文件列表'}
          </button>
        </div>
      </header>

      <div ref={listRef} onScroll={onScroll} className="chat-scroll space-y-3 px-5 py-4">
        {messages.length === 0 && (
          <div className="mt-16 text-center text-sm text-ink-500">
            还没有消息。拖入文件，或直接开始聊天。
          </div>
        )}

        {messages.map((message, index) => {
          const prev = messages[index - 1]
          const next = messages[index + 1]
          const showDay =
            !prev || !isSameDay(new Date(prev.createdAt), new Date(message.createdAt))
          const showMeta =
            !next ||
            next.direction !== message.direction ||
            next.createdAt - message.createdAt > META_GAP_MS

          return (
            <div key={message.id} className="space-y-3">
              {showDay && (
                <div className="flex justify-center">
                  <span className="rounded-full bg-ink-800/80 px-3 py-1 text-[11px] text-ink-500">
                    {formatDayLabel(message.createdAt)}
                  </span>
                </div>
              )}
              <MessageBubble
                message={message}
                transfer={message.transferId ? transferMap.get(message.transferId) : undefined}
                showMeta={showMeta}
                onOpen={onOpen}
                onReveal={onReveal}
                onResend={onResend}
                onPreviewImage={onPreviewImage}
                onCancelTransfer={onCancelTransfer}
              />
            </div>
          )
        })}
      </div>

      <div className="chat-composer">
        <Composer
          disabled={!peer.online}
          onSendText={onSendText}
          onPickFiles={onPickFiles}
          onPasteFiles={onPasteFiles}
          onSendClipboard={onSendClipboard}
        />
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-ink-950/55">
          <div className="rounded-2xl border border-mint-500/50 bg-ink-900/90 px-8 py-6 text-center">
            <div className="font-display text-xl font-semibold text-mint-400">放到此处发送</div>
            <div className="mt-1 text-sm text-ink-300">支持文件与图片</div>
          </div>
        </div>
      )}
    </section>
  )
}
