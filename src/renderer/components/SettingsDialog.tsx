import { useEffect, useState, type ReactElement } from 'react'
import type { AppSettings, AutoAcceptMode } from '../../shared/types'

interface Props {
  settings: AppSettings
  onClose: () => void
  onSave: (patch: Partial<AppSettings>) => Promise<void>
  onChooseDir: () => Promise<string | null>
}

const ACCEPT_MODES: Array<{ value: AutoAcceptMode; label: string; hint: string }> = [
  { value: 'trusted', label: '仅信任设备自动接收', hint: '陌生设备发文件时会先询问（推荐）' },
  { value: 'always', label: '全部自动接收', hint: '同一网络下任何人都能直接发文件给你' },
  { value: 'ask', label: '每次都询问', hint: '每个文件都需要手动确认' }
]

export default function SettingsDialog({
  settings,
  onClose,
  onSave,
  onChooseDir
}: Props): ReactElement {
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const portsChanged = draft.httpPort !== settings.httpPort || draft.wsPort !== settings.wsPort

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await onSave(draft)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-full w-[560px] overflow-y-auto rounded-2xl border border-ink-700/70 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-700/60 px-6 py-4">
          <div className="font-display text-lg font-semibold text-sand-100">设置</div>
          <button type="button" className="text-ink-500 hover:text-ink-100" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          <Field label="设备名称">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none ring-mint-500 focus:ring-1"
            />
          </Field>

          <Field label="接收文件保存位置">
            <div className="flex gap-2">
              <input
                readOnly
                value={draft.downloadDir}
                className="min-w-0 flex-1 truncate rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-300 outline-none"
              />
              <button
                type="button"
                className="shrink-0 rounded-lg border border-ink-700 px-3 text-sm text-ink-300 hover:border-mint-500/40 hover:text-mint-400"
                onClick={() => {
                  void onChooseDir().then((dir) => {
                    if (dir) setDraft({ ...draft, downloadDir: dir })
                  })
                }}
              >
                更改
              </button>
            </div>
          </Field>

          <Field label="接收方式">
            <div className="space-y-2">
              {ACCEPT_MODES.map((mode) => (
                <label
                  key={mode.value}
                  className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition ${
                    draft.autoAcceptMode === mode.value
                      ? 'border-mint-500/50 bg-mint-600/10'
                      : 'border-ink-700 hover:border-ink-500'
                  }`}
                >
                  <input
                    type="radio"
                    name="autoAcceptMode"
                    className="mt-1 accent-mint-500"
                    checked={draft.autoAcceptMode === mode.value}
                    onChange={() => setDraft({ ...draft, autoAcceptMode: mode.value })}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-ink-100">{mode.label}</span>
                    <span className="block text-xs text-ink-500">{mode.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>

          {draft.trustedPeerIds.length > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-ink-700 px-3 py-2.5">
              <span className="text-sm text-ink-300">
                已信任 {draft.trustedPeerIds.length} 台设备
              </span>
              <button
                type="button"
                className="text-xs text-red-300 hover:underline"
                onClick={() => setDraft({ ...draft, trustedPeerIds: [] })}
              >
                全部取消信任
              </button>
            </div>
          )}

          <Field label="提醒">
            <Toggle
              label="收到新消息时通知"
              checked={draft.notifyOnMessage}
              onChange={(v) => setDraft({ ...draft, notifyOnMessage: v })}
            />
            <Toggle
              label="文件接收完成时通知"
              checked={draft.notifyOnTransfer}
              onChange={(v) => setDraft({ ...draft, notifyOnTransfer: v })}
            />
          </Field>

          <Field label="启动与窗口">
            <Toggle
              label="关闭窗口时最小化到托盘"
              checked={draft.minimizeToTray}
              onChange={(v) => setDraft({ ...draft, minimizeToTray: v })}
            />
            <Toggle
              label="开机自动启动"
              checked={draft.autoLaunch}
              onChange={(v) => setDraft({ ...draft, autoLaunch: v })}
            />
          </Field>

          <Field label="端口">
            <div className="flex gap-2">
              <PortInput
                label="文件传输"
                value={draft.httpPort}
                onChange={(v) => setDraft({ ...draft, httpPort: v })}
              />
              <PortInput
                label="消息"
                value={draft.wsPort}
                onChange={(v) => setDraft({ ...draft, wsPort: v })}
              />
            </div>
            {portsChanged && (
              <p className="mt-2 text-xs text-amber-300/90">端口修改后需要重启程序才会生效</p>
            )}
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-700/60 px-6 py-4">
          <button
            type="button"
            className="rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-300 hover:text-ink-100"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            className="rounded-lg bg-mint-500 px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-mint-400 disabled:opacity-40"
            onClick={() => void save()}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): ReactElement {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-[0.14em] text-ink-500">{label}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}): ReactElement {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-ink-100">
      <input
        type="checkbox"
        className="h-4 w-4 accent-mint-500"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

function PortInput({
  label,
  value,
  onChange
}: {
  label: string
  value: number
  onChange: (value: number) => void
}): ReactElement {
  return (
    <label className="flex-1">
      <span className="mb-1 block text-xs text-ink-500">{label}</span>
      <input
        type="number"
        min={1024}
        max={65535}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-sm outline-none ring-mint-500 focus:ring-1"
      />
    </label>
  )
}
