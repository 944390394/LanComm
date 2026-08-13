import { contextBridge, ipcRenderer, webUtils, IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  ChatMessage,
  IncomingTransferRequest,
  LocalIdentity,
  PeerInfo,
  TransferItem
} from '../shared/types'

type Unsubscribe = () => void

function on<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  getIdentity: (): Promise<LocalIdentity> => ipcRenderer.invoke('app:getIdentity'),
  setDisplayName: (name: string): Promise<LocalIdentity> =>
    ipcRenderer.invoke('app:setDisplayName', name),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', patch),
  chooseDownloadDir: (): Promise<string | null> =>
    ipcRenderer.invoke('settings:chooseDownloadDir'),

  listPeers: (): Promise<PeerInfo[]> => ipcRenderer.invoke('peers:list'),
  rescanPeers: (): Promise<boolean> => ipcRenderer.invoke('peers:rescan'),
  connectByIp: (ip: string): Promise<PeerInfo> => ipcRenderer.invoke('peers:connectByIp', ip),

  getMessages: (peerId: string): Promise<ChatMessage[]> =>
    ipcRenderer.invoke('chat:getMessages', peerId),
  clearMessages: (peerId: string): Promise<boolean> => ipcRenderer.invoke('chat:clear', peerId),
  sendText: (peerId: string, text: string): Promise<ChatMessage> =>
    ipcRenderer.invoke('chat:sendText', peerId, text),
  connectPeer: (peerId: string): Promise<{ connected: boolean }> =>
    ipcRenderer.invoke('chat:connect', peerId),

  chooseFiles: (): Promise<string[]> => ipcRenderer.invoke('files:choose'),
  /** Electron 32 removed File.path; without this a dropped file would be read into memory. */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  sendFiles: (
    peerId: string,
    filePaths: string[],
    previewDataUrl?: string
  ): Promise<ChatMessage[]> =>
    ipcRenderer.invoke('files:send', peerId, filePaths, previewDataUrl),
  sendBuffer: (
    peerId: string,
    payload: { fileName: string; mimeType: string; base64: string }
  ): Promise<ChatMessage[]> => ipcRenderer.invoke('files:sendBuffer', peerId, payload),
  sendClipboard: (peerId: string): Promise<ChatMessage | ChatMessage[]> =>
    ipcRenderer.invoke('clipboard:send', peerId),

  listTransfers: (): Promise<TransferItem[]> => ipcRenderer.invoke('transfers:list'),
  cancelTransfer: (transferId: string): Promise<boolean> =>
    ipcRenderer.invoke('transfers:cancel', transferId),
  respondToTransferRequest: (
    requestId: string,
    accept: boolean,
    trust: boolean
  ): Promise<boolean> => ipcRenderer.invoke('transfers:respond', requestId, accept, trust),

  openPath: (targetPath: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('shell:openPath', targetPath),
  showItemInFolder: (targetPath: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('shell:showItemInFolder', targetPath),
  openDownloadDir: (): Promise<string> => ipcRenderer.invoke('shell:openDownloadDir'),

  onPeersUpdate: (cb: (peers: PeerInfo[]) => void): Unsubscribe => on('peers:update', cb),
  onIdentityUpdate: (cb: (identity: LocalIdentity) => void): Unsubscribe =>
    on('identity:update', cb),
  onChatMessages: (
    cb: (payload: { peerId: string; messages: ChatMessage[] }) => void
  ): Unsubscribe => on('chat:messages', cb),
  onChatMessage: (cb: (msg: ChatMessage) => void): Unsubscribe => on('chat:message', cb),
  onTransferUpdate: (cb: (item: TransferItem) => void): Unsubscribe => on('transfer:update', cb),
  onTransferList: (cb: (list: TransferItem[]) => void): Unsubscribe => on('transfer:list', cb),
  onTransferRequest: (cb: (request: IncomingTransferRequest) => void): Unsubscribe =>
    on('transfer:request', cb),
  onTransferRequestClosed: (cb: (requestId: string) => void): Unsubscribe =>
    on('transfer:request-closed', cb),
  onPeerConnection: (
    cb: (payload: { peerId: string; connected: boolean }) => void
  ): Unsubscribe => on('peer:connection', cb)
}

contextBridge.exposeInMainWorld('lop2p', api)

export type Lop2pApi = typeof api
