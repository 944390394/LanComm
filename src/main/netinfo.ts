import { networkInterfaces } from 'os'

export interface InterfaceInfo {
  address: string
  netmask: string
}

export function getLocalInterfaces(): InterfaceInfo[] {
  const result: InterfaceInfo[] = []
  for (const list of Object.values(networkInterfaces())) {
    if (!list) continue
    for (const item of list) {
      if (item.family === 'IPv4' && !item.internal) {
        result.push({ address: item.address, netmask: item.netmask })
      }
    }
  }
  return result
}

export function getLocalIPv4s(): string[] {
  return getLocalInterfaces()
    .map((i) => i.address)
    .sort()
}

export function isValidIPv4(ip: string): boolean {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    const n = Number(part)
    return n >= 0 && n <= 255
  })
}

/** Node reports IPv4 peers as ::ffff:a.b.c.d when the socket is dual-stack. */
export function normalizeIp(ip?: string | null): string {
  if (!ip) return ''
  if (ip.startsWith('::ffff:')) return ip.slice(7)
  if (ip === '::1') return '127.0.0.1'
  return ip
}

export function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

export function intToIp(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

export function ipv4Broadcast(address: string, netmask: string): string | null {
  try {
    const broadcast = (ipToInt(address) & ipToInt(netmask)) | (~ipToInt(netmask) >>> 0)
    return intToIp(broadcast >>> 0)
  } catch {
    return null
  }
}
