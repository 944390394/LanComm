import { createReadStream, createWriteStream, existsSync, rmSync, statSync } from 'fs'
import { basename, join, resolve, sep } from 'path'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import {
  ACCEPT_TIMEOUT_MS,
  CHUNK_SIZE,
  LocalIdentity,
  MAX_TRANSFERS,
  TRANSFER_TOTAL_HEADER,
  TransferItem
} from '../shared/types'
import { getDownloadDir } from './store'
import { normalizeIp } from './netinfo'

const PROGRESS_INTERVAL_MS = 200

interface OutgoingParams {
  peerId: string
  peerName: string
  peerIp: string
  filePath: string
  fileName?: string
  mimeType?: string
}

interface IncomingOffer {
  transferId: string
  peerId: string
  peerName: string
  peerIp: string
  fileName: string
  fileSize: number
  mimeType: string
}

interface ActiveWrite {
  stream: ReturnType<typeof createWriteStream>
  request: IncomingMessage
}

export class TransferService extends EventEmitter {
  private server: Server | null = null
  private port = 0
  private identity: LocalIdentity | null = null
  private transfers = new Map<string, TransferItem>()
  private pendingAccept = new Map<
    string,
    { resolve: (ok: boolean) => void; reject: (err: Error) => void }
  >()
  private activeWrites = new Map<string, ActiveWrite>()
  private activeUploads = new Map<string, AbortController>()

  setIdentity(identity: LocalIdentity): void {
    this.identity = identity
  }

  start(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res)
      })
      this.server = server
      server.on('error', reject)
      server.listen(port, '0.0.0.0', () => {
        const addr = server.address()
        this.port = typeof addr === 'object' && addr ? addr.port : port
        resolve(this.port)
      })
    })
  }

  stop(): void {
    for (const controller of this.activeUploads.values()) controller.abort()
    this.activeUploads.clear()
    for (const { stream, request } of this.activeWrites.values()) {
      request.destroy()
      stream.destroy()
    }
    this.activeWrites.clear()
    this.server?.close()
    this.server = null
  }

  getTransfers(): TransferItem[] {
    return Array.from(this.transfers.values()).sort((a, b) => b.createdAt - a.createdAt)
  }

  getTransfer(id: string): TransferItem | undefined {
    return this.transfers.get(id)
  }

  restore(items: TransferItem[]): void {
    for (const item of items) this.transfers.set(item.id, item)
  }

  /** Whitelist source for the lop2p:// protocol handler. */
  isKnownPath(target: string): boolean {
    const normalized = resolve(target).toLowerCase()
    const downloadRoot = resolve(getDownloadDir()).toLowerCase()
    if (normalized.startsWith(downloadRoot + sep)) return true

    for (const item of this.transfers.values()) {
      if (item.localPath && resolve(item.localPath).toLowerCase() === normalized) return true
    }
    return false
  }

  upsert(item: TransferItem): void {
    this.transfers.set(item.id, item)
    this.trim()
    this.emit('update', item)
    this.emit('list', this.getTransfers())
  }

  markAccepted(transferId: string): void {
    const pending = this.pendingAccept.get(transferId)
    if (pending) {
      this.pendingAccept.delete(transferId)
      pending.resolve(true)
    }
  }

  markRejected(transferId: string, reason?: string): void {
    const pending = this.pendingAccept.get(transferId)
    if (pending) {
      this.pendingAccept.delete(transferId)
      pending.reject(new Error(reason || '对方拒绝接收'))
    }
    if (this.transfers.has(transferId)) {
      this.patch(transferId, { status: 'cancelled', error: reason || '已取消', speedBps: 0 })
    }
  }

  waitForAccept(transferId: string, timeoutMs = ACCEPT_TIMEOUT_MS): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAccept.delete(transferId)
        reject(new Error('等待对方接受超时'))
      }, timeoutMs)

      this.pendingAccept.set(transferId, {
        resolve: (ok) => {
          clearTimeout(timer)
          resolve(ok)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })
    })
  }

  cancel(transferId: string): boolean {
    const item = this.transfers.get(transferId)
    if (!item) return false

    this.activeUploads.get(transferId)?.abort()
    this.activeUploads.delete(transferId)

    const active = this.activeWrites.get(transferId)
    if (active) {
      active.request.destroy()
      active.stream.destroy()
      this.activeWrites.delete(transferId)
      if (item.localPath) safeUnlink(item.localPath)
    }

    this.markRejected(transferId, '已取消')
    return true
  }

  prepareOutgoing(params: OutgoingParams): TransferItem {
    const stats = statSync(params.filePath)
    const fileName = sanitizeFileName(params.fileName || basename(params.filePath))
    const item: TransferItem = {
      id: uuidv4(),
      peerId: params.peerId,
      peerName: params.peerName,
      peerIp: params.peerIp,
      direction: 'out',
      fileName,
      fileSize: stats.size,
      mimeType: params.mimeType || guessMime(fileName),
      transferred: 0,
      status: 'pending',
      speedBps: 0,
      localPath: params.filePath,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.upsert(item)
    return item
  }

  prepareIncoming(offer: IncomingOffer): TransferItem {
    const safeName = sanitizeFileName(offer.fileName)
    const localPath = uniquePath(join(getDownloadDir(), safeName))
    const item: TransferItem = {
      id: offer.transferId,
      peerId: offer.peerId,
      peerName: offer.peerName,
      peerIp: offer.peerIp,
      direction: 'in',
      fileName: safeName,
      fileSize: offer.fileSize,
      mimeType: offer.mimeType,
      transferred: 0,
      status: 'pending',
      speedBps: 0,
      localPath,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.upsert(item)
    return item
  }

  /**
   * Sends the whole file as one streamed request. An earlier version issued a separate
   * request per 512 KB chunk, which made large files hundreds of round trips slower.
   */
  async pushFile(params: {
    peerHttpBase: string
    transferId: string
    filePath: string
  }): Promise<void> {
    const item = this.transfers.get(params.transferId)
    if (!item) throw new Error('传输不存在')

    const total = statSync(params.filePath).size
    this.patch(params.transferId, {
      status: 'transferring',
      transferred: 0,
      speedBps: 0,
      fileSize: total
    })

    const controller = new AbortController()
    this.activeUploads.set(params.transferId, controller)

    const fileStream = createReadStream(params.filePath, { highWaterMark: CHUNK_SIZE })
    const iterator = fileStream[Symbol.asyncIterator]()

    let sent = 0
    let lastTick = Date.now()
    let lastBytes = 0

    const body = new ReadableStream<Uint8Array>({
      pull: async (controllerRef) => {
        const { value, done } = await iterator.next()
        if (done) {
          controllerRef.close()
          return
        }
        const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
        controllerRef.enqueue(new Uint8Array(buffer))

        sent += buffer.length
        const now = Date.now()
        if (now - lastTick >= PROGRESS_INTERVAL_MS || sent >= total) {
          const speed = ((sent - lastBytes) * 1000) / Math.max(1, now - lastTick)
          lastTick = now
          lastBytes = sent
          this.patch(params.transferId, {
            transferred: sent,
            speedBps: speed,
            status: 'transferring'
          })
        }
      },
      cancel: () => {
        fileStream.destroy()
      }
    })

    try {
      const res = await fetch(`${params.peerHttpBase}/transfer/${params.transferId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          [TRANSFER_TOTAL_HEADER]: String(total)
        },
        body,
        signal: controller.signal,
        duplex: 'half'
      } as RequestInit & { duplex: 'half' })

      if (!res.ok) {
        throw new Error((await res.text()) || `上传失败 HTTP ${res.status}`)
      }

      this.patch(params.transferId, { transferred: total, status: 'completed', speedBps: 0 })
    } catch (err) {
      const aborted = controller.signal.aborted
      const message = aborted ? '已取消' : err instanceof Error ? err.message : String(err)
      this.patch(params.transferId, {
        status: aborted ? 'cancelled' : 'failed',
        error: message,
        speedBps: 0
      })
      throw err
    } finally {
      fileStream.destroy()
      this.activeUploads.delete(params.transferId)
    }
  }

  private trim(): void {
    if (this.transfers.size <= MAX_TRANSFERS) return
    const ordered = this.getTransfers()
    for (const item of ordered.slice(MAX_TRANSFERS)) {
      this.transfers.delete(item.id)
    }
  }

  private patch(id: string, partial: Partial<TransferItem>): void {
    const current = this.transfers.get(id)
    if (!current) return
    this.upsert({ ...current, ...partial, updatedAt: Date.now() })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

      if (url.pathname === '/identity' && req.method === 'GET') {
        if (!this.identity) {
          res.writeHead(503)
          res.end('Not ready')
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(
          JSON.stringify({
            type: 'identity',
            id: this.identity.id,
            name: this.identity.name,
            hostname: this.identity.hostname,
            httpPort: this.identity.httpPort || this.port,
            wsPort: this.identity.wsPort
          })
        )
        return
      }

      const match = url.pathname.match(/^\/transfer\/([^/]+)$/)
      if (!match || req.method !== 'POST') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      await this.receiveFile(decodeURIComponent(match[1]), req, res)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!res.headersSent) res.writeHead(500)
      res.end(message)
    }
  }

  private async receiveFile(
    transferId: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const item = this.transfers.get(transferId)
    if (!item || item.direction !== 'in' || !item.localPath || item.status !== 'pending') {
      res.writeHead(404)
      res.end('Unknown transfer')
      return
    }

    // Only the peer that made the accepted offer may upload into this slot.
    if (!item.peerIp || normalizeIp(req.socket.remoteAddress) !== item.peerIp) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    const declared = Number(req.headers[TRANSFER_TOTAL_HEADER]) || item.fileSize
    const limit = Math.max(declared, item.fileSize)
    const fileStream = createWriteStream(item.localPath, { flags: 'w' })
    this.activeWrites.set(transferId, { stream: fileStream, request: req })
    this.patch(transferId, { status: 'transferring', transferred: 0, fileSize: declared })

    let received = 0
    let lastTick = Date.now()
    let lastBytes = 0

    const counter = new Transform({
      transform: (chunk: Buffer, _enc, done) => {
        received += chunk.length
        if (limit > 0 && received > limit) {
          done(new Error('数据超出声明大小'))
          return
        }

        const now = Date.now()
        if (now - lastTick >= PROGRESS_INTERVAL_MS) {
          const speed = ((received - lastBytes) * 1000) / Math.max(1, now - lastTick)
          lastTick = now
          lastBytes = received
          this.patch(transferId, {
            transferred: received,
            speedBps: speed,
            status: 'transferring'
          })
        }
        done(null, chunk)
      }
    })

    try {
      await pipeline(req, counter, fileStream)
      this.activeWrites.delete(transferId)
      this.patch(transferId, {
        transferred: received,
        fileSize: received,
        status: 'completed',
        speedBps: 0
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, transferred: received }))
    } catch (err) {
      this.activeWrites.delete(transferId)
      fileStream.destroy()
      if (item.localPath) safeUnlink(item.localPath)

      const message = err instanceof Error ? err.message : String(err)
      const current = this.transfers.get(transferId)
      if (current && current.status !== 'cancelled') {
        this.patch(transferId, { status: 'failed', error: message, speedBps: 0 })
      }
      if (!res.headersSent) {
        res.writeHead(500)
        res.end(message)
      }
    }
  }
}

function safeUnlink(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // The partial file may already be gone; nothing to recover here.
  }
}

// Control characters are stripped on purpose: a peer must not be able to smuggle
// separators or terminal escapes into a path we create.
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(UNSAFE_FILENAME_CHARS, '_').replace(/^\.+/, '').trim()
  return cleaned.slice(0, 180) || 'file'
}

function uniquePath(path: string): string {
  if (!existsSync(path)) return path
  const dot = path.lastIndexOf('.')
  const hasExt = dot > path.lastIndexOf('\\') && dot > path.lastIndexOf('/')
  const base = hasExt ? path.slice(0, dot) : path
  const ext = hasExt ? path.slice(dot) : ''
  let i = 1
  while (existsSync(`${base} (${i})${ext}`)) i += 1
  return `${base} (${i})${ext}`
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  txt: 'text/plain',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg'
}

export function guessMime(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() || ''
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

export function isImageMime(mime: string, fileName: string): boolean {
  return mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName)
}
