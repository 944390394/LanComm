import { useState, type ReactElement } from 'react'
import type { LocalIdentity, PeerInfo } from '../../shared/types'

interface Props {
  identity: LocalIdentity | null
  peers: PeerInfo[]
  selectedPeerId: string | null
  connectedPeerId: string | null
  unread: Record<string, number>
  onSelect: (peerId: string) => void
  onRename: (name: string) => Promise<void>
  onConnectByIp: (ip: string) => Promise<void>
  onRescan: () => void
  onOpenSettings: () => void
}

export default function PeerSidebar({
  identity,
  peers,
  selectedPeerId,
  connectedPeerId,
  unread,
  onSelect,
  onRename,
  onConnectByIp,
  onRescan,
  onOpenSettings
}: Props): ReactElement {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [ipInput, setIpInput] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [copiedIp, setCopiedIp] = useState<string | null>(null)

  const online = peers.filter((p) => p.online)
  const offline = peers.filter((p) => !p.online)
  const ips = identity?.ips || []

  async function handleConnectIp(): Promise<void> {
    const ip = ipInput.trim()
    if (!ip || connecting) return

    setConnecting(true)
    setConnectError(null)
    try {
      await onConnectByIp(ip)
      setIpInput('')
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }

  function copyIp(ip: string): void {
    void navigator.clipboard.writeText(ip).then(() => {
      setCopiedIp(ip)
      window.setTimeout(() => setCopiedIp(null), 1200)
    })
  }

  return (
    <aside className="glass-panel flex h-full min-h-0 flex-col overflow-hidden border-y-0 border-l-0 border-r border-ink-700/60">
      <div className="panel-topbar">
        <div className="min-w-0">
          <div className="brand-mark truncate text-[1.35rem] font-bold leading-none">
            局域网通信软件
          </div>
          <p className="mt-1.5 truncate text-xs text-ink-300">互传文件 · 图片 · 消息</p>
        </div>
        <button
          type="button"
          title="设置"
          onClick={onOpenSettings}
          className="shrink-0 rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-ink-300 hover:border-mint-500/40 hover:text-mint-400"
        >
          设置
        </button>
      </div>

      <div className="border-b border-ink-700/50 px-5 py-4">
        <div className="text-xs uppercase tracking-[0.14em] text-ink-500">本机</div>
        {editing ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void onRename(name).then(() => setEditing(false))
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm outline-none ring-mint-500 focus:ring-1"
            />
            <button
              type="submit"
              className="rounded-md bg-mint-600 px-2.5 text-sm font-medium text-ink-950"
            >
              保存
            </button>
          </form>
        ) : (
          <button
            type="button"
            title="点击修改设备名称"
            className="mt-1 w-full text-left"
            onClick={() => {
              setName(identity?.name || '')
              setEditing(true)
            }}
          >
            <div className="truncate font-medium text-sand-100">{identity?.name || '...'}</div>
            <div className="truncate text-xs text-ink-500">{identity?.hostname}</div>
          </button>
        )}

        <div className="mt-2 space-y-1">
          {ips.length === 0 ? (
            <div className="text-xs text-ink-500">IP: --</div>
          ) : (
            ips.map((ip) => (
              <button
                key={ip}
                type="button"
                title="点击复制 IP"
                className="block w-full truncate text-left font-mono text-xs text-mint-400 hover:underline"
                onClick={() => copyIp(ip)}
              >
                IP: {ip}
                {copiedIp === ip ? ' 已复制' : ''}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="border-b border-ink-700/50 px-5 py-3">
        <div className="mb-2 text-xs uppercase tracking-[0.14em] text-ink-500">IP 直连</div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void handleConnectIp()
          }}
        >
          <input
            value={ipInput}
            onChange={(e) => setIpInput(e.target.value)}
            placeholder="192.168.x.x"
            className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-sm outline-none ring-mint-500 focus:ring-1"
          />
          <button
            type="submit"
            disabled={connecting || !ipInput.trim()}
            className="rounded-md bg-mint-600 px-2.5 text-sm font-medium text-ink-950 disabled:opacity-40"
          >
            {connecting ? '...' : '连接'}
          </button>
        </form>
        {connectError && <div className="mt-2 text-xs text-red-300/90">{connectError}</div>}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs uppercase tracking-[0.14em] text-ink-500">附近设备</span>
          <button
            type="button"
            title="立即重新扫描"
            onClick={onRescan}
            className="inline-flex items-center gap-1.5 text-xs text-mint-400 hover:underline"
          >
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-mint-400" />
            重新扫描
          </button>
        </div>

        {peers.length === 0 && (
          <div className="mx-2 mt-6 rounded-xl border border-dashed border-ink-700/80 px-3 py-6 text-center text-sm text-ink-500">
            等待发现或使用 IP 直连...
          </div>
        )}

        <ul className="space-y-1">
          {online.map((peer, index) => (
            <li
              key={peer.id}
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
              className="animate-rise"
            >
              <PeerButton
                peer={peer}
                selected={selectedPeerId === peer.id}
                connected={connectedPeerId === peer.id}
                unread={unread[peer.id] || 0}
                onSelect={onSelect}
              />
            </li>
          ))}
          {offline.map((peer) => (
            <li key={peer.id} className="opacity-55">
              <PeerButton
                peer={peer}
                selected={selectedPeerId === peer.id}
                connected={false}
                unread={unread[peer.id] || 0}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

function PeerButton({
  peer,
  selected,
  connected,
  unread,
  onSelect
}: {
  peer: PeerInfo
  selected: boolean
  connected: boolean
  unread: number
  onSelect: (id: string) => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onSelect(peer.id)}
      className={`w-full rounded-xl px-3 py-3 text-left transition ${
        selected ? 'bg-mint-600/15 ring-1 ring-mint-500/40' : 'hover:bg-ink-800/80'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            peer.online ? 'bg-mint-600/25 text-mint-400' : 'bg-ink-700 text-ink-300'
          }`}
        >
          {peer.name.slice(0, 1).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-ink-100">{peer.name}</div>
          <div className="truncate text-xs text-ink-500">
            {peer.ip}
            {connected ? ' · 已连接' : peer.online ? ' · 在线' : ' · 离线'}
          </div>
        </div>

        {unread > 0 && (
          <span className="shrink-0 rounded-full bg-mint-500 px-2 py-0.5 text-[11px] font-semibold text-ink-950">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </div>
    </button>
  )
}
