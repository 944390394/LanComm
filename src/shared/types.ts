export interface PeerInfo {
  id: string
  name: string
  hostname: string
  ip: string
  httpPort: number
  wsPort: number
  lastSeen: number
  online: boolean
}

export type AutoAcceptMode = 'always' | 'trusted' | 'ask'

export interface AppSettings {
  name: string
  downloadDir: string
  httpPort: number
  wsPort: number
  autoAcceptMode: AutoAcceptMode
  trustedPeerIds: string[]
  notifyOnMessage: boolean
  notifyOnTransfer: boolean
  minimizeToTray: boolean
  autoLaunch: boolean
}

export interface LocalIdentity {
  id: string
  name: string
  hostname: string
  ips: string[]
  httpPort: number
  wsPort: number
  downloadDir: string
}

export type MessageKind = 'text' | 'image' | 'file' | 'system'

export type TransferStatus =
  | 'pending'
  | 'transferring'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type DeliveryStatus = 'pending' | 'delivered' | 'failed'

export interface ChatMessage {
  id: string
  peerId: string
  direction: 'in' | 'out'
  kind: MessageKind
  text?: string
  fileName?: string
  fileSize?: number
  mimeType?: string
  localPath?: string
  transferId?: string
  previewDataUrl?: string
  deliveryStatus?: DeliveryStatus
  createdAt: number
}

export interface TransferItem {
  id: string
  peerId: string
  peerName: string
  peerIp?: string
  direction: 'in' | 'out'
  fileName: string
  fileSize: number
  mimeType: string
  transferred: number
  status: TransferStatus
  speedBps: number
  localPath?: string
  error?: string
  createdAt: number
  updatedAt: number
}

export interface IncomingTransferRequest {
  requestId: string
  peerId: string
  peerName: string
  fileName: string
  fileSize: number
  mimeType: string
  createdAt: number
}

export type WsEnvelope =
  | {
      type: 'hello'
      id: string
      name: string
      hostname: string
    }
  | {
      type: 'chat.text'
      id: string
      text: string
      createdAt: number
    }
  | {
      type: 'chat.ack'
      id: string
    }
  | {
      type: 'chat.image'
      id: string
      transferId: string
      fileName: string
      fileSize: number
      mimeType: string
      previewDataUrl?: string
      createdAt: number
    }
  | {
      type: 'transfer.offer'
      transferId: string
      fileName: string
      fileSize: number
      mimeType: string
      kind: 'file' | 'image'
      createdAt: number
    }
  | {
      type: 'transfer.accept'
      transferId: string
    }
  | {
      type: 'transfer.reject'
      transferId: string
      reason?: string
    }
  | {
      type: 'transfer.cancel'
      transferId: string
    }
  | {
      type: 'transfer.progress'
      transferId: string
      transferred: number
      speedBps: number
    }
  | {
      type: 'transfer.done'
      transferId: string
      ok: boolean
      error?: string
    }

export interface AnnouncePayload {
  type: 'announce'
  id: string
  name: string
  hostname: string
  httpPort: number
  wsPort: number
  ts: number
}

export const PROTOCOL_VERSION = '1'
/** Browsers cannot set custom headers on WebSocket, so this also blocks drive-by web pages. */
export const WS_PROTOCOL_HEADER = 'x-lancomm-protocol'
export const TRANSFER_TOTAL_HEADER = 'x-lancomm-total'

export const DISCOVERY_PORT = 41234
export const DISCOVERY_MULTICAST = '239.255.90.91'
export const DEFAULT_HTTP_PORT = 17890
export const DEFAULT_WS_PORT = 17891
export const PORT_RETRY_ATTEMPTS = 12

export const CHUNK_SIZE = 512 * 1024
export const PEER_TIMEOUT_MS = 12000
export const ANNOUNCE_INTERVAL_MS = 2000

export const SCAN_MIN_INTERVAL_MS = 6000
export const SCAN_MAX_INTERVAL_MS = 120000
export const SCAN_IDLE_INTERVAL_MS = 60000

export const ACCEPT_TIMEOUT_MS = 60000
export const ACK_TIMEOUT_MS = 6000

export const MAX_MESSAGES_PER_PEER = 800
export const MAX_TRANSFERS = 300
