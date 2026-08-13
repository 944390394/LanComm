import { AnnouncePayload, WsEnvelope } from '../shared/types'

const MAX_TEXT_LENGTH = 100_000
const MAX_PREVIEW_LENGTH = 1_500_000
const MAX_FILE_SIZE = 1024 ** 4

function isNonEmptyString(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536
}

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_FILE_SIZE
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Everything below arrives from an unauthenticated LAN socket, so each field is
 * checked before it reaches code that assumes strings and numbers.
 */
export function parseAnnounce(raw: Buffer): AnnouncePayload | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw.toString('utf-8')) as Record<string, unknown>
  } catch {
    return null
  }

  if (!data || data.type !== 'announce') return null
  if (!isNonEmptyString(data.id, 128)) return null
  if (!isPort(data.httpPort) || !isPort(data.wsPort)) return null

  return {
    type: 'announce',
    id: data.id,
    name: isNonEmptyString(data.name, 128) ? data.name : '',
    hostname: isNonEmptyString(data.hostname, 128) ? data.hostname : '',
    httpPort: data.httpPort,
    wsPort: data.wsPort,
    ts: isTimestamp(data.ts) ? data.ts : Date.now()
  }
}

export function parseEnvelope(raw: string): WsEnvelope | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  if (!data || typeof data.type !== 'string') return null

  switch (data.type) {
    case 'hello':
      if (!isNonEmptyString(data.id, 128)) return null
      return {
        type: 'hello',
        id: data.id,
        name: isNonEmptyString(data.name, 128) ? data.name : '未知设备',
        hostname: isNonEmptyString(data.hostname, 128) ? data.hostname : ''
      }

    case 'chat.text':
      if (!isNonEmptyString(data.id, 128)) return null
      if (typeof data.text !== 'string' || data.text.length > MAX_TEXT_LENGTH) return null
      return {
        type: 'chat.text',
        id: data.id,
        text: data.text,
        createdAt: isTimestamp(data.createdAt) ? data.createdAt : Date.now()
      }

    case 'chat.ack':
      if (!isNonEmptyString(data.id, 128)) return null
      return { type: 'chat.ack', id: data.id }

    case 'chat.image':
      if (!isNonEmptyString(data.id, 128) || !isNonEmptyString(data.transferId, 128)) return null
      if (!isNonEmptyString(data.fileName, 512) || !isSize(data.fileSize)) return null
      return {
        type: 'chat.image',
        id: data.id,
        transferId: data.transferId,
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: isNonEmptyString(data.mimeType, 128)
          ? data.mimeType
          : 'application/octet-stream',
        previewDataUrl:
          typeof data.previewDataUrl === 'string' &&
          data.previewDataUrl.startsWith('data:image/') &&
          data.previewDataUrl.length <= MAX_PREVIEW_LENGTH
            ? data.previewDataUrl
            : undefined,
        createdAt: isTimestamp(data.createdAt) ? data.createdAt : Date.now()
      }

    case 'transfer.offer':
      if (!isNonEmptyString(data.transferId, 128)) return null
      if (!isNonEmptyString(data.fileName, 512) || !isSize(data.fileSize)) return null
      return {
        type: 'transfer.offer',
        transferId: data.transferId,
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: isNonEmptyString(data.mimeType, 128)
          ? data.mimeType
          : 'application/octet-stream',
        kind: data.kind === 'image' ? 'image' : 'file',
        createdAt: isTimestamp(data.createdAt) ? data.createdAt : Date.now()
      }

    case 'transfer.accept':
      if (!isNonEmptyString(data.transferId, 128)) return null
      return { type: 'transfer.accept', transferId: data.transferId }

    case 'transfer.cancel':
      if (!isNonEmptyString(data.transferId, 128)) return null
      return { type: 'transfer.cancel', transferId: data.transferId }

    case 'transfer.reject':
      if (!isNonEmptyString(data.transferId, 128)) return null
      return {
        type: 'transfer.reject',
        transferId: data.transferId,
        reason: isNonEmptyString(data.reason, 256) ? data.reason : undefined
      }

    case 'transfer.progress':
      if (!isNonEmptyString(data.transferId, 128)) return null
      if (!isSize(data.transferred)) return null
      return {
        type: 'transfer.progress',
        transferId: data.transferId,
        transferred: data.transferred,
        speedBps: isSize(data.speedBps) ? data.speedBps : 0
      }

    case 'transfer.done':
      if (!isNonEmptyString(data.transferId, 128)) return null
      return {
        type: 'transfer.done',
        transferId: data.transferId,
        ok: data.ok === true,
        error: isNonEmptyString(data.error, 512) ? data.error : undefined
      }

    default:
      return null
  }
}
