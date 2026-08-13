import { createSocket, Socket } from 'dgram'
import { EventEmitter } from 'events'
import {
  ANNOUNCE_INTERVAL_MS,
  AnnouncePayload,
  DEFAULT_HTTP_PORT,
  DEFAULT_WS_PORT,
  DISCOVERY_MULTICAST,
  DISCOVERY_PORT,
  LocalIdentity,
  PEER_TIMEOUT_MS,
  PeerInfo,
  SCAN_IDLE_INTERVAL_MS,
  SCAN_MAX_INTERVAL_MS,
  SCAN_MIN_INTERVAL_MS
} from '../shared/types'
import { InterfaceInfo, getLocalInterfaces, intToIp, ipToInt, ipv4Broadcast } from './netinfo'
import { parseAnnounce } from './validate'

const INTERFACE_CACHE_MS = 5000
const PROBE_TIMEOUT_MS = 400
const SCAN_CONCURRENCY = 48

function log(...args: unknown[]): void {
  console.log('[discovery]', ...args)
}

interface RemoteIdentity {
  type?: string
  id?: string
  name?: string
  hostname?: string
  httpPort?: number
  wsPort?: number
}

export class DiscoveryService extends EventEmitter {
  private socket: Socket | null = null
  private announceTimer: NodeJS.Timeout | null = null
  private sweepTimer: NodeJS.Timeout | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private peers = new Map<string, PeerInfo>()
  private identity: LocalIdentity
  private scanning = false
  private scanDelay = SCAN_MIN_INTERVAL_MS
  private interfaces: InterfaceInfo[] = []
  private interfacesAt = 0
  private stopped = false

  constructor(identity: LocalIdentity) {
    super()
    this.identity = identity
  }

  updateIdentity(identity: LocalIdentity): void {
    this.identity = identity
  }

  start(): void {
    if (this.socket) return
    this.stopped = false

    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket

    socket.on('error', (err) => {
      log('socket error:', err.message)
      this.emit('error', err)
    })

    socket.on('message', (msg, rinfo) => this.handleMessage(msg, rinfo.address))

    socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      try {
        socket.setBroadcast(true)
      } catch (err) {
        log('setBroadcast failed:', err)
      }

      try {
        socket.setMulticastTTL(1)
        socket.setMulticastLoopback(true)
        socket.addMembership(DISCOVERY_MULTICAST)
      } catch (err) {
        log('multicast join failed:', err)
      }

      for (const iface of this.localInterfaces()) {
        try {
          socket.addMembership(DISCOVERY_MULTICAST, iface.address)
        } catch {
          // A single interface refusing membership must not abort the rest.
        }
      }

      log('listening on UDP', DISCOVERY_PORT)
      this.announce()
      this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL_MS)
      this.sweepTimer = setInterval(() => this.sweep(), 1000)
      this.queueScan(1500)
    })
  }

  stop(): void {
    this.stopped = true
    for (const timer of [this.announceTimer, this.sweepTimer, this.scanTimer]) {
      if (timer) clearTimeout(timer as NodeJS.Timeout)
    }
    this.announceTimer = null
    this.sweepTimer = null
    this.scanTimer = null

    try {
      this.socket?.dropMembership(DISCOVERY_MULTICAST)
    } catch {
      // Membership may already be gone when the interface disappeared.
    }
    this.socket?.close()
    this.socket = null
    this.peers.clear()
  }

  getPeers(): PeerInfo[] {
    return Array.from(this.peers.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  getPeer(id: string): PeerInfo | undefined {
    return this.peers.get(id)
  }

  addOrUpdatePeer(peer: PeerInfo): PeerInfo {
    this.upsertPeer(peer)
    return this.peers.get(peer.id) ?? peer
  }

  /** Called by the UI when the user asks for an immediate re-scan. */
  rescan(): void {
    this.scanDelay = SCAN_MIN_INTERVAL_MS
    this.announce()
    this.queueScan(0)
  }

  private localInterfaces(): InterfaceInfo[] {
    const now = Date.now()
    if (now - this.interfacesAt > INTERFACE_CACHE_MS) {
      this.interfaces = getLocalInterfaces()
      this.interfacesAt = now
    }
    return this.interfaces
  }

  private announce(): void {
    if (!this.socket) return
    const payload: AnnouncePayload = {
      type: 'announce',
      id: this.identity.id,
      name: this.identity.name,
      hostname: this.identity.hostname,
      httpPort: this.identity.httpPort,
      wsPort: this.identity.wsPort,
      ts: Date.now()
    }
    const buf = Buffer.from(JSON.stringify(payload), 'utf-8')

    const targets = new Set<string>(['255.255.255.255', DISCOVERY_MULTICAST])
    for (const iface of this.localInterfaces()) {
      const broadcast = ipv4Broadcast(iface.address, iface.netmask)
      if (broadcast) targets.add(broadcast)
    }

    for (const host of targets) {
      this.socket.send(buf, 0, buf.length, DISCOVERY_PORT, host, (err) => {
        if (err) log('send failed to', host, err.message)
      })
    }
  }

  private handleMessage(msg: Buffer, ip: string): void {
    const data = parseAnnounce(msg)
    if (!data || data.id === this.identity.id) return
    if (ip === '127.0.0.1') return

    this.upsertPeer({
      id: data.id,
      name: data.name || data.hostname || '未知设备',
      hostname: data.hostname,
      ip,
      httpPort: data.httpPort,
      wsPort: data.wsPort,
      lastSeen: Date.now(),
      online: true
    })
  }

  private upsertPeer(peer: PeerInfo): void {
    const existing = this.peers.get(peer.id)
    const changed =
      !existing ||
      existing.name !== peer.name ||
      existing.ip !== peer.ip ||
      existing.httpPort !== peer.httpPort ||
      existing.wsPort !== peer.wsPort ||
      !existing.online

    this.peers.set(peer.id, peer)
    if (changed) {
      log('peer online:', peer.name, peer.ip)
      this.emit('peers', this.getPeers())
    }
  }

  private sweep(): void {
    const now = Date.now()
    let changed = false

    for (const [id, peer] of this.peers) {
      const idle = now - peer.lastSeen
      if (idle <= PEER_TIMEOUT_MS) continue

      if (peer.online) {
        peer.online = false
        changed = true
        log('peer offline:', peer.name, peer.ip)
      }
      if (idle > PEER_TIMEOUT_MS * 4) {
        this.peers.delete(id)
        changed = true
      }
    }

    if (changed) this.emit('peers', this.getPeers())
  }

  private hasOnlinePeer(): boolean {
    for (const peer of this.peers.values()) {
      if (peer.online) return true
    }
    return false
  }

  private queueScan(delay: number): void {
    if (this.stopped) return
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = setTimeout(() => {
      void this.scanSubnet().finally(() => this.queueScan(this.nextScanDelay()))
    }, delay)
  }

  /**
   * Scanning a /24 costs hundreds of requests, so it only runs aggressively while no
   * peer has been found. Once a device is online, UDP keeps it fresh and we idle.
   */
  private nextScanDelay(): number {
    if (this.hasOnlinePeer()) {
      this.scanDelay = SCAN_MIN_INTERVAL_MS
      return SCAN_IDLE_INTERVAL_MS
    }
    this.scanDelay = Math.min(this.scanDelay * 2, SCAN_MAX_INTERVAL_MS)
    return this.scanDelay
  }

  private async scanSubnet(): Promise<void> {
    if (this.scanning || this.stopped) return
    this.scanning = true

    try {
      const hosts = this.candidateHosts()
      if (!hosts.length) return

      const ports = Array.from(
        new Set([this.identity.wsPort, this.identity.httpPort, DEFAULT_WS_PORT, DEFAULT_HTTP_PORT])
      )

      let index = 0
      const worker = async (): Promise<void> => {
        while (index < hosts.length && !this.stopped) {
          const host = hosts[index++]
          for (const port of ports) {
            if (await this.probeIdentity(host, port)) break
          }
        }
      }

      await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker))
    } finally {
      this.scanning = false
    }
  }

  private candidateHosts(): string[] {
    const hosts = new Set<string>()

    for (const iface of this.localInterfaces()) {
      const address = ipToInt(iface.address)
      const mask = ipToInt(iface.netmask)
      const prefix = maskPrefixLength(iface.netmask)

      // Anything wider than a /24 is clamped to the local /24 to keep the scan bounded.
      const [network, broadcast] =
        prefix < 24
          ? [(address & 0xffffff00) >>> 0, ((address & 0xffffff00) | 0xff) >>> 0]
          : [(address & mask) >>> 0, ((address & mask) | (~mask >>> 0)) >>> 0]

      for (let value = network + 1; value < broadcast; value += 1) {
        const ip = intToIp(value)
        if (ip !== iface.address) hosts.add(ip)
      }
    }

    return Array.from(hosts)
  }

  private async probeIdentity(host: string, port: number): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(`http://${host}:${port}/identity`, {
        method: 'GET',
        signal: controller.signal
      })
      if (!res.ok) return false

      const data = (await res.json()) as RemoteIdentity
      if (data.type !== 'identity' || !data.id || data.id === this.identity.id) return false

      this.upsertPeer({
        id: data.id,
        name: data.name || data.hostname || '未知设备',
        hostname: data.hostname || '',
        ip: host,
        httpPort: data.httpPort || DEFAULT_HTTP_PORT,
        wsPort: data.wsPort || DEFAULT_WS_PORT,
        lastSeen: Date.now(),
        online: true
      })
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}

function maskPrefixLength(netmask: string): number {
  return netmask
    .split('.')
    .reduce((acc, oct) => acc + (Number(oct) >>> 0).toString(2).replace(/0/g, '').length, 0)
}
