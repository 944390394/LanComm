import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { hostname } from 'os'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import {
  AppSettings,
  AutoAcceptMode,
  DEFAULT_HTTP_PORT,
  DEFAULT_WS_PORT,
  LocalIdentity
} from '../shared/types'
import { getLocalIPv4s } from './netinfo'

interface PersistedStore extends AppSettings {
  id: string
}

let cache: PersistedStore | null = null

function storePath(): string {
  return join(app.getPath('userData'), 'lop2p-config.json')
}

function localHostname(): string {
  return hostname() || '本机'
}

function defaultSettings(): AppSettings {
  return {
    name: localHostname(),
    downloadDir: join(app.getPath('downloads'), '局域网通信软件'),
    httpPort: DEFAULT_HTTP_PORT,
    wsPort: DEFAULT_WS_PORT,
    autoAcceptMode: 'trusted',
    trustedPeerIds: [],
    notifyOnMessage: true,
    notifyOnTransfer: true,
    minimizeToTray: true,
    autoLaunch: false
  }
}

function isAutoAcceptMode(value: unknown): value is AutoAcceptMode {
  return value === 'always' || value === 'trusted' || value === 'ask'
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 65536
}

function load(): PersistedStore {
  if (cache) return cache

  let raw: Partial<PersistedStore> = {}
  const path = storePath()
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<PersistedStore>
    } catch {
      raw = {}
    }
  }

  const defaults = defaultSettings()
  cache = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uuidv4(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : defaults.name,
    downloadDir:
      typeof raw.downloadDir === 'string' && raw.downloadDir
        ? raw.downloadDir
        : defaults.downloadDir,
    httpPort: isPort(raw.httpPort) ? raw.httpPort : defaults.httpPort,
    wsPort: isPort(raw.wsPort) ? raw.wsPort : defaults.wsPort,
    autoAcceptMode: isAutoAcceptMode(raw.autoAcceptMode)
      ? raw.autoAcceptMode
      : defaults.autoAcceptMode,
    trustedPeerIds: Array.isArray(raw.trustedPeerIds)
      ? raw.trustedPeerIds.filter((x): x is string => typeof x === 'string')
      : [],
    notifyOnMessage:
      typeof raw.notifyOnMessage === 'boolean' ? raw.notifyOnMessage : defaults.notifyOnMessage,
    notifyOnTransfer:
      typeof raw.notifyOnTransfer === 'boolean' ? raw.notifyOnTransfer : defaults.notifyOnTransfer,
    minimizeToTray:
      typeof raw.minimizeToTray === 'boolean' ? raw.minimizeToTray : defaults.minimizeToTray,
    autoLaunch: typeof raw.autoLaunch === 'boolean' ? raw.autoLaunch : defaults.autoLaunch
  }

  persist()
  return cache
}

function persist(): void {
  if (!cache) return
  try {
    writeFileSync(storePath(), JSON.stringify(cache, null, 2), 'utf-8')
  } catch (err) {
    console.error('[store] save failed', err)
  }
}

export function getSettings(): AppSettings {
  const { id: _id, ...settings } = load()
  void _id
  return settings
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const current = load()
  if (typeof patch.name === 'string') {
    current.name = patch.name.trim() || localHostname()
  }
  if (typeof patch.downloadDir === 'string' && patch.downloadDir) {
    current.downloadDir = patch.downloadDir
  }
  if (isPort(patch.httpPort)) current.httpPort = patch.httpPort
  if (isPort(patch.wsPort)) current.wsPort = patch.wsPort
  if (isAutoAcceptMode(patch.autoAcceptMode)) current.autoAcceptMode = patch.autoAcceptMode
  if (Array.isArray(patch.trustedPeerIds)) {
    current.trustedPeerIds = Array.from(new Set(patch.trustedPeerIds))
  }
  if (typeof patch.notifyOnMessage === 'boolean') current.notifyOnMessage = patch.notifyOnMessage
  if (typeof patch.notifyOnTransfer === 'boolean') current.notifyOnTransfer = patch.notifyOnTransfer
  if (typeof patch.minimizeToTray === 'boolean') current.minimizeToTray = patch.minimizeToTray
  if (typeof patch.autoLaunch === 'boolean') current.autoLaunch = patch.autoLaunch

  persist()
  return getSettings()
}

/** Ports are decided at startup after resolving conflicts, so they bypass validation above. */
export function setResolvedPorts(httpPort: number, wsPort: number): void {
  const current = load()
  current.httpPort = httpPort
  current.wsPort = wsPort
  persist()
}

export function getIdentity(): LocalIdentity {
  const current = load()
  return {
    id: current.id,
    name: current.name,
    hostname: localHostname(),
    ips: getLocalIPv4s(),
    httpPort: current.httpPort,
    wsPort: current.wsPort,
    downloadDir: current.downloadDir
  }
}

export function getDownloadDir(): string {
  const dir = load().downloadDir
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function isTrustedPeer(peerId: string): boolean {
  return load().trustedPeerIds.includes(peerId)
}

export function trustPeer(peerId: string): void {
  const current = load()
  if (!current.trustedPeerIds.includes(peerId)) {
    current.trustedPeerIds.push(peerId)
    persist()
  }
}
