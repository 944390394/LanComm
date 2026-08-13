import { EventEmitter } from 'events'
import { createServer, Server as HttpServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { readFileSync, unlinkSync } from 'fs'
import { basename } from 'path'
import { v4 as uuidv4 } from 'uuid'
import {
  ACCEPT_TIMEOUT_MS,
  ACK_TIMEOUT_MS,
  ChatMessage,
  IncomingTransferRequest,
  LocalIdentity,
  MAX_MESSAGES_PER_PEER,
  PROTOCOL_VERSION,
  PeerInfo,
  TransferItem,
  WS_PROTOCOL_HEADER,
  WsEnvelope
} from '../shared/types'
import { TransferService, guessMime, isImageMime } from './transfer'
import { getSettings, isTrustedPeer, trustPeer } from './store'
import { normalizeIp } from './netinfo'
import { parseEnvelope } from './validate'

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000]
const CONNECT_TIMEOUT_MS = 8000

interface PeerSocket {
  ws: WebSocket
  peerId: string
  peerName: string
  ip: string
}

interface PendingRequest {
  peerId: string
  resolve: (accepted: boolean) => void
  timer: NodeJS.Timeout
}

export class HubService extends EventEmitter {
  private httpServer: HttpServer | null = null
  private wss: WebSocketServer | null = null
  private port = 0
  private identity: LocalIdentity
  private transfers: TransferService
  private outbound = new Map<string, PeerSocket>()
  private inbound = new Map<string, PeerSocket>()
  private messages = new Map<string, ChatMessage[]>()
  private ackWaiters = new Map<string, { resolve: (ok: boolean) => void; timer: NodeJS.Timeout }>()
  private pendingRequests = new Map<string, PendingRequest>()
  private reconnectTimers = new Map<string, NodeJS.Timeout>()
  private reconnectAttempts = new Map<string, number>()
  private peerResolver: (peerId: string) => PeerInfo | undefined = () => undefined
  private stopped = false

  constructor(identity: LocalIdentity, transfers: TransferService) {
    super()
    this.identity = identity
    this.transfers = transfers
  }

  updateIdentity(identity: LocalIdentity): void {
    this.identity = identity
  }

  setPeerResolver(resolver: (peerId: string) => PeerInfo | undefined): void {
    this.peerResolver = resolver
  }

  start(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const httpServer = createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
        if (url.pathname === '/identity') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(
            JSON.stringify({
              type: 'identity',
              id: this.identity.id,
              name: this.identity.name,
              hostname: this.identity.hostname,
              httpPort: this.identity.httpPort,
              wsPort: this.identity.wsPort || this.port
            })
          )
          return
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
      })

      const wss = new WebSocketServer({
        server: httpServer,
        // Web pages can open a WebSocket to any LAN address but cannot set custom
        // headers and always send an Origin, so both checks keep browsers out.
        verifyClient: ({ origin, req }, done) => {
          if (origin) {
            done(false, 403, 'Forbidden')
            return
          }
          if (req.headers[WS_PROTOCOL_HEADER] !== PROTOCOL_VERSION) {
            done(false, 426, 'Unsupported protocol')
            return
          }
          done(true)
        }
      })

      this.httpServer = httpServer
      this.wss = wss

      wss.on('connection', (ws, req) => {
        const ip = normalizeIp(req.socket.remoteAddress)
        let peerId = ''
        ws.on('message', (raw) => {
          void this.onSocketMessage(ws, raw.toString('utf-8'), true, ip).then((id) => {
            if (id) peerId = id
          })
        })
        ws.on('close', () => {
          if (!peerId) return
          this.inbound.delete(peerId)
          this.emit('peer-connection', { peerId, connected: this.isConnected(peerId) })
        })
        ws.on('error', () => ws.close())
      })

      httpServer.on('error', reject)
      httpServer.listen(port, '0.0.0.0', () => {
        const addr = httpServer.address()
        this.port = typeof addr === 'object' && addr ? addr.port : port
        resolve(this.port)
      })
    })
  }

  stop(): void {
    this.stopped = true
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer)
    this.reconnectTimers.clear()
    for (const waiter of this.ackWaiters.values()) clearTimeout(waiter.timer)
    this.ackWaiters.clear()
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timer)
      request.resolve(false)
    }
    this.pendingRequests.clear()

    for (const s of this.outbound.values()) s.ws.close()
    for (const s of this.inbound.values()) s.ws.close()
    this.outbound.clear()
    this.inbound.clear()
    this.wss?.close()
    this.httpServer?.close()
    this.wss = null
    this.httpServer = null
  }

  getMessages(peerId: string): ChatMessage[] {
    return this.messages.get(peerId) || []
  }

  getAllMessages(): Record<string, ChatMessage[]> {
    return Object.fromEntries(this.messages)
  }

  restoreMessages(saved: Record<string, ChatMessage[]>): void {
    for (const [peerId, list] of Object.entries(saved)) {
      this.messages.set(peerId, list)
    }
  }

  clearMessages(peerId: string): void {
    this.messages.delete(peerId)
    this.emit('messages', { peerId, messages: [] })
  }

  isConnected(peerId: string): boolean {
    return this.getLiveSocket(peerId) !== null
  }

  async ensureConnected(peer: PeerInfo): Promise<void> {
    if (this.getLiveSocket(peer.id)) return
    await this.connectOutbound(peer)
  }

  async sendText(peer: PeerInfo, text: string): Promise<ChatMessage> {
    const msg: ChatMessage = {
      id: uuidv4(),
      peerId: peer.id,
      direction: 'out',
      kind: 'text',
      text,
      deliveryStatus: 'pending',
      createdAt: Date.now()
    }
    this.pushMessage(msg)

    try {
      await this.ensureConnected(peer)

      const ack = this.waitForAck(msg.id)
      const sent = this.send(peer.id, {
        type: 'chat.text',
        id: msg.id,
        text,
        createdAt: msg.createdAt
      })

      if (!sent) {
        this.resolveAck(msg.id, false)
        this.patchMessage(peer.id, msg.id, { deliveryStatus: 'failed' })
      } else {
        this.patchMessage(peer.id, msg.id, {
          deliveryStatus: (await ack) ? 'delivered' : 'failed'
        })
      }
    } catch {
      this.patchMessage(peer.id, msg.id, { deliveryStatus: 'failed' })
    }

    return this.getMessage(peer.id, msg.id) || msg
  }

  async sendFiles(
    peer: PeerInfo,
    filePaths: string[],
    options?: { previewDataUrl?: string; fileName?: string; mimeType?: string }
  ): Promise<ChatMessage[]> {
    const results: ChatMessage[] = []

    for (const filePath of filePaths) {
      const item = this.transfers.prepareOutgoing({
        peerId: peer.id,
        peerName: peer.name,
        peerIp: peer.ip,
        filePath,
        fileName: filePaths.length === 1 ? options?.fileName : undefined,
        mimeType: filePaths.length === 1 ? options?.mimeType : undefined
      })
      const image = isImageMime(item.mimeType, item.fileName)
      const kind = image ? 'image' : 'file'

      const chat: ChatMessage = {
        id: uuidv4(),
        peerId: peer.id,
        direction: 'out',
        kind,
        fileName: item.fileName,
        fileSize: item.fileSize,
        mimeType: item.mimeType,
        localPath: filePath,
        transferId: item.id,
        previewDataUrl: image ? options?.previewDataUrl : undefined,
        deliveryStatus: 'pending',
        createdAt: Date.now()
      }
      this.pushMessage(chat)
      results.push(chat)

      try {
        await this.ensureConnected(peer)
      } catch {
        this.failOutgoing(peer.id, chat.id, item.id, filePath, '未连接')
        continue
      }

      const acceptPromise = this.transfers.waitForAccept(item.id)
      const offered = this.send(peer.id, {
        type: 'transfer.offer',
        transferId: item.id,
        fileName: item.fileName,
        fileSize: item.fileSize,
        mimeType: item.mimeType,
        kind,
        createdAt: chat.createdAt
      })

      if (!offered) {
        acceptPromise.catch(() => undefined)
        this.failOutgoing(peer.id, chat.id, item.id, filePath, '未连接')
        continue
      }

      if (image && options?.previewDataUrl) {
        this.send(peer.id, {
          type: 'chat.image',
          id: chat.id,
          transferId: item.id,
          fileName: item.fileName,
          fileSize: item.fileSize,
          mimeType: item.mimeType,
          previewDataUrl: options.previewDataUrl,
          createdAt: chat.createdAt
        })
      }

      void this.runOutgoingTransfer(peer, item, acceptPromise, chat.id)
    }

    return results
  }

  respondToRequest(requestId: string, accept: boolean, trust: boolean): void {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) return
    this.pendingRequests.delete(requestId)
    clearTimeout(pending.timer)
    if (accept && trust) trustPeer(pending.peerId)
    pending.resolve(accept)
  }

  cancelTransfer(transferId: string): void {
    const item = this.transfers.getTransfer(transferId)
    this.transfers.cancel(transferId)
    if (item) {
      this.send(item.peerId, { type: 'transfer.cancel', transferId })
    }
  }

  private failOutgoing(
    peerId: string,
    chatId: string,
    transferId: string,
    filePath: string,
    reason: string
  ): void {
    this.patchMessage(peerId, chatId, { deliveryStatus: 'failed' })
    this.transfers.markRejected(transferId, reason)
    cleanupOutboxTemp(filePath)
  }

  private async runOutgoingTransfer(
    peer: PeerInfo,
    item: TransferItem,
    acceptPromise: Promise<boolean>,
    chatId: string
  ): Promise<void> {
    try {
      await acceptPromise
      if (!item.localPath) throw new Error('文件路径丢失')

      await this.transfers.pushFile({
        peerHttpBase: `http://${peer.ip}:${peer.httpPort}`,
        transferId: item.id,
        filePath: item.localPath
      })
      this.send(peer.id, { type: 'transfer.done', transferId: item.id, ok: true })
      this.patchMessage(peer.id, chatId, { deliveryStatus: 'delivered' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.send(peer.id, {
        type: 'transfer.done',
        transferId: item.id,
        ok: false,
        error: message
      })
      this.patchMessage(peer.id, chatId, { deliveryStatus: 'failed' })
    } finally {
      cleanupOutboxTemp(item.localPath)
    }
  }

  private connectOutbound(peer: PeerInfo): Promise<void> {
    return new Promise((resolve, reject) => {
      const existing = this.outbound.get(peer.id)
      if (existing && existing.ws.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      const ws = new WebSocket(`ws://${peer.ip}:${peer.wsPort}`, {
        headers: { [WS_PROTOCOL_HEADER]: PROTOCOL_VERSION }
      })
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        ws.close()
        reject(new Error('连接对端超时'))
      }, CONNECT_TIMEOUT_MS)

      ws.on('open', () => {
        clearTimeout(timer)
        this.reconnectAttempts.delete(peer.id)
        this.outbound.set(peer.id, {
          ws,
          peerId: peer.id,
          peerName: peer.name,
          ip: peer.ip
        })
        this.sendRaw(ws, {
          type: 'hello',
          id: this.identity.id,
          name: this.identity.name,
          hostname: this.identity.hostname
        })
        this.emit('peer-connection', { peerId: peer.id, connected: true })
        if (!settled) {
          settled = true
          resolve()
        }
      })

      ws.on('message', (raw) => {
        void this.onSocketMessage(ws, raw.toString('utf-8'), false, peer.ip)
      })

      ws.on('error', (err) => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(err)
        }
      })

      ws.on('close', () => {
        clearTimeout(timer)
        this.outbound.delete(peer.id)
        this.emit('peer-connection', {
          peerId: peer.id,
          connected: this.isConnected(peer.id)
        })
        this.scheduleReconnect(peer.id)
      })
    })
  }

  private scheduleReconnect(peerId: string): void {
    if (this.stopped || this.reconnectTimers.has(peerId)) return

    const attempt = this.reconnectAttempts.get(peerId) ?? 0
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
    this.reconnectAttempts.set(peerId, attempt + 1)

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(peerId)
      if (this.stopped || this.isConnected(peerId)) return

      const peer = this.peerResolver(peerId)
      if (!peer || !peer.online) {
        this.reconnectAttempts.delete(peerId)
        return
      }
      this.connectOutbound(peer).catch(() => this.scheduleReconnect(peerId))
    }, delay)

    this.reconnectTimers.set(peerId, timer)
  }

  private async onSocketMessage(
    ws: WebSocket,
    raw: string,
    fromServer: boolean,
    ip: string
  ): Promise<string | null> {
    const data = parseEnvelope(raw)
    if (!data) return null

    if (data.type === 'hello') {
      const sock: PeerSocket = { ws, peerId: data.id, peerName: data.name, ip }
      if (fromServer) {
        this.inbound.set(data.id, sock)
        this.sendRaw(ws, {
          type: 'hello',
          id: this.identity.id,
          name: this.identity.name,
          hostname: this.identity.hostname
        })
      } else {
        this.outbound.set(data.id, sock)
      }
      this.emit('peer-connection', { peerId: data.id, connected: true })
      return data.id
    }

    const peerId = this.findPeerIdBySocket(ws)
    if (!peerId) return null

    switch (data.type) {
      case 'chat.text': {
        this.pushMessage({
          id: data.id,
          peerId,
          direction: 'in',
          kind: 'text',
          text: data.text,
          deliveryStatus: 'delivered',
          createdAt: data.createdAt
        })
        this.send(peerId, { type: 'chat.ack', id: data.id })
        this.emit('incoming', { peerId, peerName: this.peerName(peerId), preview: data.text })
        break
      }

      case 'chat.ack': {
        this.resolveAck(data.id, true)
        break
      }

      case 'chat.image': {
        const existing = this.getMessages(peerId).find(
          (m) => m.transferId === data.transferId || m.id === data.id
        )
        if (existing) {
          Object.assign(existing, {
            kind: 'image' as const,
            previewDataUrl: data.previewDataUrl || existing.previewDataUrl,
            fileName: data.fileName,
            fileSize: data.fileSize,
            mimeType: data.mimeType,
            transferId: data.transferId
          })
          this.emit('messages', { peerId, messages: this.getMessages(peerId) })
        } else {
          this.pushMessage({
            id: data.id,
            peerId,
            direction: 'in',
            kind: 'image',
            fileName: data.fileName,
            fileSize: data.fileSize,
            mimeType: data.mimeType,
            transferId: data.transferId,
            previewDataUrl: data.previewDataUrl,
            localPath: this.transfers.getTransfer(data.transferId)?.localPath,
            createdAt: data.createdAt
          })
        }
        break
      }

      case 'transfer.offer': {
        await this.handleOffer(peerId, ip, data)
        break
      }

      case 'transfer.accept': {
        this.transfers.markAccepted(data.transferId)
        break
      }

      case 'transfer.reject': {
        this.transfers.markRejected(data.transferId, data.reason)
        break
      }

      case 'transfer.cancel': {
        this.transfers.cancel(data.transferId)
        break
      }

      case 'transfer.progress': {
        const current = this.transfers.getTransfer(data.transferId)
        if (current) {
          this.transfers.upsert({
            ...current,
            transferred: data.transferred,
            speedBps: data.speedBps,
            status: 'transferring',
            updatedAt: Date.now()
          })
        }
        break
      }

      case 'transfer.done': {
        const current = this.transfers.getTransfer(data.transferId)
        if (current && current.status !== 'completed' && current.status !== 'cancelled') {
          this.transfers.upsert({
            ...current,
            status: data.ok ? 'completed' : 'failed',
            error: data.error,
            speedBps: 0,
            updatedAt: Date.now()
          })
        }
        if (data.ok && current?.localPath) {
          const list = this.getMessages(peerId)
          for (const m of list) {
            if (m.transferId === data.transferId) m.localPath = current.localPath
          }
          this.emit('messages', { peerId, messages: list })
        }
        break
      }

      default:
        break
    }

    return peerId
  }

  private async handleOffer(
    peerId: string,
    ip: string,
    data: Extract<WsEnvelope, { type: 'transfer.offer' }>
  ): Promise<void> {
    const peerName = this.peerName(peerId)
    const accepted = await this.decideAcceptance(peerId, peerName, data)

    if (!accepted) {
      this.send(peerId, {
        type: 'transfer.reject',
        transferId: data.transferId,
        reason: '对方拒绝接收'
      })
      return
    }

    const item = this.transfers.prepareIncoming({
      transferId: data.transferId,
      peerId,
      peerName,
      peerIp: ip,
      fileName: data.fileName,
      fileSize: data.fileSize,
      mimeType: data.mimeType
    })
    this.send(peerId, { type: 'transfer.accept', transferId: data.transferId })

    const existing = this.getMessages(peerId).find((m) => m.transferId === item.id)
    if (existing) {
      Object.assign(existing, {
        localPath: item.localPath,
        fileName: item.fileName,
        fileSize: item.fileSize,
        mimeType: item.mimeType
      })
      this.emit('messages', { peerId, messages: this.getMessages(peerId) })
    } else {
      this.pushMessage({
        id: uuidv4(),
        peerId,
        direction: 'in',
        kind: data.kind === 'image' ? 'image' : 'file',
        fileName: item.fileName,
        fileSize: item.fileSize,
        mimeType: item.mimeType,
        localPath: item.localPath,
        transferId: item.id,
        createdAt: data.createdAt
      })
    }
  }

  private decideAcceptance(
    peerId: string,
    peerName: string,
    data: Extract<WsEnvelope, { type: 'transfer.offer' }>
  ): Promise<boolean> {
    const mode = getSettings().autoAcceptMode
    if (mode === 'always') return Promise.resolve(true)
    if (mode === 'trusted' && isTrustedPeer(peerId)) return Promise.resolve(true)

    const request: IncomingTransferRequest = {
      requestId: uuidv4(),
      peerId,
      peerName,
      fileName: data.fileName,
      fileSize: data.fileSize,
      mimeType: data.mimeType,
      createdAt: Date.now()
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.requestId)
        this.emit('transfer-request-closed', request.requestId)
        resolve(false)
      }, ACCEPT_TIMEOUT_MS)

      this.pendingRequests.set(request.requestId, { peerId, resolve, timer })
      this.emit('transfer-request', request)
    })
  }

  private peerName(peerId: string): string {
    return (
      this.inbound.get(peerId)?.peerName ||
      this.outbound.get(peerId)?.peerName ||
      this.peerResolver(peerId)?.name ||
      '对端'
    )
  }

  private findPeerIdBySocket(ws: WebSocket): string | null {
    for (const [id, s] of this.inbound) if (s.ws === ws) return id
    for (const [id, s] of this.outbound) if (s.ws === ws) return id
    return null
  }

  private getLiveSocket(peerId: string): PeerSocket | null {
    const outbound = this.outbound.get(peerId)
    if (outbound && outbound.ws.readyState === WebSocket.OPEN) return outbound
    const inbound = this.inbound.get(peerId)
    if (inbound && inbound.ws.readyState === WebSocket.OPEN) return inbound
    return null
  }

  private send(peerId: string, envelope: WsEnvelope): boolean {
    const sock = this.getLiveSocket(peerId)
    return sock ? this.sendRaw(sock.ws, envelope) : false
  }

  private sendRaw(ws: WebSocket, envelope: WsEnvelope): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false
    try {
      ws.send(JSON.stringify(envelope))
      return true
    } catch {
      return false
    }
  }

  private waitForAck(messageId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.ackWaiters.delete(messageId)
        resolve(false)
      }, ACK_TIMEOUT_MS)
      this.ackWaiters.set(messageId, { resolve, timer })
    })
  }

  private resolveAck(messageId: string, ok: boolean): void {
    const waiter = this.ackWaiters.get(messageId)
    if (!waiter) return
    this.ackWaiters.delete(messageId)
    clearTimeout(waiter.timer)
    waiter.resolve(ok)
  }

  private getMessage(peerId: string, messageId: string): ChatMessage | undefined {
    return this.getMessages(peerId).find((m) => m.id === messageId)
  }

  private patchMessage(peerId: string, messageId: string, partial: Partial<ChatMessage>): void {
    const list = this.getMessages(peerId)
    const idx = list.findIndex((m) => m.id === messageId)
    if (idx < 0) return
    list[idx] = { ...list[idx], ...partial }
    this.messages.set(peerId, list)
    this.emit('message', list[idx])
    this.emit('messages', { peerId, messages: list })
  }

  private pushMessage(msg: ChatMessage): void {
    const list = this.messages.get(msg.peerId) || []
    list.push(msg)
    if (list.length > MAX_MESSAGES_PER_PEER) {
      list.splice(0, list.length - MAX_MESSAGES_PER_PEER)
    }
    this.messages.set(msg.peerId, list)
    this.emit('message', msg)
    this.emit('messages', { peerId: msg.peerId, messages: list })
  }
}

export function readFileAsDataUrl(filePath: string, maxBytes = 400_000): string | undefined {
  try {
    const buf = readFileSync(filePath)
    if (buf.length > maxBytes) return undefined
    return `data:${guessMime(basename(filePath))};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

function cleanupOutboxTemp(filePath?: string): void {
  if (!filePath || !filePath.includes('lancomm-outbox')) return
  try {
    unlinkSync(filePath)
  } catch {
    // The temp file may already be gone after a failed send.
  }
}
