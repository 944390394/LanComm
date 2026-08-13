import { useEffect, type ReactElement } from 'react'

interface Props {
  src: string
  name: string
  onClose: () => void
  onOpenExternal?: () => void
  onReveal?: () => void
}

export default function ImageLightbox({
  src,
  name,
  onClose,
  onOpenExternal,
  onReveal
}: Props): ReactElement {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink-950/90 p-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <img
        src={src}
        alt={name}
        className="max-h-[80vh] max-w-full rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />

      <div
        className="mt-4 flex items-center gap-3 rounded-full border border-ink-700/70 bg-ink-900/90 px-4 py-2 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="max-w-[320px] truncate text-ink-300">{name}</span>
        {onOpenExternal && (
          <button type="button" className="text-mint-400 hover:underline" onClick={onOpenExternal}>
            用默认程序打开
          </button>
        )}
        {onReveal && (
          <button type="button" className="text-ink-300 hover:underline" onClick={onReveal}>
            所在文件夹
          </button>
        )}
        <button type="button" className="text-ink-500 hover:text-ink-100" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}
