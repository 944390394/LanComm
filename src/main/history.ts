import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  ChatMessage,
  MAX_MESSAGES_PER_PEER,
  MAX_TRANSFERS,
  TransferItem
} from '../shared/types'

export interface HistorySnapshot {
  messages: Record<string, ChatMessage[]>
  transfers: TransferItem[]
}

interface HistoryFile extends HistorySnapshot {
  version: 1
}

let saveTimer: NodeJS.Timeout | null = null

function historyPath(): string {
  return join(app.getPath('userData'), 'lop2p-history.json')
}

/** Inline image previews can be hundreds of KB each, so they are dropped before writing. */
function slimMessage(msg: ChatMessage): ChatMessage {
  const { previewDataUrl: _preview, ...rest } = msg
  void _preview
  return rest
}

export function loadHistory(): HistorySnapshot {
  const path = historyPath()
  if (!existsSync(path)) return { messages: {}, transfers: [] }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<HistoryFile>
    const messages: Record<string, ChatMessage[]> = {}
    if (raw.messages && typeof raw.messages === 'object') {
      for (const [peerId, list] of Object.entries(raw.messages)) {
        if (!Array.isArray(list)) continue
        messages[peerId] = list.slice(-MAX_MESSAGES_PER_PEER)
      }
    }

    const transfers = Array.isArray(raw.transfers)
      ? raw.transfers.slice(0, MAX_TRANSFERS).map((item) =>
          item.status === 'transferring' || item.status === 'pending'
            ? { ...item, status: 'failed' as const, error: '程序已退出', speedBps: 0 }
            : item
        )
      : []

    return { messages, transfers }
  } catch {
    return { messages: {}, transfers: [] }
  }
}

export function saveHistory(snapshot: HistorySnapshot): void {
  const messages: Record<string, ChatMessage[]> = {}
  for (const [peerId, list] of Object.entries(snapshot.messages)) {
    if (!list.length) continue
    messages[peerId] = list.slice(-MAX_MESSAGES_PER_PEER).map(slimMessage)
  }

  const data: HistoryFile = {
    version: 1,
    messages,
    transfers: snapshot.transfers.slice(0, MAX_TRANSFERS)
  }

  try {
    writeFileSync(historyPath(), JSON.stringify(data), 'utf-8')
  } catch (err) {
    console.error('[history] save failed', err)
  }
}

export function scheduleSaveHistory(getSnapshot: () => HistorySnapshot): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveHistory(getSnapshot())
  }, 1500)
}

export function flushHistory(getSnapshot: () => HistorySnapshot): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  saveHistory(getSnapshot())
}
