import {
  app,
  BrowserWindow,
  Notification,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  shell
} from 'electron'
import { basename, join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import { DiscoveryService } from './discovery'
import { HubService, readFileAsDataUrl } from './hub'
import { TransferService, guessMime, isImageMime, sanitizeFileName } from './transfer'
import {
  getDownloadDir,
  getIdentity,
  getSettings,
  setResolvedPorts,
  updateSettings
} from './store'
import { flushHistory, loadHistory, scheduleSaveHistory } from './history'
import { ensureWindowsFirewallRules } from './firewall'
import { isValidIPv4 } from './netinfo'
import { createTray } from './tray'
import {
  AppSettings,
  DEFAULT_HTTP_PORT,
  DEFAULT_WS_PORT,
  IncomingTransferRequest,
  LocalIdentity,
  PORT_RETRY_ATTEMPTS,
  PeerInfo,
  TransferItem
} from '../shared/types'

let mainWindow: BrowserWindow | null = null
let identity: LocalIdentity
let discovery: DiscoveryService
let transfers: TransferService
let hub: HubService
let peersCache: PeerInfo[] = []
let isQuitting = false
const notifiedTransfers = new Set<string>()

function resolveIconPath(): string | undefined {
  return [
    join(__dirname, '../../resources/icon.ico'),
    join(__dirname, '../../build/icon.ico'),
    join(process.resourcesPath, 'icon.ico')
  ].find((p) => existsSync(p))
}

function createWindow(): void {
  const icon = resolveIconPath()
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: '局域网通信软件',
    backgroundColor: '#0d1418',
    show: false,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', (event) => {
    if (isQuitting || !getSettings().minimizeToTray) return
    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

function findPeer(peerId: string): PeerInfo | undefined {
  return peersCache.find((p) => p.id === peerId) || discovery?.getPeer(peerId)
}

function requirePeer(peerId: string): PeerInfo {
  const peer = findPeer(peerId)
  if (!peer) throw new Error('设备不在线或不存在')
  return peer
}

function isAddrInUse(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'EADDRINUSE'
}

/** Falls forward through consecutive ports so a stale process cannot brick startup. */
async function listenWithRetry(
  label: string,
  listen: (port: number) => Promise<number>,
  preferred: number
): Promise<number> {
  for (let offset = 0; offset < PORT_RETRY_ATTEMPTS; offset += 1) {
    try {
      return await listen(preferred + offset)
    } catch (err) {
      if (!isAddrInUse(err)) throw err
    }
  }
  throw new Error(
    `${label}端口 ${preferred}-${preferred + PORT_RETRY_ATTEMPTS - 1} 都被占用，请关闭占用程序后重试`
  )
}

function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body, icon: resolveIconPath() })
  if (onClick) notification.on('click', onClick)
  notification.show()
}

async function bootstrapServices(): Promise<void> {
  identity = getIdentity()
  transfers = new TransferService()
  hub = new HubService(identity, transfers)
  discovery = new DiscoveryService(identity)
  hub.setPeerResolver((peerId) => findPeer(peerId))

  const httpPort = await listenWithRetry('文件传输', (p) => transfers.start(p), identity.httpPort)
  const wsPort = await listenWithRetry('消息服务', (p) => hub.start(p), identity.wsPort)

  setResolvedPorts(httpPort, wsPort)
  identity = getIdentity()
  transfers.setIdentity(identity)
  discovery.updateIdentity(identity)
  hub.updateIdentity(identity)

  const history = loadHistory()
  hub.restoreMessages(history.messages)
  transfers.restore(history.transfers)

  void ensureWindowsFirewallRules(httpPort, wsPort)
  discovery.start()

  discovery.on('peers', (peers: PeerInfo[]) => {
    peersCache = peers
    send('peers:update', peers)
  })
  discovery.on('error', (err: Error) => console.error('[discovery]', err))

  hub.on('messages', (payload) => {
    send('chat:messages', payload)
    persistLater()
  })
  hub.on('message', (msg) => send('chat:message', msg))
  hub.on('peer-connection', (payload) => send('peer:connection', payload))
  hub.on('transfer-request', (request: IncomingTransferRequest) => {
    send('transfer:request', request)
    showWindow()
  })
  hub.on('transfer-request-closed', (requestId: string) =>
    send('transfer:request-closed', requestId)
  )
  hub.on('incoming', ({ peerName, preview }: { peerName: string; preview: string }) => {
    if (!getSettings().notifyOnMessage || mainWindow?.isFocused()) return
    notify(peerName, preview.slice(0, 120), showWindow)
  })

  transfers.on('update', (item: TransferItem) => {
    send('transfer:update', item)
    maybeNotifyTransfer(item)
    persistLater()
  })
  transfers.on('list', (list: TransferItem[]) => send('transfer:list', list))

  watchNetworkChanges()
}

function maybeNotifyTransfer(item: TransferItem): void {
  if (item.status !== 'completed' || item.direction !== 'in') return
  if (notifiedTransfers.has(item.id)) return
  notifiedTransfers.add(item.id)
  if (!getSettings().notifyOnTransfer) return

  notify('已接收文件', `${item.peerName} · ${item.fileName}`, () => {
    if (item.localPath && existsSync(item.localPath)) shell.showItemInFolder(item.localPath)
  })
}

function persistLater(): void {
  scheduleSaveHistory(() => ({
    messages: hub.getAllMessages(),
    transfers: transfers.getTransfers()
  }))
}

/** Switching Wi-Fi changes the local address, so the displayed IP must follow. */
function watchNetworkChanges(): void {
  setInterval(() => {
    const next = getIdentity()
    if (next.ips.join(',') === identity.ips.join(',')) return
    identity = next
    discovery.updateIdentity(identity)
    hub.updateIdentity(identity)
    transfers.setIdentity(identity)
    send('identity:update', identity)
  }, 5000)
}

function writeTempOutbox(fileName: string, data: Buffer): string {
  const dir = join(
    tmpdir(),
    'lancomm-outbox',
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })

  const target = join(dir, sanitizeFileName(fileName))
  writeFileSync(target, data)
  return target
}

function registerIpc(): void {
  ipcMain.handle('app:getIdentity', () => identity)

  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:update', (_e, patch: Partial<AppSettings>) => {
    const next = updateSettings(patch)
    identity = getIdentity()
    discovery.updateIdentity(identity)
    hub.updateIdentity(identity)
    transfers.setIdentity(identity)
    send('identity:update', identity)

    if (typeof patch.autoLaunch === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: patch.autoLaunch, path: process.execPath })
    }
    return next
  })

  ipcMain.handle('settings:chooseDownloadDir', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择接收文件的保存位置'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:setDisplayName', (_e, name: string) => {
    updateSettings({ name })
    identity = getIdentity()
    discovery.updateIdentity(identity)
    hub.updateIdentity(identity)
    transfers.setIdentity(identity)
    return identity
  })

  ipcMain.handle('peers:list', () => discovery.getPeers())

  ipcMain.handle('peers:rescan', () => {
    discovery.rescan()
    return true
  })

  ipcMain.handle('peers:connectByIp', async (_e, rawIp: string) => {
    const ip = String(rawIp || '').trim()
    if (!isValidIPv4(ip)) throw new Error('IP 地址格式不正确')
    if (identity.ips.includes(ip)) throw new Error('不能连接本机 IP')

    const ports = Array.from(
      new Set([identity.wsPort, identity.httpPort, DEFAULT_WS_PORT, DEFAULT_HTTP_PORT])
    )

    for (const port of ports) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2000)
      try {
        const res = await fetch(`http://${ip}:${port}/identity`, { signal: controller.signal })
        if (!res.ok) continue

        const data = (await res.json()) as {
          type?: string
          id?: string
          name?: string
          hostname?: string
          httpPort?: number
          wsPort?: number
        }
        if (data.type !== 'identity' || !data.id || data.id === identity.id) continue

        const peer = discovery.addOrUpdatePeer({
          id: data.id,
          name: data.name || data.hostname || ip,
          hostname: data.hostname || '',
          ip,
          httpPort: data.httpPort || DEFAULT_HTTP_PORT,
          wsPort: data.wsPort || DEFAULT_WS_PORT,
          lastSeen: Date.now(),
          online: true
        })
        peersCache = discovery.getPeers()
        send('peers:update', peersCache)

        await hub.ensureConnected(peer)
        return peer
      } catch {
        // Try the next candidate port.
      } finally {
        clearTimeout(timer)
      }
    }

    throw new Error(`无法连接 ${ip}，请确认对方已打开软件且防火墙已放行`)
  })

  ipcMain.handle('chat:getMessages', (_e, peerId: string) => hub.getMessages(peerId))

  ipcMain.handle('chat:clear', (_e, peerId: string) => {
    hub.clearMessages(peerId)
    persistLater()
    return true
  })

  ipcMain.handle('chat:sendText', (_e, peerId: string, text: string) =>
    hub.sendText(requirePeer(peerId), text.trim())
  )

  ipcMain.handle('chat:connect', async (_e, peerId: string) => {
    await hub.ensureConnected(requirePeer(peerId))
    return { connected: true }
  })

  ipcMain.handle('files:choose', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: '选择要发送的文件'
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(
    'files:send',
    async (_e, peerId: string, filePaths: string[], previewDataUrl?: string) => {
      const peer = requirePeer(peerId)
      const existing = filePaths.filter((p) => existsSync(p))
      if (!existing.length) throw new Error('文件不存在')

      let preview = previewDataUrl
      if (!preview && existing.length === 1) {
        const name = basename(existing[0])
        if (isImageMime(guessMime(name), name)) preview = readFileAsDataUrl(existing[0])
      }
      return hub.sendFiles(peer, existing, { previewDataUrl: preview })
    }
  )

  ipcMain.handle(
    'files:sendBuffer',
    async (
      _e,
      peerId: string,
      payload: { fileName: string; mimeType: string; base64: string }
    ) => {
      const peer = requirePeer(peerId)
      const buf = Buffer.from(payload.base64, 'base64')
      const tempPath = writeTempOutbox(payload.fileName || 'file', buf)

      const preview =
        payload.mimeType.startsWith('image/') && buf.length < 400_000
          ? `data:${payload.mimeType};base64,${payload.base64}`
          : undefined

      return hub.sendFiles(peer, [tempPath], {
        previewDataUrl: preview,
        fileName: basename(tempPath),
        mimeType: payload.mimeType
      })
    }
  )

  ipcMain.handle('clipboard:send', async (_e, peerId: string) => {
    const peer = requirePeer(peerId)

    const image = clipboard.readImage()
    if (!image.isEmpty()) {
      const buf = image.toPNG()
      const tempPath = writeTempOutbox(`clipboard-${Date.now()}.png`, buf)
      return hub.sendFiles(peer, [tempPath], {
        previewDataUrl:
          buf.length < 400_000 ? `data:image/png;base64,${buf.toString('base64')}` : undefined,
        fileName: basename(tempPath),
        mimeType: 'image/png'
      })
    }

    const text = clipboard.readText().trim()
    if (!text) throw new Error('剪贴板为空')
    return hub.sendText(peer, text)
  })

  ipcMain.handle('transfers:list', () => transfers.getTransfers())

  ipcMain.handle('transfers:cancel', (_e, transferId: string) => {
    hub.cancelTransfer(transferId)
    return true
  })

  ipcMain.handle(
    'transfers:respond',
    (_e, requestId: string, accept: boolean, trust: boolean) => {
      hub.respondToRequest(requestId, accept, trust)
      return true
    }
  )

  ipcMain.handle('shell:openPath', async (_e, targetPath: string) => {
    if (!targetPath || !existsSync(targetPath)) return { ok: false }
    await shell.openPath(targetPath)
    return { ok: true }
  })

  ipcMain.handle('shell:showItemInFolder', (_e, targetPath: string) => {
    if (!targetPath || !existsSync(targetPath)) return { ok: false }
    shell.showItemInFolder(targetPath)
    return { ok: true }
  })

  ipcMain.handle('shell:openDownloadDir', async () => {
    const dir = getDownloadDir()
    await shell.openPath(dir)
    return dir
  })
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lop2p',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  }
])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.lop2p.app')

    // Only files this app produced or received may be served to the renderer.
    protocol.handle('lop2p', (request) => {
      const filePath = new URL(request.url).searchParams.get('path') || ''
      if (!filePath || !existsSync(filePath) || !transfers?.isKnownPath(filePath)) {
        return new Response('Not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(filePath).href)
    })

    try {
      await bootstrapServices()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      dialog.showErrorBox('局域网通信软件启动失败', message)
      app.exit(1)
      return
    }

    registerIpc()
    createWindow()
    createTray({
      iconPath: resolveIconPath(),
      onShow: showWindow,
      onQuit: () => {
        isQuitting = true
        app.quit()
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
  if (hub && transfers) {
    flushHistory(() => ({
      messages: hub.getAllMessages(),
      transfers: transfers.getTransfers()
    }))
  }
  discovery?.stop()
  hub?.stop()
  transfers?.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !getSettings().minimizeToTray) app.quit()
})
