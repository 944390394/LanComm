import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type {
  AppSettings,
  ChatMessage,
  IncomingTransferRequest,
  LocalIdentity,
  PeerInfo,
  TransferItem
} from '../shared/types'
import PeerSidebar from './components/PeerSidebar'
import ChatPanel from './components/ChatPanel'
import FileTransferList from './components/FileTransferList'
import SettingsDialog from './components/SettingsDialog'
import ImageLightbox from './components/ImageLightbox'
import IncomingRequests from './components/IncomingRequests'
import { fileToBase64, messageImageSrc } from './utils'

/** Base64 goes through the renderer heap, so only small in-memory blobs take that path. */
const BUFFER_SEND_LIMIT = 32 * 1024 * 1024

interface LightboxState {
  src: string
  name: string
  localPath?: string
}

export default function App(): ReactElement {
  const [identity, setIdentity] = useState<LocalIdentity | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [peers, setPeers] = useState<PeerInfo[]>([])
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null)
  const [connectedPeerId, setConnectedPeerId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [requests, setRequests] = useState<IncomingTransferRequest[]>([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [filesPanelOpen, setFilesPanelOpen] = useState(true)
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)

  const selectedPeerIdRef = useRef<string | null>(null)
  const countedMessagesRef = useRef(new Set<string>())

  const selectedPeer = useMemo(
    () => peers.find((p) => p.id === selectedPeerId) || null,
    [peers, selectedPeerId]
  )

  const totalUnread = useMemo(
    () => Object.values(unread).reduce((sum, n) => sum + n, 0),
    [unread]
  )

  useEffect(() => {
    selectedPeerIdRef.current = selectedPeerId
  }, [selectedPeerId])

  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) 局域网通信软件` : '局域网通信软件'
  }, [totalUnread])

  useEffect(() => {
    void window.lop2p.getIdentity().then(setIdentity)
    void window.lop2p.getSettings().then(setSettings)
    void window.lop2p.listPeers().then(setPeers)
    void window.lop2p.listTransfers().then(setTransfers)

    const unsubscribers = [
      window.lop2p.onPeersUpdate(setPeers),
      window.lop2p.onIdentityUpdate(setIdentity),
      window.lop2p.onTransferList(setTransfers),
      window.lop2p.onTransferUpdate((item) => {
        setTransfers((prev) => {
          const idx = prev.findIndex((t) => t.id === item.id)
          if (idx < 0) return [item, ...prev]
          const next = prev.slice()
          next[idx] = item
          return next
        })
      }),
      window.lop2p.onChatMessages(({ peerId, messages: list }) => {
        if (selectedPeerIdRef.current === peerId) setMessages(list)
      }),
      window.lop2p.onChatMessage((msg) => {
        if (msg.direction !== 'in') return
        if (msg.peerId === selectedPeerIdRef.current) return
        if (countedMessagesRef.current.has(msg.id)) return

        countedMessagesRef.current.add(msg.id)
        setUnread((prev) => ({ ...prev, [msg.peerId]: (prev[msg.peerId] || 0) + 1 }))
      }),
      window.lop2p.onTransferRequest((request) => {
        setRequests((prev) => [...prev, request])
      }),
      window.lop2p.onTransferRequestClosed((requestId) => {
        setRequests((prev) => prev.filter((r) => r.requestId !== requestId))
      }),
      window.lop2p.onPeerConnection(({ peerId, connected }) => {
        setConnectedPeerId((current) => {
          if (connected) return peerId
          return current === peerId ? null : current
        })
      })
    ]

    return () => unsubscribers.forEach((off) => off())
  }, [])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), 3200)
    return () => window.clearTimeout(timer)
  }, [error])

  const reportError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err))
  }, [])

  const selectPeer = useCallback(async (peerId: string) => {
    setSelectedPeerId(peerId)
    setError(null)
    setUnread((prev) => ({ ...prev, [peerId]: 0 }))

    setMessages(await window.lop2p.getMessages(peerId))
    try {
      await window.lop2p.connectPeer(peerId)
      setConnectedPeerId(peerId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const rename = useCallback(async (name: string) => {
    setIdentity(await window.lop2p.setDisplayName(name))
    setSettings(await window.lop2p.getSettings())
  }, [])

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(await window.lop2p.updateSettings(patch))
    setIdentity(await window.lop2p.getIdentity())
  }, [])

  const connectByIp = useCallback(async (ip: string) => {
    setError(null)
    const peer = await window.lop2p.connectByIp(ip)

    setPeers((prev) => {
      const idx = prev.findIndex((p) => p.id === peer.id)
      if (idx < 0) return [peer, ...prev]
      const next = prev.slice()
      next[idx] = peer
      return next
    })
    setSelectedPeerId(peer.id)
    setMessages(await window.lop2p.getMessages(peer.id))
    setConnectedPeerId(peer.id)
  }, [])

  const sendText = useCallback(
    async (text: string) => {
      if (!selectedPeerId) return
      setError(null)
      try {
        const msg = await window.lop2p.sendText(selectedPeerId, text)
        if (msg.deliveryStatus === 'failed') setError('消息未送达')
      } catch (err) {
        reportError(err)
      }
    },
    [selectedPeerId, reportError]
  )

  const resendMessage = useCallback(
    async (message: ChatMessage) => {
      if (message.kind !== 'text' || !message.text) return
      await sendText(message.text)
    },
    [sendText]
  )

  const pickFiles = useCallback(async () => {
    if (!selectedPeerId) return
    const paths = await window.lop2p.chooseFiles()
    if (!paths.length) return

    setError(null)
    try {
      await window.lop2p.sendFiles(selectedPeerId, paths)
    } catch (err) {
      reportError(err)
    }
  }, [selectedPeerId, reportError])

  const sendBrowserFiles = useCallback(
    async (files: File[]) => {
      if (!selectedPeerId || !files.length) return
      setError(null)

      try {
        for (const file of files) {
          // Files that exist on disk are streamed by path; only in-memory blobs
          // (clipboard screenshots) fall back to base64, which must stay small.
          const nativePath = window.lop2p.getPathForFile(file)
          if (nativePath) {
            await window.lop2p.sendFiles(selectedPeerId, [nativePath])
            continue
          }

          if (file.size > BUFFER_SEND_LIMIT) {
            setError(`${file.name || '该内容'} 过大，请改用「附件」按钮选择文件发送`)
            continue
          }

          await window.lop2p.sendBuffer(selectedPeerId, {
            fileName: file.name || `paste-${Date.now()}.png`,
            mimeType: file.type || 'application/octet-stream',
            base64: await fileToBase64(file)
          })
        }
      } catch (err) {
        reportError(err)
      }
    },
    [selectedPeerId, reportError]
  )

  const sendClipboard = useCallback(async () => {
    if (!selectedPeerId) return
    setError(null)
    try {
      await window.lop2p.sendClipboard(selectedPeerId)
    } catch (err) {
      reportError(err)
    }
  }, [selectedPeerId, reportError])

  const clearMessages = useCallback(async () => {
    if (!selectedPeerId) return
    await window.lop2p.clearMessages(selectedPeerId)
    setMessages([])
  }, [selectedPeerId])

  const respondToRequest = useCallback(
    (requestId: string, accept: boolean, trust: boolean) => {
      setRequests((prev) => prev.filter((r) => r.requestId !== requestId))
      void window.lop2p.respondToTransferRequest(requestId, accept, trust).then(async () => {
        if (trust) setSettings(await window.lop2p.getSettings())
      })
    },
    []
  )

  const previewImage = useCallback((message: ChatMessage) => {
    const src = messageImageSrc(message)
    if (!src) return
    setLightbox({ src, name: message.fileName || '图片', localPath: message.localPath })
  }, [])

  useEffect(() => {
    function onDragOver(e: DragEvent): void {
      if (!selectedPeerId) return
      e.preventDefault()
      setDragging(true)
    }
    function onDragLeave(e: DragEvent): void {
      if (e.relatedTarget) return
      setDragging(false)
    }
    function onDrop(e: DragEvent): void {
      e.preventDefault()
      setDragging(false)
      if (!selectedPeerId) return

      const files = Array.from(e.dataTransfer?.files || [])
      if (files.length) void sendBrowserFiles(files)
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [selectedPeerId, sendBrowserFiles])

  return (
    <div className={`app-shell ${filesPanelOpen ? '' : 'app-shell--compact'}`}>
      <PeerSidebar
        identity={identity}
        peers={peers}
        selectedPeerId={selectedPeerId}
        connectedPeerId={connectedPeerId}
        unread={unread}
        onSelect={(id) => void selectPeer(id)}
        onRename={rename}
        onConnectByIp={connectByIp}
        onRescan={() => void window.lop2p.rescanPeers()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="relative min-h-0 min-w-0 overflow-hidden">
        {error && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-red-400/30 bg-ink-900/95 px-4 py-1.5 text-xs text-red-200">
            {error}
          </div>
        )}

        <IncomingRequests requests={requests} onRespond={respondToRequest} />

        <ChatPanel
          peer={selectedPeer}
          connected={connectedPeerId === selectedPeerId}
          messages={messages}
          transfers={transfers}
          dragging={dragging}
          filesPanelOpen={filesPanelOpen}
          onToggleFilesPanel={() => setFilesPanelOpen((v) => !v)}
          onClearMessages={() => void clearMessages()}
          onSendText={sendText}
          onPickFiles={pickFiles}
          onPasteFiles={sendBrowserFiles}
          onSendClipboard={sendClipboard}
          onOpen={(path) => void window.lop2p.openPath(path)}
          onReveal={(path) => void window.lop2p.showItemInFolder(path)}
          onResend={resendMessage}
          onPreviewImage={previewImage}
          onCancelTransfer={(id) => void window.lop2p.cancelTransfer(id)}
        />
      </main>

      {filesPanelOpen && (
        <FileTransferList
          items={transfers}
          peerId={selectedPeerId}
          onOpenDir={() => void window.lop2p.openDownloadDir()}
          onOpen={(path) => void window.lop2p.openPath(path)}
          onReveal={(path) => void window.lop2p.showItemInFolder(path)}
          onCancel={(id) => void window.lop2p.cancelTransfer(id)}
        />
      )}

      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          onChooseDir={() => window.lop2p.chooseDownloadDir()}
        />
      )}

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          name={lightbox.name}
          onClose={() => setLightbox(null)}
          onOpenExternal={
            lightbox.localPath
              ? () => void window.lop2p.openPath(lightbox.localPath as string)
              : undefined
          }
          onReveal={
            lightbox.localPath
              ? () => void window.lop2p.showItemInFolder(lightbox.localPath as string)
              : undefined
          }
        />
      )}
    </div>
  )
}
