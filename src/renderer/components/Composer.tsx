import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactElement
} from 'react'

interface Props {
  disabled?: boolean
  onSendText: (text: string) => Promise<void> | void
  onPickFiles: () => Promise<void> | void
  onPasteFiles: (files: File[]) => Promise<void> | void
  onSendClipboard: () => Promise<void> | void
}

export default function Composer({
  disabled,
  onSendText,
  onPickFiles,
  onPasteFiles,
  onSendClipboard
}: Props): ReactElement {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [text])

  async function submit(): Promise<void> {
    const value = text.trim()
    if (!value || disabled || sending) return

    setSending(true)
    try {
      await onSendText(value)
      setText('')
      inputRef.current?.focus()
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>): void {
    const files = Array.from(e.clipboardData.files || [])
    if (!files.length) return
    e.preventDefault()
    void onPasteFiles(files)
  }

  return (
    <div className="border-t border-ink-700/60 bg-ink-900/80 px-4 py-3 backdrop-blur">
      <div className="flex items-end gap-1 rounded-2xl border border-ink-700/80 bg-ink-950/70 p-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onPickFiles()}
          className="mb-0.5 rounded-xl px-3 py-2 text-sm text-ink-300 transition hover:bg-ink-800 hover:text-mint-400 disabled:opacity-40"
          title="选择文件发送"
        >
          附件
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onSendClipboard()}
          className="mb-0.5 rounded-xl px-3 py-2 text-sm text-ink-300 transition hover:bg-ink-800 hover:text-mint-400 disabled:opacity-40"
          title="把剪贴板里的文字或图片直接发过去"
        >
          剪贴板
        </button>

        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          disabled={disabled || sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={
            disabled ? '请先选择一台在线设备' : '写点什么，Enter 发送，Shift+Enter 换行'
          }
          className="max-h-32 min-h-[42px] flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-ink-500"
        />

        <button
          type="button"
          disabled={disabled || sending || !text.trim()}
          onClick={() => void submit()}
          className="mb-0.5 rounded-xl bg-mint-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-mint-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
  )
}
